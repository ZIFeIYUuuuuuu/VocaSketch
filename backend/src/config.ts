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

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readOptional(name);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = readOptional(name);
  if (!raw) {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(raw);
}

function readParserProvider(): "auto" | "local" | "openai-compatible" {
  const raw = readOptional("PARSER_PROVIDER");
  if (raw === "local" || raw === "openai-compatible" || raw === "auto") {
    return raw;
  }
  return "auto";
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
  },
  parser: {
    provider: readParserProvider(),
    timeoutMs: readPositiveInteger("OPENAI_COMPATIBLE_TIMEOUT_MS", 8000),
    costLog: readBoolean("PARSER_COST_LOG", false)
  },
  voice: {
    dashscopeApiKey: readOptional("DASHSCOPE_API_KEY"),
    asrModel: readOptional("DASHSCOPE_ASR_MODEL") ?? "paraformer-realtime-8k-v2",
    ttsModel: readOptional("DASHSCOPE_TTS_MODEL") ?? "qwen3-tts-flash",
    asrTimeoutMs: readPositiveInteger("VOICE_ASR_TIMEOUT_MS", 15000),
    ttsTimeoutMs: readPositiveInteger("VOICE_TTS_TIMEOUT_MS", 15000),
    maxAudioMb: readPositiveInteger("VOICE_MAX_AUDIO_MB", 10),
    maxTtsChars: readPositiveInteger("VOICE_MAX_TTS_CHARS", 300)
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
