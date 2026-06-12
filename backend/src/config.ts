import path from "node:path";

import dotenv from "dotenv";

dotenv.config();

const DEFAULT_PORT = 4000;
const corsOrigins: readonly string[] = ["http://localhost:3000", "http://127.0.0.1:3000"];

function readOptional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function readPort(): number {
  const rawPort = readOptional("PORT");
  if (!rawPort) {
    return DEFAULT_PORT;
  }

  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_PORT;
  }

  return port;
}

export const appConfig = {
  version: "0.1.0",
  env: readOptional("APP_ENV") ?? "development",
  port: readPort(),
  storageDir: path.resolve(process.cwd(), readOptional("APP_STORAGE_DIR") ?? "./data"),
  corsOrigins,
  providers: {
    openAICompatible: {
      apiKey: readOptional("OPENAI_COMPATIBLE_API_KEY"),
      baseUrl: readOptional("OPENAI_COMPATIBLE_BASE_URL"),
      model: readOptional("OPENAI_COMPATIBLE_MODEL")
    },
    dashscope: {
      apiKey: readOptional("DASHSCOPE_API_KEY")
    }
  },
  runtime: {
    asrMode: "dashscope",
    ttsEnabled: true,
    parserMode: "openai-compatible",
    defaultLocale: "zh-CN",
    maxAudioSeconds: 20,
    maxCommandChars: 500
  }
} as const;

export type ProviderStatus = "configured" | "missing";

export function getProviderStatuses(): {
  parser: ProviderStatus;
  asr: ProviderStatus;
  tts: ProviderStatus;
} {
  const parserReady = Boolean(
    appConfig.providers.openAICompatible.apiKey &&
      appConfig.providers.openAICompatible.baseUrl &&
      appConfig.providers.openAICompatible.model
  );
  const dashscopeReady = Boolean(appConfig.providers.dashscope.apiKey);

  return {
    parser: parserReady ? "configured" : "missing",
    asr: dashscopeReady ? "configured" : "missing",
    tts: dashscopeReady ? "configured" : "missing"
  };
}
