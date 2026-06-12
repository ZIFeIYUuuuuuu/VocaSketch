import { appConfig } from "../config.js";
import {
  commandInterpretationSchema,
  type CommandInterpretation
} from "../schemas/commandSchemas.js";
import { makeId } from "../storage/ids.js";
import {
  buildParserUserPrompt,
  commandInterpretationOutputJsonSchema,
  parserSystemPrompt
} from "./parserPrompt.js";
import type { InterpretRequest } from "./localRuleParser.js";

export class ParserProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export interface OpenAICompatibleParserOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  config?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export async function interpretWithOpenAICompatible(
  request: InterpretRequest,
  options: OpenAICompatibleParserOptions = {}
): Promise<CommandInterpretation> {
  const provider = options.config ?? appConfig.providers.openAICompatible;
  if (!provider.apiKey || !provider.baseUrl || !provider.model) {
    throw new ParserProviderError("PARSER_PROVIDER_MISSING", "OpenAI-compatible parser is not configured.");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? appConfig.parser.timeoutMs;
  const startedAt = Date.now();
  const endpoint = normalizeChatCompletionsUrl(provider.baseUrl);

  try {
    const response = await postChatCompletion(
      fetchImpl,
      endpoint,
      provider.apiKey,
      buildChatPayload(request, provider.model, "json_schema"),
      timeoutMs
    );
    return parseProviderResponse(response, request, Date.now() - startedAt);
  } catch (error) {
    if (shouldRetryWithoutResponseFormat(error, "json_schema")) {
      try {
        const retryResponse = await postChatCompletion(
          fetchImpl,
          endpoint,
          provider.apiKey,
          buildChatPayload(request, provider.model, "json_object"),
          timeoutMs
        );
        return parseProviderResponse(retryResponse, request, Date.now() - startedAt);
      } catch (jsonObjectError) {
        if (shouldRetryWithoutResponseFormat(jsonObjectError, "json_object")) {
          const unformattedResponse = await postChatCompletion(
            fetchImpl,
            endpoint,
            provider.apiKey,
            buildChatPayload(request, provider.model, "none"),
            timeoutMs
          );
          return parseProviderResponse(unformattedResponse, request, Date.now() - startedAt);
        }
        throw normalizeProviderError(jsonObjectError);
      }
    }

    if (shouldRetryWithoutResponseFormat(error, "json_object")) {
      const retryResponse = await postChatCompletion(
        fetchImpl,
        endpoint,
        provider.apiKey,
        buildChatPayload(request, provider.model, "none"),
        timeoutMs
      );
      return parseProviderResponse(retryResponse, request, Date.now() - startedAt);
    }

    throw normalizeProviderError(error);
  }
}

export function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

type ResponseFormatMode = "json_schema" | "json_object" | "none";

function buildChatPayload(request: InterpretRequest, model: string, responseFormatMode: ResponseFormatMode) {
  const text = (request.text ?? "").trim();
  const sessionId = request.sessionId ?? "sess_demo";
  const projectId = request.projectId ?? "proj_demo";
  const drawProgress = request.currentState?.drawProgress ?? 0;

  return {
    model,
    messages: [
      {
        role: "system",
        content: parserSystemPrompt
      },
      {
        role: "user",
        content: buildParserUserPrompt({
          text,
          sessionId,
          projectId,
          drawProgress
        })
      }
    ],
    temperature: 0.1,
    ...(responseFormatMode === "json_schema"
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "vocasketch_command_interpretation",
              strict: true,
              schema: commandInterpretationOutputJsonSchema
            }
          }
        }
      : {}),
    ...(responseFormatMode === "json_object" ? { response_format: { type: "json_object" } } : {})
  };
}

async function postChatCompletion(
  fetchImpl: typeof fetch,
  endpoint: string,
  apiKey: string,
  payload: unknown,
  timeoutMs: number
): Promise<ChatCompletionResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const responseText = await response.text();
    if (!response.ok) {
      throw new ParserProviderError("PARSER_PROVIDER_HTTP_ERROR", `Provider returned ${response.status}.`, {
        status: response.status,
        responseText
      });
    }

    try {
      return JSON.parse(responseText) as ChatCompletionResponse;
    } catch {
      throw new ParserProviderError("PARSER_PROVIDER_BAD_RESPONSE", "Provider response was not JSON.", {
        responseText
      });
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw new ParserProviderError("PARSER_TIMEOUT", `Parser provider timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function parseProviderResponse(
  response: ChatCompletionResponse,
  request: InterpretRequest,
  latencyMs: number
): CommandInterpretation {
  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new ParserProviderError("PARSER_EMPTY_RESPONSE", "Provider returned no message content.");
  }

  const parsedJson = extractJsonObject(content);
  if (!isJsonObject(parsedJson)) {
    throw new ParserProviderError("PARSER_BAD_JSON", "Provider output was not a JSON object.");
  }
  const normalized = {
    interpretationId: makeId("interp"),
    sessionId: request.sessionId ?? "sess_demo",
    projectId: request.projectId ?? "proj_demo",
    transcript: (request.text ?? "").trim(),
    ...parsedJson,
    costHint: {
      provider: "openai-compatible",
      cacheHit: false,
      parserTokensIn: response.usage?.prompt_tokens,
      parserTokensOut: response.usage?.completion_tokens
    }
  };

  const parsed = commandInterpretationSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ParserProviderError("PARSER_SCHEMA_INVALID", "Provider output failed schema validation.", {
      issues: parsed.error.issues
    });
  }

  return {
    ...parsed.data,
    costHint: {
      ...parsed.data.costHint,
      provider: "openai-compatible",
      cacheHit: false,
      parserTokensIn: response.usage?.prompt_tokens,
      parserTokensOut: response.usage?.completion_tokens
    }
  };
}

export function extractJsonObject(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced?.[1] ?? content;
  const direct = tryParseJson(source);
  if (direct) return direct;

  const start = source.indexOf("{");
  if (start < 0) {
    throw new ParserProviderError("PARSER_BAD_JSON", "Provider output did not contain a JSON object.");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const candidate = source.slice(start, index + 1);
        const parsed = tryParseJson(candidate);
        if (parsed) return parsed;
      }
    }
  }

  throw new ParserProviderError("PARSER_BAD_JSON", "Provider output JSON extraction failed.");
}

function tryParseJson(source: string): unknown | null {
  try {
    const parsed = JSON.parse(source.trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function shouldRetryWithoutResponseFormat(error: unknown, mode: ResponseFormatMode): boolean {
  if (!(error instanceof ParserProviderError)) return false;
  const responseText = String(error.details.responseText ?? "");
  const formatPattern = mode === "json_schema" ? /response_format|json_schema|structured/i : /response_format|json_object/i;
  return formatPattern.test(responseText) && /unsupported|not support|invalid|unknown/i.test(responseText);
}

function normalizeProviderError(error: unknown): ParserProviderError {
  if (error instanceof ParserProviderError) {
    return error;
  }

  return new ParserProviderError("PARSER_PROVIDER_FAILED", error instanceof Error ? error.message : "Provider failed.");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
