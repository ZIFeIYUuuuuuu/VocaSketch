import type { DrawingOperation } from "../schemas/commandSchemas.js";
import type { CharacterConfig, DrawStage, PaintLayer } from "./project.js";

export type ProjectHistoryKind = "snapshot" | "command" | "undo" | "redo";

export interface ProjectHistoryState {
  config: CharacterConfig;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  canvasObjects: unknown[];
  serverRevision: number;
}

export interface ProjectHistoryEntry {
  historyId: string;
  projectId: string;
  sessionId: string;
  timestamp: string;
  kind: ProjectHistoryKind;
  transcript?: string;
  aiReplyText?: string;
  confirmed?: boolean;
  operations: DrawingOperation[];
  before: ProjectHistoryState;
  after: ProjectHistoryState;
}

export interface ProjectHistoryFile {
  projectId: string;
  undoStack: ProjectHistoryEntry[];
  redoStack: ProjectHistoryEntry[];
}
