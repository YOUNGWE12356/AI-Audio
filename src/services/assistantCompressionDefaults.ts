/** The user's compression preset applies to audio processing, never ZIP packaging. */
export function applyAssistantCompressionDefaults<T extends Record<string, any>>(args: T, prompt = ''): T {
  if (!/(?:压缩|压小|减小体积|compress)/i.test(prompt) || /(?:不(?:要|用)?|别)压缩/.test(prompt)) return args;
  if (/(?:压缩包|zip|打包)/i.test(prompt) && !/(?:音频|音乐|响度|音量|音质|kbps|khz)/i.test(prompt)) return args;
  const sampleRate = prompt.match(/(\d+(?:\.\d+)?)\s*(kHz|Hz|千赫兹|赫兹)/i);
  const labelledSampleRate = prompt.match(/采样率\s*(?:为|到|设为|调整为|[:：])?\s*(\d{4,6})/);
  const bitrate = prompt.match(/(\d+)\s*(?:kbps|kb\/s|kbit\/s)/i)
    || prompt.match(/(?:比特率|码率)\s*(?:为|到|设为|调整为|[:：])?\s*(\d+)/);
  const format = prompt.match(/\b(mp3|wav|ogg|flac|aac|m4a)\b/i);
  const preservePrevious = /(?:上次|之前|原来|相同|同上).{0,6}(?:参数|设置)/.test(prompt);
  const keepSampleRate = preservePrevious || /(?:保持|保留|不改|不变).{0,8}采样率|采样率.{0,6}(?:保持|保留|不改|不变)/.test(prompt);
  const keepBitrate = preservePrevious || /(?:保持|保留|不改|不变).{0,8}(?:比特率|码率)|(?:比特率|码率).{0,6}(?:保持|保留|不改|不变)/.test(prompt);
  return {
    ...args,
    format: format?.[1].toLowerCase() || (preservePrevious ? args.format : undefined) || 'mp3',
    sampleRate: sampleRate ? Number(sampleRate[1]) * (/^(?:k|千)/i.test(sampleRate[2]) ? 1000 : 1)
      : labelledSampleRate ? Number(labelledSampleRate[1]) : keepSampleRate ? args.sampleRate : 32000,
    bitrate: bitrate ? Number(bitrate[1]) : keepBitrate ? args.bitrate : 96,
  };
}
