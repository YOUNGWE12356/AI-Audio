import test from 'node:test';
import assert from 'node:assert/strict';
import type { AssistantJob } from '../services/assistantAgentTypes';
import { getAssistantAutoNavigation, readWorkspaceTab } from './workspaceNavigation';

test('restores the selected function instead of resetting to workbench on reload', () => {
  assert.equal(readWorkspaceTab({ getItem: () => 'video-soundtrack' }), 'video-soundtrack');
  assert.equal(readWorkspaceTab({ getItem: () => 'sfx-library' }), 'sfx-library');
  assert.equal(readWorkspaceTab({ getItem: () => 'invalid' }), 'workbench');
  assert.equal(readWorkspaceTab({ getItem: () => { throw new Error('storage disabled'); } }), 'workbench');
});

test('production completion never navigates to workbench; explicit open-only commands still work', () => {
  const job: AssistantJob = { id: 'task', prompt: '', status: 'completed', assets: [], createdAt: '', updatedAt: '', navigation: 'workbench',
    events: [{ id: 'generate', tool: 'generate_speech', status: 'completed', message: '' }, { id: 'nav', tool: 'open_module', status: 'completed', message: '' }] };
  assert.equal(getAssistantAutoNavigation(job), undefined);
  assert.equal(getAssistantAutoNavigation({ ...job, status: 'running' }), undefined);
  assert.equal(getAssistantAutoNavigation({ ...job, navigation: 'dubbing-studio' }), undefined);
  const openOnly = { ...job, events: [job.events[1]], navigation: 'dubbing-studio' };
  assert.deepEqual(getAssistantAutoNavigation(openOnly), { eventId: 'nav', tab: 'dubbing-studio' });
  assert.equal(getAssistantAutoNavigation({ ...openOnly, workspaceCommand: { id: 'command', workspace: 'video-soundtrack', action: 'export', status: 'completed', args: {}, message: '' } }), undefined);
});
