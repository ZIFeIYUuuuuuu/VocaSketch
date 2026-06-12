import assert from "node:assert/strict";

import { interpretCommand } from "./parser.js";
import { interpretWithLocalRules } from "./parser/localRuleParser.js";
import { commandInterpretationSchema } from "./schemas/commandSchemas.js";

const baseRequest = {
  sessionId: "sess_test",
  projectId: "proj_test",
  currentState: { drawProgress: 0 }
};

const shortCreate = parseLocal("画一个蓝色长发女生");
assert.equal(shortCreate.intent, "create_avatar");
assert.equal(shortCreate.requiresConfirmation, true);
assert.equal(shortCreate.traitPatch?.gender, "female");
assert.equal(shortCreate.traitPatch?.hairLength, "long");
assert.equal(shortCreate.traitPatch?.hairColor, "blue");
assert.deepEqual(shortCreate.operations, [
  {
    type: "set_character",
    patch: {
      gender: "female",
      hairLength: "long",
      hairColor: "blue"
    }
  },
  {
    type: "start_auto_painting",
    fromProgress: 0
  }
]);

const fullCreate = parseLocal("画一个蓝色长发的二次元女生半身头像，水彩素描风");
assert.equal(fullCreate.intent, "create_avatar");
assert.equal(fullCreate.traitPatch?.gender, "female");
assert.equal(fullCreate.traitPatch?.hairLength, "long");
assert.equal(fullCreate.traitPatch?.hairColor, "blue");
assert.equal(fullCreate.traitPatch?.backgroundStyle, "watercolor");
assert.deepEqual(fullCreate.affectedLayers, [
  "layer-sketch",
  "layer-lineart",
  "layer-flats",
  "layer-watercolor",
  "layer-details",
  "layer-bg"
]);

const eyeEdit = parseLocal("把眼睛改成紫色");
assert.equal(eyeEdit.intent, "edit_traits");
assert.equal(eyeEdit.requiresConfirmation, true);
assert.equal(eyeEdit.traitPatch?.eyeColor, "purple");
assert.deepEqual(eyeEdit.operations, [
  {
    type: "redraw_component",
    target: "eyes",
    patch: {
      eyeColor: "purple"
    }
  }
]);
assert.deepEqual(eyeEdit.affectedLayers, ["layer-details"]);

const glasses = parseLocal("戴上一副红框大圆眼镜");
assert.equal(glasses.intent, "add_accessory");
assert.equal(glasses.traitPatch?.accessory, "glasses");
assert.deepEqual(glasses.operations, [
  {
    type: "redraw_component",
    target: "accessory",
    patch: {
      accessory: "glasses"
    }
  }
]);

const shyExpression = parseLocal("表情换成害羞，再添加红彤彤的腮红");
assert.equal(shyExpression.intent, "edit_traits");
assert.equal(shyExpression.traitPatch?.expression, "害羞");
assert.deepEqual(shyExpression.operations, [
  {
    type: "redraw_component",
    target: "expression",
    patch: {
      expression: "害羞"
    }
  }
]);

const pinkHair = parseLocal("把头发改成粉红色吧");
assert.equal(pinkHair.intent, "edit_traits");
assert.equal(pinkHair.traitPatch?.hairColor, "pink");
assert.deepEqual(pinkHair.operations, [
  {
    type: "redraw_component",
    target: "hair",
    patch: {
      hairColor: "pink"
    }
  }
]);

const pause = parseLocal("暂停");
assert.equal(pause.intent, "control");
assert.equal(pause.requiresConfirmation, false);
assert.deepEqual(pause.operations, [{ type: "pause" }]);
assert.deepEqual(pause.affectedLayers, []);

const resume = parseLocal("继续");
assert.equal(resume.intent, "control");
assert.deepEqual(resume.operations, [{ type: "resume" }]);

const undo = parseLocal("撤销");
assert.equal(undo.intent, "control");
assert.deepEqual(undo.operations, [{ type: "undo" }]);

const redo = parseLocal("重做");
assert.equal(redo.intent, "control");
assert.deepEqual(redo.operations, [{ type: "redo" }]);

const replay = parseLocal("回放");
assert.equal(replay.intent, "control");
assert.deepEqual(replay.operations, [{ type: "replay" }]);

const exportCommand = parseLocal("导出");
assert.equal(exportCommand.intent, "control");
assert.deepEqual(exportCommand.operations, [{ type: "export" }]);

const ambiguous = parseLocal("这个颜色怪怪的，调一下");
assert.equal(ambiguous.intent, "clarify");
assert.equal(ambiguous.requiresConfirmation, false);
assert.equal(ambiguous.needsClarification, true);
assert.equal(ambiguous.confidence, 0.52);
assert.deepEqual(ambiguous.operations, []);
assert.equal(ambiguous.clarificationQuestion, "你想调整头发、眼睛、衣服，还是背景？");
assert.equal(ambiguous.aiReplyText, ambiguous.clarificationQuestion);

let fetchCalls = 0;
const localOnly = await interpretCommand(
  {
    ...baseRequest,
    text: "画一个蓝色长发女生"
  },
  {
    provider: "local",
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("should not call remote");
    }
  }
);
assert.equal(localOnly.costHint?.provider, "local-rule-parser");
assert.equal(fetchCalls, 0);

const remote = await parseWithRemote(
  "画一个蓝色长发女生，在背景加粉色花瓣，眼睛像星空一样闪",
  validRemoteBody({
    normalizedText: "创建蓝色长发女生半身头像，背景有粉色花瓣和星空眼睛",
    intent: "create_avatar",
    traitPatch: {
      gender: "female",
      hairLength: "long",
      hairColor: "blue",
      eyeColor: "purple",
      backgroundStyle: "cherry"
    },
    operations: [
      {
        type: "set_character",
        patch: {
          gender: "female",
          hairLength: "long",
          hairColor: "blue",
          eyeColor: "purple",
          backgroundStyle: "cherry"
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
  })
);
assert.equal(remote.intent, "create_avatar");
assert.equal(remote.costHint?.provider, "openai-compatible");
assert.equal(remote.costHint?.parserTokensIn, 123);
assert.equal(remote.costHint?.parserTokensOut, 80);
assert.equal(remote.traitPatch?.backgroundStyle, "cherry");

let firstPayload: any;
await interpretCommand(
  {
    ...baseRequest,
    text: "把眼睛改成紫色"
  },
  {
    provider: "openai-compatible",
    config: providerConfig(),
    fetchImpl: async (_url, init) => {
      firstPayload = JSON.parse(String(init?.body));
      return mockJsonResponse(
        chatResponse(
          JSON.stringify({
            normalizedText: "调整紫色眼睛",
            intent: "edit_traits",
            confidence: 0.91,
            requiresConfirmation: true,
            needsClarification: false,
            aiReplyText: "我会把眼睛改成紫色，确认修改吗？",
            traitPatch: { eyeColor: "purple" },
            operations: [{ type: "redraw_component", target: "eyes", patch: { eyeColor: "purple" } }],
            affectedLayers: ["layer-details"]
          })
        )
      );
    }
  }
);
assert.equal(firstPayload.response_format.type, "json_schema");
assert.equal(firstPayload.response_format.json_schema.strict, true);
assert.equal(firstPayload.response_format.json_schema.schema.properties.operations.type, "array");

const responseFormatModes: Array<string | undefined> = [];
const downgraded = await interpretCommand(
  {
    ...baseRequest,
    text: "把眼睛改成紫色"
  },
  {
    provider: "openai-compatible",
    config: providerConfig(),
    fetchImpl: async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      responseFormatModes.push(payload.response_format?.type);
      if (payload.response_format?.type === "json_schema") {
        return mockJsonResponse(
          {
            error: {
              message: "response_format json_schema unsupported"
            }
          },
          400
        );
      }
      return mockJsonResponse(
        chatResponse(
          JSON.stringify({
            normalizedText: "调整紫色眼睛",
            intent: "edit_traits",
            confidence: 0.91,
            requiresConfirmation: true,
            needsClarification: false,
            aiReplyText: "我会把眼睛改成紫色，确认修改吗？",
            traitPatch: { eyeColor: "purple" },
            operations: [{ type: "redraw_component", target: "eyes", patch: { eyeColor: "purple" } }],
            affectedLayers: ["layer-details"]
          })
        )
      );
    }
  }
);
assert.deepEqual(responseFormatModes, ["json_schema", "json_object"]);
assert.equal(downgraded.costHint?.provider, "openai-compatible");

const fenced = await parseWithRemote(
  "把眼睛改成紫色",
  chatResponse(`\`\`\`json\n${JSON.stringify({
    normalizedText: "调整紫色眼睛",
    intent: "edit_traits",
    confidence: 0.91,
    requiresConfirmation: true,
    needsClarification: false,
    aiReplyText: "我会把眼睛改成紫色，确认修改吗？",
    traitPatch: { eyeColor: "purple" },
    operations: [{ type: "redraw_component", target: "eyes", patch: { eyeColor: "purple" } }],
    affectedLayers: ["layer-details"]
  })}\n\`\`\``)
);
assert.equal(fenced.intent, "edit_traits");
assert.equal(fenced.traitPatch?.eyeColor, "purple");

const invalidJsonFallback = await parseWithRemote("把眼睛改成紫色", chatResponse("not json"));
assert.equal(invalidJsonFallback.costHint?.provider, "local-rule-parser");
assert.equal(invalidJsonFallback.traitPatch?.eyeColor, "purple");

const schemaInvalidFallback = await parseWithRemote(
  "把眼睛改成紫色",
  chatResponse(JSON.stringify({ intent: "edit_traits" }))
);
assert.equal(schemaInvalidFallback.costHint?.provider, "local-rule-parser");
assert.equal(schemaInvalidFallback.traitPatch?.eyeColor, "purple");

let controlFetchCalls = 0;
const controlViaAdapter = await interpretCommand(
  {
    ...baseRequest,
    text: "暂停"
  },
  {
    provider: "openai-compatible",
    config: providerConfig(),
    fetchImpl: async () => {
      controlFetchCalls += 1;
      return mockJsonResponse(chatResponse("{}"));
    }
  }
);
assert.equal(controlViaAdapter.intent, "control");
assert.equal(controlFetchCalls, 0);

console.log("parser tests passed");

function parseLocal(text: string) {
  const result = interpretWithLocalRules({
    ...baseRequest,
    text
  });
  return commandInterpretationSchema.parse(result);
}

async function parseWithRemote(text: string, responseBody: unknown) {
  const result = await interpretCommand(
    {
      ...baseRequest,
      text
    },
    {
      provider: "openai-compatible",
      config: providerConfig(),
      fetchImpl: async () => mockJsonResponse(responseBody)
    }
  );
  return commandInterpretationSchema.parse(result);
}

function validRemoteBody(body: Record<string, unknown>) {
  return chatResponse(
    JSON.stringify({
      confidence: 0.94,
      requiresConfirmation: true,
      needsClarification: false,
      aiReplyText: "我会绘制这个二次元半身头像，确认开始吗？",
      ...body
    })
  );
}

function chatResponse(content: string) {
  return {
    choices: [
      {
        message: {
          content
        }
      }
    ],
    usage: {
      prompt_tokens: 123,
      completion_tokens: 80
    }
  };
}

function providerConfig() {
  return {
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    model: "test-model"
  };
}

function mockJsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
