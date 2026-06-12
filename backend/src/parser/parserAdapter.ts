import { appConfig } from "../config.js";
import { commandInterpretationSchema, type CommandInterpretation } from "../schemas/commandSchemas.js";
import { interpretWithLocalRules, type InterpretRequest } from "./localRuleParser.js";
import {
  interpretWithOpenAICompatible,
  type OpenAICompatibleParserOptions,
  type ParserProviderError
} from "./openAICompatibleParser.js";
import { logLocalParser, logParserCost } from "./parserCostLog.js";

export interface ParserAdapterOptions extends OpenAICompatibleParserOptions {
  provider?: "auto" | "local" | "openai-compatible";
}

export async function interpretCommand(
  request: InterpretRequest,
  options: ParserAdapterOptions = {}
): Promise<CommandInterpretation> {
  const text = (request.text ?? "").trim();
  const startedAt = Date.now();

  const provider = options.provider ?? appConfig.parser.provider;

  if (isControlCommand(text) || provider === "local" || !isOpenAICompatibleConfigured(options)) {
    const local = parseWithValidatedLocalRules(request);
    await logLocalParser({
      startedAt,
      textLength: text.length,
      intent: local.intent
    });
    return local;
  }

  try {
    const remote = await interpretWithOpenAICompatible(request, options);
    await logParserCost({
      provider: "openai-compatible",
      model: options.config?.model ?? appConfig.providers.openAICompatible.model,
      latencyMs: Date.now() - startedAt,
      fallbackUsed: false,
      parserTokensIn: remote.costHint?.parserTokensIn,
      parserTokensOut: remote.costHint?.parserTokensOut,
      textLength: text.length,
      intent: remote.intent
    });
    return remote;
  } catch (error) {
    const fallbackReason = fallbackCode(error);
    const local = parseWithValidatedLocalRules(request);
    await logLocalParser({
      startedAt,
      textLength: text.length,
      intent: local.intent,
      fallbackUsed: true,
      fallbackReason
    });
    return local;
  }
}

export function parseWithValidatedLocalRules(request: InterpretRequest): CommandInterpretation {
  const local = interpretWithLocalRules(request);
  return commandInterpretationSchema.parse(local);
}

export function isControlCommand(text: string): boolean {
  return /暂停|停一下|先停|继续|接着|恢复|撤销|撤消|上一步|退回|重做|恢复下一步|恢复刚才|前进|回放|重新放|重演|重播|导出|保存图片|下载|导出作品/.test(
    text
  );
}

function isOpenAICompatibleConfigured(options: ParserAdapterOptions): boolean {
  const provider = options.config ?? appConfig.providers.openAICompatible;
  return Boolean(
    provider.apiKey &&
      provider.baseUrl &&
      provider.model
  );
}

function fallbackCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as ParserProviderError).code);
  }
  return error instanceof Error ? error.message : "PARSER_PROVIDER_FAILED";
}
