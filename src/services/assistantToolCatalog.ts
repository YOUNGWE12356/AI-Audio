import type { AssistantWorkspaceCommand } from './assistantAgentTypes';

type Destination = { workspace: AssistantWorkspaceCommand['workspace']; title: string; tab?: string };
/** Only these tools have an adapter to the actual page action. */
export const NATIVE_ASSISTANT_TOOLS = new Set([
  'process_audio', 'analyze_music_metrics', 'semantic_audio_analysis', 'audio_to_midi',
  'transcribe_speech', 'generate_music', 'generate_sound_effect', 'sound_requirements', 'audio_design', 'cloud_isolation',
]);
/** Preserve existing advanced processing paths that have no equivalent page controls. */
export function canUseNativeAssistantTool(tool: string, args: Record<string, any>) {
  if (!NATIVE_ASSISTANT_TOOLS.has(tool)) return false;
  if (tool === 'generate_music') return args.duration >= 10 && args.duration <= 60;
  if (tool === 'process_audio') return ['wav', 'mp3', 'ogg'].includes(args.format || 'wav')
    && args.duration === undefined && !args.start && !args.fadeIn && !args.fadeOut && !args.gainDb
    && !args.pitchSemitones && !args.denoise && (args.speed === undefined || args.speed === 1);
  return true;
}
/** Shared by the planner, server and UI; only existing, registered tools are executable. */
export const ASSISTANT_TOOL_PAGES: Record<string, Destination> = {
  generate_speech: { workspace: 'dubbing-studio', title: '生成配音', tab: 'tts' },
  generate_speech_batch: { workspace: 'dubbing-studio', title: '批量制作配音', tab: 'tts' },
  translate_text: { workspace: 'dubbing-studio', title: '翻译台词', tab: 'tts' },
  enhance_voice_text: { workspace: 'dubbing-studio', title: '调整台词语气', tab: 'tts' },
  image_ocr: { workspace: 'dubbing-studio', title: '识别截图台词', tab: 'tts' },
  transcribe_speech: { workspace: 'dubbing-studio', title: '语音转文字', tab: 'stt' },
  change_voice: { workspace: 'dubbing-studio', title: '声音转换', tab: 'sts' },
  translate_dubbing: { workspace: 'dubbing-studio', title: '跨语种声音转换', tab: 'translate' },
  clone_voice: { workspace: 'dubbing-studio', title: '本地音色克隆', tab: 'convert' },
  clone_dialogue: { workspace: 'dubbing-studio', title: '多角色声音克隆', tab: 'convert' },
  local_voice_conversion: { workspace: 'dubbing-studio', title: '本地声音转换', tab: 'convert' },
  generate_music: { workspace: 'music-studio', title: '生成音乐' },
  music_prompt: { workspace: 'music-studio', title: '编写音乐提示词' },
  generate_lyrics: { workspace: 'music-studio', title: '创作歌词' },
  edit_lyrics: { workspace: 'music-studio', title: '修改歌词' },
  generate_sound_effect: { workspace: 'sfx-studio', title: '生成音效' },
  audio_design: { workspace: 'audio-director', title: '分析音频设计需求' },
  sound_requirements: { workspace: 'sfx-requirements', title: '整理音效需求表' },
  process_audio: { workspace: 'audio-tools', title: '格式与音频处理', tab: 'factory' },
  measure_audio: { workspace: 'audio-tools', title: '测量音频响度', tab: 'analysis' },
  analyze_music_metrics: { workspace: 'audio-tools', title: '分析节奏与调性', tab: 'analysis' },
  semantic_audio_analysis: { workspace: 'audio-tools', title: '解读音频指标', tab: 'analysis' },
  audio_to_midi: { workspace: 'audio-tools', title: '音频转 MIDI', tab: 'midi' },
  cloud_isolation: { workspace: 'audio-tools', title: '云端人声分离', tab: 'isolation' },
  rename_files: { workspace: 'audio-tools', title: '批量重命名', tab: 'renamer' },
  ucs_metadata: { workspace: 'audio-tools', title: '规范 UCS 命名', tab: 'renamer' },
  mix_timeline: { workspace: 'audio-tools', title: '混合音频轨道', tab: 'workstation' },
  export_timeline_stems: { workspace: 'audio-tools', title: '导出时间线分轨', tab: 'workstation' },
  library_search: { workspace: 'sfx-library', title: '搜索音效库' },
  library_get_files: { workspace: 'sfx-library', title: '读取音效库素材' },
  library_import: { workspace: 'sfx-library', title: '归档音效库' },
  library_edit_metadata: { workspace: 'sfx-library', title: '更新音效库资料' },
};

export const ASSISTANT_WORKSPACE_NAMES: Record<AssistantWorkspaceCommand['workspace'], string> = {
  'audio-tools': '音频工具', 'video-soundtrack': '视频声音制作', 'dubbing-studio': 'AI 配音',
  'music-studio': 'AI 音乐', 'sfx-studio': 'AI 音效', 'audio-director': 'AI 音频设计',
  'sfx-requirements': '音效需求表', 'sfx-library': '音效库',
};
