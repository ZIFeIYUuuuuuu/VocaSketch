import { z } from "zod";

export const interpretCommandSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  clientCommandId: z.string().trim().min(1).optional(),
  text: z.string().default(""),
  currentState: z
    .object({
      drawProgress: z.number().min(0).max(100).optional()
    })
    .passthrough()
    .optional()
}).passthrough();

export const confirmInterpretationSchema = z.object({
  sessionId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  confirmed: z.boolean().optional(),
  confirmationText: z.string().optional(),
  currentRevision: z.number().int().positive().optional()
});
