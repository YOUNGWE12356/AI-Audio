const RECENT_VOICE_IDS_KEY = 'ai-audio-recent-voice-ids-v1';
const MAX_RECENT_VOICES = 5;

export const readRecentVoiceIds = (): string[] => {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_VOICE_IDS_KEY) || '[]');
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).slice(0, MAX_RECENT_VOICES)
      : [];
  } catch {
    return [];
  }
};

export const rememberVoiceId = (id: string): string[] => {
  const recentIds = [id, ...readRecentVoiceIds().filter(recentId => recentId !== id)].slice(0, MAX_RECENT_VOICES);
  try {
    window.localStorage.setItem(RECENT_VOICE_IDS_KEY, JSON.stringify(recentIds));
  } catch {
    // Storage availability must not prevent voice selection.
  }
  return recentIds;
};

export const clearRecentVoiceIds = () => {
  try {
    window.localStorage.removeItem(RECENT_VOICE_IDS_KEY);
  } catch {
    // Local storage may be unavailable in private browsing.
  }
};
