import type { TabType } from '../types';
import type { AssistantJob } from '../services/assistantAgentTypes';

export const WORKSPACE_TAB_KEY = 'ai_audio_current_workspace_v1';
const tabs: TabType[] = ['workbench', 'audio-director', 'music-studio', 'sfx-studio', 'dubbing-studio', 'settings',
  'sfx-library', 'sfx-requirements', 'audio-tools', 'video-soundtrack'];

export function readWorkspaceTab(storage: Pick<Storage, 'getItem'>): TabType {
  try {
    const tab = storage.getItem(WORKSPACE_TAB_KEY);
    return tabs.includes(tab as TabType) ? tab as TabType : 'workbench';
  } catch { return 'workbench'; }
}

export function getAssistantAutoNavigation(job?: AssistantJob) {
  if (!job?.navigation || job.workspaceCommand) return undefined;
  const event = [...job.events].reverse().find(item => item.tool === 'open_module' && item.status === 'completed');
  if (!event) return undefined;
  const didWork = job.events.some(item => item.status === 'completed' && item.tool
    && !['open_module', 'inspect_assets', 'engine_status', 'list_voices', 'finish_task', 'ask_user'].includes(item.tool));
  // Finishing or restoring a production task must not replay old navigation.
  if (didWork && (job.status !== 'running' || job.navigation === 'workbench')) return undefined;
  return { eventId: event.id, tab: job.navigation as TabType };
}
