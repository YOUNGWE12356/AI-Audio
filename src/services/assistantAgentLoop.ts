import type { AssistantModelItem } from './aiGateway';

export type AgentTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, any>) => Promise<unknown>;
};

/** Keep every response item (including reasoning) when resuming a stateless turn. */
export async function runAssistantLoop(options: {
  input: AssistantModelItem[];
  tools: AgentTool[];
  signal: AbortSignal;
  turn: (input: AssistantModelItem[], tools: AssistantModelItem[]) => Promise<{ output: AssistantModelItem[]; text: string; model: string }>;
  event: (name: string, status: 'running' | 'completed' | 'failed', detail?: string) => void;
  isWaiting: () => boolean;
}) {
  const definitions = options.tools.map(({ name, description, parameters }) => ({
    type: 'function', name, description, parameters, strict: false,
  }));
  let failures = 0;
  for (let round = 0; round < 80; round++) {
    options.signal.throwIfAborted();
    const response = await options.turn(options.input, definitions);
    options.signal.throwIfAborted();
    options.input.push(...response.output);
    const calls = response.output.filter(item => item.type === 'function_call');
    if (!calls.length) {
      if (!response.text) throw new Error('模型没有返回任务结果。');
      return { answer: response.text, model: response.model, failures };
    }
    let failedStep = '';
    for (const [index, call] of calls.entries()) {
      options.signal.throwIfAborted();
      if (failedStep) {
        options.input.push({ type: 'function_call_output', call_id: call.call_id,
          output: JSON.stringify({ completed: false, skipped: true, reason: `前一步 ${failedStep} 失败，须先根据真实错误修正或停止，不能继续依赖它的步骤。` }) });
        continue;
      }
      const tool = options.tools.find(item => item.name === call.name);
      options.event(call.name, 'running');
      let output: unknown;
      try {
        if (!tool) throw new Error('该操作未开放。');
        output = await tool.execute(JSON.parse(call.arguments));
        options.signal.throwIfAborted();
        options.event(call.name, 'completed');
      } catch (error) {
        options.signal.throwIfAborted();
        failures++;
        failedStep = call.name;
        const message = error instanceof Error ? error.message : String(error);
        output = { error: message, completed: false };
        options.event(call.name, 'failed', message);
      }
      options.input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(output) });
      if (options.isWaiting()) {
        // Keep the tool transcript valid on resume without executing later calls
        // from the same turn (for example export followed by finish_task).
        for (const skipped of calls.slice(index + 1)) options.input.push({ type: 'function_call_output', call_id: skipped.call_id,
          output: JSON.stringify({ completed: false, skipped: true, reason: '任务已暂停，等待用户回复后重新安排。' }) });
        return { answer: '', model: response.model, failures };
      }
    }
  }
  throw new Error('任务达到单次执行步骤上限，已保留生成的文件，可继续执行。');
}
