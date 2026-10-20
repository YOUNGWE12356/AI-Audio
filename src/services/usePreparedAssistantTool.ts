import { useEffect, useRef } from 'react';
import { getPreparedToolTask, type PreparedToolTask } from './assistantToolWorkspace';

/** Select the native subpage before its action adapter mounts. */
export function usePreparedAssistantTool(workspace: string, prepare: (task: PreparedToolTask) => void) {
  const latest = useRef(prepare);
  const consumed = useRef('');
  latest.current = prepare;
  useEffect(() => {
    const receive = (task?: PreparedToolTask) => {
      if (!task || task.command.workspace !== workspace || consumed.current === task.command.id) return;
      consumed.current = task.command.id;
      latest.current(task);
    };
    const listener = (event: Event) => receive((event as CustomEvent<PreparedToolTask>).detail);
    receive(getPreparedToolTask());
    window.addEventListener('ai-audio:tool-task', listener);
    return () => window.removeEventListener('ai-audio:tool-task', listener);
  }, [workspace]);
}
