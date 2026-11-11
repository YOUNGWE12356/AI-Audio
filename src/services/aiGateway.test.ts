import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAiContent, generateGptStructuredJson, generateGptToolTurn } from './aiGateway';
import { setAiUsageRecorder, type AiUsageEvent } from './usageTracking';

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

test('a long requirements request uses its own timeout and can still be cancelled', async () => {
  await withTokenHub(async () => {
    const originalTimeout = AbortSignal.timeout;
    const timeouts: number[] = [];
    AbortSignal.timeout = ms => { timeouts.push(ms); return originalTimeout(ms); };
    try {
      globalThis.fetch = async (_url, options) => {
        options?.signal?.throwIfAborted();
        return Response.json({ output_text: '{"items":[]}' });
      };
      await generateAiContent({ contents: 'Generate requirements', timeoutMs: 240_000 });
      assert.deepEqual(timeouts, [240_000]);
      const controller = new AbortController(); controller.abort();
      await assert.rejects(generateAiContent({ contents: 'Generate requirements', timeoutMs: 240_000, signal: controller.signal }), { name: 'AbortError' });
      globalThis.fetch = async () => { throw new DOMException('timeout', 'TimeoutError'); };
      await assert.rejects(generateAiContent({ contents: 'Generate requirements', timeoutMs: 240_000 }), /240 秒未返回/);
    } finally { AbortSignal.timeout = originalTimeout; }
  });
});

test('supplier usage survives incomplete, empty and invalid JSON output without charging failed work twice', async () => {
  await withTokenHub(async () => {
    const events: AiUsageEvent[] = [];
    setAiUsageRecorder(event => events.push(event));
    const usage = { input_tokens: 300, output_tokens: 200, total_tokens: 500, output_tokens_details: { reasoning_tokens: 40 } };
    try {
      for (const body of [
        { status: 'incomplete', output_text: '{}' }, { output_text: '' }, { output_text: 'invalid json' },
      ]) {
        globalThis.fetch = async () => Response.json({ ...body, usage });
        await assert.rejects(generateAiContent({ contents: 'requirements', config: { responseSchema: { type: 'object' } } }));
      }
      globalThis.fetch = async () => Response.json({ output_text: 'invalid json', usage });
      await assert.rejects(generateGptStructuredJson({ instructions: 'test', input: 'test', schema: {}, schemaName: 'test' }));
      globalThis.fetch = async () => Response.json({ error: { message: 'upstream failure' }, usage }, { status: 502 });
      await assert.rejects(generateAiContent({ contents: 'test' }));
      assert.equal(events.length, 5);
      for (const event of events) {
        assert.equal(event.totalTokens, 500); assert.equal(event.reasoningTokens, 40);
        assert.equal(event.companyPoints, 0); assert.equal(event.outcome, 'failed');
      }
      globalThis.fetch = async () => Response.json({ output_text: '{}', output: [], usage });
      await generateAiContent({ contents: 'test' });
      await generateGptStructuredJson({ instructions: 'test', input: 'test', schema: {}, schemaName: 'test' });
      await generateGptToolTurn({ instructions: 'test', input: [], tools: [], signal: new AbortController().signal });
      assert.equal(events.length, 8);
      assert.equal(events.reduce((sum, event) => sum + event.totalTokens, 0), 4000);
      for (const event of events.slice(5)) {
        assert.ok(event.companyPoints! > 0); assert.equal(event.outcome, 'success');
      }
    } finally { setAiUsageRecorder(null); }
  });
});
