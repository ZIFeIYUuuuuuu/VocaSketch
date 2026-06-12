import { Router } from "express";

import { interpretCommand } from "../parser.js";
import {
  commandInterpretationSchema,
  confirmInterpretationSchema,
  interpretCommandSchema,
  rejectInterpretationSchema,
  type CommandInterpretation
} from "../schemas/commandSchemas.js";
import { getInterpretation, saveInterpretation } from "../storage/interpretationStore.js";
import { ApiError, asyncHandler, validationError } from "../errors.js";

export const commandsRouter = Router();

type StoredInterpretation = CommandInterpretation & {
  confirmed?: boolean;
  confirmedAt?: string;
  confirmationText?: string;
  rejectedAt?: string;
  reasonText?: string;
};

commandsRouter.post(
  "/interpret",
  asyncHandler(async (req, res) => {
    const parsed = interpretCommandSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const interpreted = interpretCommand(parsed.data);
    const output = commandInterpretationSchema.safeParse(interpreted);
    if (!output.success) {
      throw new ApiError({
        statusCode: 502,
        code: "PARSER_SCHEMA_INVALID",
        message: "模型返回的绘图指令格式不完整。",
        retryable: true,
        details: {
          issues: output.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message
          }))
        }
      });
    }

    const interpretation = await saveInterpretation(output.data);
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

    const interpretation = await getInterpretation<StoredInterpretation>(req.params.interpretationId);

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

    assertInterpretationUnresolved(interpretation);

    const confirmed = parsed.data.confirmed ?? true;
    await saveInterpretation({
      ...interpretation,
      confirmed,
      confirmedAt: new Date().toISOString(),
      confirmationText: parsed.data.confirmationText
    });

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
    const parsed = rejectInterpretationSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const interpretation = await getInterpretation<StoredInterpretation>(req.params.interpretationId);
    if (!interpretation) {
      throw new ApiError({
        statusCode: 404,
        code: "CONFIRMATION_EXPIRED",
        message: "确认记录不存在或已过期。"
      });
    }

    if (interpretation.sessionId !== parsed.data.sessionId || interpretation.projectId !== parsed.data.projectId) {
      throw new ApiError({
        statusCode: 404,
        code: "CONFIRMATION_EXPIRED",
        message: "确认记录不存在或已过期。"
      });
    }

    assertInterpretationUnresolved(interpretation);

    await saveInterpretation({
      ...interpretation,
      confirmed: false,
      rejectedAt: new Date().toISOString(),
      reasonText: parsed.data.reasonText
    });

    res.json({
      interpretationId: interpretation.interpretationId,
      cancelled: true,
      aiReplyText: "好的，我先不执行这次修改。"
    });
  })
);

function assertInterpretationUnresolved(interpretation: StoredInterpretation) {
  if (interpretation.confirmedAt || interpretation.rejectedAt) {
    throw new ApiError({
      statusCode: 409,
      code: "CONFIRMATION_ALREADY_RESOLVED",
      message: "该确认记录已处理，不能重复确认或取消。"
    });
  }
}
