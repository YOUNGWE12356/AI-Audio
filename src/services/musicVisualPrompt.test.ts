import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { analyzeMusicVisualPrompt, createMusicVisualPromptRouter, normalizeMusicVisualInput } from './musicVisualPrompt';
import { getMusicVisualClipboardImage, validateMusicVisualFile } from './musicVisualPromptClient';
import { createEnglishMusicPromptForElevenLabs } from './aiService';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfkEAAAAASUVORK5CYII=';
const image = { mimeType: 'image/png', data: png, label: '图片参考' };
const input = { files: [image], sourceType: 'image', requirements: '温暖，不要鼓', duration: 30, instrumental: true };
const prompt = '用途：海边静谧画面背景配乐；风格：温暖极简原声氛围；情绪/能量：宁静舒展，低能量；配器：毡音钢琴主奏、尼龙吉他分解、柔和弦乐铺底；速度：慢速，60-70 BPM；调性：D major；旋律/混音：疏朗短动机，给对白留白；结构/结尾：自然铺展，延音收束；排除：鼓与打击乐、人声、对白、歌词。';

test('a pasted screenshot is read once when browsers expose it as both files and items', () => {
  const screenshot = new File(['image'], 'screenshot.png', { type: 'image/png' });
  let itemReads = 0;
  const item = { kind: 'file', type: 'image/png', getAsFile: () => { itemReads++; return screenshot; } };
  const clipboard = (files: File[], items: unknown[]) => ({ files, items }) as unknown as Pick<DataTransfer, 'files' | 'items'>;
  assert.equal(getMusicVisualClipboardImage(clipboard([screenshot], [item])), screenshot);
  assert.equal(itemReads, 0);
  assert.equal(getMusicVisualClipboardImage(clipboard([], [item, item])), screenshot);
  assert.equal(itemReads, 1);
  assert.equal(getMusicVisualClipboardImage(clipboard([], [{ kind: 'string', type: 'text/plain' }])), null);
  assert.equal(getMusicVisualClipboardImage(clipboard([new File(['audio'], 'clip.mp3', { type: 'audio/mpeg' })], [])), null);
});

test('visual input accepts real image data but rejects audio, invalid frames and excessive payloads', () => {
  assert.equal(normalizeMusicVisualInput(input).files[0].data, png);
  assert.equal(normalizeMusicVisualInput({ ...input, files: [{ ...image, data: `data:image/png;base64,${png}` }] }).files[0].data, png);
  for (const bad of [
    { ...input, files: [] }, { ...input, sourceType: 'audio' }, { ...input, files: [{ mimeType: 'audio/wav', data: png }] },
    { ...input, files: [{ ...image, data: 'data:image/jpeg;base64,' + png }] },
    { ...input, files: [{ ...image, data: Buffer.from('not an image').toString('base64') }] },
    { ...input, duration: NaN }, { ...input, duration: 61 }, { ...input, requirements: 'x'.repeat(5001) },
    { ...input, files: Array(9).fill(image), sourceType: 'video' },
  ]) assert.throws(() => normalizeMusicVisualInput(bad));
  assert.throws(() => normalizeMusicVisualInput({ ...input, files: [{ ...image, data: 'A'.repeat(17 * 1024 * 1024) }] }), /过大/);
  assert.equal(validateMusicVisualFile(new File(['image'], 'sample.png', { type: 'image/png' })), 'image');
  assert.equal(validateMusicVisualFile(new File(['video'], 'sample.mp4')), 'video');
  assert.throws(() => validateMusicVisualFile(new File(['audio'], 'sample.mp3', { type: 'audio/mpeg' })), /图片/);
  assert.throws(() => validateMusicVisualFile(new File([], 'empty.png', { type: 'image/png' })), /为空/);
});

test('GPT returns an editable Chinese prompt from visual inputs and preserves music constraints', async () => {
  const keys = ['OPENAI_API_KEY', 'ARK_API_KEY', 'TOKENHUB_API_KEY'];
  const saved = keys.map(key => process.env[key]);
  const nativeFetch = globalThis.fetch;
  keys.forEach(key => delete process.env[key]); process.env.TOKENHUB_API_KEY = 'test-key';
  let request: any;
  globalThis.fetch = async (_url, options) => {
    options?.signal?.throwIfAborted();
    request = JSON.parse(String(options?.body));
    return Response.json({ output_text: JSON.stringify({ text: prompt }) });
  };
  try {
    assert.equal((await analyzeMusicVisualPrompt(input)).text, prompt);
    const content = request.input[0].content;
    assert.equal(content.filter((part: any) => part.type === 'input_image').length, 1);
    assert.ok(content.some((part: any) => part.image_url === `data:image/png;base64,${png}`));
    const instructions = content[0].text;
    assert.match(instructions, /不要分析或声称听到原声/);
    assert.match(instructions, /30 秒/);
    assert.match(instructions, /不要把总时长、多少秒或多少分钟写入返回的提示词/);
    assert.match(instructions, /必须保留 BPM 速度/);
    assert.match(instructions, /简体中文配乐提示词/);
    assert.match(instructions, /生成音乐时系统会自动转换为英文/);
    assert.match(instructions, /无人声、无对白、无歌词/);
    assert.match(instructions, /不要鼓/);
    for (const field of ['用途：', '风格：', '情绪/能量：', '配器：', '速度：', '调性：', '旋律/混音：', '结构/结尾：', '排除：']) {
      assert.ok(instructions.includes(field), `Missing whole-track direction: ${field}`);
    }
    assert.match(instructions, /不复制视频时间码/);
    await analyzeMusicVisualPrompt({ ...input, sourceType: 'video', files: [image, image], instrumental: false });
    assert.equal(request.input[0].content.filter((part: any) => part.type === 'input_image').length, 2);
    assert.match(request.input[0].content[0].text, /允许原创人声/);
    const editedPrompt = `${prompt}不要弦乐。`;
    const englishPrompt = 'Use: quiet seaside background; Style: warm minimal acoustic ambience; Mood/energy: calm and restrained; Instruments: felt piano lead and nylon guitar arpeggios; Tempo: slow, 60-70 BPM; Key: D major; Melody/mix: sparse motifs, space for dialogue; Form/ending: natural development and sustained close; Avoid: no drums, no percussion, no strings, no vocals, no speech, no lyrics.';
    globalThis.fetch = async (_url, options) => {
      request = JSON.parse(String(options?.body));
      return Response.json({ output_text: englishPrompt });
    };
    assert.equal(await createEnglishMusicPromptForElevenLabs(editedPrompt, { instrumental: true }), englishPrompt);
    assert.ok(JSON.stringify(request).includes(editedPrompt));
    assert.match(JSON.stringify(request), /只返回英文 prompt/);
    assert.match(JSON.stringify(request), /完整保留 BPM 范围/);
    assert.match(JSON.stringify(request), /90～160/);
    assert.match(JSON.stringify(request), /独立接口参数控制/);
    assert.match(JSON.stringify(request), /翻译时省略/);
    assert.doesNotMatch(JSON.stringify(request), /45 个英文词/);
    await createEnglishMusicPromptForElevenLabs('温暖的钢琴背景配乐');
    assert.match(JSON.stringify(request), /45 个英文词/);
    globalThis.fetch = async () => Response.json({ output_text: '' });
    await assert.rejects(createEnglishMusicPromptForElevenLabs(editedPrompt), /no text output/);
    globalThis.fetch = async () => Response.json({ output_text: prompt });
    await assert.rejects(createEnglishMusicPromptForElevenLabs(editedPrompt), /转换失败/);
    globalThis.fetch = async () => Response.json({ output_text: '{"text":""}' });
    await assert.rejects(analyzeMusicVisualPrompt(input), /有效提示词/);
    globalThis.fetch = async () => Response.json({ output_text: JSON.stringify({ text: 'Warm instrumental background music, soft piano and acoustic guitar, no drums, no vocals.' }) });
    await assert.rejects(analyzeMusicVisualPrompt(input), /有效提示词/);
    globalThis.fetch = async () => Response.json({ error: { message: 'vision unavailable' } }, { status: 503 });
    await assert.rejects(analyzeMusicVisualPrompt(input), /vision unavailable/);
    globalThis.fetch = async (_url, options) => { options?.signal?.throwIfAborted(); throw new Error('unexpected'); };
    const canceled = new AbortController(); canceled.abort();
    await assert.rejects(analyzeMusicVisualPrompt(input, canceled.signal), { name: 'AbortError' });
  } finally {
    globalThis.fetch = nativeFetch;
    keys.forEach((key, index) => saved[index] === undefined ? delete process.env[key] : process.env[key] = saved[index]);
  }
});

test('the visual endpoint rejects invalid media before requesting a model', async () => {
  const app = express(); app.use(express.json()); app.use('/music-prompt', createMusicVisualPromptRouter());
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/music-prompt/from-visual`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [] }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /请选择图片或视频/);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
