import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAiContent } from './aiGateway';

const withTokenHub = async (run: () => Promise<void>) => {
  const saved = {
    openai: process.env.OPENAI_API_KEY,
    ark: process.env.ARK_API_KEY,
    tokenHub: process.env.TOKENHUB_API_KEY,
    model: process.env.TOKENHUB_MODEL,
    fetch: globalThis.fetch,
  };
  delete process.env.OPENAI_API_KEY;
  delete process.env.ARK_API_KEY;
  process.env.TOKENHUB_API_KEY = 'test-token';
  process.env.TOKENHUB_MODEL = 'ark/gpt-6.1-sol';
  try { await run(); } finally {
    globalThis.fetch = saved.fetch;
    for (const [key, value] of [
      ['OPENAI_API_KEY', saved.openai], ['ARK_API_KEY', saved.ark],
      ['TOKENHUB_API_KEY', saved.tokenHub], ['TOKENHUB_MODEL', saved.model],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('image analysis uses the configured GPT gateway', async () => {
  await withTokenHub(async () => {
    let body: any;
    globalThis.fetch = async (_url, options) => {
      body = JSON.parse(String(options?.body));
      return Response.json({ model: 'gpt-6.1-sol', output_text: '{"ok":true}' });
    };
    const response = await generateAiContent({ contents: [{ parts: [
      { text: 'Describe this image' }, { inlineData: { data: 'aGVsbG8=', mimeType: 'image/png' } },
    ] }] });
    assert.equal(response.text, '{"ok":true}');
    assert.equal(body.model, 'ark/gpt-6.1-sol');
    assert.equal(body.input[0].content[1].type, 'input_image');
  });
});

test('gateway failures are reported without provider fallback', async () => {
  await withTokenHub(async () => {
    globalThis.fetch = async () => Response.json({ error: { message: 'gateway unavailable' } }, { status: 502 });
    await assert.rejects(generateAiContent({ contents: 'Describe this' }), /gateway unavailable/);
  });
});

test('unsupported audio fails without sending an invalid vision request', async () => {
  await withTokenHub(async () => {
    globalThis.fetch = async () => { throw new Error('Audio must not be sent to text gateway'); };
    await assert.rejects(generateAiContent({ contents: [{ parts: [
      { text: 'Analyze this audio' }, { inlineData: { data: 'aGVsbG8=', mimeType: 'audio/wav' } },
    ] }] }), /未配置音频理解模型/);
  });
});
