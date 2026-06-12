import type { CharacterConfig, DrawStage, PaintLayer, SystemState } from '../types';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    details: Record<string, unknown>;
  };
}

export interface CreateSessionResponse {
  sessionId: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateProjectResponse {
  projectId: string;
  sessionId: string;
  title: string;
  config: CharacterConfig;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  serverRevision: number;
  createdAt: string;
  updatedAt: string;
}

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

export interface CommandInterpretation {
  interpretationId: string;
  sessionId: string;
  projectId: string;
  transcript: string;
  normalizedText: string;
  intent:
    | 'create_avatar'
    | 'edit_traits'
    | 'add_accessory'
    | 'remove_accessory'
    | 'control'
    | 'clarify'
    | 'smalltalk'
    | 'unknown';
  confidence: number;
  requiresConfirmation: boolean;
  needsClarification: boolean;
  aiReplyText: string;
  clarificationQuestion?: string;
  traitPatch?: Partial<CharacterConfig>;
  operations: DrawingOperation[];
  affectedLayers: string[];
  costHint?: {
    parserTokensIn?: number;
    parserTokensOut?: number;
    provider: string;
    cacheHit: boolean;
  };
}

export interface ConfirmInterpretationResponse {
  projectId: string;
  interpretationId: string;
  confirmed: boolean;
  aiReplyText: string;
  operations: DrawingOperation[];
  serverRevision: number;
}

export interface RuntimeProjectState {
  systemState: SystemState;
  currentStage: DrawStage;
  drawProgress: number;
  paintMode: 'auto' | 'stages';
  config: CharacterConfig;
  layers: PaintLayer[];
}
