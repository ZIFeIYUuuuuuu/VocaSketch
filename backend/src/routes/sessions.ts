import { Router } from "express";

import { asyncHandler, validationError } from "../errors.js";
import { createSessionSchema } from "../schemas/sessionSchemas.js";
import { createSession } from "../storage/sessionStore.js";

export const sessionsRouter = Router();

sessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = createSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    const session = await createSession(parsed.data);
    res.status(201).json({
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt
    });
  })
);
