/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const isBrowser = typeof window !== 'undefined';

async function requestBlob(path: string, init: RequestInit): Promise<Blob> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(errorBody.error || `音频服务请求失败 (${response.status})`);
  }
  return response.blob();
}

const getApiKey = () => {
  return process.env.ELEVENLABS_API_KEY || process.env.VITE_ELEVENLABS_API_KEY || "";
};

export async function generateSoundEffect(text: string, duration?: number): Promise<Blob> {
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/sound-effect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, duration }),
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  // Extract English prompt if the text contains Chinese or Search Keyword
  let cleanText = text;
  
  // 1. Try to find content inside (Search Keyword: ...) or [Search Keyword: ...] or simply containing english description
  const searchKeywordRegex = /(?:Search Keyword|Keyword):\s*([^)]+)/i;
  const match = text.match(searchKeywordRegex);
  if (match) {
    cleanText = match[1].replace(/\)$/, '').trim();
    cleanText = cleanText.replace(/[\u4e00-\u9fa5]/g, '').trim();
  } else {
    // If no match but contains chinese, clean it
    if (/[\u4e00-\u9fa5]/.test(text)) {
      cleanText = text.replace(/[\u4e00-\u9fa5]/g, '').trim();
      cleanText = cleanText.replace(/\[Duration:\s*\d+s\]/gi, '').trim();
      cleanText = cleanText.replace(/[，。；：！？（）“”‘’【】()]/g, ' ').replace(/\s+/g, ' ').trim();
    }
  }

  if (!cleanText) {
    cleanText = "cinematic ambient sound effect";
  }

  // Limit to 50 words to avoid exceeding ElevenLabs limits
  cleanText = cleanText.split(/\s+/).slice(0, 45).join(" ");

  // Ensure prompt explicitly says no speech with strong negative framing
  const sfxPrompt = `Pure sound effect, instrumental, no vocals, no speech, no language, no human voice: ${cleanText}`;

  console.log("Generating sound effect with English prompt:", sfxPrompt);

  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: sfxPrompt,
      duration_seconds: duration || 10,
      prompt_influence: 0.3,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs API error: ${errorData.detail?.message || response.statusText}`);
  }

  return await response.blob();
}

export async function generateMusic(text: string, duration?: number, isInstrumental: boolean = true, lyrics?: string): Promise<Blob> {
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, duration, isInstrumental, lyrics }),
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

  // Limit words
  cleanText = cleanText.split(/\s+/).slice(0, 45).join(" ");

  const normalizedDurationSeconds = Math.min(600, Math.max(3, duration || 30));
  const musicLengthMs = Math.round(normalizedDurationSeconds * 1000);
  const normalizedLyrics = lyrics?.trim();
  const musicPrompt = isInstrumental
    ? `Full-length background instrumental music, no vocals, no speech, no lyrics. Style: ${cleanText}`
    : (normalizedLyrics
        ? `Complete vocal song with expressive vocals and a full music mix. Style: ${cleanText}. Lyrics:\n${normalizedLyrics}`
        : `AI Music, complete song with expressive vocals and lyrics, vocal track, full mix: ${cleanText}`);
  const limitedMusicPrompt = musicPrompt.slice(0, 4100);

  console.log(`Generating music (instrumental=${isInstrumental}, duration=${normalizedDurationSeconds}s) with ElevenLabs Music API prompt:`, limitedMusicPrompt);

  const response = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt: limitedMusicPrompt,
      music_length_ms: musicLengthMs,
      force_instrumental: isInstrumental,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    const detail = errorData.detail;
    const message = typeof detail === 'string'
      ? detail
      : detail?.message || errorData.message || response.statusText;
    throw new Error(`ElevenLabs Music API error: ${message}`);
  }

  return await response.blob();
}

export async function generateVoice(
  text: string, 
  voiceId: string, 
  stability: number = 0.5, 
  similarity: number = 0.75,
  style: number = 0.05
): Promise<Blob> {
  if (isBrowser) {
    return requestBlob('/api/ai/elevenlabs/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceId, stability, similarity, style }),
    });
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log(`Generating TTS Voice with ID ${voiceId} for text:`, text.substring(0, 30));

  // Use highly stable and officially supported multilingual models
  const modelsToTry = ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v1"];
  let lastError: any = null;
  let successfulBlob: Blob | null = null;

  for (const modelId of modelsToTry) {
    try {
      console.log(`Attempting voice generation using model: ${modelId}`);
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
          model_id: modelId,
          voice_settings: {
            stability: stability,
            similarity_boost: similarity,
            style: style,
            use_speaker_boost: true,
          },
        }),
      });

      if (response.ok) {
        successfulBlob = await response.blob();
        break;
      } else {
        const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
        const errorMessage = errorData.detail?.message || response.statusText || "";
        console.warn(`Model ${modelId} failed:`, errorMessage);
        
        // If it's a voice not found error (404), don't waste time trying next model, just go to fallback voice Rachel directly
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

  // Fallback if voice ID was not found: try with guaranteed default voice Rachel and stable v2 model
  const isVoiceNotFoundError = lastError && (lastError.message.toLowerCase().includes("not found") || lastError.message.toLowerCase().includes("voice_id"));
  if ((isVoiceNotFoundError || !successfulBlob) && voiceId !== '21m00Tcm4TlvDq8ikWAM') {
    console.warn(`Voice ID '${voiceId}' or model failed. Retrying with guaranteed default voice (Rachel: 21m00Tcm4TlvDq8ikWAM) and eleven_multilingual_v2...`);
    
    try {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM`, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: text,
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
  labels?: {
    gender?: string;
    description?: string;
    accent?: string;
    age?: string;
    [key: string]: string | undefined;
  };
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
    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      }
    });
    if (!response.ok) {
      console.warn("Failed to fetch ElevenLabs voices:", response.statusText);
      return [];
    }
    const data = await response.json();
    return data.voices || [];
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
  style: number = 0.05
): Promise<Blob> {
  if (isBrowser) {
    const proxyFormData = new FormData();
    proxyFormData.append('audio', audioFile);
    proxyFormData.append('voiceId', voiceId);
    proxyFormData.append('stability', String(stability));
    proxyFormData.append('similarity', String(similarity));
    proxyFormData.append('style', String(style));
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

  return await response.blob();
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

  return await response.blob();
}

/**
 * Transcribes speech from an audio file to text
 * using ElevenLabs Speech to Text API (Scribe model).
 */
export async function transcribeSpeech(
  audioFile: File | Blob,
  languageCode?: string,
  tagAudioEvents: boolean = true
): Promise<{ text: string; language_code?: string; language_probability?: number }> {
  if (isBrowser) {
    const proxyFormData = new FormData();
    proxyFormData.append('audio', audioFile, audioFile instanceof File ? audioFile.name : 'audio.wav');
    if (languageCode) {
      proxyFormData.append('languageCode', languageCode);
    }
    proxyFormData.append('tagAudioEvents', String(tagAudioEvents));

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
  formData.append("model_id", "scribe_v1");
  if (languageCode && languageCode !== "auto") {
    formData.append("language_code", languageCode);
  }
  formData.append("tag_audio_events", String(tagAudioEvents));

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

  return await response.json();
}



