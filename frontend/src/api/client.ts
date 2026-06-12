import type {
  ApiProject,
  ApiSession,
  ConfirmCommandResponse,
  CommandInterpretation,
  InterpretCommandRequest,
  ProjectHistoryResponse,
  ProjectSnapshotRequest,
  ProjectSnapshotResponse,
  ProjectUndoRedoResponse
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

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'content-type': 'application/json; charset=utf-8'
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
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
