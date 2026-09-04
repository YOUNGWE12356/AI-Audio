/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getElevenLabsQualityMode,
  isElevenLabsProQualityMode,
} from '../utils/elevenLabsQuality';
import type { ElevenLabsQualityMode } from '../utils/elevenLabsQuality';
import { recordElevenLabsResponseUsage } from './usageTracking';

const isBrowser = typeof window !== 'undefined';

interface ElevenLabsGenerationOptions {
  qualityMode?: ElevenLabsQualityMode;
  fallbackText?: string;
  seed?: number;
  voiceSource?: 'my_voices' | 'voice_library';
  publicOwnerId?: string;
  voiceName?: string;
}

export interface TranslateDubbingOptions extends ElevenLabsGenerationOptions {
  sourceLanguage?: string;
  targetLanguage: string;
  voiceId: string;
  timingMode: 'natural' | 'match' | 'strict';
}

export interface TranslateDubbingResult {
  audioUrl: string;
  sourceText: string;
  translatedText: string;
  detectedLanguage?: string;
  sourceDuration?: number;
  generatedDuration?: number;
  outputDuration?: number;
  timingMode: 'natural' | 'match' | 'strict';
  speedRatio?: number;
  qualityMode?: ElevenLabsQualityMode;
  dubbingModel?: 'dubbing_v2' | 'manual_tts' | 'local_chatterbox' | 'local_cosyvoice3' | 'local_multispeaker' | 'local_seed_vc';
  cloningStrength?: number;
  /** Diagnostic cosine similarity from the local speaker encoder (0..1). */
  speakerSimilarity?: number;
  outputFormat?: 'mp3' | 'mp4' | 'wav';
}

export interface ElevenLabsDubbingV2Options {
  sourceLanguage?: string;
  targetLanguage: string;
  cloningStrength?: number;
  outputFormat?: 'mp3' | 'mp4';
}

const resolveQualityMode = (options?: ElevenLabsGenerationOptions): ElevenLabsQualityMode => (
  options?.qualityMode || (isBrowser ? getElevenLabsQualityMode() : 'pro')
);

const ELEVENLABS_PROMPT_POLICY_ERROR = /violated our Terms of Service|prompt appears to have violated|policy|safety/i;
const MUSIC_PROMPT_POLICY_MESSAGE = '音乐提示词被 ElevenLabs 安全策略拦截了。我已经会在生成前自动改写成更音乐化的英文描述；如果仍失败，请避开“恐怖、惊吓、暴力、血腥、武器、模仿某歌手”等直白词，改写成“阴暗悬疑、紧张弦乐、诡异氛围、无鼓点”等配乐语言。';
export const ELEVENLABS_MUSIC_MODEL = 'music_v2';
// Officially documented high-quality v2 output format.
export const ELEVENLABS_MUSIC_OUTPUT_FORMAT = 'mp3_48000_192';
// Sound Effects currently exposes one model. Request the highest-quality
// uncompressed format and wrap the raw PCM response as WAV for playback.
export const ELEVENLABS_SOUND_MODEL = 'eleven_text_to_sound_v2';
export const ELEVENLABS_SOUND_OUTPUT_FORMAT = 'pcm_48000';

export const wrapElevenLabsPcmAsWav = (pcm: ArrayBuffer | Uint8Array, sampleRate = 48000, channels = 1): Blob => {
  const pcmBytes = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm);
  const wav = new ArrayBuffer(44 + pcmBytes.byteLength);
  const view = new DataView(wav);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  const blockAlign = channels * 2;
  const byteRate = sampleRate * blockAlign;
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, pcmBytes.byteLength, true);
  new Uint8Array(wav, 44).set(pcmBytes);
  return new Blob([wav], { type: 'audio/wav' });
};

const makeMusicPromptPolicyFriendly = (value: string) => {
  const replacements: Array<[RegExp, string]> = [
    [/\bterrifying\b/gi, 'dark intense'],
    [/\bterror\b/gi, 'tense suspense'],
    [/\bhorrifying\b/gi, 'dark suspenseful'],
    [/\bhorror\b/gi, 'dark suspense'],
    [/\bscary\b/gi, 'eerie suspenseful'],
    [/\bfrightening\b/gi, 'eerie tense'],
    [/\bfright\b/gi, 'sudden tension'],
    [/\bpanic\b/gi, 'urgent tension'],
    [/\bthreatening\b/gi, 'ominous'],
    [/\bviolent\b/gi, 'intense dramatic'],
    [/\bviolence\b/gi, 'dramatic conflict'],
    [/\bblood\b/gi, 'dark dramatic'],
    [/\bgore\b/gi, 'dark dramatic'],
    [/\bweapon\b/gi, 'metallic dramatic accent'],
    [/\bgun\b/gi, 'sharp cinematic accent'],
    [/\bkill(?:ing)?\b/gi, 'dramatic climax'],
  ];

  return replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    value,
  );
};

async function requestBlob(path: string, init: RequestInit): Promise<Blob> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = String(errorBody.error || `音频服务请求失败 (${response.status})`);
    if (/Multiple voice additions\/deletions for the same voice/i.test(message)) {
      throw new Error('声音库正在同步这个声音，请稍等几秒后重试。');
    }
    if (path.includes('/music') && ELEVENLABS_PROMPT_POLICY_ERROR.test(message)) {
      throw new Error(MUSIC_PROMPT_POLICY_MESSAGE);
    }
    throw new Error(message);
  }
  return response.blob();
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `AI 服务请求失败 (${response.status})`);
  }
  return body as T;
}

const getApiKey = () => {
  return process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY || "";
};

export async function generateSoundEffect(text: string, duration?: number, options?: ElevenLabsGenerationOptions): Promise<Blob> {
  const qualityMode = resolveQualityMode(options);
  const normalizedDuration = typeof duration === 'number' && Number.isFinite(duration) && duration > 0
    ? duration
    : undefined;
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/sound-effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(normalizedDuration ? { duration: normalizedDuration } : {}),
        qualityMode,
      }),
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  // Build a richer English prompt instead of stripping Chinese to nothing.
  let cleanText = text.trim();
  const searchKeywordRegex = /(?:Search Keyword|Keyword):\s*([^)]+)/i;
  const match = text.match(searchKeywordRegex);
  if (match) {
    cleanText = match[1].replace(/\)$/, '').trim();
  }
  cleanText = cleanText.replace(/\[Duration:\s*\d+s\]/gi, '').trim();
  cleanText = cleanText.replace(/[，。；：！？（）“”‘’【】()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();

  if (!cleanText) {
    cleanText = "sound effect";
  }

  // Keep the prompt short and direct, which aligns better with the ElevenLabs sound generator.
  cleanText = cleanText.split(/\s+/).slice(0, 20).join(" ");

  // Keep the model focused on the user's description without over-biasing toward impact / metal Foley.
  const isProQuality = isElevenLabsProQualityMode(qualityMode);
  const sfxPrompt = isProQuality
    ? `Studio-quality sound effect, realistic texture, layered ambience, clear spatial depth, high fidelity, no spoken words. Description: ${cleanText}`
    : `Sound effect, realistic texture, clear spatial depth, no spoken words. Description: ${cleanText}`;

  console.log("Generating sound effect with English prompt:", sfxPrompt);

  const requestBody = {
    model_id: ELEVENLABS_SOUND_MODEL,
    text: sfxPrompt,
    ...(normalizedDuration ? { duration_seconds: normalizedDuration } : {}),
    prompt_influence: isProQuality ? 0.45 : 0.3,
  };

  const response = await fetch(
    `https://api.elevenlabs.io/v1/sound-generation?output_format=${ELEVENLABS_SOUND_OUTPUT_FORMAT}`,
    {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs API error: ${errorData.detail?.message || response.statusText}`);
  }

  recordElevenLabsResponseUsage(response, ELEVENLABS_SOUND_MODEL);
  return wrapElevenLabsPcmAsWav(await response.arrayBuffer());
}

export async function generateMusic(
  text: string,
  duration?: number,
  isInstrumental: boolean = true,
  lyrics?: string,
  options?: ElevenLabsGenerationOptions,
): Promise<Blob> {
  const qualityMode = resolveQualityMode(options);
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, duration, isInstrumental, lyrics, qualityMode }),
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  // Clean all Chinese and non-English characters from the style prompt to keep the music model prompt focused.
  // Lyrics are preserved below because vocal tracks may intentionally use Chinese lyrics.
  let cleanText = text;
  if (/[\u4e00-\u9fa5]/.test(text)) {
    cleanText = text.replace(/[\u4e00-\u9fa5]/g, '').trim();
    cleanText = cleanText.replace(/[，。；：！？（）“”‘’【】():-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (!cleanText) {
    cleanText = "orchestral game theme music background";
  }

  cleanText = makeMusicPromptPolicyFriendly(cleanText);

  // Limit words
  cleanText = cleanText.split(/\s+/).slice(0, 45).join(" ");

  const normalizedDurationSeconds = Math.min(600, Math.max(3, duration || 30));
  const musicLengthMs = Math.round(normalizedDurationSeconds * 1000);
  const normalizedLyrics = lyrics?.trim();
  const isProQuality = isElevenLabsProQualityMode(qualityMode);
  const proQualityPrefix = isProQuality
    ? 'Broadcast-ready professional mix, high fidelity, polished arrangement, clear low end, wide stereo image, clean dynamics. '
    : '';
  const musicPrompt = isInstrumental
    ? `${proQualityPrefix}Full-length background instrumental music, no vocals, no speech, no lyrics. Style: ${cleanText}`
    : (normalizedLyrics
        ? `${proQualityPrefix}Complete vocal song with expressive vocals and a full music mix. Style: ${cleanText}. Lyrics:\n${normalizedLyrics}`
        : `${proQualityPrefix}AI Music, complete song with expressive vocals and lyrics, vocal track, full mix: ${cleanText}`);
  const limitedMusicPrompt = musicPrompt.slice(0, 4100);

  console.log(
    `Generating music with ElevenLabs Music API (model=${ELEVENLABS_MUSIC_MODEL}, format=${ELEVENLABS_MUSIC_OUTPUT_FORMAT}, instrumental=${isInstrumental}, duration=${normalizedDurationSeconds}s):`,
    limitedMusicPrompt,
  );

  const response = await fetch(
    `https://api.elevenlabs.io/v1/music?output_format=${ELEVENLABS_MUSIC_OUTPUT_FORMAT}`,
    {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: limitedMusicPrompt,
      music_length_ms: musicLengthMs,
      model_id: ELEVENLABS_MUSIC_MODEL,
      force_instrumental: isInstrumental,
    }),
    },
  );

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    const detail = errorData.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || errorData.message || response.statusText;
    if (ELEVENLABS_PROMPT_POLICY_ERROR.test(message)) {
      throw new Error(MUSIC_PROMPT_POLICY_MESSAGE);
    }
    throw new Error(`ElevenLabs Music API error: ${message}`);
  }

  recordElevenLabsResponseUsage(response, ELEVENLABS_MUSIC_MODEL);
  return await response.blob();
}

export async function generateVoice(
  text: string, 
  voiceId: string, 
  stability: number = 0.5, 
  similarity: number = 0.75,
  style: number = 0.05,
  options?: ElevenLabsGenerationOptions,
): Promise<Blob> {
  const qualityMode = resolveQualityMode(options);
  const fallbackText = options?.fallbackText?.trim() || text;
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        fallbackText,
        voiceId,
        stability,
        similarity,
        style,
        qualityMode,
        seed: options?.seed,
        voiceSource: options?.voiceSource,
        publicOwnerId: options?.publicOwnerId,
        voiceName: options?.voiceName,
      }),
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log(`Generating TTS Voice with ID ${voiceId} for text:`, text.substring(0, 30));

  // Prefer Eleven v3 for the most expressive voice quality, then fall back to stable multilingual models.
  const modelsToTry = ["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"];
  let lastError: any = null;
  let successfulBlob: Blob | null = null;

  for (const modelId of modelsToTry) {
    try {
      console.log(`Attempting voice generation using model: ${modelId}`);
      const textForModel = modelId === "eleven_v3" ? text : fallbackText;
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: textForModel,
          model_id: modelId,
          ...(typeof options?.seed === 'number' ? { seed: options.seed } : {}),
          voice_settings: {
            stability: stability,
            similarity_boost: similarity,
            style: style,
            use_speaker_boost: true,
          },
        }),
      });

      if (response.ok) {
        recordElevenLabsResponseUsage(response, modelId);
        successfulBlob = await response.blob();
        break;
      } else {
        const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
        const errorMessage = errorData.detail?.message || response.statusText || "";
        console.warn(`Model ${modelId} failed:`, errorMessage);
        
        // If it's a voice not found error (404), don't waste time trying next model, just go to fallback voice directly
        if (response.status === 404 || errorMessage.toLowerCase().includes("not found") || errorMessage.toLowerCase().includes("voice_id")) {
          lastError = new Error(`ElevenLabs API error: ${errorMessage}`);
          break;
        }
        
        lastError = new Error(`ElevenLabs API error: ${errorMessage}`);
      }
    } catch (err: any) {
      console.warn(`Exception with model ${modelId}:`, err);
      lastError = err;
    }
  }

  if (successfulBlob) {
    return successfulBlob;
  }

  // Fallback if voice ID was not found: try with a configured guaranteed default voice and stable v2 model
  const isVoiceNotFoundError = lastError && (lastError.message.toLowerCase().includes("not found") || lastError.message.toLowerCase().includes("voice_id"));
  const guaranteedFallbackVoiceId: string = '';
  if ((isVoiceNotFoundError || !successfulBlob) && guaranteedFallbackVoiceId && voiceId !== guaranteedFallbackVoiceId) {
    console.warn(`Voice ID '${voiceId}' or model failed. Retrying with guaranteed default voice (${guaranteedFallbackVoiceId}) and eleven_multilingual_v2...`);
    
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${guaranteedFallbackVoiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: fallbackText,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: stability,
            similarity_boost: similarity,
            style: style,
            use_speaker_boost: true,
          },
        }),
      });

      if (response.ok) {
        recordElevenLabsResponseUsage(response, 'eleven_multilingual_v2');
        return await response.blob();
      }
      
      const retryErrorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
      throw new Error(`ElevenLabs API error (fallback): ${retryErrorData.detail?.message || response.statusText}`);
    } catch (fallbackErr: any) {
      throw new Error(`ElevenLabs API fallback failed: ${fallbackErr.message || fallbackErr}`);
    }
  }

  throw lastError || new Error("Failed to generate voiceover with the selected configuration.");
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
  preview_url?: string;
  public_owner_id?: string;
  source?: 'my_voices' | 'voice_library';
  usage_character_count_1y?: number;
  cloned_by_count?: number;
  featured?: boolean;
  language?: string;
  labels?: {
    gender?: string;
    description?: string;
    accent?: string;
    age?: string;
    use_case?: string;
    descriptive?: string;
    language?: string;
    [key: string]: string | undefined;
  };
}

interface ElevenLabsSharedVoice {
  public_owner_id?: string;
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  gender?: string;
  accent?: string;
  age?: string;
  descriptive?: string;
  use_case?: string;
  description?: string;
  language?: string;
  usage_character_count_1y?: number;
  cloned_by_count?: number;
  featured?: boolean;
}

const normalizeSharedVoice = (voice: ElevenLabsSharedVoice): ElevenLabsVoice => ({
  voice_id: voice.voice_id,
  name: voice.name,
  category: voice.category || 'professional',
  preview_url: voice.preview_url,
  public_owner_id: voice.public_owner_id,
  source: 'voice_library',
  usage_character_count_1y: voice.usage_character_count_1y,
  cloned_by_count: voice.cloned_by_count,
  featured: voice.featured,
  language: voice.language,
  labels: {
    gender: voice.gender,
    description: voice.description || voice.descriptive,
    accent: voice.accent,
    age: voice.age,
    use_case: voice.use_case,
    descriptive: voice.descriptive,
    language: voice.language,
  },
});

const normalizeMyVoice = (voice: ElevenLabsVoice): ElevenLabsVoice => ({
  ...voice,
  source: 'my_voices',
});

const dedupeVoicesById = (voices: ElevenLabsVoice[]) => {
  const seen = new Set<string>();
  return voices.filter(voice => {
    if (!voice.voice_id || seen.has(voice.voice_id)) return false;
    seen.add(voice.voice_id);
    return true;
  });
};

async function fetchSharedVoiceLibrary(apiKey: string): Promise<ElevenLabsVoice[]> {
  const requests = [
    { category: 'high_quality', sort: 'trending' },
    { category: 'professional', sort: 'trending' },
    { category: 'professional', sort: 'usage_character_count_1y' },
  ];

  const voiceLists = await Promise.all(requests.map(async ({ category, sort }) => {
    const params = new URLSearchParams({
      page_size: '100',
      category,
      sort,
      include_live_moderated: 'false',
    });

    const response = await fetch(`https://api.elevenlabs.io/v1/shared-voices?${params.toString()}`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch ElevenLabs shared voices (${category}/${sort}):`, response.statusText);
      return [];
    }

    const data = await response.json();
    return Array.isArray(data.voices)
      ? data.voices.map((voice: ElevenLabsSharedVoice) => normalizeSharedVoice(voice))
      : [];
  }));

  return dedupeVoicesById(voiceLists.flat());
}

export async function fetchAvailableVoices(): Promise<ElevenLabsVoice[]> {
  if (isBrowser) {
    const response = await fetch('/api/ai/elevenlabs/voices', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.voices || [];
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }
  try {
    const [libraryVoices, myVoicesResponse] = await Promise.all([
      fetchSharedVoiceLibrary(apiKey),
      fetch("https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=non-default&include_total_count=false", {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          Accept: 'application/json',
        }
      }),
    ]);

    let myVoices: ElevenLabsVoice[] = [];
    if (myVoicesResponse.ok) {
      const data = await myVoicesResponse.json();
      myVoices = Array.isArray(data.voices) ? data.voices.map(normalizeMyVoice) : [];
    } else {
      console.warn("Failed to fetch ElevenLabs account voices:", myVoicesResponse.statusText);
    }

    if (libraryVoices.length > 0 || myVoices.length > 0) {
      return dedupeVoicesById([...libraryVoices, ...myVoices]);
    }

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
        Accept: 'application/json',
      }
    });
    if (!response.ok) {
      console.warn("Failed to fetch ElevenLabs voices:", response.statusText);
      return [];
    }
    const data = await response.json();
    return Array.isArray(data.voices) ? data.voices.map(normalizeMyVoice) : [];
  } catch (err) {
    console.error("Error fetching ElevenLabs voices:", err);
    return [];
  }
}

export async function generateSpeechToSpeech(
  audioFile: File | Blob,
  voiceId: string,
  stability: number = 0.5,
  similarity: number = 0.75,
  style: number = 0.05,
  options?: Pick<ElevenLabsGenerationOptions, 'voiceSource' | 'publicOwnerId' | 'voiceName'>
): Promise<Blob> {
  if (isBrowser) {
    const proxyFormData = new FormData();
    proxyFormData.append('audio', audioFile);
    proxyFormData.append('voiceId', voiceId);
    proxyFormData.append('stability', String(stability));
    proxyFormData.append('similarity', String(similarity));
    proxyFormData.append('style', String(style));
    if (options?.voiceSource) proxyFormData.append('voiceSource', options.voiceSource);
    if (options?.publicOwnerId) proxyFormData.append('publicOwnerId', options.publicOwnerId);
    if (options?.voiceName) proxyFormData.append('voiceName', options.voiceName);
    return requestBlob('/api/ai/elevenlabs/speech-to-speech', {
      method: 'POST',
      body: proxyFormData,
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log(`Generating Speech to Speech with voice ID ${voiceId}`);

  const formData = new FormData();
  formData.append("audio", audioFile);
  formData.append("model_id", "eleven_multilingual_sts_v2");
  formData.append(
    "voice_settings",
    JSON.stringify({
      stability: stability,
      similarity_boost: similarity,
      style: style,
      use_speaker_boost: true,
    })
  );

  const response = await fetch(`https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs API error: ${errorData.detail?.message || response.statusText}`);
  }

  recordElevenLabsResponseUsage(response, 'eleven_multilingual_sts_v2');
  return await response.blob();
}

export async function translateDubbingAudio(
  audioFile: File | Blob,
  options: TranslateDubbingOptions,
): Promise<TranslateDubbingResult> {
  if (!isBrowser) {
    throw new Error("translateDubbingAudio is only available through the browser API proxy.");
  }

  const proxyFormData = new FormData();
  proxyFormData.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'source.wav');
  proxyFormData.append('sourceLanguage', options.sourceLanguage || 'auto');
  proxyFormData.append('targetLanguage', options.targetLanguage);
  proxyFormData.append('voiceId', options.voiceId);
  proxyFormData.append('timingMode', options.timingMode);
  proxyFormData.append('qualityMode', options.qualityMode || getElevenLabsQualityMode());

  return requestJson<TranslateDubbingResult>('/api/ai/elevenlabs/translate-dubbing', {
    method: 'POST',
    body: proxyFormData,
  });
}

/**
 * Uses ElevenLabs Automatic Dubbing (Dubbing v2) so speaker identity,
 * emotion, timing, and the original background mix are handled by ElevenLabs.
 */
export async function translateDubbingV2Audio(
  audioFile: File | Blob,
  options: ElevenLabsDubbingV2Options,
): Promise<TranslateDubbingResult> {
  if (!isBrowser) {
    throw new Error('translateDubbingV2Audio is only available through the browser API proxy.');
  }

  const proxyFormData = new FormData();
  proxyFormData.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'source.wav');
  proxyFormData.append('sourceLanguage', options.sourceLanguage || 'auto');
  proxyFormData.append('targetLanguage', options.targetLanguage);
  proxyFormData.append(
    'cloningStrength',
    String(Math.min(10, Math.max(0, Math.round(options.cloningStrength ?? 7)))),
  );
  proxyFormData.append('outputFormat', options.outputFormat || 'mp3');

  return requestJson<TranslateDubbingResult>('/api/ai/elevenlabs/translate-dubbing-v2', {
    method: 'POST',
    body: proxyFormData,
  });
}

/**
 * Isolates vocals from an audio file (removes background noise, music, etc.)
 * using ElevenLabs Audio Isolation API.
 */
export async function isolateAudio(audioFile: File | Blob): Promise<Blob> {
  if (isBrowser) {
    const proxyFormData = new FormData();
    proxyFormData.append('audio', audioFile);
    return requestBlob('/api/ai/elevenlabs/audio-isolation', {
      method: 'POST',
      body: proxyFormData,
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log(`Isolating audio / vocals...`);

  const formData = new FormData();
  formData.append("audio", audioFile);

  const response = await fetch("https://api.elevenlabs.io/v1/audio-isolation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs API error (Audio Isolation): ${errorData.detail?.message || response.statusText}`);
  }

  recordElevenLabsResponseUsage(response, 'audio-isolation');
  return await response.blob();
}

/**
 * Transcribes speech from an audio file to text
 * using ElevenLabs Speech to Text API (Scribe model).
 */
export interface SpeechTranscriptionOptions {
  diarize?: boolean;
  numSpeakers?: number;
}

export interface SpeechTranscriptionResult {
  text: string;
  language_code?: string;
  language_probability?: number;
  words?: Array<{
    text?: string;
    word?: string;
    start?: number;
    end?: number;
    type?: string;
    speaker_id?: string;
    speakerId?: string;
  }>;
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    speaker_id?: string;
    speakerId?: string;
  }>;
}

export async function transcribeSpeech(
  audioFile: File | Blob,
  languageCode?: string,
  tagAudioEvents: boolean = true,
  options: SpeechTranscriptionOptions = {},
): Promise<SpeechTranscriptionResult> {
  if (isBrowser) {
    const proxyFormData = new FormData();
    proxyFormData.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'audio.wav');
    if (languageCode) {
      proxyFormData.append('languageCode', languageCode);
    }
    proxyFormData.append('tagAudioEvents', String(tagAudioEvents));
    if (options.diarize) proxyFormData.append('diarize', 'true');
    if (typeof options.numSpeakers === 'number' && Number.isFinite(options.numSpeakers)) {
      proxyFormData.append('numSpeakers', String(Math.round(options.numSpeakers)));
    }

    const response = await fetch('/api/ai/elevenlabs/speech-to-text', {
      method: 'POST',
      body: proxyFormData,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || `转录服务请求失败 (${response.status})`);
    }
    return response.json();
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log("Transcribing speech to text...");

  const formData = new FormData();
  formData.append("file", audioFile, audioFile instanceof File ? audioFile.name : "audio.wav");
  formData.append("model_id", "scribe_v2");
  if (languageCode && languageCode !== "auto") {
    formData.append("language_code", languageCode);
  }
  formData.append("tag_audio_events", String(tagAudioEvents));
  if (options.diarize) formData.append("diarize", "true");
  if (typeof options.numSpeakers === 'number' && Number.isFinite(options.numSpeakers)) {
    formData.append("num_speakers", String(Math.round(options.numSpeakers)));
  }

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs STT API error: ${errorData.detail?.message || response.statusText}`);
  }

  recordElevenLabsResponseUsage(response, 'scribe_v2');
  return await response.json();
}
