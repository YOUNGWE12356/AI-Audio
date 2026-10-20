import fs from 'node:fs';

/** Windows scanners can briefly hold a manifest open during atomic replacement. */
export function replaceAssistantManifest(source: string, destination: string, options: {
  rename?: typeof fs.renameSync;
  pause?: () => void;
} = {}) {
  const rename = options.rename || fs.renameSync;
  for (let attempt = 0; ; attempt++) {
    try { rename(source, destination); return; }
    catch (error) {
      if (attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes((error as NodeJS.ErrnoException).code || '')) throw error;
      if (options.pause) options.pause();
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
}
