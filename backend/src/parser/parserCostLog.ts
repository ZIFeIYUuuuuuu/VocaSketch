import path from "node:path";

import { appConfig } from "../config.js";
import { ensureStorageReady } from "../storage/fileStore.js";

export interface ParserCostLogEntry {
  provider: "openai-compatible" | "local-rule-parser";
  model?: string;
  latencyMs: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  parserTokensIn?: number;
  parserTokensOut?: number;
  textLength: number;
  intent?: string;
}

export async function logParserCost(entry: ParserCostLogEntry): Promise<void> {
  const printable = {
    ...entry,
    timestamp: new Date().toISOString()
  };

  console.info("[parser]", printable);

  if (!appConfig.parser.costLog) {
    return;
  }

  await ensureStorageReady();
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(appConfig.storageDir, "parser-costs", `${date}.jsonl`);
  const fs = await import("node:fs/promises");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(printable)}\n`, "utf8");
}

export async function logLocalParser(input: {
  startedAt: number;
  textLength: number;
  intent?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string;
}) {
  await logParserCost({
    provider: "local-rule-parser",
    latencyMs: Date.now() - input.startedAt,
    fallbackUsed: input.fallbackUsed ?? false,
    fallbackReason: input.fallbackReason,
    textLength: input.textLength,
    intent: input.intent
  });
}
