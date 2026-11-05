import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSfxBatch, normalizeSfxBatchInput } from './sfxBatchServer';
import { normalizeMusicVisualInput } from './musicVisualPrompt';
import { batchRangeFrameCount, batchVideoFrameCount, batchVideoSegments, batchVideoOverview, mergeBatchVideoRequirements } from './sfxBatchVideoAnalysis';
import type { SfxBatchRequirement } from './sfxBatch';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=';
const frames = (count: number) => Array.from({ length: count }, (_, index) => ({ data: png, mimeType: 'image/png', label: `视频画面 ${index} 秒` }));
const event = (name: string, time: number): SfxBatchRequirement => ({ id: name, name, time, endTime: time + 0.5,
  description: '金属碰撞，短促清晰，轻微余响，无音乐', keywords: '碰撞', searchQuery: 'metal impact', duration: 0.5, scene: '画面动作建议' });

test('manual ranges use dense bounded sampling and reject invalid boundaries', () => {
  assert.equal(batchRangeFrameCount(16.5, 19.5, 53.3), 25);
  assert.equal(batchRangeFrameCount(1, 1.1, 10), 6);
  assert.equal(batchRangeFrameCount(0, 30, 60), 96);
  for (const [start, end] of [[-1, 2], [2, 2], [3, 2], [0, 11], [NaN, 2]]) {
    assert.throws(() => batchRangeFrameCount(start, end, 10), /范围无效/);
  }
});

test('manual range analysis keeps simultaneous events, absolute times and bounded endings', async () => {
  assert.throws(() => normalizeSfxBatchInput({ sourceType: 'video', rangeReview: true, files: frames(1), pointTime: 16.5, pointEndTime: 19.5, videoDuration: 53.3 }), /多张/);
  const files = frames(25).map((f, i) => ({ ...f, label: `视频画面 ${16.5 + i * 0.125} 秒` }));
  const input = normalizeSfxBatchInput({ sourceType: 'video', rangeReview: true, files, pointTime: 16.5, pointEndTime: 19.5, videoDuration: 53.3 });
  let calls = 0;
  const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
    calls++;
    const prompt = options.contents[0].parts[0].text;
    assert.match(prompt, /手动框选范围/); assert.match(prompt, /同一秒和同一画面内可返回多条/);
    assert.doesNotMatch(prompt, /最多返回一条最相关|视频细致拆解|遗漏复查|分段细查/);
    assert.match(prompt, /分析细致体现在描述准确/); assert.match(prompt, /一次成功\/奖励反馈/);
    assert.match(prompt, /不按对象数量机械拆分/); assert.match(prompt, /静态海滩/);
    assert.equal(options.contents[0].parts.filter((p: any) => p.inlineData).length, 25);
    return { text: JSON.stringify({ items: [event('Card_Flip', 17), event('Glow', 17), event('Before', 16), event('After', 19.5), { ...event('Tail', 19.3), endTime: 20 }] }) };
  }) as any);
  assert.equal(calls, 1);
  assert.deepEqual(result.items.map(i => [i.name, i.time, i.endTime]), [['Card_Flip', 17, 17.5], ['Glow', 17, 17.5], ['Tail', 19.3, 19.5]]);
});

test('dense video budget covers short actions and segment boundaries without raising music limits', () => {
  assert.equal(batchVideoFrameCount(1), 12);
  assert.equal(batchVideoFrameCount(5), 21);
  assert.equal(batchVideoFrameCount(10), 41);
  assert.equal(batchVideoFrameCount(53.3), 215);
  assert.ok(53.3 / (batchVideoFrameCount(53.3) - 1) <= 0.25, '53-second footage retains subsecond detail');
  assert.equal(batchVideoFrameCount(120), 240);
  const groups = batchVideoSegments(Array.from({ length: 215 }, (_, i) => i));
  assert.equal(groups.length, 9);
  assert.deepEqual([...new Set(groups.flat())].sort((a, b) => a - b), Array.from({ length: 215 }, (_, i) => i));
  assert.ok(groups[0].includes(24) && groups[1].includes(23), 'boundary actions have context in both groups');
  const overview = batchVideoOverview(Array.from({ length: 215 }, (_, i) => i));
  assert.equal(overview.length, 48); assert.equal(overview[0], 0); assert.equal(overview.at(-1), 214);
  assert.equal(normalizeSfxBatchInput({ sourceType: 'video', files: frames(240) }).files.length, 240);
  assert.throws(() => normalizeSfxBatchInput({ sourceType: 'video', files: frames(241) }), /240/);
  assert.throws(() => normalizeMusicVisualInput({ sourceType: 'video', files: frames(9) }), /8/);
});

test('same-second actions and simultaneous objects using the same name/query remain separate', () => {
  const first = event('Card_Flip', 1);
  const second = { ...first, scene: '上方玩家右侧纸牌翻面' };
  const layer = { ...first, description: '纸牌旁出现明亮粒子，清脆闪烁' };
  const repeated = { ...first, time: 1.1, endTime: 1.6 };
  const result = mergeBatchVideoRequirements([first], [first, second, layer, repeated]);
  assert.equal(result.length, 4);
  assert.deepEqual(result.map(item => item.time), [1, 1, 1, 1.1]);
});

test('merging removes cross-pass duplicates but retains repeated events and overlapping sound layers', () => {
  const first = event('Metal_Hit', 1);
  const merged = mergeBatchVideoRequirements([first], [first, event('Metal_Hit', 5), event('Debris_Fall', 1)]);
  assert.deepEqual(merged.map(item => [item.name, item.time]), [['Metal_Hit', 1], ['Debris_Fall', 1], ['Metal_Hit', 5]]);
  assert.equal(mergeBatchVideoRequirements([], Array.from({ length: 120 }, (_, i) => event(`Event_${i}`, i))).length, 120);
  assert.throws(() => mergeBatchVideoRequirements([], Array.from({ length: 301 }, (_, i) => event(`Event_${i}`, i))), /超过300/);
});

test('whole-video review replaces candidates, merges feedback phases and drops static decoration while keeping independent triggers', async () => {
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: frames(58), videoDuration: 60 });
  const seen = new Set<string>(), progress: string[] = [];
  let calls = 0;
  const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
    const parts = options.contents[0].parts, prompt = parts[0].text as string;
    calls++;
    if (calls <= 3) {
      assert.match(prompt, /分段细查/); assert.match(prompt, /只有相邻画面中明确新发生/);
      assert.doesNotMatch(prompt, /不同声音层分别列出|补充有画面依据的持续环境/);
      parts.filter((part: any) => part.text?.startsWith('视频画面 ')).forEach((part: any) => seen.add(part.text));
      return { text: JSON.stringify({ items: calls === 1
        ? [event('Card_Flip', 2), event('Flip_Glow', 2.2), event('Static_Beach', 0)]
        : calls === 2 ? [event('Independent_Click', 2), event('Card_Flip', 8)] : [event('Boundary_Hit', 16)] }) };
    }
    assert.match(prompt, /新事件制作复核/); assert.match(prompt, /Static_Beach/); assert.match(prompt, /完整最终清单/);
    assert.match(prompt, /候选scene已有明确前后变化依据/);
    return { text: JSON.stringify({ items: [{ ...event('Card_Flip', 2), endTime: 2.7, duration: 0.7,
      description: '翻牌动作伴随短促亮光反馈，纸擦与清脆尾音合为完整素材' },
      event('Independent_Click', 2), event('Card_Flip', 8), event('Boundary_Hit', 16)] }) };
  }) as any, message => progress.push(message));
  assert.equal(calls, 4); assert.equal(seen.size, 58);
  assert.deepEqual(result.items.map(item => [item.name, item.time]), [['Card_Flip', 2], ['Independent_Click', 2], ['Card_Flip', 8], ['Boundary_Hit', 16]]);
  assert.equal(result.items[0].endTime, 2.7);
  assert.match(result.items[0].description, /亮光反馈/);
  assert.ok(progress.some(message => /核对新触发依据/.test(message)));
});

test('dense video passes are bounded and finish before overview review', async () => {
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: frames(215), videoDuration: 220 });
  let active = 0, maxActive = 0, completed = 0;
  const seen = new Set<string>();
  await analyzeSfxBatch(input, undefined, (async (options: any) => {
    const parts = options.contents[0].parts;
    if (/新事件制作复核/.test(parts[0].text)) {
      assert.equal(completed, 9); assert.equal(active, 0);
      assert.equal(parts.filter((p: any) => p.inlineData).length, 48);
    } else {
      active++; maxActive = Math.max(active, maxActive);
      parts.filter((p: any) => p.text?.startsWith('视频画面 ')).forEach((p: any) => seen.add(p.text));
      await new Promise(resolve => setImmediate(resolve));
      active--; completed++;
    }
    return { text: JSON.stringify({ items: [] }) };
  }) as any);
  assert.equal(maxActive, 3); assert.equal(seen.size, 215);
});

test('video analysis propagates failed segments and cancellation instead of returning an incomplete list', async () => {
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: frames(20), videoDuration: 30 });
  let calls = 0;
  await assert.rejects(analyzeSfxBatch(input, undefined, (async () => {
    if (++calls === 2) throw new Error('segment failed');
    return { text: JSON.stringify({ items: [event('First', 1)] }) };
  }) as any), /segment failed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(analyzeSfxBatch(input, controller.signal, (async () => { throw new Error('must not call'); }) as any), { name: 'AbortError' });
});

test('a review may reject every unsupported candidate instead of restoring the unreviewed list', async () => {
  const input = normalizeSfxBatchInput({ sourceType: 'video', files: frames(20), videoDuration: 30 });
  let calls = 0;
  const result = await analyzeSfxBatch(input, undefined, (async () => ({ text: JSON.stringify({ items:
    ++calls === 1 ? [event('Persistent_Glow', 1)] : [] }) })) as any);
  assert.equal(calls, 2); assert.deepEqual(result.items, []);
});

test('single-point review stays single-pass and unstructured text uses a discovery pass', async () => {
  for (const input of [normalizeSfxBatchInput({ text: '按原表提取' }), normalizeSfxBatchInput({ sourceType: 'video', files: frames(1), pointTime: 2, pointEndTime: 4, videoDuration: 10 })]) {
    let calls = 0;
    const result = await analyzeSfxBatch(input, undefined, (async (options: any) => {
      calls++;
      return { text: JSON.stringify(JSON.stringify(options.contents).includes('这是需求表逐行盘点')
        ? { isRequirementList: false, sourceItemCount: 0, rows: [] } : { items: [event('One', 2)] }) };
    }) as any);
    assert.equal(calls, input.sourceType === 'video' ? 1 : 2); assert.equal(result.items.length, 1);
  }
});
