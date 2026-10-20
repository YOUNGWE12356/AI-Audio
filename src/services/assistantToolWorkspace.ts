import type { AssistantAsset, AssistantWorkspaceCommand } from './assistantAgentTypes';

export type PreparedToolTask = { command: AssistantWorkspaceCommand; files: File[] };
export type NativeToolHandler = (task: PreparedToolTask, signal: AbortSignal) => Promise<Record<string, any>>;
let preparedTask: PreparedToolTask | undefined;
export const getPreparedToolTask = () => preparedTask;
const handlers = new Map<string, NativeToolHandler>();
export function registerNativeAssistantTool(tool: string, handler: NativeToolHandler) {
  handlers.set(tool, handler);
  return () => { if (handlers.get(tool) === handler) handlers.delete(tool); };
}
export function presentToolTask(task: PreparedToolTask) {
  preparedTask = task;
  window.dispatchEvent(new CustomEvent('ai-audio:tool-task', { detail: task }));
}
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  signal.throwIfAborted();
  const abort = () => { clearTimeout(timer); reject(signal.reason); };
  const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 100);
  signal.addEventListener('abort', abort, { once: true });
});

/** Import the real material, then invoke the existing page's button handler. */
export async function runAssistantToolOperation(options: {
  command: AssistantWorkspaceCommand; signal: AbortSignal;
  progress: (message: string) => void;
  request?: typeof fetch; wait?: typeof pause;
}) {
  const { command, signal, progress } = options;
  const request = options.request || fetch;
  let stage = '载入素材';
  try {
    signal.throwIfAborted();
    progress(`${command.args.title}：${stage}`);
    const files: File[] = [];
    for (const source of (command.args.sources || []) as AssistantAsset[]) {
      if (!source.url.startsWith('/uploads/') || !source.name) throw new Error('输入素材不属于当前任务。');
      const response = await request(source.url, { signal });
      if (!response.ok) throw new Error(`读取 ${source.name} 失败（HTTP ${response.status}）`);
      files.push(new File([await response.blob()], source.name, { type: source.mimeType }));
    }
    const task = { command, files };
    presentToolTask(task);
    stage = '打开功能界面';
    const started = Date.now();
    while (!handlers.has(command.args.tool)) {
      signal.throwIfAborted();
      if (Date.now() - started > 45000) throw new Error('功能未加载，请重新打开对应页面。');
      await (options.wait || pause)(signal);
    }
    signal.throwIfAborted();
    stage = '执行页面操作';
    progress(`${command.args.title}：素材已载入，正在执行`);
    const executionKey = `assistant-native-started:${command.id}`;
    if (sessionStorage.getItem(executionKey)) throw new Error('页面重载中断了结果回传。为避免重复处理或扣费，未重复启动；请先检查该功能的结果。');
    sessionStorage.setItem(executionKey, '1');
    const result = await handlers.get(command.args.tool)!(task, signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(signal.aborted ? '任务已停止。' : `${command.args.title} · ${stage}失败：${detail}`);
  } finally {
    if (preparedTask?.command.id === command.id) preparedTask = undefined;
  }
}

/** Transfer a browser-produced result, never execute another tool on the server. */
export async function uploadNativeToolOutput(command: AssistantWorkspaceCommand, blob: Blob, name: string, signal: AbortSignal) {
  const form = new FormData();
  form.append('file', blob, name);
  form.append('name', name);
  const response = await fetch(`/api/ai/assistant/workspace/${command.id}/output`, {
    method: 'POST', body: form, signal,
    headers: { 'x-assistant-workspace-client': sessionStorage.getItem('assistant_workspace_client_v1') || '' },
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '保存处理结果失败。');
  return result.asset as AssistantAsset;
}
