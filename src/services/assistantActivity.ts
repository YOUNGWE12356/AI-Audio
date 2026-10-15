import type { AssistantJob } from './assistantAgentTypes';

export function getAssistantActivity(state: { job?: AssistantJob; sending: boolean; restoring?: boolean; error?: string }) {
  const job = state.job;
  const busy = state.sending || Boolean(state.restoring) || job?.status === 'running';
  if (state.sending) return { busy, label: '正在上传任务素材', detail: '上传完成后自动开始制作', tone: 'running' };
  if (state.restoring || (job?.status === 'running' && state.error)) return { busy, label: '正在重连 · 确认任务状态', detail: state.error || '正在恢复自动制作进度', tone: 'reconnecting' };
  if (job?.status === 'running') {
    const command = job.workspaceCommand;
    const executing = command && ['pending', 'running'].includes(command.status);
    return { busy, label: executing ? command.message : '正在分析并安排下一步',
      detail: executing ? (command.status === 'pending' ? '正在连接对应功能页面' : '制作中，完成后自动继续下一步') : '助手仍在工作，请稍候', tone: 'running' };
  }
  if (job?.status === 'waiting') return { busy: false, label: job.waitingFor === 'export-review' ? '制作已就绪 · 等待试听' : '制作已暂停 · 需要处理', detail: job.question || '请打开助手查看暂停原因', tone: 'waiting' };
  if (job?.status === 'failed') return { busy: false, label: '制作中断 · 查看原因', detail: job.error || '已保留完成的结果', tone: 'failed' };
  if (job?.status === 'cancelled') return { busy: false, label: '自动制作已停止', detail: '已保留完成的结果', tone: 'stopped' };
  if (job?.status === 'completed') return { busy: false, label: '自动制作已完成', detail: '打开助手查看结果', tone: 'completed' };
  return { busy: false, label: '智能助手', detail: '', tone: 'idle' };
}
