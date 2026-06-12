import { Router } from "express";

import { ApiError, asyncHandler, validationError } from "../errors.js";
import {
  createProjectSchema,
  projectHistoryQuerySchema,
  projectSnapshotSchema,
  projectUndoRedoSchema
} from "../schemas/projectSchemas.js";
import { appendProjectHistory, getProjectHistory, hasStateChanged, projectToHistoryState, saveProjectHistory } from "../storage/historyStore.js";
import { createProject, getProject, saveProject, saveSnapshot } from "../storage/projectStore.js";
import { getSession } from "../storage/sessionStore.js";
import type { ProjectHistoryEntry } from "../types/history.js";
import type { StoredProject } from "../types/project.js";

export const projectsRouter = Router();

projectsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const session = await getSession(parsed.data.sessionId);
    if (!session) {
      throw new ApiError({
        statusCode: 404,
        code: "SESSION_NOT_FOUND",
        message: "会话不存在，请先创建 session。"
      });
    }

    const project = await createProject(parsed.data);
    res.status(201).json(toProjectResponse(project, false));
  })
);

projectsRouter.get(
  "/:projectId",
  asyncHandler(async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;

    const project = await getProject(req.params.projectId);
    if (!project) {
      throw new ApiError({
        statusCode: 404,
        code: "PROJECT_NOT_FOUND",
        message: "工程不存在。"
      });
    }

    if (sessionId && project.sessionId !== sessionId) {
      throw new ApiError({
        statusCode: 404,
        code: "SESSION_PROJECT_MISMATCH",
        message: "工程不属于当前会话。"
      });
    }

    res.json(toProjectResponse(project, true));
  })
);

projectsRouter.get(
  "/:projectId/history",
  asyncHandler(async (req, res) => {
    const parsed = projectHistoryQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const project = await loadProjectOrThrow(req.params.projectId);
    assertProjectSession(project, parsed.data.sessionId);

    const history = await getProjectHistory(project.projectId);
    const items = history.undoStack.slice(-parsed.data.limit).reverse().map(toHistoryListItem);

    res.json({
      items,
      undoCount: history.undoStack.length,
      redoCount: history.redoStack.length
    });
  })
);

projectsRouter.put(
  "/:projectId/snapshot",
  asyncHandler(async (req, res) => {
    const parsed = projectSnapshotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const project = await loadProjectOrThrow(req.params.projectId);

    assertProjectSession(project, parsed.data.sessionId);

    if (project.serverRevision !== parsed.data.clientRevision) {
      throwRevisionConflict(project);
    }

    const before = projectToHistoryState(project);
    const updated = await saveSnapshot(project, parsed.data);
    const after = projectToHistoryState(updated);

    if (hasStateChanged(before, after)) {
      const history = await appendProjectHistory(updated.projectId, {
        sessionId: updated.sessionId,
        kind: parsed.data.historyMeta?.kind ?? "snapshot",
        transcript: parsed.data.historyMeta?.transcript,
        aiReplyText: parsed.data.historyMeta?.aiReplyText,
        confirmed: parsed.data.historyMeta?.kind === "command" ? true : undefined,
        operations: (parsed.data.historyMeta?.operations ?? []) as ProjectHistoryEntry["operations"],
        before,
        after
      });
      updated.historyCount = history.undoStack.length;
      await saveProject(updated);
    }

    res.json({
      projectId: updated.projectId,
      serverRevision: updated.serverRevision,
      savedAt: updated.updatedAt
    });
  })
);

projectsRouter.post(
  "/:projectId/undo",
  asyncHandler(async (req, res) => {
    const parsed = projectUndoRedoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const project = await loadProjectOrThrow(req.params.projectId);
    assertProjectSession(project, parsed.data.sessionId);
    if (project.serverRevision !== parsed.data.currentRevision) {
      throwRevisionConflict(project);
    }

    const history = await getProjectHistory(project.projectId);
    const entry = history.undoStack.pop();
    if (!entry) {
      throw new ApiError({
        statusCode: 409,
        code: "NO_UNDO_AVAILABLE",
        message: "没有可撤销的历史。"
      });
    }

    history.redoStack.push(entry);
    const updated = await restoreProjectState(project, entry.before, history.undoStack.length);
    await saveProjectHistory(history);

    res.json({
      ...toProjectResponse(updated, true),
      redoCount: history.redoStack.length,
      aiReplyText: "已撤销上一步修改。"
    });
  })
);

projectsRouter.post(
  "/:projectId/redo",
  asyncHandler(async (req, res) => {
    const parsed = projectUndoRedoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const project = await loadProjectOrThrow(req.params.projectId);
    assertProjectSession(project, parsed.data.sessionId);
    if (project.serverRevision !== parsed.data.currentRevision) {
      throwRevisionConflict(project);
    }

    const history = await getProjectHistory(project.projectId);
    const entry = history.redoStack.pop();
    if (!entry) {
      throw new ApiError({
        statusCode: 409,
        code: "NO_REDO_AVAILABLE",
        message: "没有可重做的历史。"
      });
    }

    history.undoStack.push(entry);
    const updated = await restoreProjectState(project, entry.after, history.undoStack.length);
    await saveProjectHistory(history);

    res.json({
      ...toProjectResponse(updated, true),
      redoCount: history.redoStack.length,
      aiReplyText: "已重新执行上一项被撤回的绘画工序。"
    });
  })
);

function toProjectResponse(project: Awaited<ReturnType<typeof getProject>>, includeHistory: boolean) {
  if (!project) {
    return project;
  }

  return {
    projectId: project.projectId,
    sessionId: project.sessionId,
    title: project.title,
    config: project.config,
    layers: project.layers,
    drawProgress: project.drawProgress,
    currentStage: project.currentStage,
    ...(includeHistory ? { historyCount: project.historyCount } : {}),
    serverRevision: project.serverRevision,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

async function loadProjectOrThrow(projectId: string) {
  const project = await getProject(projectId);
  if (!project) {
    throw new ApiError({
      statusCode: 404,
      code: "PROJECT_NOT_FOUND",
      message: "工程不存在。"
    });
  }
  return project;
}

function assertProjectSession(project: StoredProject, sessionId?: string) {
  if (sessionId && project.sessionId !== sessionId) {
    throw new ApiError({
      statusCode: 404,
      code: "SESSION_PROJECT_MISMATCH",
      message: "工程不属于当前会话。"
    });
  }
}

function throwRevisionConflict(project: StoredProject): never {
  throw new ApiError({
    statusCode: 409,
    code: "REVISION_CONFLICT",
    message: "工程版本已变化，请刷新后重试。",
    retryable: true,
    details: {
      serverRevision: project.serverRevision,
      updatedAt: project.updatedAt
    }
  });
}

async function restoreProjectState(
  project: StoredProject,
  state: ProjectHistoryEntry["before"],
  historyCount: number
) {
  return saveProject({
    ...project,
    config: state.config,
    layers: state.layers,
    drawProgress: state.drawProgress,
    currentStage: state.currentStage,
    canvasObjects: state.canvasObjects,
    serverRevision: project.serverRevision + 1,
    historyCount,
    updatedAt: new Date().toISOString()
  });
}

function toHistoryListItem(entry: ProjectHistoryEntry) {
  return {
    historyId: entry.historyId,
    timestamp: entry.timestamp,
    kind: entry.kind,
    transcript: entry.transcript,
    aiReplyText: entry.aiReplyText,
    confirmed: entry.confirmed,
    operations: entry.operations,
    currentStage: entry.after.currentStage,
    drawProgress: entry.after.drawProgress
  };
}
