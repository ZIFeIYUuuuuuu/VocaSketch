import fs from "node:fs/promises";

import { appConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { audioMimeType } from "./audioStore.js";
import type { AsrFields } from "./voiceSchemas.js";

interface DashScopeAsrResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  request_id?: string;
  id?: string;
}

export async function transcribeWithDashScope(
  input: {
    audioPath: string;
    fields: AsrFields;
  },
  options: { fetchImpl?: typeof fetch } = {}
): Promise<{
  transcript: string;
  confidence: number;
  durationMs: number;
  provider: "dashscope";
  rawProviderRequestId?: string;
}> {
  const apiKey = appConfig.voice.dashscopeApiKey;
  if (!apiKey) {
    throw voiceError("ASR_FAILED", "DashScope ASR 未配置。", true, "DASHSCOPE_API_KEY missing");
  }

  const audio = await fs.readFile(input.audioPath);
  const dataUrl = `data:${audioMimeType(input.fields.format)};base64,${audio.toString("base64")}`;
  const startedAt = Date.now();
  const response = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: appConfig.voice.asrModel,
        messages: [
          {
            role: "system",
            content: "你是中文语音转写助手。请只输出用户原话，不要解释。"
          },
          {
            role: "user",
            content: [
              {
                type: "input_audio",
                input_audio: {
                  data: dataUrl,
                  format: input.fields.format
                }
              }
            ]
          }
        ],
        asr_options: {
          language: input.fields.locale === "zh-CN" ? "zh" : input.fields.locale,
          enable_itn: true
        }
      })
    },
    appConfig.voice.asrTimeoutMs
  );

  const responseBody = await response.text();
  if (!response.ok) {
    throw voiceError("ASR_FAILED", "DashScope ASR 调用失败。", true, responseBody);
  }

  let parsed: DashScopeAsrResponse;
  try {
    parsed = JSON.parse(responseBody) as DashScopeAsrResponse;
  } catch {
    throw voiceError("ASR_FAILED", "DashScope ASR 返回格式不合法。", true);
  }

  const transcript = extractTranscript(parsed);
  if (!transcript) {
    throw voiceError("ASR_FAILED", "DashScope ASR 未返回有效文本。", true);
  }

  return {
    transcript,
    confidence: 0.98,
    durationMs: Date.now() - startedAt,
    provider: "dashscope",
    rawProviderRequestId: parsed.request_id ?? parsed.id
  };
}

function extractTranscript(response: DashScopeAsrResponse): string {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content.map((item) => item.text ?? "").join("").trim();
  }
  return "";
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
      throw voiceError("ASR_FAILED", "DashScope ASR 调用超时。", true);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function voiceError(code: "ASR_FAILED", message: string, retryable: boolean, providerMessage?: string) {
  return new ApiError({
    statusCode: 502,
    code,
    message,
    retryable,
    details: providerMessage ? { providerMessage } : {}
  });
}
