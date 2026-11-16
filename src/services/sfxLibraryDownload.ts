import fs from 'node:fs';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import JSZip from 'jszip';

export type SfxArchiveFile = { fileName: string; filePath: string; url?: undefined } | { fileName: string; url: string; filePath?: undefined };

export const safeDownloadFileName = (value: unknown, fallback: string): string => {
  const name = typeof value === 'string' ? value.replace(/[\\/]/g, '_').replace(/[\x00-\x1f\x7f]/g, '').trim() : '';
  return name || fallback;
};

export const downloadContentDisposition = (fileName: string, disposition: 'attachment' | 'inline' = 'attachment'): string => {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/[!'()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

export const createSfxArchiveStream = (files: SfxArchiveFile[]) => {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const file of files) {
    const baseName = safeDownloadFileName(file.fileName, path.basename(file.filePath || new URL(file.url!).pathname));
    const extension = path.extname(baseName);
    const stem = extension ? baseName.slice(0, -extension.length) : baseName;
    let archiveName = baseName;
    let suffix = 1;
    while (usedNames.has(archiveName.toLowerCase())) {
      archiveName = `${stem}_(${suffix++})${extension}`;
    }
    usedNames.add(archiveName.toLowerCase());
    const source = Readable.from((async function* () {
      if (file.filePath) { yield* fs.createReadStream(file.filePath); return; }
      const response = await fetch(file.url!, { redirect: 'error', signal: AbortSignal.timeout(120_000), referrerPolicy: 'no-referrer' });
      if (!response.ok || !response.body) throw new Error('CDN archive source unavailable');
      let bytes = 0;
      for await (const chunk of response.body as any) {
        bytes += chunk.length;
        if (bytes > 100 * 1024 * 1024) throw new Error('CDN archive source exceeds size limit');
        yield chunk;
      }
    })());
    zip.file(archiveName, source, { compression: 'STORE' });
  }
  const output = new PassThrough();
  zip.generateNodeStream({ streamFiles: true, compression: 'STORE' })
    .on('error', error => output.destroy(error))
    .pipe(output);
  return output;
};
