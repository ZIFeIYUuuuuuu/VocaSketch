import type {
  ApiErrorResponse,
  CommandInterpretation,
  ConfirmInterpretationResponse,
  CreateProjectResponse,
  CreateSessionResponse,
  RuntimeProjectState
} from './types';
import type { CharacterConfig, DrawStage, PaintLayer } from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:4000/api/v1';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: { status: number; code?: string; details?: Record<string, unknown> }) {
    super(message);
    this.name = 'ApiClientError';
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  let payload: unknown;

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiClientError('后端返回了非 JSON 响应。', { status: response.status });
  }

  if (!response.ok) {
    const errorPayload = payload as Partial<ApiErrorResponse>;
    throw new ApiClientError(errorPayload.error?.message ?? '后端请求失败。', {
      status: response.status,
      code: errorPayload.error?.code,
      details: errorPayload.error?.details
    });
  }

  return payload as T;
}

export function createSession(input: { clientId?: string; locale?: string } = {}) {
  return apiFetch<CreateSessionResponse>('/sessions', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function createProject(input: {
  sessionId: string;
  title?: string;
  initialConfig?: Partial<CharacterConfig>;
}) {
  return apiFetch<CreateProjectResponse>('/projects', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function interpretCommand(input: {
  sessionId: string;
  projectId: string;
  clientCommandId?: string;
  text: string;
  currentState: RuntimeProjectState;
}) {
  return apiFetch<CommandInterpretation>('/commands/interpret', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function confirmInterpretation(input: {
  interpretationId: string;
  sessionId: string;
  projectId: string;
  confirmed?: boolean;
  confirmationText?: string;
  currentRevision?: number;
}) {
  return apiFetch<ConfirmInterpretationResponse>(`/commands/${input.interpretationId}/confirm`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId: input.sessionId,
      projectId: input.projectId,
      confirmed: input.confirmed,
      confirmationText: input.confirmationText,
      currentRevision: input.currentRevision
    })
  });
}

export function rejectInterpretation(input: {
  interpretationId: string;
  sessionId?: string;
  projectId?: string;
  reasonText?: string;
}) {
  return apiFetch<{ interpretationId: string; cancelled: boolean; aiReplyText: string }>(
    `/commands/${input.interpretationId}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({
        sessionId: input.sessionId,
        projectId: input.projectId,
        reasonText: input.reasonText
      })
    }
  );
}

export function saveProjectSnapshot(input: {
  projectId: string;
  sessionId: string;
  config: CharacterConfig;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  canvasObjects?: unknown[];
  clientRevision: number;
}) {
  return apiFetch<{ projectId: string; serverRevision: number; savedAt: string }>(
    `/projects/${input.projectId}/snapshot`,
    {
      method: 'PUT',
      body: JSON.stringify({
        sessionId: input.sessionId,
        config: input.config,
        layers: input.layers,
        drawProgress: input.drawProgress,
        currentStage: input.currentStage,
        canvasObjects: input.canvasObjects ?? [],
        clientRevision: input.clientRevision
      })
    }
  );
}
