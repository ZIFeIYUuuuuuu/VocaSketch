import { Router } from "express";

import { ApiError, asyncHandler, validationError } from "../errors.js";
import { createProjectSchema, projectSnapshotSchema } from "../schemas/projectSchemas.js";
import { createProject, getProject, saveSnapshot } from "../storage/projectStore.js";
import { getSession } from "../storage/sessionStore.js";

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

projectsRouter.put(
  "/:projectId/snapshot",
  asyncHandler(async (req, res) => {
    const parsed = projectSnapshotSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const project = await getProject(req.params.projectId);
    if (!project) {
      throw new ApiError({
        statusCode: 404,
        code: "PROJECT_NOT_FOUND",
        message: "工程不存在。"
      });
    }

    if (project.sessionId !== parsed.data.sessionId) {
      throw new ApiError({
        statusCode: 404,
        code: "SESSION_PROJECT_MISMATCH",
        message: "工程不属于当前会话。"
      });
    }

    if (project.serverRevision !== parsed.data.clientRevision) {
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

    const updated = await saveSnapshot(project, parsed.data);
    res.json({
      projectId: updated.projectId,
      serverRevision: updated.serverRevision,
      savedAt: updated.updatedAt
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
