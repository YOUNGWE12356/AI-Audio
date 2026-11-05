import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeBatchTable } from './sfxBatchTableAnalysis';
import { analyzeSfxBatch, normalizeSfxBatchInput } from './sfxBatchServer';

const input = { text: '原表有15项音效，包含相似需求。', instructions: '', files: [] };
const source = (count = 15) => ({ isRequirementList: true, sourceItemCount: count,
  rows: Array.from({ length: count }, (_, i) => ({ rowNumber: i + 1, name: i < 2 ? '鼓掌' : `需求${i + 1}`, rawText: `第${i + 1}项的原始描述`, kind: 'sfx', reason: '' })) });
const cue = (sourceRowId: string) => ({ sourceRowId, id: sourceRowId, name: 'Sfx_Test', description: '短促清晰的音效',
  keywords: '提示', searchQuery: 'click', duration: 1, scene: '按钮点击' });
const inventoryGateway = (value = source()) => (async () => ({ text: JSON.stringify(value) })) as any;

test('15 source rows with 13 generated cues automatically recover the missing two, preserving source order and duplicate names', async () => {
  const calls: string[][] = [], progress: string[] = [];
  const result = await analyzeBatchTable(input, inventoryGateway(), undefined, message => progress.push(message), async rows => {
    calls.push(rows.map(row => row.sourceRowId));
    return (calls.length === 1 ? rows.slice(0, 13).reverse() : rows).map(row => ({ ...cue(row.sourceRowId), name: row.name }));
  });
  assert.equal(result!.sourceItemCount, 15); assert.equal(result!.items.length, 15);
  assert.deepEqual(calls[1], ['row-14', 'row-15']);
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
  await assert.rejects(analyzeBatchTable(input, inventoryGateway(), undefined, () => {}, async rows => rows.slice(0, -2).map(row => cue(row.sourceRowId))), /仍有2条.*需求14、需求15/);
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
  const result = await analyzeSfxBatch(normalizeSfxBatchInput(input), undefined, (async (options: any) => {
    calls++;
    if (calls <= 2) return { text: JSON.stringify(source()) };
    assert.match(options.contents[0].parts[0].text, /不得跨行合并、漏行/);
    assert.ok(options.config.responseSchema.properties.items.items.required.includes('sourceRowId'));
    return { text: JSON.stringify({ items: (calls === 3 ? Array.from({ length: 13 }, (_, i) => i + 1) : [14, 15])
      .map(i => ({ ...cue(`row-${i}`), name: `Cue ${i}` })) }) };
  }) as any);
  assert.equal(calls, 4); assert.equal(result.items.length, 15);
  assert.equal(result.items[14].name, 'Cue_15');
});
