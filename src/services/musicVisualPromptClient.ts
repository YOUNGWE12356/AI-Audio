import { extractVideoKeyframes, prepareFilesForAnalysis, type PreparedAnalysisMedia } from '../utils/mediaPreparation';

export function getMusicVisualClipboardImage(clipboard: Pick<DataTransfer, 'files' | 'items'>): File | null {
  // Browsers may expose the same screenshot through both files and items.
  // Prefer files and return one image, so a single paste is handled once.
  const image = Array.from(clipboard.files).find(file => file.type.startsWith('image/'));
  if (image) return image;
  for (const item of Array.from(clipboard.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) return file;
  }
  return null;
}

export function validateMusicVisualFile(file: File): 'image' | 'video' {
  const type = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v|mkv|avi)$/i.test(file.name) ? 'video'
    : /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name) || /^image\/(jpeg|png|webp|gif|avif|bmp)$/.test(file.type) ? 'image' : null;
  if (!type) throw new Error('请选择图片（JPG、PNG、WebP 等）或视频文件。');
  if (!file.size) throw new Error('素材为空，请重新选择。');
  if (file.size > (type === 'video' ? 500 : 20) * 1024 * 1024) throw new Error(type === 'video' ? '视频超过 500MB，请先裁剪或压缩。' : '图片超过 20MB，请先压缩。');
  return type;
}

export async function generateMusicPromptFromVisual(file: File, options: {
  requirements: string; duration: number; instrumental: boolean; signal: AbortSignal; onProgress: (message: string) => void;
}): Promise<string> {
  const sourceType = validateMusicVisualFile(file);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(150_000)]);
  signal.throwIfAborted();
  let files: PreparedAnalysisMedia[];
  if (sourceType === 'video') {
    options.onProgress('正在提取视频画面…');
    const videoFile = file.type.startsWith('video/') ? file : new File([file], file.name, { type: 'video/mp4' });
    try {
      const frames = await extractVideoKeyframes(videoFile, { maxFrames: 8, maxDimension: 960, jpegQuality: 0.78, signal,
        onProgress: (done, total) => options.onProgress(`正在提取视频画面 ${done}/${total}…`) });
      files = frames.map(frame => ({ data: frame.base64, mimeType: 'image/jpeg', label: `视频关键帧，时间 ${frame.timestamp} 秒` }));
    } catch (error) {
      signal.throwIfAborted();
      options.onProgress('浏览器无法解码，正在上传视频提取画面…');
      const { extractAudioDesignVideoKeyframes } = await import('./aiService');
      const frames = await extractAudioDesignVideoKeyframes(videoFile, { signal, onProgress: options.onProgress });
      files = frames.slice(0, 8);
    }
  } else {
    const imageFile = file.type.startsWith('image/') ? file : new File([file], file.name, { type: 'image/png' });
    try {
      files = await prepareFilesForAnalysis([imageFile], { signal, onProgress: options.onProgress });
    } catch {
      signal.throwIfAborted();
      throw new Error('图片无法读取，请使用有效的 JPG、PNG 或 WebP 图片后重试。');
    }
  }
  signal.throwIfAborted();
  options.onProgress('正在分析画面并生成配乐提示词…');
  const response = await fetch('/api/ai/music-prompt/from-visual', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files, sourceType,
      requirements: options.requirements, duration: options.duration, instrumental: options.instrumental }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `画面分析失败（${response.status}），请重试。`);
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('未生成有效提示词，请重试。');
  return result.text.trim();
}
