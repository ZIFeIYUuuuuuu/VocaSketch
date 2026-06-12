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

  const sessionFile = path.join(storageDir, "sessions", `${session.body.sessionId}.json`);
  const projectFile = path.join(storageDir, "projects", `${project.body.projectId}.json`);
  await fs.access(sessionFile);
  await fs.access(projectFile);

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
