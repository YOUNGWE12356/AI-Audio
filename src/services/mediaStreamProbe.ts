import { execFile } from 'node:child_process';

/** Inspect with bundled FFmpeg when a separate ffprobe is not installed. */
export const detectMediaAudioStream = (ffmpegBinary: string, filePath: string) => new Promise<boolean>((resolve, reject) => {
  execFile('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath],
    { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }, (probeError, stdout) => {
      if (!probeError) { resolve(Boolean(stdout.trim())); return; }
      execFile(ffmpegBinary, ['-hide_banner', '-i', filePath], { timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true }, (_error, _stdout, stderr) => {
        // Input inspection normally exits nonzero because no output was requested.
        if (!/Input #0,/i.test(stderr) || !/Stream #0:/i.test(stderr)) { reject(new Error('无法读取视频音轨信息，请检查源文件和FFmpeg运行状态。')); return; }
        resolve(/Stream #0:[^\r\n]*Audio:/i.test(stderr));
      });
    });
});
