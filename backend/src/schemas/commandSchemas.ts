import { z } from "zod";

import { characterConfigSchema, drawStageSchema } from "./projectSchemas.js";

const partialCharacterConfigSchema = characterConfigSchema.partial();

export const drawingOperationSchema = z.union([
  z.object({
    type: z.literal("set_character"),
    patch: partialCharacterConfigSchema
  }),
  z.object({
    type: z.literal("start_auto_painting"),
    fromProgress: z.number().min(0).max(100).optional()
  }),
  z.object({
    type: z.literal("start_stage_painting"),
    fromStage: drawStageSchema.optional()
  }),
  z.object({
    type: z.literal("redraw_component"),
    target: z.enum(["hair", "eyes", "expression", "outfit", "accessory", "background"]),
    patch: partialCharacterConfigSchema
  }),
  z.object({
    type: z.literal("set_layer_visibility"),
    layerId: z.string().trim().min(1),
    visible: z.boolean()
  }),
  z.object({
    type: z.literal("set_layer_opacity"),
    layerId: z.string().trim().min(1),
    opacity: z.number().min(0).max(1)
  }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
  z.object({ type: z.literal("replay") }),
  z.object({ type: z.literal("export") })
]);

export const commandInterpretationSchema = z.object({
  interpretationId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  transcript: z.string(),
  normalizedText: z.string(),
  intent: z.enum([
    "create_avatar",
    "edit_traits",
    "add_accessory",
    "remove_accessory",
    "control",
    "clarify",
    "smalltalk",
    "unknown"
  ]),
  confidence: z.number().min(0).max(1),
  requiresConfirmation: z.boolean(),
  needsClarification: z.boolean(),
  aiReplyText: z.string(),
  clarificationQuestion: z.string().optional(),
  traitPatch: partialCharacterConfigSchema.optional(),
  operations: z.array(drawingOperationSchema),
  affectedLayers: z.array(z.string()),
  costHint: z
    .object({
      parserTokensIn: z.number().int().nonnegative().optional(),
      parserTokensOut: z.number().int().nonnegative().optional(),
      provider: z.string(),
      cacheHit: z.boolean()
    })
    .optional()
});

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

export const rejectInterpretationSchema = z.object({
  sessionId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  reasonText: z.string().optional()
});

export type CommandInterpretation = z.infer<typeof commandInterpretationSchema>;
export type DrawingOperation = z.infer<typeof drawingOperationSchema>;
