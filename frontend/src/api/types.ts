import type { CharacterConfig, DrawStage, PaintLayer, SystemState } from '../types';

export type DrawingOperation =
  | { type: 'set_character'; patch: Partial<CharacterConfig> }
  | { type: 'start_auto_painting'; fromProgress?: number }
  | { type: 'start_stage_painting'; fromStage?: DrawStage }
  | {
      type: 'redraw_component';
      target: 'hair' | 'eyes' | 'expression' | 'outfit' | 'accessory' | 'background';
      patch: Partial<CharacterConfig>;
    }
  | { type: 'set_layer_visibility'; layerId: string; visible: boolean }
  | { type: 'set_layer_opacity'; layerId: string; opacity: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replay' }
  | { type: 'export' };

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
  };
}

export interface ApiSession {
  sessionId: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface ApiProject {
  projectId: string;
  sessionId: string;
  title: string;
  config: CharacterConfig;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  historyCount?: number;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSnapshotRequest {
  projectId: string;
  sessionId: string;
  config: Partial<CharacterConfig>;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  canvasObjects: unknown[];
  clientRevision: number;
  historyMeta?: {
    kind?: 'snapshot' | 'command';
    transcript?: string;
    aiReplyText?: string;
    operations?: DrawingOperation[];
  };
}

export interface ProjectSnapshotResponse {
  projectId: string;
  serverRevision: number;
  historyCount?: number;
  redoCount?: number;
  savedAt: string;
}

export interface ProjectHistoryEntry {
  historyId: string;
  timestamp: string;
  kind: 'snapshot' | 'command' | 'undo' | 'redo';
  transcript?: string;
  aiReplyText?: string;
  confirmed?: boolean;
  operations: DrawingOperation[];
  currentStage: DrawStage;
  drawProgress: number;
}

export interface ProjectHistoryResponse {
  items: ProjectHistoryEntry[];
  undoCount: number;
  redoCount: number;
}

export interface ProjectUndoRedoResponse extends ApiProject {
  redoCount: number;
  aiReplyText: string;
}

export interface InterpretCommandRequest {
  sessionId?: string;
  projectId?: string;
  clientCommandId?: string;
  text: string;
  currentState?: {
    systemState: SystemState;
    currentStage: DrawStage;
    drawProgress: number;
    paintMode: 'auto' | 'stages';
    config: CharacterConfig;
    layers: PaintLayer[];
  };
}

export interface CommandInterpretation {
  interpretationId: string;
  sessionId: string;
  projectId: string;
  transcript: string;
  normalizedText: string;
  intent: string;
  confidence: number;
  requiresConfirmation: boolean;
  needsClarification: boolean;
  aiReplyText: string;
  clarificationQuestion?: string;
  traitPatch?: Partial<CharacterConfig>;
  operations: DrawingOperation[];
  affectedLayers: string[];
}

export interface ConfirmCommandResponse {
  projectId: string;
  interpretationId: string;
  confirmed: boolean;
  aiReplyText: string;
  operations: DrawingOperation[];
  serverRevision: number;
}

export interface AsrResponse {
  transcript: string;
  confidence: number;
  durationMs: number;
  provider: 'dashscope';
  rawProviderRequestId?: string;
}

export interface TtsResponse {
  audioUrl?: string;
  audioBase64?: string;
  mimeType?: string;
  durationMs: number;
  provider: 'dashscope';
}
