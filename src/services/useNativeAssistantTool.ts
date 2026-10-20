import { useEffect, useRef, useState } from 'react';
import { registerNativeAssistantTool, type PreparedToolTask } from './assistantToolWorkspace';

type Operation = {
  task: PreparedToolTask; controller: AbortController;
  resolve: (result: Record<string, any>) => void; reject: (error: unknown) => void;
};

/** Prepare fields first; run after React commits them, using the same action as the button. */
export function useNativeAssistantTool(tools: string[], callbacks: {
  prepare: (task: PreparedToolTask) => void | Promise<void>;
  run: (task: PreparedToolTask, signal: AbortSignal) => Promise<Record<string, any>>;
}) {
  const latest = useRef(callbacks);
  latest.current = callbacks;
  const [operation, setOperation] = useState<Operation | null>(null);
  const active = useRef<Operation | null>(null);
  const started = useRef<Operation | null>(null);
  const key = tools.join(',');
  useEffect(() => {
    const unregister = key.split(',').map(tool => registerNativeAssistantTool(tool, (task, signal) => new Promise((resolve, reject) => {
      if (active.current) { reject(new Error('当前功能仍在处理上一项任务。')); return; }
      signal.throwIfAborted();
      const controller = new AbortController();
      const abort = () => { controller.abort(); reject(new Error('任务已停止。')); };
      signal.addEventListener('abort', abort, { once: true });
      const finish = (error?: unknown, result?: Record<string, any>) => {
        signal.removeEventListener('abort', abort);
        active.current = null;
        if (error) reject(error); else resolve(result || {});
      };
      const next = { task, controller, resolve: (result: Record<string, any>) => finish(undefined, result), reject: (error: unknown) => finish(error) };
      active.current = next;
      void Promise.resolve().then(() => latest.current.prepare(task)).then(() => {
        controller.signal.throwIfAborted();
        setOperation(next);
      }, error => finish(error)).catch(error => finish(error));
    })));
    return () => {
      unregister.forEach(remove => remove());
      active.current?.controller.abort();
      active.current?.reject(new Error('功能界面已关闭，当前步骤已停止。'));
    };
  }, [key]);
  useEffect(() => {
    if (!operation || started.current === operation) return;
    started.current = operation;
    void Promise.resolve().then(() => {
      operation.controller.signal.throwIfAborted();
      return latest.current.run(operation.task, operation.controller.signal);
    }).then(operation.resolve, operation.reject);
  }, [operation]);
}
