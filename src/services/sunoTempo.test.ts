import assert from 'node:assert/strict';
import test from 'node:test';
import { containsTimelineReference, formatSunoBpmRange, materializeAudioDesignResult } from './aiService';

const gamePlan = {
  style: '阿拉伯马卡姆融合电影管弦',
  styleEnglish: 'Arabic maqam with cinematic orchestration',
  instrumentation: '乌德琴、框鼓、弦乐铺底',
  instrumentationEnglish: 'oud, frame drum, string bed',
  visualRationale: '沙漠探索场景需要有地域特征、低干扰且可长时间循环的配乐。',
  bpm: 105,
  key: 'D minor',
  vocalDirection: '',
  vocalDirectionEnglish: '',
  sunoDirection: {
    use: '沙漠探索常驻游戏BGM',
    useEnglish: 'looping desert exploration game BGM',
    moodEnergy: '好奇而克制，能量稳定',
    moodEnergyEnglish: 'curious, restrained, steady energy',
    instrumentRoles: '乌德琴主奏、框鼓定拍、弦乐铺底',
    instrumentRolesEnglish: 'oud lead, frame drum pulse, strings bed',
    tempoFeel: '中速',
    tempoFeelEnglish: 'moderate',
    melodyMix: '短动机，给环境音留白',
    melodyMixEnglish: 'short motif, room for ambient effects',
    formEnding: '轻微渐进，可无缝循环',
    formEndingEnglish: 'gentle build, seamless loop',
    exclude: '密集鼓点和现代合成器',
    excludeEnglish: 'busy drums and modern synths',
  },
};

test('Suno prompt tempo stays near the recommended BPM without fixing one exact tempo', () => {
  assert.equal(formatSunoBpmRange('105'), '100-110 BPM');
  assert.equal(formatSunoBpmRange('80'), '75-85 BPM');
  assert.equal(formatSunoBpmRange('103'), '100-110 BPM');
});

test('Suno prompt tempo remains within the supported BPM limits', () => {
  assert.equal(formatSunoBpmRange('40'), '40-50 BPM');
  assert.equal(formatSunoBpmRange('220'), '210-220 BPM');
});

test('Suno BPM ranges are not mistaken for timeline segments', () => {
  for (let bpm = 40; bpm <= 220; bpm += 1) {
    const prompt = `cohesive full-length song; ${formatSunoBpmRange(String(bpm))}; D minor.`;
    assert.equal(containsTimelineReference(prompt), false, prompt);
  }
  assert.equal(containsTimelineReference('舒缓配乐；75-85 BPM；D minor。'), false);
});

test('actual time ranges and arrangement sequences remain disallowed', () => {
  for (const prompt of [
    '00:12-00:20 进入高潮',
    '0-5s intro',
    '5-12 秒低音进入',
    '100-110 BPM; at 12s add drums',
    '75-85 BPM; verse → chorus',
  ]) {
    assert.equal(containsTimelineReference(prompt), true, prompt);
  }
});

test('game Suno prompt covers concise production directions while keeping the exact recommendation BPM', () => {
  const result = materializeAudioDesignResult(
    { bgmRecommendations: [gamePlan] }, true, false, { music: true, sfx: false },
  );
  const { sunoPrompt } = result.bgmRecommendations[0];
  assert.equal(sunoPrompt.bpm, '105');
  for (const part of [
    'Use:', 'Style:', 'Mood/energy:', 'Instruments:', 'Tempo:', '100-110 BPM',
    'Melody/mix:', 'Form/ending:', 'Avoid:', 'no vocals',
  ]) {
    assert.ok(sunoPrompt.english.includes(part), part);
  }
  assert.ok(sunoPrompt.chinese.includes('用途：沙漠探索常驻游戏BGM'));
  assert.ok(sunoPrompt.english.includes('seamless loop'));
  assert.equal(result.bgmRecommendations[0].timelineDesign, undefined);
});

test('film Suno prompt allows musical form without copying the video timeline', () => {
  const result = materializeAudioDesignResult({ bgmRecommendations: [{
    ...gamePlan,
    vocalDirection: '轻柔女声',
    vocalDirectionEnglish: 'soft female vocals',
    sunoDirection: {
      ...gamePlan.sunoDirection,
      use: '奇幻短片高潮配乐',
      useEnglish: 'fantasy short-film climax',
      formEnding: '前奏渐进，尾声收束',
      formEndingEnglish: 'intro builds, outro resolves',
    },
    timelineDesign: [{
      timecode: '00:00-00:08',
      instruments: '乌德琴与弦乐',
      instrumentsEnglish: 'oud and strings',
      emotion: '神秘',
      emotionEnglish: 'mysterious',
      description: '弦乐逐步增强',
      descriptionEnglish: 'strings gradually swell',
    }],
  }] }, false, true, { music: true, sfx: false });
  const { sunoPrompt } = result.bgmRecommendations[0];
  assert.ok(sunoPrompt.english.includes('intro builds, outro resolves'));
  assert.ok(sunoPrompt.english.includes('Vocals: soft female vocals'));
  assert.ok(!sunoPrompt.english.includes('00:00'));
  assert.ok(result.bgmRecommendations[0].timelineDesign?.[0].timecode === '00:00-00:08');
});

test('Suno creative directions reject explicit video timecodes', () => {
  assert.throws(() => materializeAudioDesignResult(
    { bgmRecommendations: [{
      ...gamePlan,
      sunoDirection: { ...gamePlan.sunoDirection, formEndingEnglish: 'fade at 12s' },
    }] }, true, false, { music: true, sfx: false },
  ), /包含时间码/);
});
