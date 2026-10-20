import type { AssistantAsset, AssistantWorkspaceCommand } from './assistantAgentTypes';

const STAGES: Record<string, string> = { queued: '等待GPU', preparing: '音频预处理', separating: '模型推理', analyzing: '轨道分析', packaging: '打包轨道', completed: '分轨完成', failed: '分轨处理', cancelled: '取消任务', cancelling: '停止任务' };

export type SeparationWorkspaceOperation = {
  command: AssistantWorkspaceCommand;
  signal: AbortSignal;
  resolve: (result: Record<string, any>) => void;
  reject: (error: Error) => void;
};

/** Runs the same upload/job endpoints as the manual page, reporting every stage there. */
export async function runSeparationWorkspace(options: {
  command: AssistantWorkspaceCommand;
  signal: AbortSignal;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  onFile: (file: File) => void;
  onJob: (job: any) => void;
  onEngine: (engine: any) => void;
  onProgress: (message: string) => void;
  request?: typeof fetch;
  wait?: (signal: AbortSignal) => Promise<void>;
}) {
  const { command, signal, storage, onFile, onJob, onEngine, onProgress } = options;
  const request = options.request || fetch;
  const wait = options.wait || ((signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1250);
    signal.addEventListener('abort', abort, { once: true });
  }));
  let stage = '载入素材';
  let jobId = storage.getItem(`assistant-separation:${command.id}`);
  const json = async (response: Response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
    return body;
  };
  try {
    signal.throwIfAborted();
    const source = command.args.source as AssistantAsset;
    if (!source?.url?.startsWith('/uploads/') || !source.name) throw new Error('没有可读取的任务音频或视频。');
    onProgress('载入对话中的音频素材…');
    const response = await request(source.url, { signal });
    if (!response.ok) throw new Error(`读取源素材失败（HTTP ${response.status}）`);
    const file = new File([await response.blob()], source.name, { type: source.mimeType });
    if (file.size > 100 * 1024 * 1024) throw new Error('文件超过 100MB 上传限制。');
    onFile(file);
    if (!jobId) {
      stage = '检测运行环境';
      onProgress('正在检测本地分轨引擎、模型和显卡…');
      let engine = await json(await request('/api/audio/music-separation/engine', { signal }));
      // A transient probe error is not proof that the engine is uninstalled.
      if (!engine.ready && engine.error) {
        onProgress('运行环境检测异常，正在重新检测…');
        engine = await json(await request('/api/audio/music-separation/engine?refresh=1', { signal }));
      }
      onEngine(engine);
      if (!engine.ready) throw new Error(engine.error || (!engine.installed ? '未找到本地分轨环境。' : !engine.cudaAvailable ? 'CUDA 显卡不可用。' : '分轨模型尚未就绪。'));
      stage = '上传并创建分轨任务';
      onProgress('素材已载入，正在提交到分轨功能…');
      const form = new FormData();
      form.append('media', file, file.name);
      form.append('mode', command.args.mode === 'vocals' ? 'vocals' : 'stems');
      form.append('assistantOperationId', command.id);
      const job = await json(await request('/api/audio/music-separation/jobs', { method: 'POST', body: form, signal }));
      jobId = job.id;
      if (!jobId || !/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error('分轨服务未返回有效任务编号。');
      storage.setItem(`assistant-separation:${command.id}`, jobId);
      storage.setItem('ai-audio-music-separation-job', jobId);
      onJob(job);
    }
    for (;;) {
      signal.throwIfAborted();
      stage = '读取分轨进度';
      const job = await json(await request(`/api/audio/music-separation/jobs/${jobId}`, { signal }));
      onJob(job);
      stage = STAGES[job.stage || job.status] || job.stage || job.status;
      onProgress(`分轨 ${job.progress || 0}%：${job.message || stage}`);
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error || job.message || '分轨任务已停止。');
      if (job.status === 'completed') {
        if (!job.stems?.length) throw new Error('分轨完成但没有返回轨道文件。');
        return { jobId, files: job.stems.map((stem: any) => ({ url: stem.audioUrl, name: `${file.name.replace(/\.[^.]+$/, '')}_${stem.name}.wav` })) };
      }
      await wait(signal);
    }
  } catch (error) {
    if (signal.aborted && jobId) {
      await request(`/api/audio/music-separation/jobs/${jobId}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }).catch(() => undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    const message = signal.aborted ? '助手已停止分轨任务。' : detail.startsWith(`${stage}失败`) ? detail : `${stage}失败：${detail}`;
    onProgress(message);
    throw new Error(message);
  }
}
