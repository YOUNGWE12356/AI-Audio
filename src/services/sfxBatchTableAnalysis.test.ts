import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeBatchTable } from './sfxBatchTableAnalysis';
import { analyzeSfxBatch, normalizeSfxBatchInput } from './sfxBatchServer';

const input = { text: '原表有15项音效，包含相似需求。', instructions: '', files: [] };
const source = (count = 15) => ({ isRequirementList: true, sourceItemCount: count,
  rows: Array.from({ length: count }, (_, i) => ({ rowNumber: i + 1, name: i < 2 ? '鼓掌' : `需求${i + 1}`, rawText: `第${i + 1}项的原始描述`, kind: 'sfx', reason: '' })) });
const cue = (sourceRowId: string) => ({ sourceRowId, id: sourceRowId, name: 'Sfx_Test', description: '短促清晰的音效',
  keywords: '提示', searchQuery: 'click', duration: 1, scene: '按钮点击', sourceKind: 'sfx', sourceReason: '' });
const inventoryGateway = (value = source()) => (async () => ({ text: JSON.stringify(value) })) as any;

test('15 source rows with 13 generated cues automatically recover the missing two, preserving source order and duplicate names', async () => {
  const calls: string[][] = [], progress: string[] = [];
  let repaired = false;
  const result = await analyzeBatchTable(input, inventoryGateway(), undefined, message => progress.push(message), async rows => {
    calls.push(rows.map(row => row.sourceRowId));
    const result = rows.filter(row => repaired || !['row-14', 'row-15'].includes(row.sourceRowId));
    if (rows.some(row => row.sourceRowId === 'row-14')) repaired = true;
    return result.reverse().map(row => ({ ...cue(row.sourceRowId), name: row.name }));
  });
  assert.equal(result!.sourceItemCount, 15); assert.equal(result!.items.length, 15);
  assert.ok(calls.some(ids => JSON.stringify(ids) === JSON.stringify(['row-14', 'row-15'])));
  assert.deepEqual(result!.items.map(row => row.id), Array.from({ length: 15 }, (_, i) => `row-${i + 1}`));
  assert.equal(result!.items.filter(row => row.name === '鼓掌').length, 2);
  assert.ok(progress.some(message => message.includes('补查2条')));
});

test('independent screenshot inventory review can recover rows missing from the initial recognition', async () => {
  let reads = 0;
  const result = await analyzeBatchTable(input, (async () => ({ text: JSON.stringify(source(++reads === 1 ? 13 : 15)) })) as any,
    undefined, () => {}, async rows => rows.map(row => cue(row.sourceRowId)));
  assert.equal(reads, 2); assert.equal(result!.items.length, 15);
});

test('music and speech exclusions are explicit while uncertain and crowd vocal effects remain in the list', async () => {
  const inventory = source(5);
  inventory.rows[0] = { ...inventory.rows[0], name: '开场配乐', kind: 'music', reason: '原表明确要求背景配乐' };
  inventory.rows[1] = { ...inventory.rows[1], name: '英文配音', kind: 'speech', reason: '原表要求说出台词' };
  inventory.rows[2] = { ...inventory.rows[2], name: '不明确的提示', kind: 'unclear', reason: '描述截断' };
  inventory.rows[3].name = '欢呼'; inventory.rows[4].name = '喝倒彩';
  const result = await analyzeBatchTable(input, inventoryGateway(inventory), undefined, () => {}, async rows => rows.map(row => cue(row.sourceRowId)));
  assert.equal(result!.sourceItemCount, 5); assert.equal(result!.items.length, 3);
  assert.deepEqual(result!.excludedItems.map(row => row.name), ['开场配乐', '英文配音']);
  assert.match(result!.items[0].scene, /待确认.*描述截断/);
  assert.equal(result!.items.length + result!.excludedItems.length, 5);
});

test('persistent missing rows and duplicate or invented source IDs cannot produce a completed partial list', async () => {
  await assert.rejects(analyzeBatchTable(input, inventoryGateway(), undefined, () => {}, async rows => rows
    .filter(row => !['row-14', 'row-15'].includes(row.sourceRowId)).map(row => cue(row.sourceRowId))), /仍有2条.*需求14、需求15/);
  for (const ids of [['row-1', 'row-1'], ['not-a-source-row']]) {
    await assert.rejects(analyzeBatchTable(input, inventoryGateway(), undefined, () => {}, async () => ids.map(cue)), /无法一一对应/);
  }
});

test('inventory count mismatches, lost rows in review, bad row numbers and cancellation are rejected', async () => {
  const mismatch = { ...source(13), sourceItemCount: 15 };
  await assert.rejects(analyzeBatchTable(input, inventoryGateway(mismatch), undefined, () => {}, async () => []), /声明15条，读到13条/);
  let calls = 0;
  await assert.rejects(analyzeBatchTable(input, (async () => ({ text: JSON.stringify(source(++calls === 1 ? 15 : 13)) })) as any,
    undefined, () => {}, async () => []), /两次核对的行数不一致/);
  const wrongNumber = source(); wrongNumber.rows[14].rowNumber = 14;
  await assert.rejects(analyzeBatchTable(input, inventoryGateway(wrongNumber), undefined, () => {}, async () => []), /第15条/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeBatchTable(input, inventoryGateway(), controller.signal, () => {}, async () => []), { name: 'AbortError' });
});

test('all-music lists account for every row and ordinary scene images fall back to visual analysis', async () => {
  const music = source(2); music.rows.forEach(row => { row.kind = 'music'; row.reason = '背景音乐'; });
  const result = await analyzeBatchTable(input, inventoryGateway(music), undefined, () => {}, async () => { throw new Error('must not generate SFX'); });
  assert.equal(result!.items.length, 0); assert.equal(result!.excludedItems.length, 2);
  assert.equal(await analyzeBatchTable(input, inventoryGateway({ isRequirementList: false, sourceItemCount: 0, rows: [] }), undefined,
    () => {}, async () => { throw new Error('must use visual fallback'); }), null);
});

test('real batch orchestration validates source IDs before returning all 15 normalized requirements', async () => {
  let calls = 0;
  let repaired = false;
  const result = await analyzeSfxBatch(normalizeSfxBatchInput(input), undefined, (async (options: any) => {
    calls++;
    if (calls <= 2) return { text: JSON.stringify(source()) };
    assert.match(options.contents[0].parts[0].text, /不得跨行合并、漏行/);
    assert.ok(options.config.responseSchema.properties.items.items.required.includes('sourceRowId'));
    const ids = options.config.responseSchema.properties.items.items.properties.sourceRowId.enum as string[];
    const accepted = ids.filter(id => repaired || !['row-14', 'row-15'].includes(id));
    if (ids.includes('row-14')) repaired = true;
    return { text: JSON.stringify({ items: accepted.map(id => ({ ...cue(id), name: `Cue ${id.slice(4)}` })) }) };
  }) as any);
  assert.equal(calls, 5); assert.equal(result.items.length, 15);
  assert.equal(new Set(result.items.map(row => row.id)).size, 15);
  assert.equal(result.items[14].name, '需求15');
});

const numbered = (count: number) => Array.from({ length: count }, (_, i) => `${i + 1}. 第${i + 1}条声音，保留原场景与时长`).join('\n');

test('structured text avoids AI transcription but keeps all rows, global context and at most two enrichment requests active', async () => {
  const text = numbered(25);
  let active = 0, peak = 0, calls = 0;
  const result = await analyzeBatchTable({ text, instructions: '无音乐、无人声', files: [] },
    (async () => { throw new Error('must not transcribe structured text'); }) as any, undefined, () => {}, async (rows, context) => {
      calls++; active++; peak = Math.max(peak, active);
      assert.equal(context.sourceText, text); assert.equal(context.classifyRows, true);
      assert.ok(rows.length <= 8);
      await new Promise(resolve => setTimeout(resolve, rows[0].sourceRowId === 'row-1' ? 10 : 1));
      active--;
      return [...rows].reverse().map(row => cue(row.sourceRowId));
    });
  assert.equal(calls, 4); assert.equal(peak, 2);
  assert.equal(result!.sourceItemCount, 25);
  assert.deepEqual(result!.items.map(item => item.id), Array.from({ length: 25 }, (_, i) => `row-${i + 1}`));
});

test('pasted numbered requirements in instructions are parsed and incomplete fields repaired without repeating valid rows', async () => {
  const instructions = numbered(3);
  const calls: string[][] = [];
  const result = await analyzeBatchTable({ text: '', instructions, files: [] }, inventoryGateway(), undefined, () => {}, async (rows, context) => {
    assert.equal(context.sourceText, instructions);
    calls.push(rows.map(row => row.sourceRowId));
    return rows.map(row => ({ ...cue(row.sourceRowId), keywords: calls.length === 1 && row.sourceRowId === 'row-2' ? '' : '掠过' }));
  });
  assert.equal(result!.items.length, 3);
  assert.deepEqual(calls, [['row-1', 'row-2', 'row-3'], ['row-2']]);
});

test('local rows classify music and speech with reasons, retain uncertain rows, and preserve explicit source names', async () => {
  const text = '序号\t命名\t音效描述\n1\t开场\t背景音乐\n2\t对白\t说出台词\n3\t残缺\t描述被截断\n4\tCrowd Cheer\t欢呼';
  const result = await analyzeBatchTable({ text, instructions: '', files: [] }, inventoryGateway(), undefined, () => {}, async rows => rows.map((row, i) => ({
    ...cue(row.sourceRowId), sourceKind: ['music', 'speech', 'unclear', 'sfx'][i], sourceReason: ['原表背景音乐', '原表台词', '描述截断', ''][i],
  })));
  assert.equal(result!.sourceItemCount, 4); assert.equal(result!.items.length, 2);
  assert.deepEqual(result!.excludedItems.map(item => item.name), ['开场', '对白']);
  assert.match(result!.items[0].scene, /待确认.*描述截断/);
  assert.equal(result!.items[1].name, 'Crowd_Cheer');
});

test('failed groups cancel active model requests and stop queued groups', async () => {
  let started = 0;
  await assert.rejects(analyzeBatchTable({ text: numbered(25), instructions: '', files: [] }, inventoryGateway(), undefined, () => {}, async (_rows, context) => {
    started++;
    if (started === 1) {
      await new Promise((_, reject) => context.signal.addEventListener('abort', () => reject(context.signal.reason), { once: true }));
      return [];
    }
    throw new Error('provider unavailable');
  }), /provider unavailable/);
  assert.equal(started, 2);
});

test('real structured orchestration retains source fields, checks IDs and repairs only a malformed row without translation calls', async () => {
  const calls: string[][] = [];
  const text = '命名,音效描述,时长,场景\nCard Flip,纸牌快速翻动；无音乐,1.5,室内棋牌桌\nCard Flip,厚纸牌缓慢翻动；无音乐,3,室内棋牌桌';
  const result = await analyzeSfxBatch(normalizeSfxBatchInput({ text, instructions: '保持原命名' }), undefined, (async (options: any) => {
    const schema = options.config.responseSchema.properties.items.items;
    assert.ok(!schema.required.includes('searchQuery'));
    assert.ok(schema.required.includes('sourceKind'));
    assert.match(options.contents[0].parts[0].text, /整份原表作为只读场景上下文/);
    assert.ok(options.contents[0].parts[0].text.includes('厚纸牌缓慢翻动；无音乐'));
    const ids = schema.properties.sourceRowId.enum as string[];
    calls.push(ids);
    if (calls.length === 2) assert.match(options.contents[0].parts[0].text, /上次返回字段无效.*duration必须为0.5～30秒的数值/);
    return { text: JSON.stringify({ items: ids.map(id => ({ ...cue(id), searchQuery: undefined,
      description: id === 'row-1' ? '纸牌快速翻动；无音乐' : '厚纸牌缓慢翻动；无音乐', keywords: '纸牌、翻动',
      duration: id === 'row-1' ? 1.5 : calls.length === 1 ? 99 : 3, scene: '室内棋牌桌' })) }) };
  }) as any);
  assert.deepEqual(calls, [['row-1', 'row-2'], ['row-2']]);
  assert.deepEqual(result.items.map(row => [row.name, row.duration, row.scene, row.searchQuery]),
    [['Card_Flip', 1.5, '室内棋牌桌', ''], ['Card_Flip', 3, '室内棋牌桌', '']]);
  assert.match(result.items[1].description, /缓慢.*无音乐/);
});
