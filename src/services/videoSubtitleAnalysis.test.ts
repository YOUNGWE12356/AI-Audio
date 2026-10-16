import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeVideoSubtitles, buildSubtitleClips, type SubtitleFrame } from './videoSubtitleAnalysis';

test('different adjacent subtitle lines stay independent even for the same narrator', () => {
  const clips = buildSubtitleClips([
    { timestamp: 0, text: '第一句' }, { timestamp: 0.5, text: '第一句' },
    { timestamp: 1, text: '第二句' }, { timestamp: 1.5, text: '第二句' },
    { timestamp: 2, text: '' },
  ], 2.3);
  assert.deepEqual(clips.map(c => [c.text, c.startTime, c.duration]), [
    ['第一句', 0, 0.75], ['第二句', 0.75, 1],
  ]);
  assert.ok(clips.every(c => c.startTime === c.subtitleStartTime && c.duration === c.subtitleEndTime - c.startTime));
});

test('silence stays empty and the same sentence after a gap gets a separate cue', () => {
  const clips = buildSubtitleClips([
    { timestamp: 0, text: '' }, { timestamp: 0.5, text: 'Hello!' },
    { timestamp: 1, text: '' }, { timestamp: 1.5, text: 'Hello!' },
  ], 1.8);
  assert.deepEqual(clips.map(c => [c.startTime, c.subtitleEndTime]), [[0.25, 0.75], [1.25, 1.8]]);
  assert.notEqual(clips[0].subtitleId, clips[1].subtitleId);
});

test('timestamps never get invented by the vision model, including the final short interval', () => {
  const clips = buildSubtitleClips([{ timestamp: 0, text: '日本語です' }, { timestamp: 0.5, text: '日本語です' }], 0.73);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].duration, 0.73);
  assert.equal(clips[0].lipSyncConfidence, 0);
  assert.throws(() => buildSubtitleClips([{ timestamp: 1, text: 'A' }, { timestamp: 0, text: 'B' }], 2), /采样时间/);
});

test('visual line wraps do not split Japanese words or join separate English words', () => {
  const clips = buildSubtitleClips([
    { timestamp: 0, text: '今日はハッピ\nーな牧羊犬' },
    { timestamp: 0.5, text: '今日はハッピーな牧羊犬' },
    { timestamp: 1, text: 'Hello\nmy friend' },
  ], 1.3);
  assert.deepEqual(clips.map(c => c.text), ['今日はハッピーな牧羊犬', 'Hello my friend']);
});

const frames: SubtitleFrame[] = Array.from({ length: 34 }, (_, i) => ({ timestamp: i / 2, base64: 'test-frame' }));
const rowsFor = (request: any) => request.contents.filter((p: any) => p.text?.startsWith('帧编号')).map((p: any) => ({
  index: Number(p.text.match(/帧编号 (\d+)/)[1]), text: '同一条字幕', speaker: 'unknown', uncertain: false,
}));

test('caption continuity survives request batch boundaries without joining different text', async () => {
  let calls = 0;
  const clips = await analyzeVideoSubtitles(frames, 17, async request => {
    calls++;
    const rows = rowsFor(request).map(r => ({ ...r, text: r.index < 17 ? '第一句话' : 'Next sentence' }));
    return { text: JSON.stringify({ frames: rows }), modelVersion: 'test' };
  });
  assert.equal(calls, 3);
  assert.deepEqual(clips.map(c => [c.text, c.startTime, c.subtitleEndTime]), [
    ['第一句话', 0, 8.25], ['Next sentence', 8.25, 17],
  ]);
});

test('missing, duplicate and unreadable OCR frames fail instead of creating a plausible timeline', async () => {
  for (const mode of ['missing', 'duplicate', 'unreadable']) {
    await assert.rejects(analyzeVideoSubtitles(frames.slice(0, 3), 2, async request => {
      const rows = rowsFor(request);
      if (mode === 'missing') rows.pop();
      if (mode === 'duplicate') rows[1].index = rows[0].index;
      if (mode === 'unreadable') rows[1].uncertain = true;
      return { text: JSON.stringify({ frames: rows }), modelVersion: 'test' };
    }), /缺帧|可靠辨认/);
  }
});

test('upstream failure and empty captions do not become fabricated speech', async () => {
  await assert.rejects(analyzeVideoSubtitles(frames.slice(0, 2), 1, async () => { throw new Error('gateway offline'); }), /gateway offline/);
  const clips = await analyzeVideoSubtitles(frames.slice(0, 2), 1, async request => ({
    text: JSON.stringify({ frames: rowsFor(request).map(r => ({ ...r, text: '' })) }), modelVersion: 'test',
  }));
  assert.deepEqual(clips, []);
});
