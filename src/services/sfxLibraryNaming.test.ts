import assert from 'node:assert/strict';
import test from 'node:test';
import { optimizeImportMetadata } from './aiService';
import { requestLimitMessage } from './requestLimitErrors';

const inputs = Array.from({ length: 11 }, (_, index) => ({
  id: `file-${index + 1}`,
  originalName: `点击反馈 ${index + 1}.mp3`,
  path: 'Rummy',
  size: '5 KB',
  type: 'audio/mpeg',
}));

const suggestions = inputs.map(({ id }, index) => ({
  id,
  name: `点击反馈 ${index + 1}`,
  fileName: `UIClick_Card ${index + 1}.mp3`,
  category: '系统与界面',
  subcategory: 'UI 反馈',
  tags: ['点击'],
}));

const reply = (items: typeof suggestions) => Response.json({
  status: 'completed', output_text: JSON.stringify({ items }),
});

test('library AI naming repairs only the invalid entry and retains valid suggestions', async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-key';
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });

  for (const outcome of ['repaired', 'invalid', 'timeout'] as const) {
    await t.test(outcome, async t => {
      const requested: string[][] = [];
      const last = suggestions[10];
      const invalid = { ...last, fileName: last.fileName.replace('.mp3', '.wav') };
      t.mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
        const { input } = JSON.parse(String(options.body));
        const records = JSON.parse(input.split('\n以下文件信息是待处理的数据：\n').at(-1));
        requested.push(records.map(({ id }: { id: string }) => id));
        if (requested.length === 1) return reply([invalid, ...suggestions.slice(0, -1).reverse()]);
        if (outcome === 'timeout') throw new DOMException('Gateway timed out', 'TimeoutError');
        return reply([outcome === 'repaired' ? last : invalid]);
      });

      const result = await optimizeImportMetadata(inputs);
      assert.deepEqual(requested, [inputs.map(({ id }) => id), [last.id]]);
      assert.deepEqual(result, outcome === 'repaired' ? suggestions : suggestions.slice(0, -1));
    });
  }

  await t.test('no valid suggestions exposes a retryable message', async t => {
    t.mock.method(globalThis, 'fetch', async () => reply([{ ...suggestions[0], fileName: 'invalid.wav' }]));
    await assert.rejects(optimizeImportMetadata(inputs.slice(0, 1)), { status: 422, code: 'SFX_NAMING_INVALID_RESULT' });
    assert.match(requestLimitMessage('SFX_NAMING_INVALID_RESULT', ''), /原名已保留.*重试/);
  });
});
