import JSZip from 'jszip';
import { extractVideoKeyframes, prepareFilesForAnalysis, type PreparedAnalysisMedia } from '../utils/mediaPreparation';
import { generateRequirementsInBackground } from './sfxRequirementsClient';
import { normalizeBatchRequirements, type SfxBatchRequirement } from './sfxBatch';
import { batchId } from './sfxBatchProject';

export const SFX_BATCH_ACCEPT = 'image/*,video/*,.xlsx,.csv,.tsv,.txt,.md,.json,.docx';
export function validateSfxBatchFile(file: Pick<File, 'name' | 'type' | 'size'>) {
  const kind = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name) ? 'video'
    : file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name) ? 'image'
    : /\.(xlsx|csv|tsv|txt|md|json|docx)$/i.test(file.name) ? 'table' : null;
  if (!kind) throw new Error('支持视频、图片截图、XLSX、CSV、TSV、TXT、JSON 和 DOCX；旧 XLS 请另存为 XLSX。');
  if (!file.size || file.size > (kind === 'video' ? 500 : 20) * 1024 * 1024) throw new Error(kind === 'video'
    ? '视频为空或超过500MB，请压缩或分段后上传。' : '文件为空或超过20MB。');
  return kind;
}

export async function readSfxBatchDocument(file: File) {
  const bytes = await file.arrayBuffer();
  if (!/\.(xlsx|docx)$/i.test(file.name)) {
    let text = new TextDecoder('utf-8').decode(bytes).replace(/^\uFEFF/, '');
    if (text.includes('\uFFFD')) text = new TextDecoder('gb18030').decode(bytes).replace(/^\uFEFF/, '');
    if (text.length > 80_000) throw new Error('需求表超过80000字，请拆分后上传。');
    return text;
  }
  const zip = await JSZip.loadAsync(bytes);
  const xml = async (name: string) => {
    const entry = zip.file(name);
    if (!entry) return null;
    if (((entry as any)._data?.uncompressedSize || 0) > 5_000_000) throw new Error('表格展开后过大，请拆分。');
    const text = await entry.async('string');
    if (text.length > 5_000_000) throw new Error('表格展开后过大，请拆分。');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('表格格式损坏，请重新导出 XLSX。');
    return doc;
  };
  if (/\.docx$/i.test(file.name)) {
    const doc = await xml('word/document.xml');
    const text = Array.from(doc?.getElementsByTagName('w:p') || []).map(p => p.textContent).join('\n');
    if (!text.trim() || text.length > 80_000) throw new Error('文档无可读取文字或过长，请拆分。');
    return text;
  }
  const sharedDoc = await xml('xl/sharedStrings.xml');
  const shared = Array.from(sharedDoc?.getElementsByTagName('si') || []).map(si => si.textContent || '');
  const sheets = Object.keys(zip.files).filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).sort();
  if (!sheets.length || sheets.length > 20) throw new Error('表格无工作表或工作表超过20个，请拆分。');
  let result = '';
  for (const [index, name] of sheets.entries()) {
    const doc = await xml(name);
    const rows = Array.from(doc?.getElementsByTagName('row') || []);
    if (rows.length > 5000) throw new Error('表格行数过多，请只保留待制作的需求。');
    result += `\n工作表 ${index + 1}\n` + rows.map(row => {
      const values: string[] = [];
      for (const cell of Array.from(row.getElementsByTagName('c'))) {
        const column = /^[A-Z]+/.exec(cell.getAttribute('r') || '')?.[0];
        const offset = column ? Array.from(column).reduce((n, char) => n * 26 + char.charCodeAt(0) - 64, 0) - 1 : values.length;
        if (offset > 1000) throw new Error('表格列数过多，请删除多余格式列。');
        const value = cell.getElementsByTagName('v')[0]?.textContent || '';
        values[offset] = cell.getAttribute('t') === 's' ? shared[Number(value)] || ''
          : cell.getAttribute('t') === 'inlineStr' ? cell.getElementsByTagName('is')[0]?.textContent || '' : value;
      }
      return Array.from({ length: values.length }, (_, i) => values[i] || '').join('\t');
    }).join('\n');
    if (result.length > 80_000) throw new Error('需求表超过80000字，请拆分后上传。');
  }
  return result;
}

export async function prepareSfxBatchInput(file: File | null, instructions: string, onProgress: (message: string) => void) {
  let files: PreparedAnalysisMedia[] = [], text = '', sourceType = 'table';
  if (file) {
    sourceType = validateSfxBatchFile(file);
    if (sourceType === 'table') { onProgress('正在读取需求表…'); text = await readSfxBatchDocument(file); }
    else if (sourceType === 'image') files = await prepareFilesForAnalysis([file], { onProgress });
    else {
      onProgress('正在提取视频关键帧…');
      try {
        const frames = await extractVideoKeyframes(file, { maxFrames: 8, maxDimension: 1280, jpegQuality: 0.8,
          onProgress: (done, total) => onProgress(`正在读取视频画面 ${done}/${total}…`) });
        files = frames.map(frame => ({ data: frame.base64, mimeType: 'image/jpeg', label: `视频画面 ${frame.timestamp.toFixed(2)} 秒` }));
      } catch {
        onProgress('正在上传视频，使用服务器提取画面…');
        const { extractAudioDesignVideoKeyframes } = await import('./aiService');
        files = (await extractAudioDesignVideoKeyframes(file, { onProgress })).slice(0, 8);
      }
    }
  }
  return { text, files, sourceType, instructions };
}
export async function analyzeBatchRequirements(input: Awaited<ReturnType<typeof prepareSfxBatchInput>>, onProgress: (message: string) => void) {
  const result = await generateRequirementsInBackground(input, onProgress, { endpoint: '/api/ai/sfx-batch/analyze' });
  return normalizeBatchRequirements(result.items).map(row => ({ ...row, id: batchId() })) as SfxBatchRequirement[];
}

export function saveBatchDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
