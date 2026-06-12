import { z } from "zod";

export const asrFieldsSchema = z.object({
  sessionId: z.string().trim().min(1),
  projectId: z.string().trim().min(1),
  locale: z.string().trim().default("zh-CN"),
  format: z.enum(["webm", "wav", "mp3"])
});

export const ttsRequestSchema = z.object({
  sessionId: z.string().trim().min(1),
  projectId: z.string().trim().min(1).optional(),
  text: z.string().trim().min(1),
  voice: z.string().trim().default("gentle_female"),
  format: z.enum(["mp3", "wav"]).default("mp3")
});

export type AsrFields = z.infer<typeof asrFieldsSchema>;
export type TtsRequest = z.infer<typeof ttsRequestSchema>;
