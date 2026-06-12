import type {
  ApiProject,
  ApiSession,
  AsrResponse,
  ConfirmCommandResponse,
  CommandInterpretation,
  InterpretCommandRequest,
  ProjectHistoryResponse,
  ProjectSnapshotRequest,
  ProjectSnapshotResponse,
  ProjectUndoRedoResponse,
  TtsResponse
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

export async function createSession(input: {
  clientId: string;
  locale?: string;
}): Promise<ApiSession> {
  return apiRequest('/sessions', {
    method: 'POST',
    body: input
  });
}

export async function createProject(input: {
  sessionId: string;
  title?: string;
  initialConfig?: Partial<ApiProject['config']>;
}): Promise<ApiProject> {
  return apiRequest('/projects', {
    method: 'POST',
    body: input
  });
}

export async function getProject(input: {
  projectId: string;
  sessionId?: string;
}): Promise<ApiProject> {
  const query = input.sessionId ? `?sessionId=${encodeURIComponent(input.sessionId)}` : '';
  return apiRequest(`/projects/${encodeURIComponent(input.projectId)}${query}`);
}

export async function saveProjectSnapshot(
  input: ProjectSnapshotRequest
): Promise<ProjectSnapshotResponse> {
  const { projectId, ...body } = input;
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/snapshot`, {
    method: 'PUT',
    body
  });
}

export async function getProjectHistory(input: {
  projectId: string;
  sessionId?: string;
  limit?: number;
}): Promise<ProjectHistoryResponse> {
  const params = new URLSearchParams();
  if (input.sessionId) params.set('sessionId', input.sessionId);
  if (input.limit) params.set('limit', String(input.limit));
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/projects/${encodeURIComponent(input.projectId)}/history${query}`);
}

export async function undoProject(input: {
  projectId: string;
  sessionId: string;
  currentRevision: number;
}): Promise<ProjectUndoRedoResponse> {
  const { projectId, ...body } = input;
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/undo`, {
    method: 'POST',
    body
  });
}

export async function redoProject(input: {
  projectId: string;
  sessionId: string;
  currentRevision: number;
}): Promise<ProjectUndoRedoResponse> {
  const { projectId, ...body } = input;
  return apiRequest(`/projects/${encodeURIComponent(projectId)}/redo`, {
    method: 'POST',
    body
  });
}

export async function interpretCommand(input: InterpretCommandRequest): Promise<CommandInterpretation> {
  return apiRequest('/commands/interpret', {
    method: 'POST',
    body: input
  });
}

export async function confirmCommand(input: {
  interpretationId: string;
  sessionId: string;
  projectId: string;
  confirmed?: boolean;
  confirmationText?: string;
  currentRevision?: number;
}): Promise<ConfirmCommandResponse> {
  const { interpretationId, ...body } = input;
  return apiRequest(`/commands/${encodeURIComponent(interpretationId)}/confirm`, {
    method: 'POST',
    body
  });
}

export async function rejectCommand(input: {
  interpretationId: string;
  sessionId?: string;
  projectId?: string;
  reasonText?: string;
}) {
  const { interpretationId, ...body } = input;
  return apiRequest(`/commands/${encodeURIComponent(interpretationId)}/reject`, {
    method: 'POST',
    body
  });
}

export async function transcribeAudio(input: {
  sessionId: string;
  projectId: string;
  audio: Blob;
  locale?: string;
  format?: 'webm' | 'wav' | 'mp3';
}): Promise<AsrResponse> {
  const form = new FormData();
  form.append('sessionId', input.sessionId);
  form.append('projectId', input.projectId);
  form.append('locale', input.locale ?? 'zh-CN');
  form.append('format', input.format ?? 'webm');
  form.append('audio', input.audio, `voice.${input.format ?? 'webm'}`);

  return apiRequest('/voice/asr', {
    method: 'POST',
    formData: form
  });
}

export async function synthesizeSpeech(input: {
  sessionId: string;
  projectId?: string;
  text: string;
  voice?: string;
  format?: 'mp3' | 'wav';
}): Promise<TtsResponse> {
  return apiRequest('/voice/tts', {
    method: 'POST',
    body: {
      sessionId: input.sessionId,
      projectId: input.projectId,
      text: input.text,
      voice: input.voice ?? 'gentle_female',
      format: input.format ?? 'mp3'
    }
  });
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
  } = {}
): Promise<T> {
  const isFormData = options.formData !== undefined;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: isFormData
      ? undefined
      : {
          'content-type': 'application/json; charset=utf-8'
        },
    body: isFormData
      ? options.formData
      : options.body === undefined
      ? undefined
      : JSON.stringify(options.body)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message ?? `API request failed with ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string; details?: unknown };
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }

  return payload as T;
}
