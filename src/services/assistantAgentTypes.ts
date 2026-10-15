export type AssistantAsset = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  duration?: number;
  generated?: boolean;
  metadata?: Record<string, unknown>;
};
export type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};
export type AssistantJob = {
  id: string;
  prompt: string;
  messages?: AssistantMessage[];
  status: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  events: Array<{ id: string; message: string; status: 'running' | 'completed' | 'failed'; tool?: string }>;
  assets: AssistantAsset[];
  answer?: string;
  question?: string;
  waitingFor?: 'export-review';
  exportReview?: { status: 'pending' | 'approved'; args: Record<string, any> };
  error?: string;
  model?: string;
  navigation?: string;
  deliverableIds?: string[];
  workspaceCommand?: AssistantWorkspaceCommand;
};

export type AssistantWorkspaceCommand = {
  id: string;
  workspace: 'video-soundtrack';
  action: 'inspect' | 'load' | 'analyze' | 'edit_clips' | 'generate' | 'export';
  args: Record<string, any>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  message: string;
  result?: Record<string, any>;
  error?: string;
  lastHeartbeatAt?: string;
};
