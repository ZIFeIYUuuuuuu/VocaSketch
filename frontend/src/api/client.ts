import type {
  ApiProject,
  ApiSession,
  AsrResponse,
  AssetRecord,
  ConfirmCommandResponse,
  DrawingJob,
  DrawingJobCreatedEnvelope,
  DrawingJobListResponse,
  DrawingJobRetryResponse,
  JobEvent,
  JobStatus,
  CommandInterpretation,
  InterpretCommandRequest,
  ProjectHistoryResponse,
  ProjectSnapshotRequest,
  ProjectSnapshotResponse,
  ProjectUndoRedoResponse,
  RuntimeReadiness,
  TtsResponse
} from './types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';
const DRAWING_API_BASE_URL = import.meta.env.VITE_API_V2_BASE_URL ?? 'http://localhost:8000/api/v2';

type DrawingJobEventType = JobEvent['type'];

interface DrawingJobEventHandlers {
  onEvent?: (event: JobEvent) => void;
  onOpen?: () => void;
  onError?: (error: Event) => void;
}

export function getV2ApiBaseUrl(): string {
  return DRAWING_API_BASE_URL;
}

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

export async function createDrawingJob(
  inputText: string,
  options?: {
    locale?: string;
    clientSessionId?: string;
    projectHint?: string;
    qualityProfile?: 'standard' | 'high';
    references?: string[];
    simulateFailureAt?: DrawingJob['simulateFailureAt'];
  }
): Promise<DrawingJobCreatedEnvelope> {
  return v2ApiRequest('/drawing-jobs', {
    method: 'POST',
    body: {
      inputText,
      locale: options?.locale ?? 'zh-CN',
      clientSessionId: options?.clientSessionId,
      projectHint: options?.projectHint,
      qualityProfile: options?.qualityProfile ?? 'high',
      references: options?.references ?? [],
      simulateFailureAt: options?.simulateFailureAt
    }
  });
}

export async function getDrawingJob(jobId: string): Promise<DrawingJob> {
  return v2ApiRequest(`/drawing-jobs/${encodeURIComponent(jobId)}`);
}

export async function listDrawingJobs(options: { limit?: number; status?: JobStatus } = {}): Promise<DrawingJobListResponse> {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set('limit', String(options.limit));
  }
  if (options.status) {
    params.set('status', options.status);
  }
  const query = params.toString() ? `?${params.toString()}` : '';
  return v2ApiRequest(`/drawing-jobs${query}`);
}

export async function confirmDrawingJob(
  jobId: string,
  payload?: {
    decision?: 'approve';
    selectedPreviewAssetId?: string;
    notes?: string;
  }
): Promise<DrawingJob> {
  return v2ApiRequest(`/drawing-jobs/${encodeURIComponent(jobId)}/confirm`, {
    method: 'POST',
    body: {
      decision: payload?.decision ?? 'approve',
      selectedPreviewAssetId: payload?.selectedPreviewAssetId,
      notes: payload?.notes
    }
  });
}

export async function cancelDrawingJob(jobId: string, reason?: string): Promise<DrawingJob> {
  return v2ApiRequest(`/drawing-jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
    body: {
      reason
    }
  });
}

export async function retryDrawingJob(
  jobId: string,
  payload?: {
    fromPhase?: DrawingJob['simulateFailureAt'];
    reason?: string;
  }
): Promise<DrawingJobRetryResponse> {
  return v2ApiRequest(`/drawing-jobs/${encodeURIComponent(jobId)}/retry`, {
    method: 'POST',
    body: {
      fromPhase: payload?.fromPhase,
      reason: payload?.reason
    }
  });
}

export async function getAssetMetadata(assetId: string): Promise<AssetRecord> {
  return v2ApiRequest(`/assets/${encodeURIComponent(assetId)}`);
}

export async function getRuntimeReadiness(): Promise<RuntimeReadiness> {
  return v2ApiRequest('/runtime/readiness');
}

export function buildAssetContentUrl(assetOrAssetId: string | { assetId: string; contentUrl?: string | null }): string {
  if (typeof assetOrAssetId === 'string') {
    return resolveV2Url(`/api/v2/assets/${encodeURIComponent(assetOrAssetId)}/content`);
  }

  if (assetOrAssetId.contentUrl) {
    return resolveV2Url(assetOrAssetId.contentUrl);
  }

  return resolveV2Url(`/api/v2/assets/${encodeURIComponent(assetOrAssetId.assetId)}/content`);
}

export function subscribeDrawingJobEvents(
  jobId: string,
  handlers: DrawingJobEventHandlers = {}
): { close: () => void; usingEventSource: boolean } {
  if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
    return {
      close: () => undefined,
      usingEventSource: false
    };
  }

  const source = new EventSource(resolveV2Url(`/api/v2/drawing-jobs/${encodeURIComponent(jobId)}/events`));
  let isClosed = false;
  const eventTypes: DrawingJobEventType[] = [
    'job.created',
    'job.status_changed',
    'intent.ready',
    'prompt.ready',
    'preview.ready',
    'job.confirmed',
    'final.ready',
    'layers.ready',
    'playback.ready',
    'job.completed',
    'job.failed',
    'job.cancelled'
  ];

  const dispatch = (event: MessageEvent) => {
    const payload = parseEventPayload(event.data);
    if (payload) {
      handlers.onEvent?.(payload);
    }
  };

  source.onopen = () => {
    handlers.onOpen?.();
  };
  source.onerror = (error) => {
    if (!isClosed) {
      isClosed = true;
      source.close();
    }
    handlers.onError?.(error);
  };

  for (const eventType of eventTypes) {
    source.addEventListener(eventType, dispatch as EventListener);
  }

  return {
    close: () => {
      if (!isClosed) {
        isClosed = true;
        source.close();
      }
    },
    usingEventSource: true
  };
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
  } = {}
): Promise<T> {
  return performRequest<T>(toApiUrl(API_BASE_URL, path), options);
}

async function v2ApiRequest<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
  } = {}
): Promise<T> {
  return performRequest<T>(toApiUrl(DRAWING_API_BASE_URL, path), options);
}

async function performRequest<T>(
  url: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: FormData;
  }
): Promise<T> {
  const isFormData = options.formData !== undefined;
  const response = await fetch(url, {
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
    const detail = payload?.detail;
    const message =
      payload?.error?.message ??
      (typeof detail === 'string' ? detail : null) ??
      `API request failed with ${response.status}`;
    const error = new Error(message) as Error & { status?: number; code?: string; details?: unknown };
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details ?? detail;
    throw error;
  }

  return payload as T;
}

function parseEventPayload(data: string): JobEvent | null {
  try {
    return JSON.parse(data) as JobEvent;
  } catch {
    return null;
  }
}

function resolveV2Url(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  try {
    const base = new URL(DRAWING_API_BASE_URL);
    const origin = `${base.protocol}//${base.host}`;
    return new URL(pathOrUrl, origin).toString();
  } catch {
    return pathOrUrl;
  }
}

function toApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}
