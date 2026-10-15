import { randomUUID } from 'node:crypto';
import type { AssistantJob } from './assistantAgentTypes';
import { getAssistantMessages } from './assistantMessages';

export function isExportApproval(reply: string) {
  const normalized = reply.trim().replace(/[\s，,。.!！?？、：:；;“”"'‘’]/g, '');
  return /^(?:(?:已经)?试听(?:完了|过了)?)?(?:没有问题|没问题|满意|可以了|好的|好)?(?:请|帮我|现在|开始|确认|直接|可以|继续|同意)?导出(?:成品|视频)?(?:吧)?$/i.test(normalized)
    || /^(?:please)?export(?:now)?$/i.test(normalized);
}

export function requestAssistantExportReview(job: AssistantJob, args: Record<string, any> = {}) {
  const command = job.workspaceCommand;
  const project = command?.result?.project;
  const clips = project?.clips as Array<Record<string, any>> | undefined;
  if (command?.status !== 'completed' || !project?.videoFile || !clips?.length) throw new Error('制作尚未完成，无法进入试听阶段。');
  const active = clips.filter(clip => clip.trackId !== 'original-audio' && !clip.muted
    && !project.tracks?.find((track: any) => track.id === clip.trackId)?.isMuted);
  if (!active.length || active.some(clip => !clip.audioUrl || clip.isGenerating || clip.error || clip.voiceDirty || clip.timingDirty)) {
    throw new Error('时间线上还有未完成或需重新合成的片段，请先完成制作再试听。');
  }
  job.messages = getAssistantMessages(job);
  job.status = 'waiting';
  job.waitingFor = 'export-review';
  job.exportReview = { status: 'pending', args: { ...args, name: args.name || project.name } };
  job.question = '制作已就绪，请先在当前页面试听。满意后在对话框回复“导出”；如需调整，直接告诉我。';
  job.messages.push({ id: randomUUID(), role: 'assistant', content: job.question });
}
