import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMusicOutputNames, type MusicOutputItem } from './musicOutputNaming';

const options = { includeNumber: true, startCode: '009', numberSeparator: '_' };
const makeItem = (name: string, mood = 'Dreamy Hopeful') => ({
  file: { name }, status: 'done', mood, scene: 'Explore', keyName: 'C Lydian', bpm: 95.7,
});

test('original filename leads, mood replaces style and category numbers start at the selected value', () => {
  const names = buildMusicOutputNames([
    { ...makeItem('童话 花园.MP3'), style: 'Piano' }, makeItem('B.wav'), makeItem('C.flac', 'Tense'),
  ], options).map(item => item.outputName);
  assert.deepEqual(names, [
    '童话_花园_009_Dreamy_Hopeful_Explore_CLydian_96BPM.mp3',
    'B_010_Dreamy_Hopeful_Explore_CLydian_96BPM.wav',
    'C_009_Tense_Explore_CLydian_96BPM.flac',
  ]);
});

test('number switch removes only the added number and preserves numbering in the original filename', () => {
  const [item] = buildMusicOutputNames([makeItem('09_主题.wav')], { ...options, includeNumber: false });
  assert.equal(item.outputName, '09_主题_Dreamy_Hopeful_Explore_CLydian_96BPM.wav');
  const originalStem = 'A'.repeat(95);
  const [longName] = buildMusicOutputNames([makeItem(`${originalStem}.wav`)], options);
  assert.ok(longName.outputName?.startsWith(`${originalStem}_009_`));
});

test('manual filenames survive option changes and pending or failed files get no automatic names', () => {
  const input: MusicOutputItem[] = [
    { ...makeItem('A.wav'), manualOutputName: '自定 标题' },
    { ...makeItem('B.wav'), status: 'pending' }, { ...makeItem('C.wav'), status: 'error' },
  ];
  const result = buildMusicOutputNames(input, { ...options, includeNumber: false });
  assert.equal(result[0].outputName, '自定_标题.wav');
  assert.equal(result[1].outputName, undefined);
  assert.equal(result[2].outputName, undefined);
  assert.equal(input[0].manualOutputName, '自定 标题');
});

test('each filename field can be excluded independently without changing the analysis', () => {
  const input = makeItem('主题.wav');
  const expected = {
    includeSource: '009_Dreamy_Hopeful_Explore_CLydian_96BPM.wav',
    includeMood: '主题_009_Explore_CLydian_96BPM.wav',
    includeScene: '主题_009_Dreamy_Hopeful_CLydian_96BPM.wav',
    includeKey: '主题_009_Dreamy_Hopeful_Explore_96BPM.wav',
    includeBpm: '主题_009_Dreamy_Hopeful_Explore_CLydian.wav',
  };
  for (const [field, name] of Object.entries(expected)) {
    const [result] = buildMusicOutputNames([input], { ...options, [field]: false });
    assert.equal(result.outputName, name, field);
    assert.equal(result.mood, input.mood);
    assert.equal(result.keyName, input.keyName);
  }
});

test('minimal selections keep valid names and number together when excluded categories differ', () => {
  const fields = { includeSource: false, includeMood: false, includeScene: false, includeKey: false, includeBpm: false };
  const input = [makeItem('A.wav'), makeItem('B.wav', 'Tense')];
  assert.deepEqual(buildMusicOutputNames(input, { ...options, ...fields }).map(item => item.outputName), ['009.wav', '010.wav']);
  assert.equal(buildMusicOutputNames(input, { ...options, ...fields, includeNumber: false })[0].outputName, 'A.wav');
  assert.equal(buildMusicOutputNames(input, { ...options, ...fields, includeBpm: true, numberSeparator: '-' })[0].outputName, '009-96BPM.wav');
  assert.equal(buildMusicOutputNames(input, { ...options, ...fields, includeNumber: false, includeMood: true })[0].outputName, 'Dreamy_Hopeful.wav');
  const [manual] = buildMusicOutputNames([{ ...input[0], manualOutputName: '我的 名字.wav' }], { ...options, ...fields });
  assert.equal(manual.outputName, '我的_名字.wav');
});
