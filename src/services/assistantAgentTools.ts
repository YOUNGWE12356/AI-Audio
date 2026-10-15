import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import type { AgentTool } from './assistantAgentLoop';
import type { AssistantAsset, AssistantWorkspaceCommand } from './assistantAgentTypes';
import { buildSfxLibraryIndex, findSfxLibraryMatches } from './sfxLibraryIndex';
import { analyzeDecodedAudio } from '../utils/audioMetrics';
import { readAssistantDocument } from './assistantDocument';

type Args = Record<string, any>;
export type AgentToolContext = {
  assets: AssistantAsset[];
  signal: AbortSignal;
  request: (endpoint: string, body?: Args | FormData, method?: string, headers?: Record<string, string>) => Promise<any>;
  asset: (id: string) => AssistantAsset;
  filePath: (asset: AssistantAsset) => string;
  register: (url: string, name: string, generated?: boolean) => Promise<AssistantAsset>;
  save: (data: Buffer, name: string, mimeType?: string) => Promise<AssistantAsset>;
  ffmpeg: (args: string[]) => Promise<string>;
  wait: (milliseconds: number) => Promise<void>;
  ask: (question: string) => void;
  finish: (summary: string, assetIds: string[]) => void | boolean;
  review?: (args: Args) => void;
  navigate: (tab: string) => void;
  progress?: (message: string) => void;
  workspace?: (action: AssistantWorkspaceCommand['action'], args: Args) => Promise<any>;
};
const str = { type: 'string' };
const num = { type: 'number' };
const bool = { type: 'boolean' };
const strings = { type: 'array', items: str };
const object = (properties: Args, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const choice = (...values: string[]) => ({ type: 'string', enum: values });
const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`数值须在 ${min}–${max} 之间。`);
  return n;
};
export const safeAgentName = (value: string) => path.win32.basename(value).normalize('NFC')
  .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 180) || 'result';

export function createAssistantTools(c: AgentToolContext): AgentTool[] {
  const tools: AgentTool[] = [];
  const add = (name: string, description: string, properties: Args, required: string[], execute: AgentTool['execute']) => {
    tools.push({ name, description, parameters: object(properties, required), execute });
  };
  const json = (name: string, description: string, endpoint: string, properties: Args, required: string[] = []) =>
    add(name, description, properties, required, args => c.request(endpoint, args));
  const multipart = async (endpoint: string, args: Args, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(args)) {
      if (key in fields) {
        const asset = c.asset(String(value));
        form.append(fields[key], new Blob([new Uint8Array(await fs.readFile(c.filePath(asset)))], { type: asset.mimeType }), asset.name);
      } else if (value !== undefined) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return c.request(endpoint, form);
  };
  const ingest = async (result: any, name: string, keys = ['audioUrl', 'videoUrl', 'midiUrl', 'zipUrl']) => {
    const assets: AssistantAsset[] = [];
    for (const key of keys) if (typeof result[key] === 'string') {
      const extension = path.extname(result[key].split('?')[0]) || (key === 'zipUrl' ? '.zip' : '.wav');
      assets.push(await c.register(result[key], `${path.parse(safeAgentName(name)).name}${extension}`, true));
    }
    return { ...result, assets };
  };

  if (c.workspace) {
    add('video_workspace', '在软件的“视频声音制作”页面实际操作：先inspect当前工程或load视频；analyze调用页面AI画面分析；edit_clips添加/修改时间线片段和配音声线；generate调用页面片段合成功能并等待完成。全部制作完成后调用review_before_export供用户试听，只有用户回复导出后才export。各步都在页面可见，不能用聊天内独立生成替代。', {
      action: choice('inspect', 'load', 'analyze', 'edit_clips', 'generate', 'export'),
      videoAssetId: str, name: str, requirements: str, tracks: { type: 'array', items: choice('bgm', 'sfx', 'dubbing') },
      clipIds: strings, includeOriginalAudio: bool,
      clips: { type: 'array', items: object({ id: str, assetId: str, trackType: choice('bgm', 'sfx', 'dubbing'), name: str,
        prompt: str, text: str, targetLanguage: str, voiceId: str, startTime: num, duration: num, volume: num, remove: bool }, ['trackType']) },
    }, ['action'], async a => {
      const args = { ...a };
      if (a.videoAssetId) args.video = c.asset(a.videoAssetId);
      if (a.clips) args.clips = a.clips.map((clip: Args) => ({ ...clip, asset: clip.assetId ? c.asset(clip.assetId) : undefined }));
      const result = await c.workspace!(a.action, args);
      const assets: AssistantAsset[] = [];
      for (const file of result.files || []) assets.push(await c.register(file.url, file.name, true));
      let projectAsset: AssistantAsset | undefined;
      if (a.action === 'export' && result.project) projectAsset = await c.save(Buffer.from(JSON.stringify(result.project, null, 2)), `${safeAgentName(result.project.name)}_时间线.json`, 'application/json');
      return { ...result, assets, projectAsset };
    });
    if (c.review) add('review_before_export', '全部音频制作完成后，停在制作页面供用户试听，并等待用户在对话框回复“导出”。此阶段不得导出成片或宣称已交付；用户也可以直接提出修改要求。',
      { name: str, includeOriginalAudio: bool }, [], async args => {
        const result = await c.workspace!('inspect', {});
        c.review!(args);
        return { waitingForReview: true, project: result.project };
      });
  }
  add('inspect_assets', '列出本次任务全部真实文件及生成结果。文件参数一律使用 assetId，禁止编造路径。', {}, [], async () => ({ assets: c.assets }));
  add('read_document', '读取已上传 TXT/MD/CSV/TSV/JSON/DOCX/XLSX 文本资料。截图台词用 image_ocr。', { assetId: str }, ['assetId'], async ({ assetId }) => {
    const asset = c.asset(assetId);
    if (asset.size > 20 * 1024 * 1024) throw new Error('文档文件过大，请拆分。');
    const text = await readAssistantDocument(await fs.readFile(c.filePath(asset)), asset.name);
    if (text.length > 100000) throw new Error('文档文字过多，请拆分。');
    return { text };
  });
  add('engine_status', '查看模型、MIDI、分轨、本地克隆、SeedVC、额度状态。执行前按需检查。',
    { module: choice('ai', 'midi', 'separation', 'clone', 'seed_vc', 'quota') }, ['module'], async ({ module }) => {
      const endpoints = { ai: '/api/health?scope=ai', midi: '/api/audio-to-midi/status', separation: '/api/audio/music-separation/engine', clone: '/api/ai/local/voice-clone/status', seed_vc: '/api/ai/local/seed-vc/status', quota: '/api/usage/quota' };
      if (!(module in endpoints)) throw new Error('未知模块。');
      return c.request(endpoints[module as keyof typeof endpoints]);
    });
  add('list_voices', '读取真实可用人声。按性别、年龄、语言、音色描述选声音，禁止虚构 voiceId。', { query: str }, [], async ({ query }) => {
    const result = await c.request('/api/ai/elevenlabs/voices');
    const voices = Array.isArray(result.voices) ? result.voices : [];
    const terms = String(query || '').toLowerCase().split(/[\s,，]+/).filter(Boolean);
    return { voices: voices.map((voice: any) => ({ voice, score: terms.filter(term => JSON.stringify(voice).toLowerCase().includes(term)).length }))
      .sort((a: any, b: any) => b.score - a.score).slice(0, 60).map((item: any) => item.voice), total: voices.length };
  });
  json('translate_text', '翻译台词，保留语气和语义。跨语种配音应先翻译，再用返回的目标语言文本合成。', '/api/ai/translate-language',
    { text: str, targetLanguage: str, preserveTone: bool, preserveInterjections: bool, maxDurationSeconds: num, strictDuration: bool }, ['text', 'targetLanguage']);
  json('enhance_voice_text', '为台词增加适当的 V3 语气标签。', '/api/ai/voice-v3-enhance', { text: str, voiceName: str, voiceDescription: str, language: str }, ['text']);
  add('generate_speech', '使用真实人声合成配音。支持语气标签；批量任务逐条调用，沿用原序号命名。不自动翻译输入。返回实际时长。',
    { text: str, voiceId: str, voiceSource: str, publicOwnerId: str, voiceName: str, name: str, qualityMode: choice('standard', 'pro'), stability: num, similarity: num, style: num }, ['text', 'voiceId', 'name'],
    async ({ name, ...args }) => {
      const result = await ingest(await c.request('/api/ai/elevenlabs/voice', args), name);
      result.assets.forEach(asset => { asset.metadata = { voiceId: args.voiceId, voiceName: args.voiceName, voiceSource: args.voiceSource, publicOwnerId: args.publicOwnerId, text: args.text }; });
      return result;
    });
  add('generate_music', 'ElevenLabs 音乐生成，可器乐/歌曲，保留原音乐入口。duration 秒。超过60秒的纯配乐可用长音乐接口。',
    { prompt: str, duration: num, instrumental: bool, lyrics: str, name: str }, ['prompt', 'duration', 'name'], async a => {
      finite(a.duration, 30, 1, a.instrumental === false ? 60 : 600);
      const result = a.duration > 60
        ? await c.request('/api/video/generate-clip', { prompt: a.prompt, trackId: `bgm_${randomUUID()}`, trackType: 'bgm', duration: a.duration })
        : await c.request('/api/ai/elevenlabs/music', { text: a.prompt, duration: a.duration, isInstrumental: a.instrumental !== false, lyrics: a.lyrics });
      return ingest(result, a.name);
    });
  add('generate_speech_batch', '批量配音，逐条等待合成并自动制作下一条；支持统一音色/语气和逐条覆盖。名称必须优先保留原序号，最多200条。',
    { voiceId: str, voiceSource: str, publicOwnerId: str, voiceName: str, toneTags: str,
      items: { type: 'array', items: object({ text: str, name: str, voiceId: str, toneTags: str }, ['text', 'name']) } }, ['voiceId', 'items'], async a => {
      if (!Array.isArray(a.items) || !a.items.length || a.items.length > 200) throw new Error('批量配音支持1到200条。');
      const assets = [];
      for (let i = 0; i < a.items.length; i++) {
        c.signal.throwIfAborted();
        const item = a.items[i];
        c.progress?.(`批量配音 ${i + 1}/${a.items.length}：${item.name}`);
        const result = await tools.find(tool => tool.name === 'generate_speech')!.execute({
          voiceId: item.voiceId || a.voiceId, voiceSource: a.voiceSource, publicOwnerId: a.publicOwnerId, voiceName: a.voiceName,
          text: `${item.toneTags ?? a.toneTags ?? ''}${item.text}`, name: item.name,
        }) as any;
        assets.push(...result.assets);
      }
      return { assets, completedCount: assets.length };
    });
  add('generate_sound_effect', '生成指定描述、时长的音效，0.5到30秒。批量需求逐项调用。',
    { prompt: str, duration: num, name: str }, ['prompt', 'name'], async a => ingest(await c.request('/api/ai/elevenlabs/sound-effect', { text: a.prompt, duration: finite(a.duration, 4, .5, 30) }), a.name));
  json('generate_lyrics', '根据风格生成歌词。', '/api/ai/generate-lyrics', { style: str }, ['style']);
  json('edit_lyrics', '按方向修改歌词选中部分。', '/api/ai/regenerate-lyrics', { originalLyrics: str, selectedPart: str, direction: str }, ['originalLyrics', 'selectedPart', 'direction']);
  json('music_prompt', '生成专业精简英文音乐提示词。', '/api/ai/music-prompt', { text: str, instrumental: bool }, ['text']);
  add('image_ocr', '从真实截图提取台词，不重复添加文件或台词。', { assetId: str }, ['assetId'], async ({ assetId }) => {
    const a = c.asset(assetId);
    if (!a.mimeType.startsWith('image/')) throw new Error('请选择截图。');
    return c.request('/api/ai/batch-voice-image-ocr', { image: { mimeType: a.mimeType, data: (await fs.readFile(c.filePath(a))).toString('base64'), fileName: a.name } });
  });
  add('sound_requirements', '生成音效/配音需求表。默认通用游戏音效模板，遵循UCS命名。可输入文字或截图，返回结构化表。',
    { inputText: str, imageAssetId: str, templateType: choice('game_sfx_general', 'game_sfx_middleware', 'voiceover_general', 'voiceover_multilang'), projectName: str }, [], async a => {
      let screenshot: any = null;
      if (a.imageAssetId) {
        const asset = c.asset(a.imageAssetId);
        if (!asset.mimeType.startsWith('image/')) throw new Error('需求表截图须为图片。');
        screenshot = { mimeType: asset.mimeType, data: (await fs.readFile(c.filePath(asset))).toString('base64') };
      }
      return c.request('/api/ai/sfx-requirements', { inputText: a.inputText || '', screenshot, templateType: a.templateType || 'game_sfx_general', projectName: a.projectName });
    });
  add('audio_design', 'AI音频设计：分析图片/视频或文字，生成设计、音乐/SUNO提示词等。暂不支持音频和PDF分析，严禁按文件名猜测。',
    { assetIds: strings, requirements: str, target: object({ game: bool, video: bool, avatar: bool, sunnyIsland: bool, gift: bool, activity: bool }), isInstrumental: bool }, ['requirements'], async a => {
      const files = [];
      for (const id of a.assetIds || []) {
        const asset = c.asset(id);
        if (asset.mimeType.startsWith('video/')) {
          const result = await multipart('/api/ai/audio-design-video-keyframes', { assetId: id, originalName: asset.name }, { assetId: 'video' });
          files.push(...result.frames);
        } else if (asset.mimeType.startsWith('image/')) {
          files.push({ data: (await fs.readFile(c.filePath(asset))).toString('base64'), mimeType: asset.mimeType, label: asset.name });
        } else throw new Error('暂不支持音频或PDF分析；请上传图片、视频，或输入文字需求。');
      }
      return c.request('/api/ai/audio-design', { ...a, files });
    });
  add('analyze_video', '按视频画面分析BGM、音效、字幕时间线。须传用户完整要求。返回真实分析片段；需要逐片生成后再混音。',
    { assetId: str, requirements: str, bgmEnabled: bool, sfxEnabled: bool, dubbingEnabled: bool }, ['assetId', 'requirements'], async a => {
      const asset = c.asset(a.assetId);
      if (!asset.mimeType.startsWith('video/')) throw new Error('请选择视频文件。');
      if (c.workspace) {
        const tool = tools.find(tool => tool.name === 'video_workspace')!;
        await tool.execute({ action: 'load', videoAssetId: a.assetId });
        return tool.execute({ action: 'analyze', requirements: a.requirements, tracks: ['bgm', 'sfx', 'dubbing'].filter(type => a[`${type}Enabled`] !== false) });
      }
      const result = await c.request('/api/video/analyze', { ...a, fileName: path.basename(c.filePath(asset)), videoDuration: asset.duration });
      if (result.analysisSource === 'local-fallback' || result.analysisPartial) throw new Error(result.warning || '无法完成精确视频分析。');
      return result;
    });
  for (const [name, description, endpoint, properties, required, fields] of [
    ['transcribe_speech', '语音识别转文字，可分说话人；不是音乐风格分析。', '/api/ai/elevenlabs/speech-to-text', { assetId: str, languageCode: str, diarize: bool, numSpeakers: num }, ['assetId'], { assetId: 'audio' }],
    ['change_voice', 'ElevenLabs声音转换，保留语言和表演。跨语言使用translate_dubbing。', '/api/ai/elevenlabs/speech-to-speech', { assetId: str, voiceId: str, voiceSource: str, publicOwnerId: str, voiceName: str }, ['assetId', 'voiceId'], { assetId: 'audio' }],
    ['translate_dubbing', '已有跨语种声音转换；Dubbing v2已暂停，禁止启用。', '/api/ai/elevenlabs/translate-dubbing', { assetId: str, voiceId: str, sourceLanguage: str, targetLanguage: str, timingMode: choice('natural', 'match', 'strict') }, ['assetId', 'voiceId', 'targetLanguage'], { assetId: 'audio' }],
    ['cloud_isolation', 'ElevenLabs云端人声分离。免费本地用local_separation。', '/api/ai/elevenlabs/audio-isolation', { assetId: str }, ['assetId'], { assetId: 'audio' }],
    ['audio_to_midi', '调用已安装的通用/乐器专用本地MIDI模型。先查engine_status。', '/api/audio-to-midi/convert', { assetId: str, mode: choice('basic-pitch', 'piano', 'drums', 'guitar', 'bass', 'strings', 'multi') }, ['assetId', 'mode'], { assetId: 'media' }],
    ['clone_voice', '本地参考音色克隆，免费模型。先查就绪状态，text最多800字；referenceAssetId指定参考音频。', '/api/ai/local/voice-clone', { referenceAssetId: str, text: str, engine: choice('chatterbox', 'cosyvoice3', 'qwen3_tts'), language: str, referenceStart: num, referenceDuration: num }, ['referenceAssetId', 'text', 'engine'], { referenceAssetId: 'reference' }],
    ['local_voice_conversion', 'SeedVC本地声音转换，需源音频和参考音频。', '/api/ai/local/seed-vc/convert', { sourceAssetId: str, referenceAssetId: str, model: choice('v1', 'v2'), targetDuration: num }, ['sourceAssetId', 'referenceAssetId'], { sourceAssetId: 'source', referenceAssetId: 'reference' }],
    ['semantic_audio_analysis', '音乐风格/场景/调式语义分析。只有真实音频理解模型就绪才可执行；当前TokenHub不支持时会明确报错，禁止猜测。', '/api/ai/audio-analysis/semantic', { assetId: str, metadata: object({ sourceName: str, duration: num, bpm: num, keyName: str }) }, ['assetId'], { assetId: 'audio' }],
  ] as const) {
    add(name, description, properties, [...required], async a => ingest(await multipart(endpoint, a, fields), `${c.asset(a.assetId || a.sourceAssetId || a.referenceAssetId).name}_${name}`));
  }
  add('clone_dialogue', '单人/多人跨语种本地声音克隆，保留角色参考与声音事件并生成A/B两个版本。先识别和翻译全部segments，自动等待两个版本完成。',
    { sourceAssetId: str, engine: choice('chatterbox', 'cosyvoice3', 'qwen3_tts'), language: str, dialogueMode: choice('single', 'multi'),
      profiles: { type: 'array', items: object({ id: str, referenceStart: num, referenceEnd: num }, ['id', 'referenceStart', 'referenceEnd']) },
      segments: { type: 'array', items: object({ id: str, speakerId: str, sourceText: str, targetText: str, start: num, end: num }, ['speakerId', 'sourceText', 'targetText', 'start', 'end']) },
      events: { type: 'array', items: object({ id: str, type: choice('laughter', 'breath', 'quick_breath', 'cough', 'sigh', 'noise', 'mn'), start: num, end: num, sourceText: str }, ['type', 'start', 'end']) } },
    ['sourceAssetId', 'engine', 'language', 'profiles', 'segments'], async a => {
      const source = c.asset(a.sourceAssetId);
      const { sourceAssetId, ...payload } = a;
      const result = await multipart('/api/ai/local/voice-clone/batch', { sourceAssetId, payload: { ...payload, sourceDuration: source.duration,
        versions: [{ id: 'A', performance: 'natural' }, { id: 'B', performance: 'expressive' }] } }, { sourceAssetId: 'source' });
      const assets = [];
      for (const option of result.options || []) if (option.data?.audioUrl) assets.push(await c.register(option.data.audioUrl, `${path.parse(source.name).name}_${option.id}.wav`, true));
      return { ...result, assets };
    });
  add('local_separation', '免费本地人声分离(vocals，输出纯人声和伴奏)或多轨分离(stems)。等待真实结果后返回全部文件。',
    { assetId: str, mode: choice('vocals', 'stems') }, ['assetId', 'mode'], async a => {
      const source = c.asset(a.assetId);
      const job = await multipart('/api/audio/music-separation/jobs', { ...a, originalName: source.name }, { assetId: 'media' });
      try {
        for (;;) {
          c.signal.throwIfAborted();
          const state = await c.request(`/api/audio/music-separation/jobs/${encodeURIComponent(job.id)}`);
          c.progress?.(`本地分离 ${state.progress || 0}%：${state.message || '正在制作'}`);
          if (state.status === 'failed' || state.status === 'cancelled') throw new Error(state.error || state.message);
          if (state.status === 'completed') {
            const assets = [];
            for (const stem of state.stems || []) assets.push(await c.register(stem.downloadUrl || stem.audioUrl, `${path.parse(source.name).name}_${stem.name}.wav`, true));
            return { ...state, assets };
          }
          await c.wait(2000);
        }
      } catch (error) {
        if (c.signal.aborted) await c.request(`/api/audio/music-separation/jobs/${encodeURIComponent(job.id)}`, undefined, 'DELETE').catch(() => undefined);
        throw error;
      }
    });
  add('process_audio', '本地音频工厂/编辑：裁剪、格式转换、提取视频音轨、采样率、比特率、单/立体声、响度、音量、变速、移调、淡入淡出、降噪。多个处理可一次完成，源文件不覆盖。',
    { assetId: str, name: str, format: choice('wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a'), start: num, duration: num,
      sampleRate: num, bitrate: num, channels: choice('mono', 'stereo'), lufs: num, gainDb: num, speed: num, pitchSemitones: num, fadeIn: num, fadeOut: num, denoise: bool }, ['assetId', 'name'], async a => {
      const source = c.asset(a.assetId);
      const format = a.format || 'wav';
      if (!['wav', 'mp3', 'ogg', 'flac', 'aac', 'm4a'].includes(format)) throw new Error('未知音频格式。');
      const filters: string[] = [];
      const speed = finite(a.speed, 1, .25, 4);
      const pitch = Math.pow(2, finite(a.pitchSemitones, 0, -24, 24) / 12);
      if (pitch !== 1) filters.push(`aresample=48000,asetrate=${48000 * pitch},aresample=48000`);
      let tempo = speed / pitch;
      while (tempo > 2) { filters.push('atempo=2'); tempo /= 2; }
      while (tempo < .5) { filters.push('atempo=0.5'); tempo /= .5; }
      if (tempo !== 1) filters.push(`atempo=${tempo}`);
      if (a.denoise) filters.push('afftdn');
      if (a.gainDb !== undefined) filters.push(`volume=${finite(a.gainDb, 0, -96, 36)}dB`);
      if (a.lufs !== undefined) filters.push(`loudnorm=I=${finite(a.lufs, -16, -70, -5)}:TP=-1:LRA=11`);
      const duration = a.duration === undefined ? (source.duration || 0) - (a.start || 0) : finite(a.duration, 1, .01, 86400);
      if (a.fadeIn) filters.push(`afade=t=in:d=${finite(a.fadeIn, 0, 0, 600)}`);
      if (a.fadeOut) {
        if (!(duration > 0)) throw new Error('无法确定淡出位置，请提供时长。');
        const fade = finite(a.fadeOut, 0, 0, 600);
        filters.push(`afade=t=out:st=${Math.max(0, duration / speed - fade)}:d=${fade}`);
      }
      const output = await c.save(Buffer.alloc(0), `${path.parse(safeAgentName(a.name)).name}.${format}`);
      const args = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (a.start !== undefined) args.push('-ss', String(finite(a.start, 0, 0, 86400)));
      args.push('-i', c.filePath(source));
      if (a.duration !== undefined) args.push('-t', String(duration / speed));
      args.push('-vn', '-map', '0:a:0');
      if (filters.length) args.push('-af', filters.join(','));
      args.push('-ac', a.channels === 'mono' ? '1' : '2', '-ar', String(finite(a.sampleRate, 48000, 8000, 192000)));
      if (['mp3', 'ogg', 'aac', 'm4a'].includes(format)) args.push('-b:a', `${finite(a.bitrate, 192, 32, 512)}k`);
      args.push(c.filePath(output));
      await c.ffmpeg(args);
      return { asset: await c.register(output.url, output.name, true) };
    });
  add('measure_audio', '实测音频时长、响度LUFS、峰值、动态范围；不据此猜测风格/调式。', { assetId: str }, ['assetId'], async a => {
    const asset = c.asset(a.assetId);
    const log = await c.ffmpeg(['-hide_banner', '-i', c.filePath(asset), '-vn', '-af', 'loudnorm=I=-16:TP=-1:LRA=11:print_format=json', '-f', 'null', '-']);
    const match = log.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (!match) throw new Error('未能取得响度数据。');
    return { duration: asset.duration, measurements: JSON.parse(match[0]) };
  });
  add('analyze_music_metrics', '复用音频工具本地算法，估算BPM、调性、调式、和弦及频谱/乐器倾向，保留置信度。这是信号估算，不是AI听音风格识别，不承诺世界全部调式。',
    { assetId: str }, ['assetId'], async a => {
      const asset = c.asset(a.assetId);
      const decoded = await c.save(Buffer.alloc(0), 'metrics.f32');
      try {
        await c.ffmpeg(['-y', '-hide_banner', '-loglevel', 'error', '-i', c.filePath(asset), '-t', '300', '-vn', '-ac', '2', '-ar', '22050', '-f', 'f32le', c.filePath(decoded)]);
        const bytes = await fs.readFile(c.filePath(decoded));
        const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
        const channels = [new Float32Array(Math.floor(samples.length / 2)), new Float32Array(Math.floor(samples.length / 2))];
        for (let i = 0; i < channels[0].length; i++) { channels[0][i] = samples[i * 2]; channels[1][i] = samples[i * 2 + 1]; }
        const buffer = { sampleRate: 22050, duration: channels[0].length / 22050, numberOfChannels: 2, length: channels[0].length, getChannelData: (index: number) => channels[index] } as AudioBuffer;
        return { ...analyzeDecodedAudio(buffer, asset.name), sourceDuration: asset.duration, analyzedSeconds: buffer.duration, method: 'local-signal-estimation', note: '本地信号估算；最长分析前300秒。风格与场景需真实音频理解服务，不能据这些指标推断。' };
      } finally { await fs.unlink(c.filePath(decoded)).catch(() => undefined); }
    });
  const clipSchema = object({ assetId: str, name: str, trackType: choice('bgm', 'sfx', 'dubbing'), startTime: num, duration: num, sourceOffset: num, allowTrim: bool, volume: num, speed: num, fadeIn: num, fadeOut: num }, ['assetId', 'startTime']);
  add('mix_timeline', '按秒对齐多轨并导出音频或带声音的视频，同时生成可编辑时间线工程。配音默认保留实测时长，严格使用用户指定开始秒；若超出视频须先处理，不得静默截断。volume为0到2。',
    { videoAssetId: str, clips: { type: 'array', items: clipSchema }, includeOriginalAudio: bool, originalAudioVolume: num, name: str, audioFormat: choice('wav', 'mp3', 'ogg', 'aac'), timelineDuration: num }, ['clips', 'name'], async a => {
      if (!Array.isArray(a.clips) || !a.clips.length) throw new Error('需要真实生成/选择的音频片段。');
      const video = a.videoAssetId ? c.asset(a.videoAssetId) : undefined;
      if (video && c.workspace) {
        const tool = tools.find(tool => tool.name === 'video_workspace')!;
        await tool.execute({ action: 'load', videoAssetId: a.videoAssetId, name: a.name, includeOriginalAudio: a.includeOriginalAudio });
        await tool.execute({ action: 'edit_clips', clips: a.clips });
        return tool.execute({ action: 'export', name: a.name });
      }
      const clips = a.clips.map((clip: Args) => {
        const asset = c.asset(clip.assetId);
        if (!asset.size || !asset.duration) throw new Error(`片段 ${asset.name} 没有有效音频。`);
        const startTime = finite(clip.startTime, 0, 0, 86400);
        const sourceOffset = finite(clip.sourceOffset, 0, 0, asset.duration);
        const speed = finite(clip.speed, 1, .25, 4);
        const duration = finite(clip.duration, (asset.duration - sourceOffset) / speed, .01, 86400);
        if (clip.trackType === 'dubbing' && !clip.allowTrim && duration < (asset.duration - sourceOffset) / speed - .05) throw new Error('配音片段时长小于真实语音，不能静默截掉台词。请保留完整长度或按用户要求明确裁剪。');
        if (video?.duration && startTime + duration > video.duration + .05) throw new Error(`片段 ${asset.name} 超出视频结尾，须先明确调整，不能截断。`);
        return { ...clip, name: clip.name || asset.name, prompt: String(asset.metadata?.text || clip.name || asset.name), text: asset.metadata?.text, voiceId: asset.metadata?.voiceId, id: randomUUID(), audioUrl: asset.url, trackId: clip.trackType || 'sfx', trackType: clip.trackType || 'sfx', startTime, duration,
          sourceAudioDuration: asset.duration, sourceOffset, volume: finite(clip.volume, 1, 0, 1), speed, audioSource: 'generated' };
      });
      const result = await c.request(video ? '/api/video/mix' : '/api/audio/mix-tracks-v2', {
        ...a, clips, videoFileName: video && path.basename(c.filePath(video)), channelMode: 'stereo',
        includeOriginalAudio: a.includeOriginalAudio !== false,
      });
      const output = await ingest(result, a.name);
      const projectClips: Args[] = clips.map(clip => ({ ...clip, volume: clip.volume * .8, autoSpeed: 1 }));
      const tracks: Args[] = ['bgm', 'sfx', 'dubbing'].map(type => ({ id: type, name: { bgm: '配乐', sfx: '音效', dubbing: '配音' }[type], type, volume: .8, isMuted: false, isSoloed: false }));
      if (video && a.includeOriginalAudio !== false) {
        tracks.push({ id: 'original-audio', name: '视频原声', type: 'original', volume: .8, isMuted: false, isSoloed: false });
        projectClips.push({ id: 'clip-original-audio', name: '视频原声', prompt: '', trackId: 'original-audio', trackType: 'original', startTime: 0, duration: video.duration, sourceAudioDuration: video.duration, audioUrl: video.url, audioSource: 'uploaded', volume: finite(a.originalAudioVolume, 1, 0, 1) * .8, speed: 1, autoSpeed: 1 });
      }
      const projectName = path.parse(safeAgentName(a.name)).name;
      const project = { version: 1, id: randomUUID(), name: projectName, createdAt: Date.now(), videoFile: video ? { name: path.basename(c.filePath(video)), url: video.url, isUploaded: true } : null,
        videoDuration: video?.duration || a.timelineDuration || Math.max(...clips.map((clip: Args) => clip.startTime + clip.duration)), clips: projectClips,
        tracks,
        bgmEnabled: true, sfxEnabled: true, dubbingEnabled: true, mixedVideoUrl: result.videoUrl || null };
      const projectAsset = await c.save(Buffer.from(JSON.stringify(project, null, 2)), `${projectName}_时间线.json`, 'application/json');
      return { ...output, projectAsset };
    });
  add('export_timeline_stems', '导出已保存时间线工程中的各条独立音轨并打包，自动等待所有音轨完成。',
    { projectAssetId: str, audioFormat: choice('wav', 'mp3', 'ogg', 'aac') }, ['projectAssetId'], async a => {
      const projectAsset = c.asset(a.projectAssetId);
      const project = JSON.parse(await fs.readFile(c.filePath(projectAsset), 'utf8'));
      if (!Array.isArray(project.clips) || !Array.isArray(project.tracks)) throw new Error('无效的时间线工程。');
      const allowedUrls = new Set(c.assets.map(asset => asset.url));
      if (!project.clips.every((clip: Args) => allowedUrls.has(clip.audioUrl))) throw new Error('工程引用了当前任务以外的文件。');
      return ingest(await c.request('/api/audio/export-stems', { clips: project.clips.map((clip: Args) => ({ ...clip, volume: Math.min(1, (clip.volume ?? .8) / .8) })), tracks: project.tracks, audioFormat: a.audioFormat || 'wav', channelMode: 'stereo', timelineDuration: project.videoDuration }), `${project.name}_分轨`);
    });
  add('rename_files', '批量重命名副本，保留扩展名；优先沿用源序号。每个输入对应一个最终名称，可结合UCS优化结果；不覆盖原文件。',
    { items: { type: 'array', items: object({ assetId: str, name: str }, ['assetId', 'name']) } }, ['items'], async a => {
      const assets = [];
      for (const item of a.items || []) {
        const asset = c.asset(item.assetId);
        const name = path.extname(item.name) ? safeAgentName(item.name) : `${safeAgentName(item.name)}${path.extname(asset.name)}`;
        assets.push(await c.save(await fs.readFile(c.filePath(asset)), name, asset.mimeType));
      }
      return { assets };
    });
  add('ucs_metadata', '按中文含义生成专业UCS命名及分类。仅优化元数据，不伪装成音频内容分析。originalName包括原扩展名。',
    { items: { type: 'array', items: object({ id: str, originalName: str, path: str, size: str, type: str }, ['id', 'originalName']) } }, ['items'],
    async a => c.request('/api/ai/optimize-metadata', { items: a.items.map((item: Args) => ({ id: item.id, originalName: item.originalName, path: item.path || '', size: item.size || '', type: item.type || 'audio' })) }));
  add('library_search', '中英及相近词搜索音效库，返回ID、元数据及可用文件。', { query: str, limit: num }, ['query'], async a => {
    const state = await c.request('/api/sfx/library/state');
    const index = buildSfxLibraryIndex(state.categories || [], state.sounds || []);
    const matches = findSfxLibraryMatches(a.query, index).slice(0, finite(a.limit, 12, 1, 60));
    return { matches };
  });
  add('library_get_files', '按精确音效ID将库中文件加入当前任务，可混音或打包下载，保留库内文件名。', { ids: strings }, ['ids'], async a => {
    const state = await c.request('/api/sfx/library/state');
    const assets = [];
    for (const id of a.ids || []) {
      const sound = (state.sounds || []).find((s: Args) => s.id === id);
      if (!sound) throw new Error(`音效不存在：${id}`);
      const url = sound.storageKey ? `/api/sfx/library/stream?key=${encodeURIComponent(sound.storageKey)}` : sound.downloadUrl || sound.url;
      assets.push(await c.register(url, sound.fileName || sound.name, false));
    }
    return { assets };
  });
  add('library_import', '将指定文件入音效库。需现有管理员权限，保留文件名。category须先从library_categories取得。禁止绕过权限。',
    { assetIds: strings, category: str, subcategory: str, tags: strings }, ['assetIds', 'category'], async a => {
      const entries = [];
      for (const id of a.assetIds || []) {
        const asset = c.asset(id);
        // Existing raw upload endpoint enforces the same administrator session.
        const data = await c.request('/api/sfx/library/upload', { rawAssetId: id }, 'RAW', { 'x-filename-utf8-base64': Buffer.from(asset.name).toString('base64') });
        entries.push({ id: randomUUID(), name: path.parse(asset.name).name, fileName: asset.name, category: a.category, subcategory: a.subcategory,
          tags: a.tags || [], duration: asset.duration || 0, format: path.extname(asset.name).slice(1).toUpperCase(), size: `${asset.size} B`, sampleRate: '', channels: 'Stereo', designer: '智能助手', path: '', url: data.url, storageKey: data.storageKey, source: 'uploaded' });
      }
      const state = await c.request('/api/sfx/library/state');
      await c.request('/api/sfx/library/state', { categories: state.categories, baseRevision: state.revision, sounds: [...(state.sounds || []), ...entries] }, 'PUT');
      return { imported: entries };
    });
  add('library_edit_metadata', '修改指定库内音效的文件显示名、分类、标签、收藏状态。需管理员权限，使用精确ID，保留现有文件扩展名。',
    { items: { type: 'array', items: object({ id: str, fileName: str, name: str, category: str, subcategory: str, tags: strings, isFavorite: bool }, ['id']) } }, ['items'], async a => {
      const state = await c.request('/api/sfx/library/state');
      const sounds = [...(state.sounds || [])];
      for (const patch of a.items || []) {
        const index = sounds.findIndex((sound: Args) => sound.id === patch.id);
        if (index < 0) throw new Error(`音效ID不存在：${patch.id}`);
        const old = sounds[index];
        const update = Object.fromEntries(Object.entries(patch).filter(([key]) => ['name', 'category', 'subcategory', 'tags', 'isFavorite'].includes(key)));
        if (patch.fileName) update.fileName = `${path.parse(safeAgentName(patch.fileName)).name}${path.extname(old.fileName)}`;
        sounds[index] = { ...old, ...update };
      }
      await c.request('/api/sfx/library/state', { categories: state.categories, baseRevision: state.revision, sounds }, 'PUT');
      return { updatedIds: a.items.map((item: Args) => item.id) };
    });
  add('library_categories', '读取音效库当前有效分类。', {}, [], async () => c.request('/api/sfx/categories'));
  add('package_files', '将实际文件打包ZIP，保留Unicode名称和下划线；同名自动加后缀，绝不覆盖。',
    { assetIds: strings, name: str }, ['assetIds', 'name'], async a => {
      const zip = new JSZip();
      for (const id of a.assetIds || []) {
        const asset = c.asset(id);
        let name = safeAgentName(asset.name), count = 2;
        while (zip.file(name)) name = `${path.parse(asset.name).name}_${count++}${path.extname(asset.name)}`;
        zip.file(name, await fs.readFile(c.filePath(asset)));
      }
      if (!Object.keys(zip.files).length) throw new Error('没有可打包的文件。');
      return { asset: await c.save(await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }), `${path.parse(safeAgentName(a.name)).name}.zip`, 'application/zip') };
    });
  add('save_report', '将真实分析/歌词/台词/需求表/执行结果保存为TXT/CSV/JSON/MD文件。不能捏造工具结果。',
    { name: str, content: str }, ['name', 'content'], async a => {
      if (!/\.(txt|csv|json|md)$/i.test(a.name)) throw new Error('报告支持txt/csv/json/md。');
      return { asset: await c.save(Buffer.from(a.content, 'utf8'), a.name, 'text/plain') };
    });
  add('open_module', '用户只要求打开功能时导航。导航不代表生成工作完成。',
    { tab: choice('workbench', 'audio-tools', 'music-studio', 'sfx-studio', 'dubbing-studio', 'video-soundtrack', 'audio-director', 'sfx-requirements', 'sfx-library') }, ['tab'], async a => { c.navigate(a.tab); return { opened: a.tab }; });
  add('ask_user', '仅当缺少必要文件、不可推断参数、权限或引擎阻塞时向用户提问并暂停。不要每一步都要求确认。',
    { question: str }, ['question'], async a => { c.ask(a.question); return { waitingForUser: true }; });
  add('finish_task', '所有要求都已实际完成才调用。视频成品必须先供用户试听，收到导出指令并导出成功后才交付。附最终文件assetIds；若仅完成部分，必须ask_user或报告失败，禁止称全部完成。',
    { summary: str, assetIds: strings }, ['summary', 'assetIds'], async a => {
      return c.finish(a.summary, a.assetIds) === false ? { waitingForReview: true, completed: false } : { completed: true };
    });
  return tools;
}
