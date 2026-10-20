import { useEffect, useRef } from 'react';
import type { TabType } from '../types';
import type { AssistantWorkspaceCommand } from './assistantAgentTypes';
import { runAssistantToolOperation } from './assistantToolWorkspace';

type Handler = (command: AssistantWorkspaceCommand, signal: AbortSignal, context: { jobId: string; clientId: string }) => Promise<Record<string, any>>;
const handlers = new Map<string, Handler>();
let navigate: ((tab: TabType) => void) | undefined;
let active: { id: string; controller: AbortController; endpoint: string; message: string } | undefined;
const receipts = new Map<string, Record<string, any>>();
const clientKey = 'assistant_workspace_client_v1';
const clientId = () => {
  let id = sessionStorage.getItem(clientKey);
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(clientKey, id); }
  return id;
};
export function setAssistantWorkspaceNavigator(handler: (tab: TabType) => void) {
  navigate = handler;
  return () => { if (navigate === handler) navigate = undefined; };
}
export function useAssistantWorkspace(workspace: string, handler: Handler) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    const stable: Handler = (command, signal, context) => latest.current(command, signal, context);
    handlers.set(workspace, stable);
    return () => { if (handlers.get(workspace) === stable) handlers.delete(workspace); };
  }, [workspace]);
}
export function stopAssistantWorkspace() { active?.controller.abort(); }
export function reportAssistantWorkspaceProgress(message: string) {
  if (!active || active.message === message) return;
  active.message = message;
  void sendHeartbeat(active);
}
async function sendHeartbeat(operation: NonNullable<typeof active>) {
  try {
    await fetch(`${operation.endpoint}/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId: clientId(), message: operation.message }), signal: AbortSignal.timeout(10000) });
  } catch { /* Job polling displays connectivity loss; keep the production request intact. */ }
}
export function assistantWorkspaceHeaders(commandId?: string, operation = ''): Record<string, string> {
  return commandId ? { 'x-assistant-workspace-operation': `${commandId}:${operation}` } : {};
}
export async function runAssistantWorkspace(jobId: string, command: AssistantWorkspaceCommand) {
  if (!['pending', 'running'].includes(command.status) || active) return;
  const controller = new AbortController();
  const endpoint = `/api/ai/assistant/jobs/${jobId}/workspace/${command.id}`;
  active = { id: command.id, controller, endpoint, message: command.message };
  let claimed = false;
  let heartbeat: number | undefined;
  let receipt: Record<string, any> | undefined;
  try {
    navigate?.(command.workspace);
    const claim = await fetch(`${endpoint}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId() }), signal: AbortSignal.timeout(15000) });
    if (!claim.ok) return;
    claimed = true;
    const operation = active;
    heartbeat = window.setInterval(() => { void sendHeartbeat(operation); }, 10000);
    const startedAt = Date.now();
    const handlerKey = command.workspace;
    while (command.action !== 'run_tool' && !handlers.has(handlerKey)) {
      controller.signal.throwIfAborted();
      if (Date.now() - startedAt > 45000) throw new Error('对应功能页面加载失败。');
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    receipt = receipts.get(command.id);
    if (!receipt) {
      try { receipt = JSON.parse(sessionStorage.getItem(`assistant-native-receipt:${command.id}`) || 'null') || undefined; } catch { /* Ignore malformed local receipts. */ }
    }
    if (!receipt) {
      const result = command.action === 'run_tool'
        ? await runAssistantToolOperation({ command, signal: controller.signal, progress: reportAssistantWorkspaceProgress })
        : await handlers.get(handlerKey)!(command, controller.signal, { jobId, clientId: clientId() });
      receipt = { result, clientId: clientId() };
      receipts.set(command.id, receipt);
      if (command.action === 'run_tool') {
        try { sessionStorage.setItem(`assistant-native-receipt:${command.id}`, JSON.stringify(receipt)); } catch { /* In-memory receipt still prevents repeating this action. */ }
      }
    }
  } catch (error) {
    // Retain completed page receipts when a response is lost.
    if ((error as { reconnectable?: boolean })?.reconnectable && !controller.signal.aborted) return;
    receipt = { error: error instanceof Error ? error.message : String(error), result: (error as any)?.workspaceResult, clientId: clientId() };
    receipts.set(command.id, receipt);
  } finally {
    if (heartbeat !== undefined) window.clearInterval(heartbeat);
    if (claimed && receipt) {
      try {
        await fetch(`${endpoint}/result`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(receipt), signal: AbortSignal.timeout(15000) });
      } catch { /* The next poll resends the receipt without repeating production. */ }
    }
    if (active?.id === command.id) active = undefined;
  }
}
