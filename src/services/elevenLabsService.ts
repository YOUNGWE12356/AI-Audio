/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const getApiKey = () => {
  if (typeof window !== 'undefined') {
    const localKey = localStorage.getItem('ELEVENLABS_API_KEY');
    if (localKey) return localKey;
  }
  return process.env.ELEVENLABS_API_KEY || "";
};

export async function generateSoundEffect(text: string, duration?: number): Promise<Blob> {
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

export async function generateMusic(text: string, duration?: number, isInstrumental: boolean = true): Promise<Blob> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  // Clean all Chinese and non-English characters from music prompt to ensure high quality track generation
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

  const musicPrompt = isInstrumental
    ? `AI Music, full background instrumental track, no vocals, no speech: ${cleanText}`
    : `AI Music, complete song with expressive vocals and lyrics, vocal track, full mix: ${cleanText}`;

  console.log(`Generating music (instrumental=${isInstrumental}) with English prompt:`, musicPrompt);

  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: musicPrompt,
      duration_seconds: duration || 30, // Default to 30 seconds for music
      prompt_influence: 0.5,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ detail: { message: "Unknown error" } }));
    throw new Error(`ElevenLabs API error: ${errorData.detail?.message || response.statusText}`);
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
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("ElevenLabs API Key is not configured. Please add it in the Secrets panel.");
  }

  console.log(`Generating TTS Voice with ID ${voiceId} for text:`, text.substring(0, 30));

  // Try the "eleven_multilingual_v3" model first as requested. If not supported or returns error, fallback to the stable "eleven_multilingual_v2"
  const modelsToTry = ["eleven_multilingual_v3", "eleven_multilingual_v2"];
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
    console.warn(`Voice ID '${voiceId}' or model failed. Retrying with guaranteed default voice (Rachel: 21m00Tcm4TlvDq8ikWAM) and stable multilingual_v2...`);
    
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

