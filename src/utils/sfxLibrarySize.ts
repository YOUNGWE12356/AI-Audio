import type { SoundEffect } from '../data/sfxData';

const units = ['B', 'KB', 'MB', 'GB', 'TB'];

export function summarizeSfxLibrarySize(sounds: Pick<SoundEffect, 'size' | 'sizeBytes'>[]) {
  let bytes = 0;
  let unknownCount = 0;
  let estimated = false;

  for (const sound of sounds) {
    if (typeof sound.sizeBytes === 'number' && Number.isSafeInteger(sound.sizeBytes) && sound.sizeBytes >= 0) {
      bytes += sound.sizeBytes;
      continue;
    }

    const match = typeof sound.size === 'string' && sound.size.trim().match(/^(\d+(?:\.\d+)?)\s*(B|[KMGT]I?B)$/i);
    if (match) {
      const unit = units.indexOf(match[2].toUpperCase().replace('I', ''));
      const size = Math.round(Number(match[1]) * 1024 ** unit);
      if (Number.isSafeInteger(size)) {
        bytes += size;
        estimated ||= unit > 0;
        continue;
      }
    }

    unknownCount++;
  }

  let unit = 0;
  let size = bytes;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return { formatted: `${unit === 0 ? size : Number(size.toFixed(2))} ${units[unit]}`, unknownCount, estimated };
}
