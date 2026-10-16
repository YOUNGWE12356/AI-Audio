export const SOUND_EFFECT_SAMPLE_RATE = 48000;
export const SOUND_EFFECT_CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;

export function getSoundEffectPcmDuration(bytes: number): number {
  const frameSize = SOUND_EFFECT_CHANNELS * BYTES_PER_SAMPLE;
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes % frameSize !== 0) {
    throw new Error('返回的音效数据不完整，请重试。');
  }
  return bytes / (SOUND_EFFECT_SAMPLE_RATE * frameSize);
}

/** Our sound-generation endpoint always returns a 44-byte PCM WAV header. */
export async function readGeneratedSoundEffectDuration(blob: Blob): Promise<number> {
  const header = new DataView(await blob.slice(0, 44).arrayBuffer());
  if (header.byteLength !== 44
    || header.getUint32(0) !== 0x52494646 || header.getUint32(8) !== 0x57415645
    || header.getUint16(20, true) !== 1
    || header.getUint16(22, true) !== SOUND_EFFECT_CHANNELS
    || header.getUint32(24, true) !== SOUND_EFFECT_SAMPLE_RATE
    || header.getUint16(34, true) !== 16
    || header.getUint32(40, true) !== blob.size - 44) {
    throw new Error('返回的音效格式或数据不完整，请重试。');
  }
  return getSoundEffectPcmDuration(blob.size - 44);
}
