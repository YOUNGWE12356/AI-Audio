import type { AssistantJob, AssistantMessage } from './assistantAgentTypes';

/** Older saved jobs still expose their original instruction and current response. */
export function getAssistantMessages(job: AssistantJob): AssistantMessage[] {
  const messages = job.messages?.length ? [...job.messages] : [
    { id: `${job.id}:prompt`, role: 'user' as const, content: job.prompt },
  ];
  const response = job.status === 'completed' ? '已完成' : job.status === 'waiting' ? job.question : undefined;
  if (response && !(messages.at(-1)?.role === 'assistant' && messages.at(-1)?.content === response)) {
    messages.push({ id: `${job.id}:${job.status}`, role: 'assistant', content: response });
  }
  return messages;
}
