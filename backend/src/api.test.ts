import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "vocasketch-api-test-"));
process.env.APP_STORAGE_DIR = storageDir;
process.env.PORT = "0";

const { createApp } = await import("./app.js");
const { ensureStorageReady } = await import("./storage/fileStore.js");

await ensureStorageReady();

const app = createApp();
const server = app.listen(0);

try {
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;

  const session = await request(baseUrl, "/sessions", {
    method: "POST",
    body: {
      clientId: "api-test-browser",
      locale: "zh-CN"
    }
  });

  assert.equal(session.status, 201);
  assert.match(session.body.sessionId, /^sess_/);

  const missingSession = await request(baseUrl, "/projects", {
    method: "POST",
    body: {
      sessionId: "sess_missing"
    }
  });

  assert.equal(missingSession.status, 404);
  assert.equal(missingSession.body.error.code, "SESSION_NOT_FOUND");

  const project = await request(baseUrl, "/projects", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      title: "API 测试头像",
      initialConfig: {
        hairColor: "purple"
      }
    }
  });

  assert.equal(project.status, 201);
  assert.match(project.body.projectId, /^proj_/);
  assert.equal(project.body.serverRevision, 1);
  assert.equal(project.body.config.hairColor, "purple");
  assert.equal(project.body.layers.length, 6);

  const readWithoutSession = await request(baseUrl, `/projects/${project.body.projectId}`);
  assert.equal(readWithoutSession.status, 200);
  assert.equal(readWithoutSession.body.projectId, project.body.projectId);
  assert.equal(readWithoutSession.body.historyCount, 0);

  const readWithSession = await request(
    baseUrl,
    `/projects/${project.body.projectId}?sessionId=${session.body.sessionId}`
  );
  assert.equal(readWithSession.status, 200);
  assert.equal(readWithSession.body.sessionId, session.body.sessionId);

  const missingProject = await request(
    baseUrl,
    `/projects/proj_missing?sessionId=${session.body.sessionId}`
  );
  assert.equal(missingProject.status, 404);
  assert.equal(missingProject.body.error.code, "PROJECT_NOT_FOUND");

  const snapshot = await request(baseUrl, `/projects/${project.body.projectId}/snapshot`, {
    method: "PUT",
    body: {
      sessionId: session.body.sessionId,
      config: {
        eyeColor: "green"
      },
      layers: project.body.layers,
      drawProgress: 100,
      currentStage: "已完成",
      canvasObjects: [{ type: "test-object" }],
      clientRevision: project.body.serverRevision
    }
  });

  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.serverRevision, 2);

  const revisionConflict = await request(baseUrl, `/projects/${project.body.projectId}/snapshot`, {
    method: "PUT",
    body: {
      sessionId: session.body.sessionId,
      config: {},
      layers: project.body.layers,
      drawProgress: 100,
      currentStage: "已完成",
      canvasObjects: [],
      clientRevision: project.body.serverRevision
    }
  });

  assert.equal(revisionConflict.status, 409);
  assert.equal(revisionConflict.body.error.code, "REVISION_CONFLICT");
  assert.equal(revisionConflict.body.error.details.serverRevision, 2);

  const interpretation = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      clientCommandId: "cmd_api_test_001",
      text: "把眼睛改成紫色",
      currentState: {
        systemState: "等待指令",
        currentStage: "未开始",
        drawProgress: 0,
        paintMode: "auto",
        config: {},
        layers: []
      }
    }
  });

  assert.equal(interpretation.status, 200);
  assert.match(interpretation.body.interpretationId, /^interp_/);
  assert.equal(interpretation.body.intent, "edit_traits");
  assert.equal(interpretation.body.traitPatch.eyeColor, "purple");
  assert.deepEqual(interpretation.body.operations, [
    {
      type: "redraw_component",
      target: "eyes",
      patch: {
        eyeColor: "purple"
      }
    }
  ]);

  const confirmed = await request(
    baseUrl,
    `/commands/${interpretation.body.interpretationId}/confirm`,
    {
      method: "POST",
      body: {
        sessionId: session.body.sessionId,
        projectId: project.body.projectId,
        confirmed: true,
        confirmationText: "确认",
        currentRevision: snapshot.body.serverRevision
      }
    }
  );

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.confirmed, true);
  assert.deepEqual(confirmed.body.operations, interpretation.body.operations);

  const rejectTarget = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "戴上一副红框大圆眼镜"
    }
  });

  const rejected = await request(baseUrl, `/commands/${rejectTarget.body.interpretationId}/reject`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      reasonText: "不对，取消"
    }
  });

  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.cancelled, true);
  assert.equal(rejected.body.aiReplyText, "好的，我先不执行这次修改。");

  const invalidInterpretRequest = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      text: 42
    }
  });

  assert.equal(invalidInterpretRequest.status, 400);
  assert.equal(invalidInterpretRequest.body.error.code, "REQUEST_INVALID");

  const sessionFile = path.join(storageDir, "sessions", `${session.body.sessionId}.json`);
  const projectFile = path.join(storageDir, "projects", `${project.body.projectId}.json`);
  const interpretationFile = path.join(
    storageDir,
    "interpretations",
    `${interpretation.body.interpretationId}.json`
  );
  await fs.access(sessionFile);
  await fs.access(projectFile);
  await fs.access(interpretationFile);

  console.log("api tests passed");
} finally {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await fs.rm(storageDir, { recursive: true, force: true });
}

async function request(
  baseUrl: string,
  pathName: string,
  options: {
    method?: string;
    body?: unknown;
  } = {}
) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  return {
    status: response.status,
    body: await response.json()
  };
}
