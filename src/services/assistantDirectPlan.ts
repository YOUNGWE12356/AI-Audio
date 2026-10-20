import type { AssistantAsset } from './assistantAgentTypes';

type Step = { tool: string; args: Record<string, unknown>; usePreviousOutput?: boolean };
/** Small, conservative shortcuts. Everything more complex uses the tool planner. */
export function getDirectAssistantPlan(prompt: string, sources: AssistantAsset[]): Step[] | undefined {
  if (sources.length !== 1) return;
  const text = prompt.trim().replace(/[\s，,。！!]/g, '');
  const source = sources[0];
  const name = source.name.replace(/\.[^.]+$/, '');
  if (/^(?:请|帮我|请帮我)?(?:把(?:上传的|这个|这段)?(?:音频|音乐|文件))?压缩(?:一下)?(?:上传的|这个|这段)?(?:音频|音乐|文件)?(?:一下|吧)?$/i.test(text)) {
    return [{ tool: 'process_audio', args: { assetId: source.id, name: `${name}_压缩`, format: 'mp3', sampleRate: 32000, bitrate: 96 } }];
  }
  const convert = text.match(/^(?:请|帮我|请帮我)?(?:把(?:上传的|这个|这段)?(?:音频|视频))?(?:转成|转为|转换成|转换为)(mp3|wav|ogg|flac|aac|m4a)(?:格式)?(?:(?:然后|并|再)((?:测量|检测)响度|测速(?:和?测调)?|分析(?:BPM|节奏和调性)))?(?:吧|一下)?$/i);
  if (convert) return [{ tool: 'process_audio', args: { assetId: source.id, name: `${name}_转换`, format: convert[1].toLowerCase() } },
    ...(convert[2] ? [{ tool: /响度/.test(convert[2]) ? 'measure_audio' : 'analyze_music_metrics', args: {}, usePreviousOutput: true }] : [])];
  if (/^(?:请|帮我|请帮我)?(?:测量|检测)(?:这个|上传的)?(?:音频)?响度(?:吧|一下)?$/.test(text)) return [{ tool: 'measure_audio', args: { assetId: source.id } }];
  if (/^(?:请|帮我|请帮我)?(?:(?:分析|检测)(?:这个|上传的)?(?:音频|音乐)?(?:的)?(?:节奏和调性|BPM和调性|BPM|调性|测速|测调|测速测调)|(?:给(?:这个|上传的)?(?:音频|音乐))?(?:测速|测调|测速测调|测速和测调))(?:吧|一下)?$/i.test(text)) return [{ tool: 'analyze_music_metrics', args: { assetId: source.id } }];
  if (/^(?:请|帮我|请帮我)?(?:本地)?(?:人声分离|分离人声|提取人声)(?:吧|一下)?$/.test(text)) return [{ tool: 'local_separation', args: { assetId: source.id, mode: 'vocals' } }];
}
