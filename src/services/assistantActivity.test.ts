import test from 'node:test';
import assert from 'node:assert/strict';
import { getAssistantActivity } from './assistantActivity';
import type { AssistantJob } from './assistantAgentTypes';
import { distributeManagedSfxClips } from '../utils/sfxTrackLayout';

const job: AssistantJob = { id: 'test', prompt: '', status: 'running', createdAt: '', updatedAt: '', assets: [], events: [],
  workspaceCommand: { id: 'command', workspace: 'video-soundtrack', action: 'generate', status: 'running', args: {}, message: '正在生成 4/6：环境声' } };

test('assistant remains active through generation, planning and reconnect, but stops for real interruptions', () => {
  const generating = getAssistantActivity({ sending: false, job });
  assert.equal(generating.busy, true);
  assert.match(generating.label, /4\/6/);
  assert.equal(getAssistantActivity({ sending: false, job: { ...job, workspaceCommand: { ...job.workspaceCommand!, status: 'completed' } } }).busy, true);
  assert.equal(getAssistantActivity({ sending: false, job, error: 'connection lost' }).tone, 'reconnecting');
  for (const status of ['waiting', 'failed', 'cancelled', 'completed'] as const) {
    assert.equal(getAssistantActivity({ sending: false, job: { ...job, status } }).busy, false);
  }
  const paused = getAssistantActivity({ sending: false, job: { ...job, status: 'waiting', question: '供应商拦截笑声，请选择如何处理。' } });
  assert.match(paused.label, /暂停/);
  assert.match(paused.detail, /供应商/);
});

test('assistant edits cannot collapse concurrent SFX; original/custom audio and generated files survive redistribution', () => {
  const clips = [
    { id: 'original', trackId: 'original-audio', startTime: 0, duration: 5, audioUrl: 'original.mp4' },
    { id: 'music', trackId: 'bgm', startTime: 0, duration: 5, audioUrl: 'music.mp3' },
    { id: 'ambience', trackId: 'sfx', startTime: 0, duration: 4.8, audioUrl: 'wind.wav' },
    { id: 'movement', trackId: 'sfx', startTime: .2, duration: 2.55, audioUrl: 'swing.wav' },
    { id: 'sparkle', trackId: 'sfx-auto-2', startTime: 1.2, duration: 1.65, audioUrl: 'sparkle.wav' },
    { id: 'laugh', trackId: 'sfx', startTime: 3, duration: 1.35, audioUrl: '' },
    { id: 'manual', trackId: 'custom-foley', startTime: 0, duration: 5, audioUrl: 'manual.wav' },
  ];
  const result = distributeManagedSfxClips(clips);
  assert.equal(result.trackIds.length, 3);
  assert.deepEqual(result.clips.map(clip => clip.audioUrl), clips.map(clip => clip.audioUrl));
  assert.equal(result.clips[0], clips[0]);
  assert.equal(result.clips[6], clips[6]);
  for (const track of result.trackIds) {
    const lane = result.clips.filter(clip => clip.trackId === track).sort((a, b) => a.startTime - b.startTime);
    for (let index = 1; index < lane.length; index++) assert.ok(lane[index - 1].startTime + lane[index - 1].duration <= lane[index].startTime);
  }
  assert.deepEqual(distributeManagedSfxClips(result.clips), result);
});
