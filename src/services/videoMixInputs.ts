import path from 'node:path';

type MixClip = { id?: string; name?: string; audioUrl: string; trackId?: string; trackType?: string };

export async function resolveVideoMixAudioInputs<T extends MixClip>(
  uploadsDir: string,
  sourcePath: string,
  clips: T[],
  probe: (filePath: string) => Promise<boolean>,
  includeOriginalAudio: boolean,
) {
  const probes = new Map<string, Promise<boolean>>();
  const hasAudio = (filePath: string) => {
    let pending = probes.get(filePath);
    if (!pending) { pending = probe(filePath); probes.set(filePath, pending); }
    return pending;
  };
  const skippedOriginalClipIds: string[] = [];
  const checked = await Promise.all(clips.map(async clip => {
    const filePath = path.join(uploadsDir, path.basename(clip.audioUrl));
    if (await hasAudio(filePath)) return clip;
    // A silent source has no original sound to preserve. Other missing audio is
    // a real asset error and must not silently disappear from the deliverable.
    if (clip.trackType === 'original' || clip.trackId === 'original-audio') {
      if (clip.id) skippedOriginalClipIds.push(clip.id);
      return undefined;
    }
    throw Object.assign(new Error(`片段“${clip.name || clip.id || '音频'}”不包含音轨，请重新上传或合成。`), { status: 422, code: 'CLIP_HAS_NO_AUDIO' });
  }));
  const validClips = checked.filter(Boolean) as T[];
  // The original source may already be represented by an editable timeline clip.
  const sourceAlreadyInTimeline = validClips.some(clip => path.join(uploadsDir, path.basename(clip.audioUrl)) === sourcePath);
  const useOriginalAudio = includeOriginalAudio && !sourceAlreadyInTimeline && await hasAudio(sourcePath);
  return { clips: validClips, useOriginalAudio, skippedOriginalClipIds };
}
