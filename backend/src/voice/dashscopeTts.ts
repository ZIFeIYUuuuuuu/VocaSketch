import { appConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { saveTtsAudio } from "./audioStore.js";
import type { TtsRequest } from "./voiceSchemas.js";

interface DashScopeTtsResponse {
  output?: {
    audio?: {
      url?: string;
    };
  };
  request_id?: string;
}

const voiceMap: Record<string, string> = {
  gentle_female: "Cherry",
  gentle_male: "Ethan"
};

export async function synthesizeWithDashScope(
  input: TtsRequest,
  options: { fetchImpl?: typeof fetch } = {}
): Promise<{
  audioUrl: string;
  durationMs: number;
  provider: "dashscope";
  mimeType: string;
  rawProviderRequestId?: string;
}> {
  const apiKey = appConfig.voice.dashscopeApiKey;
  if (!apiKey) {
    throw voiceError("TTS_FAILED", "DashScope TTS 未配置。", true, "DASHSCOPE_API_KEY missing");
  }

  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: appConfig.voice.ttsModel,
        input: {
          text: input.text,
          voice: voiceMap[input.voice] ?? input.voice,
          language_type: "Chinese"
        }
      })
    },
    appConfig.voice.ttsTimeoutMs
  );

  const responseBody = await response.text();
  if (!response.ok) {
    throw voiceError("TTS_FAILED", "DashScope TTS 调用失败。", true, responseBody);
  }

  let parsed: DashScopeTtsResponse;
  try {
    parsed = JSON.parse(responseBody) as DashScopeTtsResponse;
  } catch {
    throw voiceError("TTS_FAILED", "DashScope TTS 返回格式不合法。", true);
  }

  const providerAudioUrl = parsed.output?.audio?.url;
  if (!providerAudioUrl) {
    throw voiceError("TTS_FAILED", "DashScope TTS 未返回音频地址。", true);
  }

  const audioResponse = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    providerAudioUrl,
    { method: "GET" },
    appConfig.voice.ttsTimeoutMs
  );
  if (!audioResponse.ok) {
    throw voiceError("TTS_FAILED", "DashScope TTS 音频下载失败。", true);
  }

  const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
  const extension = inferAudioExtension(providerAudioUrl, audioResponse.headers.get("content-type"), input.format);
  const saved = await saveTtsAudio(audioBuffer, extension);

  return {
    audioUrl: `/api/v1/assets/audio/${saved.filename}`,
    durationMs: Date.now() - startedAt,
    provider: "dashscope",
    mimeType: saved.mimeType,
    rawProviderRequestId: parsed.request_id
  };
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw voiceError("TTS_FAILED", "DashScope TTS 调用超时。", true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function inferAudioExtension(url: string, contentType: string | null, fallback: string): "mp3" | "wav" {
  if (contentType?.includes("wav")) return "wav";
  if (contentType?.includes("mpeg") || contentType?.includes("mp3")) return "mp3";
  if (/\.wav(?:$|\?)/i.test(url)) return "wav";
  if (/\.mp3(?:$|\?)/i.test(url)) return "mp3";
  return fallback === "wav" ? "wav" : "mp3";
}

function voiceError(code: "TTS_FAILED", message: string, retryable: boolean, providerMessage?: string) {
  return new ApiError({
    statusCode: 502,
    code,
    message,
    retryable,
    details: providerMessage ? { providerMessage } : {}
  });
}
