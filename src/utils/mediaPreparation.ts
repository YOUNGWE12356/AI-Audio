export interface VideoKeyframe {
  timestamp: number;
  base64: string;
}

export interface PreparedGeminiMedia {
  data: string;
  mimeType: string;
  label?: string;
}

interface ExtractVideoOptions {
  maxFrames?: number;
  maxDimension?: number;
  jpegQuality?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

const MAX_DIRECT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PREPARED_PAYLOAD_BYTES = 24 * 1024 * 1024;
const MAX_PREPARED_PARTS = 16;
const VIDEO_FRAME_TIMEOUT_MS = 3_500;

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw new DOMException('分析已取消', 'AbortError');
  }
};

const readFileAsDataUrl = (file: Blob, signal?: AbortSignal) => new Promise<string>((resolve, reject) => {
  throwIfAborted(signal);
  const reader = new FileReader();

  const cleanup = () => signal?.removeEventListener('abort', handleAbort);
  const handleAbort = () => {
    reader.abort();
    cleanup();
    reject(new DOMException('分析已取消', 'AbortError'));
  };

  reader.onload = () => {
    cleanup();
    resolve(String(reader.result || ''));
  };
  reader.onerror = () => {
    cleanup();
    reject(reader.error || new Error('文件读取失败'));
  };
  signal?.addEventListener('abort', handleAbort, { once: true });
  reader.readAsDataURL(file);
});

const waitForVideoMetadata = (video: HTMLVideoElement, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  throwIfAborted(signal);

  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
    resolve();
    return;
  }

  const timeoutId = window.setTimeout(() => finish(new Error('读取视频信息超时')), 8_000);

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    video.removeEventListener('loadedmetadata', handleLoaded);
    video.removeEventListener('error', handleError);
    signal?.removeEventListener('abort', handleAbort);
  };
  const finish = (error?: Error | DOMException) => {
    cleanup();
    error ? reject(error) : resolve();
  };
  const handleLoaded = () => finish();
  const handleError = () => finish(new Error('浏览器无法读取此视频编码'));
  const handleAbort = () => finish(new DOMException('分析已取消', 'AbortError'));

  video.addEventListener('loadedmetadata', handleLoaded, { once: true });
  video.addEventListener('error', handleError, { once: true });
  signal?.addEventListener('abort', handleAbort, { once: true });

  // loadedmetadata may fire between the first readyState check and listener
  // registration, especially for small local files already held in cache.
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) finish();
});

const seekVideo = (video: HTMLVideoElement, timestamp: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  throwIfAborted(signal);

  let frameCallbackId: number | undefined;
  let animationFrameId: number | undefined;
  let secondAnimationFrameId: number | undefined;
  const timeoutId = window.setTimeout(
    () => finish(new Error('视频定位或画面解码超时')),
    VIDEO_FRAME_TIMEOUT_MS,
  );

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    video.removeEventListener('seeked', handleSeeked);
    video.removeEventListener('error', handleError);
    signal?.removeEventListener('abort', handleAbort);
    if (frameCallbackId !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
      video.cancelVideoFrameCallback(frameCallbackId);
    }
    if (animationFrameId !== undefined) window.cancelAnimationFrame(animationFrameId);
    if (secondAnimationFrameId !== undefined) window.cancelAnimationFrame(secondAnimationFrameId);
  };
  const finish = (error?: Error | DOMException) => {
    cleanup();
    error ? reject(error) : resolve();
  };
  const waitForDecodedFrame = () => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      frameCallbackId = video.requestVideoFrameCallback(() => finish());
      return;
    }

    // Browsers without requestVideoFrameCallback still need a render turn
    // after seeked before drawImage can reliably read the newly decoded frame.
    animationFrameId = window.requestAnimationFrame(() => {
      secondAnimationFrameId = window.requestAnimationFrame(() => finish());
    });
  };
  const handleSeeked = () => waitForDecodedFrame();
  const handleError = () => finish(new Error('读取视频画面失败'));
  const handleAbort = () => finish(new DOMException('分析已取消', 'AbortError'));

  video.addEventListener('seeked', handleSeeked, { once: true });
  video.addEventListener('error', handleError, { once: true });
  signal?.addEventListener('abort', handleAbort, { once: true });
  video.currentTime = timestamp;
});

export async function extractVideoKeyframes(
  file: File,
  options: ExtractVideoOptions = {},
): Promise<VideoKeyframe[]> {
  const {
    maxFrames = 6,
    maxDimension = 512,
    jpegQuality = 0.68,
    signal,
    onProgress,
  } = options;
  const video = document.createElement('video');
  const objectUrl = URL.createObjectURL(file);

  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = objectUrl;

  try {
    await waitForVideoMetadata(video, signal);
    throwIfAborted(signal);

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 10;
    const frameCount = Math.max(3, Math.min(
      maxFrames,
      duration <= 30 ? 4 : duration <= 120 ? 6 : 8,
    ));
    const sourceWidth = Math.max(1, video.videoWidth || 1280);
    const sourceHeight = Math.max(1, video.videoHeight || 720);
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(sourceWidth * scale));
    canvas.height = Math.max(2, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('浏览器无法创建画面解析画布');

    const keyframes: VideoKeyframe[] = [];
    for (let index = 0; index < frameCount; index += 1) {
      throwIfAborted(signal);
      const timestamp = Math.min(
        Math.max(0, ((index + 0.5) / frameCount) * duration),
        Math.max(0, duration - 0.05),
      );

      try {
        await seekVideo(video, timestamp, signal);
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
        const base64 = dataUrl.split(',')[1];
        if (base64) {
          keyframes.push({
            timestamp: Number(timestamp.toFixed(1)),
            base64,
          });
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      } finally {
        // Keep the UI moving even when an individual seek/decode is skipped.
        onProgress?.(index + 1, frameCount);
      }
    }

    if (keyframes.length < 3) {
      throw new Error('未能提取足够的视频关键帧，请尝试使用 H.264 编码的 MP4 视频');
    }
    return keyframes;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

const compressImageForAnalysis = async (file: File, signal?: AbortSignal): Promise<PreparedGeminiMedia> => {
  throwIfAborted(signal);
  const bitmap = await createImageBitmap(file);

  try {
    const maxDimension = 1_600;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('图片压缩失败');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      data: canvas.toDataURL('image/jpeg', 0.82),
      mimeType: 'image/jpeg',
      label: `图片素材：${file.name}`,
    };
  } finally {
    bitmap.close();
  }
};

export async function prepareFilesForGemini(
  files: File[],
  options: {
    signal?: AbortSignal;
    onProgress?: (message: string) => void;
  } = {},
): Promise<PreparedGeminiMedia[]> {
  const prepared: PreparedGeminiMedia[] = [];
  const appendPrepared = (parts: PreparedGeminiMedia[]) => {
    if (prepared.length + parts.length > MAX_PREPARED_PARTS) {
      throw new Error(`本次素材切片超过 ${MAX_PREPARED_PARTS} 个，请减少文件数量后分批分析。`);
    }
    prepared.push(...parts);
  };

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    throwIfAborted(options.signal);
    const prefix = `${fileIndex + 1}/${files.length}`;

    if (file.type.startsWith('video/')) {
      options.onProgress?.(`正在提取视频关键帧（${prefix}）`);
      const frames = await extractVideoKeyframes(file, {
        signal: options.signal,
        onProgress: (completed, total) => {
          options.onProgress?.(`正在提取视频关键帧 ${completed}/${total}（${prefix}）`);
        },
      });
      appendPrepared(frames.map((frame, frameIndex) => ({
        data: frame.base64,
        mimeType: 'image/jpeg',
        label: `视频 ${file.name} 的关键帧 ${frameIndex + 1}/${frames.length}，时间 ${frame.timestamp} 秒`,
      })));
      continue;
    }

    if (file.type.startsWith('image/')) {
      options.onProgress?.(`正在压缩图片（${prefix}）`);
      appendPrepared([await compressImageForAnalysis(file, options.signal)]);
      continue;
    }

    if (file.size > MAX_DIRECT_FILE_BYTES) {
      throw new Error(`${file.name} 超过 20MB。大型音频或 PDF 请先压缩后再分析。`);
    }
    options.onProgress?.(`正在读取素材（${prefix}）`);
    appendPrepared([{
      data: await readFileAsDataUrl(file, options.signal),
      mimeType: file.type || 'application/octet-stream',
      label: `素材文件：${file.name}`,
    }]);
  }

  const estimatedBytes = prepared.reduce((total, part) => {
    const base64 = part.data.includes(',') ? part.data.split(',')[1] : part.data;
    const paddingBytes = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const decodedBytes = Math.max(0, Math.floor((base64.length * 3) / 4) - paddingBytes);
    return total + decodedBytes;
  }, 0);
  if (estimatedBytes > MAX_PREPARED_PAYLOAD_BYTES) {
    throw new Error('本次素材总量过大，请减少文件数量后分批分析。');
  }

  return prepared;
}
