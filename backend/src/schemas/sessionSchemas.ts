import { z } from "zod";

export const createSessionSchema = z.object({
  clientId: z.string().trim().min(1).max(200).optional(),
  locale: z.string().trim().min(2).max(20).default("zh-CN")
});
