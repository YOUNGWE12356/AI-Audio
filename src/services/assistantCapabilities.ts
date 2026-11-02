import type { AgentTool } from './assistantAgentLoop';
import { ASSISTANT_TOOL_PAGES, ASSISTANT_WORKSPACE_NAMES, NATIVE_ASSISTANT_TOOLS } from './assistantToolCatalog';
import { FACTORY_LOUDNESS_PRESETS } from './audioFactoryPresets';

/** Derived from registered executors, not an AI-maintained list of imaginary UI controls. */
export function inspectAssistantTools(tools: AgentTool[], query = '') {
  const terms = query.toLowerCase().split(/[\s,，/→]+/).filter(Boolean);
  const capabilities = tools.filter(tool => !['inspect_tools', 'ask_user', 'finish_task'].includes(tool.name)).map(tool => {
    const page = ASSISTANT_TOOL_PAGES[tool.name];
    const workspace = tool.name === 'video_workspace' ? 'video-soundtrack' : tool.name === 'local_separation' ? 'audio-tools' : page?.workspace;
    const native = NATIVE_ASSISTANT_TOOLS.has(tool.name) || ['video_workspace', 'local_separation'].includes(tool.name);
    return {
      tool: tool.name, description: tool.description,
      page: workspace ? ASSISTANT_WORKSPACE_NAMES[workspace] : undefined,
      tab: tool.name === 'local_separation' ? 'music-separation' : page?.tab,
      execution: native ? 'native-page' : page ? 'service-operation' : 'supporting-operation',
      ...(tool.name === 'process_audio' ? { presets: FACTORY_LOUDNESS_PRESETS,
        pageConstraints: '格式/压缩/音量页面支持 MP3/WAV/OGG、采样率、码率、单/立体声、响度预设及自定义 LUFS；裁剪、变速、移调、降噪等高级参数走现有处理服务。' } : {}),
      ...(tool.name === 'generate_music' ? { pageConstraints: '原生音乐页面支持 10–60 秒；更长音乐走现有处理服务。' } : {}),
    };
  }).filter(item => !terms.length || terms.some(term => JSON.stringify(item).toLowerCase().includes(term)));
  return { capabilities, rules: '先匹配任务与真实功能，优先执行 native-page：自动进入页面、导入素材、填写参数并调用原按钮操作，等待真实结果后推进。service-operation 尚无页面自动操作适配，不得宣称已点击界面。预设已存在时直接使用，不要求用户重复提供数值；不匹配的标准才提问。' };
}
