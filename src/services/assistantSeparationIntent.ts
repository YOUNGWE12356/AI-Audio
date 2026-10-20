/** Only unambiguous standalone commands bypass model planning. */
export function isDirectStemSeparationRequest(prompt: string) {
  const normalized = prompt.trim().replace(/[\s，,。.!！?？、：:；;]/g, '');
  return /^(?:请|帮我|请帮我)?(?:把(?:这个|这段|上传的)?(?:音频|视频|歌曲|音乐))?(?:拆分轨|拆分分轨|拆分音轨|拆分乐器|音乐分轨|歌曲分轨|乐器分轨|分轨)(?:吧|一下|处理)?$/.test(normalized);
}
