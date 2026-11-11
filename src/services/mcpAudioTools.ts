import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAssistantTools, type AgentToolContext } from './assistantAgentTools';
import type { AgentTool } from './assistantAgentLoop';
import { AUDIO_LANGUAGE_REGISTRY } from './languageRegistry';
import { createAudioEvidence } from '../utils/audioEvidence';
import { MCP_SFX_POLICY, produceMcpSoundEffect } from './mcpSfxProduction';

const s = { type: 'string' }, n = { type: 'number' }, b = { type: 'boolean' };
const strings = { type: 'array', items: s, maxItems: 200 };
const choice = (...values: string[]) => ({ type: 'string', enum: values });
export const MCP_EXCLUDED_TOOLS = new Set(['audio_to_midi', 'clone_voice', 'local_voice_conversion', 'clone_dialogue', 'local_separation',
  'open_module', 'ask_user', 'finish_task', 'review_before_export', 'video_workspace']);

/** Remote tools share the production implementations, including billing. */
export function createMcpAudioTools(c: AgentToolContext) {
  const tools = createAssistantTools(c).filter(t => !MCP_EXCLUDED_TOOLS.has(t.name));
  const add = (name: string, description: string, properties: Record<string, any>, required: string[], execute: AgentTool['execute']) =>
    tools.push({ name, description, parameters: { type: 'object', properties, required, additionalProperties: false }, execute });
  const replace = (name: string, execute: AgentTool['execute']) => { tools.find(t => t.name === name)!.execute = execute; };
  const generation = tools.find(t => t.name === 'generate_sound_effect')!;
  generation.description = '仅在用户明确要求AI生成音效，或搜索失败需要回退时使用。普通“需要某种音效”请求用produce_sound_effect，默认先搜索。生成支持0.5～30秒。';
  const image = async (id: string) => {
    const a = c.asset(id);
    if (!a.mimeType.startsWith('image/')) throw new Error('请选择图片。');
    return { data: (await fs.readFile(c.filePath(a))).toString('base64'), mimeType: a.mimeType, label: a.name };
  };
  const frames = async (id: string, batch = false) => {
    const a = c.asset(id);
    if (!a.mimeType.startsWith('video/')) throw new Error('请选择视频。');
    const form = new FormData();
    form.append('video', new Blob([new Uint8Array(await fs.readFile(c.filePath(a)))], { type: a.mimeType }), a.name);
    form.append('originalName', a.name);
    if (batch) form.append('analysisMode', 'sfx-batch');
    return (await c.request('/api/ai/audio-design-video-keyframes', form)).frames;
  };
  const waitJob = async (endpoint: string, job: any) => {
    while (job.status === 'running') {
      c.progress?.(job.message || '正在处理');
      await c.wait(1500);
      job = await c.request(`${endpoint}/${job.id}`);
    }
    if (job.status !== 'completed') throw new Error(job.error || job.message || '任务未完成。');
    return job.result;
  };
  const engine = tools.find(t => t.name === 'engine_status')!;
  engine.description = '检查云端 AI 服务或本人的积分额度。';
  (engine.parameters.properties as any).module = choice('ai', 'quota');
  replace('engine_status', ({ module }) => c.request(module === 'quota' ? '/api/usage/quota' : '/api/health?scope=ai'));
  replace('inspect_tools', async ({ query }) => ({ soundEffectPolicy: MCP_SFX_POLICY, tools: tools.filter(t => !query || `${t.name} ${t.description}`.toLowerCase().includes(String(query).toLowerCase()))
    .map(({ name, description, parameters }) => ({ name, description, inputSchema: parameters })), excluded: '依赖本地模型的功能不开放。' }));
  // Language selection is forwarded to the same voice endpoint used by the UI.
  const speech = tools.find(t => t.name === 'generate_speech')!;
  (speech.parameters.properties as any).languageCode = s;
  const speak = async ({ name, ...args }: Record<string, any>) => {
    const result = await c.request('/api/ai/elevenlabs/voice', args);
    const url = result.audioUrl || result.asset?.url;
    const assets = url ? [await c.register(url, `${path.parse(name).name}${path.extname(url) || '.mp3'}`, true)] : [];
    if (!assets.length) throw new Error('配音服务未返回音频文件。');
    assets.forEach(asset => { asset.metadata = { ...asset.metadata, voiceId: args.voiceId, text: args.text, languageCode: args.languageCode || 'auto' }; });
    return { ...result, assets };
  };
  speech.execute = speak;
  const batchSpeech = tools.find(t => t.name === 'generate_speech_batch')!;
  (batchSpeech.parameters.properties as any).languageCode = s;
  ((batchSpeech.parameters.properties as any).items.items.properties).languageCode = s;
  batchSpeech.execute = async a => {
    if (!a.items?.length || a.items.length > 200) throw new Error('批量配音支持1～200条。');
    const assets = [];
    for (const item of a.items) {
      c.signal.throwIfAborted();
      const result = await speak({ ...a, ...item, items: undefined, text: `${item.toneTags ?? a.toneTags ?? ''}${item.text}` });
      assets.push(...result.assets);
    }
    return { assets, completedCount: assets.length };
  };
  add('list_languages', '读取当前配音支持的语言；languageCode不填或auto为自动。', {}, [], async () => ({ languages: AUDIO_LANGUAGE_REGISTRY.map(l => ({ code: l.elevenLabsCode, name: l.label, englishName: l.elevenLabsName })) }));
  replace('sound_requirements', async a => {
    const screenshot = a.imageAssetId ? await image(a.imageAssetId) : null;
    const job = await c.request('/api/ai/sfx-requirements', { inputText: a.inputText || '', screenshot,
      templateType: a.templateType || 'game_sfx_general', projectName: a.projectName, background: true, requestId: randomUUID() });
    return waitJob('/api/ai/sfx-requirements/jobs', job);
  });
  replace('analyze_video', async a => {
    const video = c.asset(a.assetId);
    if (!video.mimeType.startsWith('video/') || !video.duration) throw new Error('请选择可读取时长的视频。');
    let job = await c.request('/api/video/analyze/jobs', { requestId: randomUUID(), fileName: path.basename(c.filePath(video)),
      videoDuration: video.duration, requirements: a.requirements, tracks: ['bgm', 'sfx', 'dubbing'].filter(t => a[`${t}Enabled`] !== false) });
      const requestId = job.requestId;
    try {
      while (job.status === 'running') { await c.wait(1500); job = await c.request(`/api/video/analyze/jobs/${job.id}`); }
      return job;
    } finally {
      if (c.signal.aborted) await c.request('/api/video/analyze/jobs/cancel', { requestId }, 'CANCEL').catch(() => undefined);
    }
  });
  add('prepare_sfx_query', '将中文关键词提炼成1～2个可搜索的英文声音词。已有英文搜索词直接复用，不翻译整段描述。',
    { keywords: s, description: s, searchQuery: s }, ['keywords'], a => c.request('/api/ai/sfx-batch/search-query', a));
  add('search_online_sound_effects', '复用AI音效联网搜索：Envato30%、其他三库合计30%、全网40%，来源故障互补。中文关键词自动转换成简短英文。返回候选ID和来源，接着capture_online_sound_effect采集试听。换关键词后旧候选可能失效，先采集需要的结果。',
    { keywords: s, searchQuery: s, page: { type: 'integer', minimum: 1, maximum: 50 }, excludeSourceUrls: strings }, ['keywords'], async a => {
      const { searchQuery } = await c.request('/api/ai/sfx-batch/search-query', { keywords: a.keywords, searchQuery: a.searchQuery || '' });
      return { ...await c.request('/api/sfx/online/search', { query: searchQuery, page: a.page || 1, excludeSourceUrls: a.excludeSourceUrls }), searchQuery };
    });
  add('capture_online_sound_effect', '采集上一步搜索候选的公开试听，保留原来源、水印及许可信息；返回可编辑文件。',
    { id: s, name: s }, ['id'], async a => {
      const result = await c.request('/api/sfx/online/capture', { id: a.id });
      const url = result.audioUrl || result.url;
      return { ...result, asset: await c.register(url, a.name || '联网音效.wav', false) };
    });
  add('analyze_sfx_batch', '从视频、需求表截图、文档或文字整理逐条音效需求（描述、关键词、时长、命名、时间范围），与批量制作页同一分析流程。文档可TXT/CSV/XLSX/DOCX，传assetId；视频保留密集动作采样。',
    { assetId: s, text: s, instructions: s }, [], async a => {
      let files: any[] = [], text = a.text || '', sourceType = 'table', videoDuration: number | undefined;
      if (a.assetId) {
        const asset = c.asset(a.assetId);
        if (asset.mimeType.startsWith('video/')) { files = await frames(a.assetId, true); sourceType = 'video'; videoDuration = asset.duration; }
        else if (asset.mimeType.startsWith('image/')) { files = [await image(a.assetId)]; sourceType = 'image'; }
        else text += '\n' + (await tools.find(t => t.name === 'read_document')!.execute({ assetId: a.assetId }) as any).text;
      }
      const job = await c.request('/api/ai/sfx-batch/analyze', { text, files, sourceType, videoDuration, instructions: a.instructions || '', background: true, requestId: randomUUID() });
      return waitJob('/api/ai/sfx-batch/analyze/jobs', job);
    });
  const modeSchema = { ...choice('auto', 'search', 'generate'), default: 'auto', description: '默认auto先搜索，服务报错时AI生成；明确要求AI生成填generate；只搜索不生成填search。' };
  const soundProperties = { name: { ...s, minLength: 1, maxLength: 180 }, keywords: { ...s, minLength: 1, maxLength: 300 },
    description: { ...s, maxLength: 2000 }, searchQuery: s, duration: { ...n, minimum: 0.5, maximum: 30 }, mode: modeSchema };
  const produce = (input: any) => produceMcpSoundEffect(c, input, generation.execute);
  add('produce_sound_effect', '普通音效需求的默认入口：先联网搜索并采集候选试听；搜索或采集服务报错且没有可用结果时自动AI生成一次。明确要求AI生成时mode=generate直接生成。没有搜索结果、积分不足、权限问题、限流或取消不会触发生成。返回method与fallbackReason，告知实际方式。',
    { ...soundProperties, searchBatchId: s }, ['name', 'keywords'], produce);
  const row = { type: 'object', properties: soundProperties, required: ['name', 'keywords'], additionalProperties: false };
  add('produce_sfx_batch', '批量制作音效的默认入口：每条默认先搜索，遇服务错误且没有可用音效时自动AI生成一次。用户明确要求AI生成才用mode=generate；mode=search仅搜索。每条可指定mode覆盖批次模式，返回实际method及切换原因。搜索复用同一searchBatchId的原有积分规则；先试听，不自动混入视频。',
    { mode: modeSchema, items: { type: 'array', items: row, minItems: 1, maxItems: 200 }, searchBatchId: s }, ['items'], async a => {
      const searchBatchId = a.searchBatchId || randomUUID();
      const items = [];
      for (const [index, item] of a.items.entries()) {
        c.signal.throwIfAborted(); c.progress?.(`制作音效 ${index + 1}/${a.items.length}`);
        try {
          items.push({ index, name: item.name, ...await produce({ ...item, mode: item.mode || a.mode || 'auto', searchBatchId }) });
        } catch (error) {
          c.signal.throwIfAborted();
          items.push({ index, name: item.name, status: 'failed', message: error instanceof Error ? error.message : '处理失败' });
        }
      }
      return { searchBatchId, items, completedCount: items.filter(v => v.status === 'completed').length };
    });
  add('match_voice', '从真实可用音色库中按描述或参考音频匹配声音，不创建本地克隆模型。',
    { description: s, gender: choice('male', 'female'), referenceAssetId: s }, [], async a => {
      const { voices } = await c.request('/api/ai/elevenlabs/voices');
      if (a.referenceAssetId) return c.request('/api/video/match-similar-voices', { audioUrl: c.asset(a.referenceAssetId).url, voices, preferredGender: a.gender, matchingKeywords: a.description });
      return c.request('/api/ai/match-voice', { description: a.description || '', gender: a.gender || 'female', voices });
    });
  add('music_analysis_naming', '复用音乐分析命名，依据实测BPM/调性/调式及AI情绪建议，不将名称分析冒充听音。返回命名数据，rename_files可生成副本。',
    { assetIds: { ...strings, minItems: 1, maxItems: 10 } }, ['assetIds'], async a => {
      const items = [];
      for (const id of a.assetIds) {
        const asset = c.asset(id);
        const metrics: any = await tools.find(t => t.name === 'analyze_music_metrics')!.execute({ assetId: id });
        items.push({ sourceName: asset.name, audioMetrics: createAudioEvidence(metrics, asset.duration || metrics.duration) });
      }
      return c.request('/api/ai/music-analysis-naming', { items });
    });
  add('visual_music_prompt', '依据图片或视频画面分析配乐，并生成英文配乐提示词。',
    { assetId: s, requirements: s, duration: n, instrumental: b }, ['assetId'], async a => {
      const asset = c.asset(a.assetId);
      const prepared = asset.mimeType.startsWith('video/') ? await frames(a.assetId) : [await image(a.assetId)];
      const selected = prepared.length <= 8 ? prepared : Array.from({ length: 8 }, (_, i) => prepared[Math.round(i * (prepared.length - 1) / 7)]);
      return c.request('/api/ai/music-prompt/from-visual', { files: selected,
        sourceType: asset.mimeType.startsWith('video/') ? 'video' : 'image', requirements: a.requirements || '', duration: a.duration || 30, instrumental: a.instrumental !== false });
    });
  add('analyze_audio', '提取真实音频指标，并将最多前36秒的PCM片段交给已配置的云端音频模型分析。未配置云端音频模型时按原功能返回指标解读并标明未直接听音，不会启动本地模型。',
    { assetId: s }, ['assetId'], async a => {
      const asset = c.asset(a.assetId);
      const metrics: any = await tools.find(t => t.name === 'analyze_music_metrics')!.execute(a);
      const preview = await c.save(Buffer.alloc(0), '分析片段.wav');
      try {
        await c.ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', c.filePath(asset), '-t', '36', '-vn', '-ac', '1', '-ar', '22050', '-c:a', 'pcm_s16le', c.filePath(preview)]);
        const form = new FormData();
        form.append('metadata', JSON.stringify({ duration: metrics.duration, bpm: metrics.bpm.value, keyName: metrics.key.name, tempo: metrics.bpm, key: metrics.key, musicalMode: metrics.musicalMode, chords: metrics.chords, audioProfile: metrics.audioProfile }));
        form.append('audio', new Blob([new Uint8Array(await fs.readFile(c.filePath(preview)))], { type: 'audio/wav' }), 'preview.wav');
        return c.request('/api/ai/audio-analysis/semantic', form);
      } finally { await fs.unlink(c.filePath(preview)).catch(() => undefined); }
    });
  return tools;
}
