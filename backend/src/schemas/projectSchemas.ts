import { z } from "zod";

export const drawStageSchema = z.enum([
  "未开始",
  "草图阶段",
  "线稿阶段",
  "铺色阶段",
  "水彩晕染",
  "细节刻画",
  "已完成"
]);

export const characterConfigSchema = z.object({
  gender: z.enum(["female", "male", "neutral"]),
  hairLength: z.enum(["long", "short", "medium"]),
  hairColor: z.string().trim().min(1),
  eyeColor: z.string().trim().min(1),
  expression: z.enum(["微笑", "害羞", "冷淡", "惊讶"]),
  outfit: z.enum(["school", "hoodie", "shirt"]),
  accessory: z.enum(["butterfly_knot", "glasses", "none"]),
  backgroundStyle: z.enum(["gradient", "watercolor", "stars", "cherry"])
});

export const paintLayerSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  visible: z.boolean(),
  opacity: z.number().min(0).max(1),
  stage: drawStageSchema,
  color: z.string().trim().min(1),
  objectCount: z.number().int().nonnegative().optional(),
  locked: z.boolean().optional()
});

export const createProjectSchema = z.object({
  sessionId: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  initialConfig: characterConfigSchema.partial().optional()
});

export const projectSnapshotSchema = z.object({
  sessionId: z.string().trim().min(1),
  config: characterConfigSchema.partial().default({}),
  layers: z.array(paintLayerSchema),
  drawProgress: z.number().min(0).max(100),
  currentStage: drawStageSchema,
  canvasObjects: z.array(z.unknown()).default([]),
  clientRevision: z.number().int().positive()
});
