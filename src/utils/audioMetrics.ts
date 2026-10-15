export type Confidence = '高' | '中' | '低';

export interface AnalyzerResult {
  fileName: string;
  duration: number;
  sampleRate: number;
  channels: number;
  bpm: {
    value: number;
    confidence: Confidence;
    alternatives: number[];
  };
  key: {
    name: string;
    mode: 'Major' | 'Minor';
    confidence: Confidence;
  };
  musicalMode: {
    name: string;
    englishName: string;
    confidence: Confidence;
    alternatives: string[];
    evidence: string;
  };
  globalAnalysis?: {
    primaryStyle: string;
    subStyles: string[];
    regionalTradition: string;
    modeSystem: string;
    modeName: string;
    tonic: string;
    tuningSystem: string;
    microtonal: '是' | '否' | '不确定';
    confidence: Confidence;
    alternatives: string[];
    reason: string;
    model?: string;
  };
  semanticError?: string;
  chords: Array<{
    section: string;
    chord: string;
    confidence: Confidence;
  }>;
  instruments: Array<{
    name: string;
    reason: string;
    confidence: Confidence;
  }>;
  audioProfile: {
    peakDb: number;
    rmsDb: number;
    dynamicRangeDb: number;
    noiseFloorRmsDb: number;
    snrDb: number;
    spectralCentroid: number;
    bassPercent: number;
    midPercent: number;
    highPercent: number;
    stereoWidth: number;
    zeroCrossingRate: number;
  };
  productionNotes: string[];
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const MODE_DEFINITIONS = [
  { englishName: 'Ionian', chineseName: '伊奥尼亚（自然大调）', family: 'Major' as const, intervals: [0, 2, 4, 5, 7, 9, 11], characteristic: [4, 11] },
  { englishName: 'Dorian', chineseName: '多利亚', family: 'Minor' as const, intervals: [0, 2, 3, 5, 7, 9, 10], characteristic: [3, 9] },
  { englishName: 'Phrygian', chineseName: '弗里几亚', family: 'Minor' as const, intervals: [0, 1, 3, 5, 7, 8, 10], characteristic: [1, 8] },
  { englishName: 'Lydian', chineseName: '利底亚', family: 'Major' as const, intervals: [0, 2, 4, 6, 7, 9, 11], characteristic: [4, 6] },
  { englishName: 'Mixolydian', chineseName: '混合利底亚', family: 'Major' as const, intervals: [0, 2, 4, 5, 7, 9, 10], characteristic: [4, 10] },
  { englishName: 'Aeolian', chineseName: '艾奥利亚（自然小调）', family: 'Minor' as const, intervals: [0, 2, 3, 5, 7, 8, 10], characteristic: [3, 8] },
  { englishName: 'Locrian', chineseName: '洛克里亚', family: 'Minor' as const, intervals: [0, 1, 3, 5, 6, 8, 10], characteristic: [1, 6] },
  { englishName: 'Harmonic Minor', chineseName: '和声小调', family: 'Minor' as const, intervals: [0, 2, 3, 5, 7, 8, 11], characteristic: [8, 11] },
  { englishName: 'Melodic Minor', chineseName: '旋律小调', family: 'Minor' as const, intervals: [0, 2, 3, 5, 7, 9, 11], characteristic: [9, 11] },
];

export const AUDIO_FILE_EXTENSION_REGEX = /\.(mp3|wav|m4a|aac|ogg|oga|flac|webm|opus|aif|aiff|caf)$/i;

export const formatTime = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
};

export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const dbFromPower = (value: number) => 20 * Math.log10(Math.max(value, 1e-9));

const toMono = (buffer: AudioBuffer) => {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      mono[i] += data[i] / buffer.numberOfChannels;
    }
  }
  return mono;
};

const estimateTempo = (mono: Float32Array, sampleRate: number) => {
  const envelopeRate = 100;
  const hop = Math.max(1, Math.floor(sampleRate / envelopeRate));
  const envelopeLength = Math.floor(mono.length / hop);
  const envelope = new Float32Array(envelopeLength);

  for (let i = 0; i < envelopeLength; i += 1) {
    let sum = 0;
    const start = i * hop;
    for (let j = 0; j < hop && start + j < mono.length; j += 1) {
      const sample = mono[start + j];
      sum += sample * sample;
    }
    envelope[i] = Math.sqrt(sum / hop);
  }

  let mean = 0;
  for (let i = 0; i < envelope.length; i += 1) mean += envelope[i];
  mean /= Math.max(envelope.length, 1);

  let previous = 0;
  const novelty = new Float32Array(envelope.length);
  for (let i = 0; i < envelope.length; i += 1) {
    const current = Math.max(0, envelope[i] - mean);
    novelty[i] = Math.max(0, current - previous);
    previous = current;
  }

  const candidates: Array<{ bpm: number; score: number }> = [];
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = Math.round((60 / bpm) * envelopeRate);
    let score = 0;
    for (let i = lag; i < novelty.length; i += 1) {
      score += novelty[i] * novelty[i - lag];
    }
    candidates.push({ bpm, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0] || { bpm: 120, score: 0 };
  const second = candidates.find(candidate => Math.abs(candidate.bpm - best.bpm) > 4);
  const confidence: Confidence = best.score > 0 && second
    ? best.score / Math.max(second.score, 1e-9) > 1.25
      ? '中'
      : '低'
    : '低';

  return {
    value: best.bpm,
    confidence,
    alternatives: candidates
      .filter(candidate => Math.abs(candidate.bpm - best.bpm) > 4)
      .slice(0, 3)
      .map(candidate => candidate.bpm),
  };
};

const goertzelPower = (samples: Float32Array, start: number, size: number, sampleRate: number, frequency: number) => {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let q0 = 0;
  let q1 = 0;
  let q2 = 0;

  for (let i = 0; i < size; i += 1) {
    const sample = samples[start + i] || 0;
    q0 = coeff * q1 - q2 + sample;
    q2 = q1;
    q1 = q0;
  }

  return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
};

const computeChroma = (
  mono: Float32Array,
  sampleRate: number,
  startSample = 0,
  endSample = mono.length,
) => {
  const chroma = new Array(12).fill(0) as number[];
  const windowSize = Math.min(4096, Math.max(1024, Math.floor(sampleRate * 0.09)));
  const hop = Math.max(windowSize * 3, Math.floor(sampleRate * 0.35));
  const safeEnd = Math.max(startSample + windowSize, endSample - windowSize);
  let windows = 0;

  for (let start = startSample; start < safeEnd && windows < 180; start += hop) {
    for (let note = 0; note < 12; note += 1) {
      for (let octave = 2; octave <= 6; octave += 1) {
        const midi = (octave + 1) * 12 + note;
        const frequency = 440 * Math.pow(2, (midi - 69) / 12);
        if (frequency > 60 && frequency < Math.min(sampleRate / 2, 4200)) {
          chroma[note] += Math.sqrt(goertzelPower(mono, start, windowSize, sampleRate, frequency));
        }
      }
    }
    windows += 1;
  }

  const total = chroma.reduce((sum, value) => sum + value, 0) || 1;
  return chroma.map(value => value / total);
};

const rotateProfile = (profile: number[], root: number) => (
  profile.map((_, index) => profile[(index - root + 12) % 12])
);

const correlation = (a: number[], b: number[]) => {
  const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
  const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
  let top = 0;
  let bottomA = 0;
  let bottomB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    top += da * db;
    bottomA += da * da;
    bottomB += db * db;
  }
  return top / Math.sqrt(Math.max(bottomA * bottomB, 1e-9));
};

export const estimateKey = (chroma: number[]) => {
  const scores: Array<{ root: number; mode: 'Major' | 'Minor'; score: number }> = [];
  for (let root = 0; root < 12; root += 1) {
    scores.push({ root, mode: 'Major', score: correlation(chroma, rotateProfile(MAJOR_PROFILE, root)) });
    scores.push({ root, mode: 'Minor', score: correlation(chroma, rotateProfile(MINOR_PROFILE, root)) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  const margin = best.score - second.score;
  return {
    name: `${NOTES[best.root]} ${best.mode}`,
    mode: best.mode,
    confidence: margin > 0.08 ? '中' : '低' as Confidence,
    root: best.root,
  };
};

const buildModeProfile = (definition: typeof MODE_DEFINITIONS[number]) => {
  const profile = new Array(12).fill(0.12) as number[];
  definition.intervals.forEach(interval => { profile[interval] = 0.78; });
  profile[0] = 1.55;
  profile[7] = Math.max(profile[7], 1.08);
  profile[definition.family === 'Major' ? 4 : 3] = 1.02;
  definition.characteristic.forEach(interval => { profile[interval] += 0.28; });
  return profile;
};

const averageChroma = (left: number[], right: number[]) => (
  left.map((value, index) => (value + (right[index] || 0)) / 2)
);

export const estimateMusicalMode = (
  chroma: number[],
  introChroma: number[],
  outroChroma: number[],
  estimatedKey: ReturnType<typeof estimateKey>,
) => {
  const edgeChroma = averageChroma(introChroma, outroChroma);
  const candidates = MODE_DEFINITIONS.flatMap(definition => (
    NOTES.map((_, root) => {
      const modeProfile = rotateProfile(buildModeProfile(definition), root);
      const familyProfile = rotateProfile(definition.family === 'Major' ? MAJOR_PROFILE : MINOR_PROFILE, root);
      const tonicEvidence = edgeChroma[root] + edgeChroma[(root + 7) % 12] * 0.42;
      const keyAgreement = root === estimatedKey.root
        ? definition.family === estimatedKey.mode ? 0.055 : 0.018
        : 0;
      return {
        definition,
        root,
        score: correlation(chroma, modeProfile) * 0.58
          + correlation(chroma, familyProfile) * 0.17
          + correlation(edgeChroma, modeProfile) * 0.17
          + tonicEvidence * 0.42
          + keyAgreement,
      };
    })
  ));
  candidates.sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const second = candidates[1];
  const rawMargin = best.score - second.score;
  const rawConfidence: Confidence = rawMargin > 0.09 && best.score > 0.42
    ? '高'
    : rawMargin > 0.035 && best.score > 0.28
      ? '中'
      : '低';
  const selected = rawConfidence === '低'
    ? candidates.find(candidate => (
        candidate.root === estimatedKey.root && candidate.definition.family === estimatedKey.mode
      )) || best
    : best;
  const selectedIndex = candidates.indexOf(selected);
  const selectedRunnerUp = candidates.find((candidate, index) => (
    index !== selectedIndex
    && (candidate.root !== selected.root || candidate.definition.englishName !== selected.definition.englishName)
  ));
  const selectedMargin = selectedRunnerUp ? Math.max(0, selected.score - selectedRunnerUp.score) : rawMargin;
  const confidence: Confidence = selected === best ? rawConfidence : '低';
  const characteristicNotes = selected.definition.characteristic
    .map(interval => NOTES[(selected.root + interval) % 12])
    .join(' / ');
  const formatCandidate = (candidate: typeof selected) => (
    `${NOTES[candidate.root]} ${candidate.definition.chineseName}`
  );
  const alternatives = candidates
    .filter(candidate => candidate !== selected)
    .filter(candidate => candidate.score >= selected.score - 0.12)
    .slice(0, 3)
    .map(formatCandidate);

  return {
    name: `${NOTES[selected.root]} ${selected.definition.chineseName}`,
    englishName: selected.definition.englishName,
    family: selected.definition.family,
    root: selected.root,
    confidence,
    alternatives,
    evidence: `特征音 ${characteristicNotes} · 候选差值 ${Math.round(selectedMargin * 100)}%`,
  };
};

const estimateChord = (chroma: number[]) => {
  const chordTypes = [
    { suffix: '', intervals: [0, 4, 7] },
    { suffix: 'm', intervals: [0, 3, 7] },
    { suffix: 'sus4', intervals: [0, 5, 7] },
    { suffix: '7', intervals: [0, 4, 7, 10] },
    { suffix: 'm7', intervals: [0, 3, 7, 10] },
  ];
  const scores: Array<{ chord: string; score: number }> = [];

  for (let root = 0; root < 12; root += 1) {
    for (const type of chordTypes) {
      const score = type.intervals.reduce((sum, interval) => sum + chroma[(root + interval) % 12], 0)
        - chroma.reduce((sum, value, index) => type.intervals.includes((index - root + 12) % 12) ? sum : sum + value * 0.16, 0);
      scores.push({ chord: `${NOTES[root]}${type.suffix}`, score });
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  return {
    chord: best.chord,
    confidence: best.score - second.score > 0.035 ? '中' : '低' as Confidence,
  };
};

const analyzeSpectrumProfile = (mono: Float32Array, sampleRate: number) => {
  const sampleCount = Math.min(160000, mono.length);
  const step = Math.max(1, Math.floor(mono.length / sampleCount));
  let peak = 0;
  let rmsSum = 0;
  let zeroCrossings = 0;
  let previous = 0;

  for (let i = 0; i < mono.length; i += step) {
    const value = mono[i];
    const abs = Math.abs(value);
    peak = Math.max(peak, abs);
    rmsSum += value * value;
    if ((value >= 0 && previous < 0) || (value < 0 && previous >= 0)) zeroCrossings += 1;
    previous = value;
  }

  const inspected = Math.ceil(mono.length / step);
  const rms = Math.sqrt(rmsSum / Math.max(inspected, 1));
  const noiseWindowSize = Math.max(512, Math.floor(sampleRate * 0.05));
  const noiseFrameRmsValues: number[] = [];
  for (let start = 0; start + noiseWindowSize < mono.length; start += noiseWindowSize) {
    let framePower = 0;
    for (let i = 0; i < noiseWindowSize; i += 1) {
      const sample = mono[start + i];
      framePower += sample * sample;
    }
    noiseFrameRmsValues.push(Math.sqrt(framePower / noiseWindowSize));
  }
  noiseFrameRmsValues.sort((a, b) => a - b);
  const quietFrameCount = Math.max(1, Math.floor(noiseFrameRmsValues.length * 0.1));
  const quietRmsSum = noiseFrameRmsValues
    .slice(0, quietFrameCount)
    .reduce((sum, value) => sum + value * value, 0);
  const noiseFloorRms = Math.sqrt(quietRmsSum / quietFrameCount);
  const noiseFloorRmsDb = dbFromPower(noiseFloorRms);
  const snrDb = Math.max(0, Math.min(96, dbFromPower(rms) - noiseFloorRmsDb));
  const chroma = computeChroma(mono, sampleRate);
  const estimatedKey = estimateKey(chroma);
  const edgeSampleCount = Math.min(
    Math.floor(mono.length / 3),
    Math.max(
      Math.floor(sampleRate * 8),
      Math.min(Math.floor(mono.length * 0.18), Math.floor(sampleRate * 18)),
    ),
  );
  const introChroma = computeChroma(mono, sampleRate, 0, edgeSampleCount);
  const outroChroma = computeChroma(mono, sampleRate, Math.max(0, mono.length - edgeSampleCount), mono.length);
  const musicalMode = estimateMusicalMode(chroma, introChroma, outroChroma, estimatedKey);
  const key = musicalMode.confidence === '低'
    ? estimatedKey
    : {
        name: `${NOTES[musicalMode.root]} ${musicalMode.family}`,
        mode: musicalMode.family,
        confidence: musicalMode.confidence,
        root: musicalMode.root,
      };

  const bandEnergy = { bass: 0, mid: 0, high: 0 };
  let centroidTop = 0;
  let centroidBottom = 0;
  const windowSize = 2048;
  const hop = Math.max(windowSize * 8, Math.floor(sampleRate * 0.4));
  let windows = 0;
  for (let start = 0; start + windowSize < mono.length && windows < 120; start += hop) {
    for (let frequency = 55; frequency <= Math.min(8000, sampleRate / 2); frequency += frequency < 1000 ? 55 : 160) {
      const magnitude = Math.sqrt(goertzelPower(mono, start, windowSize, sampleRate, frequency));
      if (frequency < 180) bandEnergy.bass += magnitude;
      else if (frequency < 2500) bandEnergy.mid += magnitude;
      else bandEnergy.high += magnitude;
      centroidTop += frequency * magnitude;
      centroidBottom += magnitude;
    }
    windows += 1;
  }

  const totalEnergy = bandEnergy.bass + bandEnergy.mid + bandEnergy.high || 1;
  return {
    peakDb: dbFromPower(peak),
    rmsDb: dbFromPower(rms),
    dynamicRangeDb: dbFromPower(peak) - dbFromPower(rms),
    noiseFloorRmsDb,
    snrDb,
    spectralCentroid: centroidTop / Math.max(centroidBottom, 1e-9),
    bassPercent: Math.round((bandEnergy.bass / totalEnergy) * 100),
    midPercent: Math.round((bandEnergy.mid / totalEnergy) * 100),
    highPercent: Math.round((bandEnergy.high / totalEnergy) * 100),
    zeroCrossingRate: zeroCrossings / Math.max(inspected, 1),
    chroma,
    key,
    musicalMode,
  };
};

const estimateStereoWidth = (buffer: AudioBuffer) => {
  if (buffer.numberOfChannels < 2) return 0;
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const step = Math.max(1, Math.floor(buffer.length / 100000));
  let side = 0;
  let mid = 0;
  for (let i = 0; i < buffer.length; i += step) {
    const midValue = (left[i] + right[i]) * 0.5;
    const sideValue = (left[i] - right[i]) * 0.5;
    mid += midValue * midValue;
    side += sideValue * sideValue;
  }
  return Math.min(100, Math.round((Math.sqrt(side) / Math.max(Math.sqrt(mid), 1e-9)) * 100));
};

const estimateInstruments = (
  profile: AnalyzerResult['audioProfile'],
  bpm: number,
): AnalyzerResult['instruments'] => {
  const instruments: AnalyzerResult['instruments'] = [];
  if (profile.bassPercent > 28) {
    instruments.push({ name: 'Bass / 低音乐器', confidence: '中', reason: '低频能量占比较高，可能有贝斯、低音合成器或底鼓支撑。' });
  }
  if (profile.highPercent > 24 || profile.zeroCrossingRate > 0.14) {
    instruments.push({ name: 'Drums / Hi-hat / Cymbal', confidence: '中', reason: '高频与瞬态较明显，适合判断为鼓组、镲片或电子打击。' });
  }
  if (profile.midPercent > 45) {
    instruments.push({ name: 'Piano / Guitar / Synth Lead', confidence: '低', reason: '中频主体突出，可能包含钢琴、吉他、合成器主奏或人声旋律。' });
  }
  if (profile.spectralCentroid < 1200 && profile.dynamicRangeDb < 16) {
    instruments.push({ name: 'Pad / Ambient Texture', confidence: '低', reason: '整体频谱偏暗且动态较平稳，可能有铺底 Pad 或环境氛围层。' });
  }
  if (bpm >= 120 && profile.highPercent > 18) {
    instruments.push({ name: 'Electronic Percussion / Sequencer', confidence: '低', reason: '速度偏快且高频节奏能量明显，可能包含电子节奏或序列器音色。' });
  }
  return instruments.length ? instruments.slice(0, 5) : [
    { name: 'Mixed Full Track', confidence: '低', reason: '当前音频更像完整混音，浏览器本地分析无法稳定拆出单一乐器。' },
  ];
};

const buildChordSections = (mono: Float32Array, sampleRate: number, duration: number) => {
  const sectionCount = Math.min(8, Math.max(3, Math.round(duration / 18)));
  return Array.from({ length: sectionCount }, (_, index) => {
    const startSecond = (duration / sectionCount) * index;
    const endSecond = (duration / sectionCount) * (index + 1);
    const chroma = computeChroma(
      mono,
      sampleRate,
      Math.floor(startSecond * sampleRate),
      Math.floor(endSecond * sampleRate),
    );
    const chord = estimateChord(chroma);
    return {
      section: `${formatTime(startSecond)} - ${formatTime(endSecond)}`,
      chord: chord.chord,
      confidence: chord.confidence,
    };
  });
};

const buildProductionNotes = (result: Omit<AnalyzerResult, 'productionNotes'>) => {
  const notes: string[] = [];
  notes.push(`建议工程 Tempo 先设为 ${result.bpm.value} BPM，再根据鼓点或小节网格微调。`);
  notes.push(`调性可先按 ${result.key.name} 建工程，写旋律/和声时优先围绕该调内音。`);
  notes.push(`调式倾向为 ${result.musicalMode.name}（${result.musicalMode.englishName}），编曲时可重点核对 ${result.musicalMode.evidence.split(' · ')[0].replace('特征音 ', '')}。`);
  if (result.audioProfile.peakDb > -1) notes.push('峰值接近 0 dBFS，后续混音建议预留 3-6 dB headroom。');
  if (result.audioProfile.bassPercent > 32) notes.push('低频占比较高，替换音乐时注意不要让贝斯和低鼓抢对白/音效空间。');
  if (result.audioProfile.highPercent > 28) notes.push('高频存在感明显，做游戏或视频配乐时可适当降低镲片/噪声层避免疲劳。');
  if (result.audioProfile.stereoWidth > 70) notes.push('立体声宽度较大，转单声道或手机外放前建议检查相位兼容。');
  if (result.audioProfile.snrDb < 24) notes.push('SNR 信噪比较低，素材可能有明显底噪；做人声、采样或二次混音前建议先降噪。');
  if (result.audioProfile.noiseFloorRmsDb > -45) notes.push('底噪 RMS 偏高，静音段可能能听到环境噪声、风噪、电流声或压缩噪声。');
  notes.push('乐器和和弦为本地算法估算，复杂混音建议作为创作参考而不是最终乐谱。');
  return notes;
};

export function analyzeDecodedAudio(buffer: AudioBuffer, fileName: string): AnalyzerResult {
  const mono = toMono(buffer);
  const tempo = estimateTempo(mono, buffer.sampleRate);
  const spectrum = analyzeSpectrumProfile(mono, buffer.sampleRate);
  const audioProfile = {
    peakDb: spectrum.peakDb,
    rmsDb: spectrum.rmsDb,
    dynamicRangeDb: spectrum.dynamicRangeDb,
    noiseFloorRmsDb: spectrum.noiseFloorRmsDb,
    snrDb: spectrum.snrDb,
    spectralCentroid: spectrum.spectralCentroid,
    bassPercent: spectrum.bassPercent,
    midPercent: spectrum.midPercent,
    highPercent: spectrum.highPercent,
    stereoWidth: estimateStereoWidth(buffer),
    zeroCrossingRate: spectrum.zeroCrossingRate,
  };
  const baseResult = {
    fileName,
    duration: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: buffer.numberOfChannels,
    bpm: tempo,
    key: {
      name: spectrum.key.name,
      mode: spectrum.key.mode,
      confidence: spectrum.key.confidence,
    },
    musicalMode: {
      name: spectrum.musicalMode.name,
      englishName: spectrum.musicalMode.englishName,
      confidence: spectrum.musicalMode.confidence,
      alternatives: spectrum.musicalMode.alternatives,
      evidence: spectrum.musicalMode.evidence,
    },
    chords: buildChordSections(mono, buffer.sampleRate, buffer.duration),
    instruments: estimateInstruments(audioProfile, tempo.value),
    audioProfile,
  };

  return {
    ...baseResult,
    productionNotes: buildProductionNotes(baseResult),
  };
}
