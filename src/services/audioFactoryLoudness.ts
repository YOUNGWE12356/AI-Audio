export const FACTORY_METER_SAMPLE_RATE = 48_000;
export const FACTORY_GAIN_MIN_DB = -60;
export const FACTORY_GAIN_MAX_DB = 24;

export type FactoryLoudnessMode = 'original' | 'normalize' | 'gain';
export type FactoryLoudnessMeasurement = { lufs: number | null; peak: number };
export type FactoryLoudnessSettings = {
  mode: FactoryLoudnessMode;
  gainDb: number;
  targetLufs: number;
  peakCeilingDb: number;
};

export function measureFactoryPeak(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    for (const sample of buffer.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
  }
  return peak;
}

// BS.1770 K-weighting coefficients at 48 kHz, with 400 ms windows and 100 ms hops.
// Short effects use the available samples as one window for an indicative reading.
export function measureFactoryLoudness(buffer: AudioBuffer): FactoryLoudnessMeasurement {
  const hop = FACTORY_METER_SAMPLE_RATE / 10;
  const energies = new Float64Array(Math.ceil(buffer.length / hop));
  let peak = 0;
  const weights = buffer.numberOfChannels === 6 ? [1, 1, 1, 0, 1.41, 1.41]
    : buffer.numberOfChannels === 4 ? [1, 1, 1.41, 1.41] : [];

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    const weight = weights[channel] ?? 1;
    let shelf1 = 0;
    let shelf2 = 0;
    let highpass1 = 0;
    let highpass2 = 0;
    for (let start = 0; start < data.length; start += hop) {
      let energy = 0;
      const end = Math.min(start + hop, data.length);
      for (let index = start; index < end; index++) {
        const sample = data[index];
        peak = Math.max(peak, Math.abs(sample));
        const shelf = sample + 1.69065929318241 * shelf1 - 0.73248077421585 * shelf2;
        const filtered = 1.53512485958697 * shelf - 2.69169618940638 * shelf1 + 1.19839281085285 * shelf2;
        shelf2 = shelf1;
        shelf1 = shelf;
        const highpass = filtered + 1.99004745483398 * highpass1 - 0.99007225036621 * highpass2;
        const weighted = highpass - 2 * highpass1 + highpass2;
        highpass2 = highpass1;
        highpass1 = highpass;
        energy += weighted * weighted;
      }
      energies[start / hop] += weight * energy;
    }
  }

  const blocks: number[] = [];
  if (buffer.length < hop * 4) {
    blocks.push(energies.reduce((total, value) => total + value, 0) / buffer.length);
  } else {
    for (let index = 0; index + 4 <= Math.floor(buffer.length / hop); index++) {
      blocks.push((energies[index] + energies[index + 1] + energies[index + 2] + energies[index + 3]) / (4 * hop));
    }
  }

  const absoluteGate = 10 ** ((-70 + 0.691) / 10);
  const aboveAbsolute = blocks.filter(energy => energy > absoluteGate);
  if (!aboveAbsolute.length) return { lufs: null, peak };
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length;
  const relativeGate = mean(aboveAbsolute) / 10;
  const gatedEnergy = mean(aboveAbsolute.filter(energy => energy > relativeGate));
  return { lufs: -0.691 + 10 * Math.log10(gatedEnergy), peak };
}

export function planFactoryGain(measurement: FactoryLoudnessMeasurement, settings: FactoryLoudnessSettings) {
  const { mode, gainDb, targetLufs, peakCeilingDb } = settings;
  const requestedGainDb = mode === 'gain' ? gainDb
    : mode === 'normalize' && measurement.lufs !== null ? targetLufs - measurement.lufs : 0;
  const maxGainDb = peakCeilingDb - 20 * Math.log10(measurement.peak);
  const appliedGainDb = mode === 'original' ? 0 : Math.min(requestedGainDb, maxGainDb);
  const shiftedLufs = measurement.lufs === null ? null : measurement.lufs + appliedGainDb;
  const estimatedLufs = shiftedLufs !== null && shiftedLufs > -70 ? shiftedLufs : null;
  return { requestedGainDb, appliedGainDb, estimatedLufs };
}

export function applyFactoryGain(buffer: AudioBuffer, gainDb: number) {
  if (gainDb === 0) return;
  const gain = 10 ** (gainDb / 20);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index++) samples[index] *= gain;
  }
}
