import { Router } from "express";

import { interpretCommand } from "../parser.js";
import { confirmInterpretationSchema, interpretCommandSchema } from "../schemas/commandSchemas.js";
import { getInterpretation, saveInterpretation } from "../storage/interpretationStore.js";
import { ApiError, asyncHandler, validationError } from "../errors.js";

export const commandsRouter = Router();

commandsRouter.post(
  "/interpret",
  asyncHandler(async (req, res) => {
    const parsed = interpretCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const interpretation = await saveInterpretation(interpretCommand(parsed.data));
    res.json(interpretation);
  })
);

commandsRouter.post(
  "/:interpretationId/confirm",
  asyncHandler(async (req, res) => {
    const parsed = confirmInterpretationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const interpretation = await getInterpretation<{
      interpretationId: string;
      sessionId: string;
      projectId: string;
      operations: unknown[];
    }>(req.params.interpretationId);

    if (
      !interpretation ||
      interpretation.sessionId !== parsed.data.sessionId ||
      interpretation.projectId !== parsed.data.projectId
    ) {
      throw new ApiError({
        statusCode: 404,
        code: "CONFIRMATION_EXPIRED",
        message: "确认记录不存在或已过期。"
      });
    }

    const confirmed = parsed.data.confirmed ?? true;
    res.json({
      projectId: interpretation.projectId,
      interpretationId: interpretation.interpretationId,
      confirmed,
      aiReplyText: confirmed ? "好的，我开始绘制。" : "好的，我先不执行这次修改。",
      operations: confirmed ? interpretation.operations : [],
      serverRevision: parsed.data.currentRevision ?? 1
    });
  })
);

commandsRouter.post(
  "/:interpretationId/reject",
  asyncHandler(async (req, res) => {
    const interpretation = await getInterpretation<{ interpretationId: string }>(
      req.params.interpretationId
    );
    if (!interpretation) {
      throw new ApiError({
        statusCode: 404,
        code: "CONFIRMATION_EXPIRED",
        message: "确认记录不存在或已过期。"
      });
    }

    res.json({
      interpretationId: interpretation.interpretationId,
      cancelled: true,
      aiReplyText: "好的，我先不执行这次修改。"
    });
  })
);
