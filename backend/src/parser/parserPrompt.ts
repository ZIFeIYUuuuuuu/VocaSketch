export const commandInterpretationOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    normalizedText: { type: "string" },
    intent: {
      type: "string",
      enum: [
        "create_avatar",
        "edit_traits",
        "add_accessory",
        "remove_accessory",
        "control",
        "clarify",
        "smalltalk",
        "unknown"
      ]
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    requiresConfirmation: { type: "boolean" },
    needsClarification: { type: "boolean" },
    aiReplyText: { type: "string" },
    clarificationQuestion: { type: "string" },
    traitPatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        gender: { type: "string", enum: ["female", "male", "neutral"] },
        hairLength: { type: "string", enum: ["long", "short", "medium"] },
        hairColor: { type: "string" },
        eyeColor: { type: "string" },
        expression: { type: "string", enum: ["微笑", "害羞", "冷淡", "惊讶"] },
        outfit: { type: "string", enum: ["school", "hoodie", "shirt"] },
        accessory: { type: "string", enum: ["butterfly_knot", "glasses", "none"] },
        backgroundStyle: { type: "string", enum: ["gradient", "watercolor", "stars", "cherry"] }
      }
    },
    operations: {
      type: "array",
      items: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "set_character" },
              patch: { $ref: "#/properties/traitPatch" }
            },
            required: ["type", "patch"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "start_auto_painting" },
              fromProgress: { type: "number", minimum: 0, maximum: 100 }
            },
            required: ["type"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "start_stage_painting" },
              fromStage: {
                type: "string",
                enum: ["未开始", "草图阶段", "线稿阶段", "铺色阶段", "水彩晕染", "细节刻画", "已完成"]
              }
            },
            required: ["type"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "redraw_component" },
              target: {
                type: "string",
                enum: ["hair", "eyes", "expression", "outfit", "accessory", "background"]
              },
              patch: { $ref: "#/properties/traitPatch" }
            },
            required: ["type", "target", "patch"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "set_layer_visibility" },
              layerId: { type: "string" },
              visible: { type: "boolean" }
            },
            required: ["type", "layerId", "visible"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { const: "set_layer_opacity" },
              layerId: { type: "string" },
              opacity: { type: "number", minimum: 0, maximum: 1 }
            },
            required: ["type", "layerId", "opacity"]
          },
          {
            type: "object",
            additionalProperties: false,
            properties: {
              type: { enum: ["pause", "resume", "undo", "redo", "replay", "export"] }
            },
            required: ["type"]
          }
        ]
      }
    },
    affectedLayers: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "normalizedText",
    "intent",
    "confidence",
    "requiresConfirmation",
    "needsClarification",
    "aiReplyText",
    "operations",
    "affectedLayers"
  ]
} as const;

export const parserSystemPrompt = `
你是 VocaSketch 的语音绘图指令编译器。你只能把中文自然语言转换成结构化绘图操作 JSON。
最终画面由前端 Canvas/SVG 分层绘制，不允许输出生图 prompt、图片 URL、Markdown 或无法执行的自由文本。
你不是生图模型，不要调用任何外部工具，不要输出 API key 或 Authorization 信息。

输出必须是一个 JSON object，字段必须符合 CommandInterpretation：
- normalizedText: string
- intent: "create_avatar" | "edit_traits" | "add_accessory" | "remove_accessory" | "control" | "clarify" | "smalltalk" | "unknown"
- confidence: 0 到 1
- requiresConfirmation: boolean
- needsClarification: boolean
- aiReplyText: string
- clarificationQuestion?: string
- traitPatch?: CharacterConfig 的部分字段
- operations: DrawingOperation[]
- affectedLayers: string[]

后端会补充 interpretationId、sessionId、projectId、transcript、costHint，你不要输出这些字段也可以。

MVP 范围：二次元半身头像、水彩上色、素描线稿。复杂创建描述要拆成 set_character + start_auto_painting。
局部修改输出 redraw_component。用户说不清楚时 intent=clarify，operations=[]。
修改类指令 requiresConfirmation=true。控制类指令 pause/resume/undo/redo/replay/export requiresConfirmation=false。

CharacterConfig:
gender: "female" | "male" | "neutral"
hairLength: "long" | "short" | "medium"
hairColor: string
eyeColor: string
expression: "微笑" | "害羞" | "冷淡" | "惊讶"
outfit: "school" | "hoodie" | "shirt"
accessory: "butterfly_knot" | "glasses" | "none"
backgroundStyle: "gradient" | "watercolor" | "stars" | "cherry"

DrawingOperation:
{ "type": "set_character", "patch": Partial<CharacterConfig> }
{ "type": "start_auto_painting", "fromProgress"?: number }
{ "type": "start_stage_painting", "fromStage"?: DrawStage }
{ "type": "redraw_component", "target": "hair" | "eyes" | "expression" | "outfit" | "accessory" | "background", "patch": Partial<CharacterConfig> }
{ "type": "set_layer_visibility", "layerId": string, "visible": boolean }
{ "type": "set_layer_opacity", "layerId": string, "opacity": number }
{ "type": "pause" | "resume" | "undo" | "redo" | "replay" | "export" }

图层 ID：
layer-sketch, layer-lineart, layer-flats, layer-watercolor, layer-details, layer-bg

只输出 JSON object，不要 Markdown。
`.trim();

export function buildParserUserPrompt(input: {
  text: string;
  sessionId: string;
  projectId: string;
  drawProgress: number;
}) {
  return JSON.stringify(
    {
      task: "把用户中文绘图指令解析为 VocaSketch CommandInterpretation JSON。",
      sessionId: input.sessionId,
      projectId: input.projectId,
      transcript: input.text,
      currentState: {
        drawProgress: input.drawProgress
      },
      outputJsonSchema: commandInterpretationOutputJsonSchema,
      outputExample: {
        normalizedText: "创建蓝色长发女生半身头像，水彩素描风",
        intent: "create_avatar",
        confidence: 0.94,
        requiresConfirmation: true,
        needsClarification: false,
        aiReplyText: "我会绘制蓝色长发的二次元女生半身头像，使用水彩上色和素描线稿。确认开始吗？",
        traitPatch: {
          gender: "female",
          hairLength: "long",
          hairColor: "blue",
          backgroundStyle: "watercolor"
        },
        operations: [
          {
            type: "set_character",
            patch: {
              gender: "female",
              hairLength: "long",
              hairColor: "blue",
              backgroundStyle: "watercolor"
            }
          },
          {
            type: "start_auto_painting",
            fromProgress: 0
          }
        ],
        affectedLayers: [
          "layer-sketch",
          "layer-lineart",
          "layer-flats",
          "layer-watercolor",
          "layer-details",
          "layer-bg"
        ]
      }
    },
    null,
    2
  );
}
