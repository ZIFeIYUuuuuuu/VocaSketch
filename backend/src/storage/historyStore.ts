import type { ProjectHistoryEntry, ProjectHistoryFile, ProjectHistoryState } from "../types/history.js";
import type { StoredProject } from "../types/project.js";
import { readJson, writeJson } from "./fileStore.js";
import { makeId } from "./ids.js";

export async function getProjectHistory(projectId: string): Promise<ProjectHistoryFile> {
  return (
    (await readJson<ProjectHistoryFile>("history", projectId)) ?? {
      projectId,
      undoStack: [],
      redoStack: []
    }
  );
}

export async function saveProjectHistory(history: ProjectHistoryFile): Promise<ProjectHistoryFile> {
  return writeJson("history", history.projectId, history);
}

export async function appendProjectHistory(
  projectId: string,
  entry: Omit<ProjectHistoryEntry, "historyId" | "timestamp" | "projectId">
): Promise<ProjectHistoryFile> {
  const history = await getProjectHistory(projectId);
  const next: ProjectHistoryFile = {
    projectId,
    undoStack: [
      ...history.undoStack,
      {
        ...entry,
        projectId,
        historyId: makeId("hist"),
        timestamp: new Date().toISOString()
      }
    ],
    redoStack: []
  };

  return saveProjectHistory(next);
}

export function projectToHistoryState(project: StoredProject): ProjectHistoryState {
  return {
    config: project.config,
    layers: project.layers,
    drawProgress: project.drawProgress,
    currentStage: project.currentStage,
    canvasObjects: project.canvasObjects,
    serverRevision: project.serverRevision
  };
}

export function hasStateChanged(before: ProjectHistoryState, after: ProjectHistoryState): boolean {
  return JSON.stringify({ ...before, serverRevision: 0 }) !== JSON.stringify({ ...after, serverRevision: 0 });
}
