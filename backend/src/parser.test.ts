import assert from "node:assert/strict";

import { interpretCommand } from "./parser.js";

const createResult = interpretCommand({
  sessionId: "sess_test",
  projectId: "proj_test",
  text: "画一个蓝色长发的女生头像，水彩风格",
  currentState: { drawProgress: 0 }
});

assert.equal(createResult.intent, "create_avatar");
assert.equal(createResult.requiresConfirmation, true);
assert.equal(createResult.traitPatch?.hairColor, "blue");
assert.equal(createResult.traitPatch?.hairLength, "long");
assert.equal(createResult.traitPatch?.gender, "female");
assert.equal(createResult.traitPatch?.backgroundStyle, "watercolor");
assert.equal(createResult.operations.length, 2);

const pauseResult = interpretCommand({
  sessionId: "sess_test",
  projectId: "proj_test",
  text: "暂停"
});

assert.equal(pauseResult.intent, "control");
assert.equal(pauseResult.requiresConfirmation, false);
assert.deepEqual(pauseResult.operations, [{ type: "pause" }]);

console.log("parser tests passed");
