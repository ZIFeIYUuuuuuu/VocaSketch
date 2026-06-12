import assert from "node:assert/strict";

import { interpretCommand } from "./parser.js";
import { commandInterpretationSchema } from "./schemas/commandSchemas.js";

const baseRequest = {
  sessionId: "sess_test",
  projectId: "proj_test",
  currentState: { drawProgress: 0 }
};

const shortCreate = parse("画一个蓝色长发女生");
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

const fullCreate = parse("画一个蓝色长发的二次元女生半身头像，水彩素描风");
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

const eyeEdit = parse("把眼睛改成紫色");
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

const glasses = parse("戴上一副红框大圆眼镜");
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

const shyExpression = parse("表情换成害羞，再添加红彤彤的腮红");
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

const pinkHair = parse("把头发改成粉红色吧");
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

const pause = parse("暂停");
assert.equal(pause.intent, "control");
assert.equal(pause.requiresConfirmation, false);
assert.deepEqual(pause.operations, [{ type: "pause" }]);
assert.deepEqual(pause.affectedLayers, []);

const resume = parse("继续");
assert.equal(resume.intent, "control");
assert.deepEqual(resume.operations, [{ type: "resume" }]);

const undo = parse("撤销");
assert.equal(undo.intent, "control");
assert.deepEqual(undo.operations, [{ type: "undo" }]);

const redo = parse("重做");
assert.equal(redo.intent, "control");
assert.deepEqual(redo.operations, [{ type: "redo" }]);

const replay = parse("回放");
assert.equal(replay.intent, "control");
assert.deepEqual(replay.operations, [{ type: "replay" }]);

const exportCommand = parse("导出");
assert.equal(exportCommand.intent, "control");
assert.deepEqual(exportCommand.operations, [{ type: "export" }]);

const ambiguous = parse("这个颜色怪怪的，调一下");
assert.equal(ambiguous.intent, "clarify");
assert.equal(ambiguous.requiresConfirmation, false);
assert.equal(ambiguous.needsClarification, true);
assert.equal(ambiguous.confidence, 0.52);
assert.deepEqual(ambiguous.operations, []);
assert.equal(ambiguous.clarificationQuestion, "你想调整头发、眼睛、衣服，还是背景？");
assert.equal(ambiguous.aiReplyText, ambiguous.clarificationQuestion);

console.log("parser tests passed");

function parse(text: string) {
  const result = interpretCommand({
    ...baseRequest,
    text
  });
  return commandInterpretationSchema.parse(result);
}
