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

export type JobStatus =
  | 'queued'
  | 'parsing'
  | 'intent_ready'
  | 'prompt_ready'
  | 'preview_generating'
  | 'preview_ready'
  | 'final_generating'
  | 'final_ready'
  | 'layers_generating'
  | 'layers_ready'
  | 'playback_ready'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ParsedIntent {
  subject: string;
  style: string;
  composition: string;
  constraints: string[];
  edits: string[];
  ambiguities: string[];
  confidence: number;
}

export interface VisualBrief {
  artDirection: string;
  camera: string;
  palette: string[];
  mood: string;
  characterSpec: string;
  backgroundSpec: string;
  negativeConstraints: string[];
}

export interface ImagePrompt {
  model: string;
  positivePrompt: string;
  negativePrompt: string;
  size: string;
  guidance?: string | null;
  seed?: number | null;
}

export interface AssetRecord {
  assetId: string;
  jobId: string;
  kind: 'preview' | 'final' | 'layer' | 'manifest';
  role: string;
  mimeType: string;
  url: string;
  contentUrl?: string | null;
  byteSize?: number | null;
  checksum?: string | null;
  width?: number | null;
  height?: number | null;
  storagePath?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface LayerAsset {
  assetId: string;
  jobId: string;
  role: string;
  label: string;
  mimeType: string;
  width: number;
  height: number;
  url: string;
  contentUrl?: string | null;
  byteSize?: number | null;
  checksum?: string | null;
  storagePath?: string | null;
  order?: number | null;
  opacity?: number | null;
  blendMode?: string | null;
  sourceFinalAssetId?: string | null;
  metadata: Record<string, unknown>;
}

export interface PlaybackManifestStep {
  stepId: string;
  order: number;
  role: string;
  label: string;
  startMs: number;
  durationMs: number;
  opacityFrom: number;
  opacityTo: number;
  blendMode: string;
  easing: string;
  transition: string;
  assetId?: string | null;
  contentUrl?: string | null;
  step?: number | null;
  phase?: string | null;
  assetRole?: string | null;
}

export type PlaybackProcessAction =
  | {
      id: string;
      type: 'stroke';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      tool: string;
      points: Array<{ x: number; y: number }>;
      strokeWidth: number;
      color: string;
      opacity: number;
      speedProfile?: string;
      source?: string;
    }
  | {
      id: string;
      type: 'fillRegion';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      tool: string;
      center: { x: number; y: number };
      radius: { x: number; y: number };
      color: string;
      opacity: number;
      sourceImage?: 'preview' | 'final';
      imageAlpha?: number;
      tintAlpha?: number;
      filterStyle?: string;
      edgeFeather?: number;
      reveal?: string;
    }
  | {
      id: string;
      type: 'maskReveal';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      tool: string;
      blendMode: string;
      opacity: number;
      direction?: string;
      filter?: string;
    }
  | {
      id: string;
      type: 'layerBadge';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      blendMode?: string;
    }
  | {
      id: string;
      type: 'finalReveal';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      tool: string;
    }
  | {
      id: string;
      type: 'eyeSpark';
      phase: string;
      label: string;
      startMs: number;
      durationMs: number;
      tool: string;
      points: Array<{ x: number; y: number }>;
      color: string;
      opacity: number;
    };

export interface PlaybackProcessPhase {
  role: string;
  label: string;
  progressPercent: number;
  startMs: number;
  durationMs: number;
}

export interface PlaybackProcess {
  version: string;
  style: string;
  renderer: string;
  source: {
    previewAssetId?: string | null;
    previewContentUrl?: string | null;
    finalAssetId: string;
    finalContentUrl: string;
    mimeType: string;
    width: number;
    height: number;
    mode: string;
    processVideoAssetId?: string | null;
    processVideoContentUrl?: string | null;
    processVideoMimeType?: string | null;
  };
  phases: PlaybackProcessPhase[];
  actions: PlaybackProcessAction[];
  ui?: Record<string, unknown>;
}

export interface PlaybackManifest {
  manifestVersion: string;
  canvasSize: {
    width: number;
    height: number;
  };
  durationMs: number;
  steps: PlaybackManifestStep[];
  layerRefs: string[];
  finalCompositeAssetId?: string | null;
  process?: PlaybackProcess | null;
}

export interface JobError {
  code: string;
  phase: JobStatus;
  message: string;
  retryable: boolean;
  provider?: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface DrawingJob {
  jobId: string;
  status: JobStatus;
  progressPercent: number;
  inputText: string;
  locale: string;
  clientSessionId?: string | null;
  projectHint?: string | null;
  qualityProfile: string;
  references: string[];
  parsedIntent?: ParsedIntent | null;
  visualBrief?: VisualBrief | null;
  imagePrompt?: ImagePrompt | null;
  previewAssetId?: string | null;
  finalAssetId?: string | null;
  playbackManifestAssetId?: string | null;
  layerAssets: LayerAsset[];
  playbackManifest?: PlaybackManifest | null;
  requiresConfirmation: boolean;
  error?: JobError | null;
  retryOfJobId?: string | null;
  simulateFailureAt?: JobStatus | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  eventsUrl: string;
}

export interface JobErrorSummary {
  code: string;
  phase: JobStatus;
  message: string;
  retryable: boolean;
  provider?: string | null;
}

export interface DrawingJobSummary {
  jobId: string;
  status: JobStatus;
  progressPercent: number;
  inputText: string;
  previewAssetId?: string | null;
  finalAssetId?: string | null;
  retryOfJobId?: string | null;
  error?: JobErrorSummary | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface DrawingJobListResponse {
  items: DrawingJobSummary[];
  limit: number;
  status?: JobStatus | null;
}

export interface DrawingJobCreatedEnvelope {
  jobId: string;
  status: JobStatus;
  eventsUrl: string;
}

export interface DrawingJobRetryResponse {
  jobId: string;
  status: JobStatus;
  eventsUrl: string;
  retryOfJobId: string;
}

export interface JobEvent {
  eventId: string;
  jobId: string;
  seq: number;
  type:
    | 'job.created'
    | 'job.status_changed'
    | 'intent.ready'
    | 'prompt.ready'
    | 'preview.ready'
    | 'job.confirmed'
    | 'final.ready'
    | 'layers.ready'
    | 'playback.ready'
    | 'job.completed'
    | 'job.failed'
    | 'job.cancelled';
  status: JobStatus;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeReadiness {
  status: 'ready' | string;
  app: {
    name: string;
    version: string;
  };
  provider: {
    profile: string;
    providerName: string;
    allowLiveRequests: boolean;
    networkEnabled: boolean;
    configured: boolean;
    placeholder: boolean;
    capabilities: {
      preview: boolean;
      final: boolean;
      layerDecomposition: boolean;
      playbackManifest: boolean;
    };
    modes: {
      text: string;
      preview: string;
      final: string;
      layers: string;
      playback: string;
    };
    safeSettings?: Record<string, unknown>;
  };
  storage: Record<string, unknown>;
  workflow: {
    runnerMode: string;
    usesLangGraph: boolean;
    langGraphAvailable: boolean;
    langGraphDisabled: boolean;
  };
}
