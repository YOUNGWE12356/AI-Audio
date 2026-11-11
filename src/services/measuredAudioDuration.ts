import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';

const durations = new WeakMap<Blob, Promise<number>>();

/** Server-only: decode the audio stream, never infer billable seconds from bytes or client metadata. */
export function measureAudioDurationSeconds(audio: Blob): Promise<number> {
  const existing = durations.get(audio);
  if (existing) return existing;
  const pending = (async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'audio-billing-'));
    try {
      const input = path.join(directory, 'input.media');
      await fs.writeFile(input, new Uint8Array(await audio.arrayBuffer()));
      return await new Promise<number>((resolve, reject) => {
        execFile(process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg', [
          '-nostdin', '-hide_banner', '-nostats',
          '-protocol_whitelist', 'file,pipe',
          '-format_whitelist', 'mp3,wav,ogg,mov,flac,aac,aiff,matroska,asf,au',
          '-i', input, '-map', '0:a:0', '-vn',
          '-af', 'aresample=48000,astats=measure_perchannel=none:measure_overall=Number_of_samples:reset=0',
          '-f', 'null', '-',
        ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true }, (error, _stdout, stderr) => {
          const samples = [...String(stderr).matchAll(/Number of samples:\s*(\d+)/g)];
          const duration = Number(samples.at(-1)?.[1]) / 48000;
          if (error || !Number.isFinite(duration) || duration <= 0) {
            reject(Object.assign(new Error('无法读取音频真实时长，请上传有效的音频或含音轨的视频后重试。'), { status: 422 }));
          } else resolve(duration);
        });
      });
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  })();
  durations.set(audio, pending);
  return pending;
}
