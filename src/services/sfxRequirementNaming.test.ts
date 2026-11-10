import assert from 'node:assert/strict';
import test from 'node:test';
import { repairRequirementUcsNames } from './sfxRequirementNaming';
import { generateSfxRequirements } from './aiService';

const source = Array.from({ length: 15 }, (_, i) => ({ index: i + 1, audio_type: 'SFX',
  filename: i === 4 ? 'Sfx_Invalid_Reward' : `Sfx_UIClick_Button_${i + 1}`, description: `第${i + 1}条具体声音描述`,
  scene: `场景${i + 1}`, duration_logic: '2秒，单次', remarks: '保留原备注' }));

test('an invalid fifth category is repaired without changing any other row or non-naming fields', async () => {
  const original = structuredClone(source);
  let calls = 0;
  const result = await repairRequirementUcsNames(source, 'game_sfx_general', { generate: (async (options: any) => {
    calls++;
    const prompt = options.contents[0].parts[0].text;
    assert.ok(!options.contents[0].parts.some((part: any) => part.inlineData));
    assert.match(prompt, /第5条具体声音描述/); assert.doesNotMatch(prompt, /第4条具体声音描述/);
    assert.ok(options.config.responseSchema.properties.repairs.items.properties.catId.enum.includes('UIClick'));
    return { text: JSON.stringify({ repairs: [{ rowNumber: 5, catId: 'UIClick', fxName: 'Reward_Confirm' }] }) };
  }) as any });
  assert.equal(calls, 1); assert.equal(result.length, 15);
  assert.deepEqual(source, original);
  assert.deepEqual(result, original.map((item, i) => i === 4 ? { ...item, filename: 'Sfx_UIClick_Reward_Confirm' } : item));
});

test('repair retries only missing/invalid names and never accepts invented row numbers, duplicate IDs or fake categories', async () => {
  const rows = source.map((item, i) => i === 8 ? { ...item, filename: 'Sfx_Fake_Door' } : item);
  const requested: number[][] = [];
  const result = await repairRequirementUcsNames(rows, 'game_sfx_general', { generate: (async (options: any) => {
    requested.push(options.config.responseSchema.properties.repairs.items.properties.rowNumber.enum);
    return { text: JSON.stringify({ repairs: requested.length === 1 ? [{ rowNumber: 5, catId: 'UIClick', fxName: 'Reward' }]
      : [{ rowNumber: 9, catId: 'DOORWood', fxName: 'Creak' }] }) };
  }) as any });
  assert.deepEqual(requested, [[5, 9], [9]]); assert.equal(result.length, 15);
  for (const repairs of [[{ rowNumber: 1, catId: 'UIClick', fxName: 'Click' }],
    [{ rowNumber: 5, catId: 'FAKE', fxName: 'Click' }],
    [{ rowNumber: 5, catId: 'UIClick', fxName: 'Click' }, { rowNumber: 5, catId: 'UIClick', fxName: 'Other' }]]) {
    await assert.rejects(repairRequirementUcsNames(source, 'game_sfx_general', { generate: (async () => ({ text: JSON.stringify({ repairs }) })) as any }), /第 5 行/);
  }
});

test('valid names, BGM and VO need no repair; cancellation prevents any AI request', async () => {
  const rows = [source[0], { ...source[4], audio_type: 'BGM', filename: 'Bgm_Battle' }, { ...source[4], audio_type: 'VO', filename: 'Vo_Hello' }];
  assert.deepEqual(await repairRequirementUcsNames(rows, 'game_sfx_general', { generate: (async () => { throw new Error('must not request'); }) as any }), rows);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repairRequirementUcsNames(source, 'game_sfx_general', { signal: controller.signal, generate: (async () => { throw new Error('must not request'); }) as any }), { name: 'AbortError' });
});

test('screenshot generation performs one visual read then repairs only the fifth filename, preserving all 15 source rows', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: any, options: any) => {
    calls++;
    const body = JSON.parse(options.body);
    const schema = body.text.format.schema;
    if (schema.properties.items) {
      assert.ok(Array.isArray(body.input));
      return Response.json({ output_text: JSON.stringify({ items: source, sourceItemCount: 15 }) });
    }
    assert.ok(schema.properties.repairs);
    assert.equal(typeof body.input, 'string');
    return Response.json({ output_text: JSON.stringify({ repairs: [{ rowNumber: 5, catId: 'UIClick', fxName: 'Reward' }] }) });
  });
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only-key';
  try {
    const result = await generateSfxRequirements('', { mimeType: 'image/png', data: 'fixture-base64' }, 'game_sfx_general');
    assert.equal(result.sourceItemCount, 15); assert.equal(result.items.length, 15);
    assert.equal(result.items[4].filename, 'Sfx_UIClick_Reward');
    assert.deepEqual(result.items[4].description, source[4].description);
    assert.equal(calls, 2);
  } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; }
});
