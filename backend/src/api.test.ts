import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), "vocasketch-api-test-"));
process.env.APP_STORAGE_DIR = storageDir;
process.env.PORT = "0";
process.env.DASHSCOPE_API_KEY = "test-dashscope-key";
process.env.DASHSCOPE_ASR_MODEL = "paraformer-realtime-8k-v2";
process.env.PARSER_PROVIDER = "local";

const { createApp } = await import("./app.js");
const { ensureStorageReady } = await import("./storage/fileStore.js");
const { setCommandParserOptionsForTest } = await import("./routes/commands.js");
const { setVoiceFetchForTest } = await import("./routes/voice.js");

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
  assert.equal(readWithoutSession.status, 400);
  assert.equal(readWithoutSession.body.error.code, "REQUEST_INVALID");

  const readWithSession = await request(
    baseUrl,
    `/projects/${project.body.projectId}?sessionId=${session.body.sessionId}`
  );
  assert.equal(readWithSession.status, 200);
  assert.equal(readWithSession.body.sessionId, session.body.sessionId);

  const emptyUndo = await request(baseUrl, `/projects/${project.body.projectId}/undo`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      currentRevision: project.body.serverRevision
    }
  });
  assert.equal(emptyUndo.status, 409);
  assert.equal(emptyUndo.body.error.code, "NO_UNDO_AVAILABLE");

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
      clientRevision: project.body.serverRevision,
      historyMeta: {
        kind: "command",
        transcript: "把眼睛改成绿色",
        aiReplyText: "我会把眼睛改成绿色，确认吗？",
        operations: [
          {
            type: "redraw_component",
            target: "eyes",
            patch: {
              eyeColor: "green"
            }
          }
        ]
      }
    }
  });

  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.serverRevision, 2);
  assert.equal(snapshot.body.historyCount, 1);
  assert.equal(snapshot.body.redoCount, 0);

  const historyList = await request(
    baseUrl,
    `/projects/${project.body.projectId}/history?sessionId=${session.body.sessionId}&limit=10`
  );
  assert.equal(historyList.status, 200);
  assert.equal(historyList.body.undoCount, 1);
  assert.equal(historyList.body.redoCount, 0);
  assert.equal(historyList.body.items.length, 1);
  assert.equal(historyList.body.items[0].kind, "command");
  assert.equal(historyList.body.items[0].transcript, "把眼睛改成绿色");
  assert.equal(historyList.body.items[0].operations[0].target, "eyes");

  const undo = await request(baseUrl, `/projects/${project.body.projectId}/undo`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      currentRevision: snapshot.body.serverRevision
    }
  });
  assert.equal(undo.status, 200);
  assert.equal(undo.body.serverRevision, 3);
  assert.equal(undo.body.config.hairColor, "purple");
  assert.equal(undo.body.config.eyeColor, "blue");
  assert.equal(undo.body.historyCount, 0);
  assert.equal(undo.body.redoCount, 1);

  const noUndoLeft = await request(baseUrl, `/projects/${project.body.projectId}/undo`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      currentRevision: undo.body.serverRevision
    }
  });
  assert.equal(noUndoLeft.status, 409);
  assert.equal(noUndoLeft.body.error.code, "NO_UNDO_AVAILABLE");

  const redo = await request(baseUrl, `/projects/${project.body.projectId}/redo`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      currentRevision: undo.body.serverRevision
    }
  });
  assert.equal(redo.status, 200);
  assert.equal(redo.body.serverRevision, 4);
  assert.equal(redo.body.config.eyeColor, "green");
  assert.equal(redo.body.historyCount, 1);
  assert.equal(redo.body.redoCount, 0);

  const noRedoLeft = await request(baseUrl, `/projects/${project.body.projectId}/redo`, {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      currentRevision: redo.body.serverRevision
    }
  });
  assert.equal(noRedoLeft.status, 409);
  assert.equal(noRedoLeft.body.error.code, "NO_REDO_AVAILABLE");

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
  assert.equal(revisionConflict.body.error.details.serverRevision, 4);

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

  setCommandParserOptionsForTest({
    provider: "openai-compatible",
    config: {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model"
    },
    fetchImpl: async () =>
      mockJsonResponse(
        chatResponse({
          normalizedText: "创建湖蓝长发少女和樱花水彩背景",
          intent: "create_avatar",
          confidence: 0.94,
          requiresConfirmation: true,
          needsClarification: false,
          aiReplyText: "我会绘制湖蓝长发少女和樱花水彩背景，确认开始吗？",
          traitPatch: {
            gender: "female",
            hairLength: "long",
            hairColor: "blue",
            eyeColor: "pink",
            backgroundStyle: "cherry"
          },
          operations: [
            {
              type: "set_character",
              patch: {
                gender: "female",
                hairLength: "long",
                hairColor: "blue",
                eyeColor: "pink",
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
      )
  });

  const remoteInterpretation = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "画一个湖蓝色长发的二次元少女，粉色瞳孔，背景有樱花和淡淡水彩晕染",
      currentState: {
        drawProgress: 0
      }
    }
  });
  assert.equal(remoteInterpretation.status, 200);
  assert.equal(remoteInterpretation.body.intent, "create_avatar");
  assert.equal(remoteInterpretation.body.costHint.provider, "openai-compatible");
  assert.equal(remoteInterpretation.body.traitPatch.eyeColor, "pink");

  setCommandParserOptionsForTest({
    provider: "openai-compatible",
    config: {
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      model: "test-model"
    },
    fetchImpl: async () => mockJsonResponse({ choices: [{ message: { content: "not json" } }] })
  });

  const remoteFallbackInterpretation = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "把眼睛改成紫色"
    }
  });
  assert.equal(remoteFallbackInterpretation.status, 200);
  assert.equal(remoteFallbackInterpretation.body.costHint.provider, "local-rule-parser");
  assert.equal(remoteFallbackInterpretation.body.traitPatch.eyeColor, "purple");

  setCommandParserOptionsForTest(undefined);

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
        currentRevision: redo.body.serverRevision
      }
    }
  );

  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.confirmed, true);
  assert.deepEqual(confirmed.body.operations, interpretation.body.operations);

  const confirmAgain = await request(
    baseUrl,
    `/commands/${interpretation.body.interpretationId}/confirm`,
    {
      method: "POST",
      body: {
        sessionId: session.body.sessionId,
        projectId: project.body.projectId,
        confirmed: true
      }
    }
  );
  assert.equal(confirmAgain.status, 409);
  assert.equal(confirmAgain.body.error.code, "CONFIRMATION_ALREADY_RESOLVED");

  const rejectTarget = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "戴上一副红框大圆眼镜"
    }
  });

  const rejectWithoutSession = await request(
    baseUrl,
    `/commands/${rejectTarget.body.interpretationId}/reject`,
    {
      method: "POST",
      body: {
        reasonText: "不对，取消"
      }
    }
  );
  assert.equal(rejectWithoutSession.status, 400);
  assert.equal(rejectWithoutSession.body.error.code, "REQUEST_INVALID");

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

  const confirmRejected = await request(
    baseUrl,
    `/commands/${rejectTarget.body.interpretationId}/confirm`,
    {
      method: "POST",
      body: {
        sessionId: session.body.sessionId,
        projectId: project.body.projectId,
        confirmed: true
      }
    }
  );
  assert.equal(confirmRejected.status, 409);
  assert.equal(confirmRejected.body.error.code, "CONFIRMATION_ALREADY_RESOLVED");

  const invalidInterpretRequest = await request(baseUrl, "/commands/interpret", {
    method: "POST",
    body: {
      text: 42
    }
  });

  assert.equal(invalidInterpretRequest.status, 400);
  assert.equal(invalidInterpretRequest.body.error.code, "REQUEST_INVALID");

  const asrMissingAudio = await request(baseUrl, "/voice/asr", {
    method: "POST",
    formData: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      locale: "zh-CN",
      format: "webm"
    }
  });
  assert.equal(asrMissingAudio.status, 400);
  assert.equal(asrMissingAudio.body.error.code, "REQUEST_INVALID");

  let blockedVoiceFetchCalls = 0;
  setVoiceFetchForTest(async () => {
    blockedVoiceFetchCalls += 1;
    return mockJsonResponse({});
  });
  const asrSessionMismatch = await request(baseUrl, "/voice/asr", {
    method: "POST",
    formData: {
      sessionId: "sess_missing",
      projectId: project.body.projectId,
      locale: "zh-CN",
      format: "webm",
      audio: new Blob([Buffer.from("fake audio")], { type: "audio/webm" })
    }
  });
  assert.equal(asrSessionMismatch.status, 404);
  assert.equal(asrSessionMismatch.body.error.code, "SESSION_NOT_FOUND");
  assert.equal(blockedVoiceFetchCalls, 0);

  let asrRequestBody: any;
  setVoiceFetchForTest(async (_url, init) => {
    asrRequestBody = JSON.parse(String(init?.body));
    return mockJsonResponse({
      id: "asr_request_001",
      choices: [
        {
          message: {
            content: "画一个蓝色长发女生"
          }
        }
      ]
    });
  });

  const asrSuccess = await request(baseUrl, "/voice/asr", {
    method: "POST",
    formData: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      locale: "zh-CN",
      format: "webm",
      audio: new Blob([Buffer.from("fake audio")], { type: "audio/webm" })
    }
  });
  assert.equal(asrSuccess.status, 200);
  assert.equal(asrSuccess.body.transcript, "画一个蓝色长发女生");
  assert.equal(asrSuccess.body.provider, "dashscope");
  assert.equal(asrRequestBody.model, "paraformer-realtime-8k-v2");
  assert.equal(asrRequestBody.messages[1].role, "user");
  assert.equal(asrRequestBody.messages[1].content.length, 1);
  assert.equal(asrRequestBody.messages[1].content[0].type, "input_audio");
  assert.equal(asrRequestBody.asr_options.language, "zh");
  assert.equal(asrRequestBody.asr_options.enable_itn, true);
  const tmpAudioFiles = await fs.readdir(path.join(storageDir, "audio", "tmp"));
  assert.equal(tmpAudioFiles.length, 0);

  setVoiceFetchForTest(async () => mockJsonResponse({ error: { message: "provider failed" } }, 500));

  const asrProviderFailure = await request(baseUrl, "/voice/asr", {
    method: "POST",
    formData: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      locale: "zh-CN",
      format: "webm",
      audio: new Blob([Buffer.from("fake audio")], { type: "audio/webm" })
    }
  });
  assert.equal(asrProviderFailure.status, 502);
  assert.equal(asrProviderFailure.body.error.code, "ASR_FAILED");

  const ttsMissingText = await request(baseUrl, "/voice/tts", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId
    }
  });
  assert.equal(ttsMissingText.status, 400);
  assert.equal(ttsMissingText.body.error.code, "REQUEST_INVALID");

  let ttsRequestBody: any;
  setVoiceFetchForTest(async (url, init) => {
    if (String(url).includes("multimodal-generation")) {
      ttsRequestBody = JSON.parse(String(init?.body));
      return mockJsonResponse({
        request_id: "tts_request_001",
        output: {
          audio: {
            url: "https://example.test/tts.wav"
          }
        }
      });
    }
    return new Response(Buffer.from("RIFFfakewav"), {
      status: 200,
      headers: {
        "content-type": "audio/wav"
      }
    });
  });

  const ttsSuccess = await request(baseUrl, "/voice/tts", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "我会绘制蓝色长发女生头像，确认开始吗？",
      voice: "gentle_female",
      format: "mp3"
    }
  });
  assert.equal(ttsSuccess.status, 200);
  assert.equal(ttsSuccess.body.provider, "dashscope");
  assert.equal(ttsSuccess.body.mimeType, "audio/wav");
  assert.match(ttsSuccess.body.audioUrl, /\.wav$/);
  assert.equal(ttsRequestBody.model, "qwen3-tts-flash");
  assert.equal(ttsRequestBody.input.language_type, "Chinese");
  assert.equal("parameters" in ttsRequestBody, false);

  const ttsAsset = await fetch(`${baseUrl}${ttsSuccess.body.audioUrl.replace("/api/v1", "")}`);
  assert.equal(ttsAsset.status, 200);
  assert.equal(ttsAsset.headers.get("content-type"), "audio/wav");

  setVoiceFetchForTest(async () => mockJsonResponse({ error: { message: "provider failed" } }, 500));

  blockedVoiceFetchCalls = 0;
  setVoiceFetchForTest(async () => {
    blockedVoiceFetchCalls += 1;
    return mockJsonResponse({});
  });
  const ttsSessionMismatch = await request(baseUrl, "/voice/tts", {
    method: "POST",
    body: {
      sessionId: "sess_missing",
      projectId: project.body.projectId,
      text: "测试语音",
      voice: "gentle_female",
      format: "mp3"
    }
  });
  assert.equal(ttsSessionMismatch.status, 404);
  assert.equal(ttsSessionMismatch.body.error.code, "SESSION_NOT_FOUND");
  assert.equal(blockedVoiceFetchCalls, 0);

  setVoiceFetchForTest(async () => mockJsonResponse({ error: { message: "provider failed" } }, 500));

  const ttsProviderFailure = await request(baseUrl, "/voice/tts", {
    method: "POST",
    body: {
      sessionId: session.body.sessionId,
      projectId: project.body.projectId,
      text: "我会绘制蓝色长发女生头像，确认开始吗？",
      voice: "gentle_female",
      format: "mp3"
    }
  });
  assert.equal(ttsProviderFailure.status, 502);
  assert.equal(ttsProviderFailure.body.error.code, "TTS_FAILED");
  setVoiceFetchForTest(undefined);

  const traversalAsset = await request(baseUrl, "/assets/audio/..%2Fsecret.mp3");
  assert.equal(traversalAsset.status, 400);
  assert.equal(traversalAsset.body.error.code, "REQUEST_INVALID");

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

function chatResponse(content: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content)
        }
      }
    ],
    usage: {
      prompt_tokens: 111,
      completion_tokens: 77
    }
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

async function request(
  baseUrl: string,
  pathName: string,
  options: {
    method?: string;
    body?: unknown;
    formData?: Record<string, string | Blob>;
  } = {}
) {
  let body: BodyInit | undefined;
  let headers: HeadersInit | undefined;

  if (options.formData) {
    const form = new FormData();
    for (const [key, value] of Object.entries(options.formData)) {
      if (value instanceof Blob) {
        form.append(key, value, `audio.${key === "audio" ? "webm" : "bin"}`);
      } else {
        form.append(key, value);
      }
    }
    body = form;
  } else if (options.body !== undefined) {
    body = JSON.stringify(options.body);
    headers = {
      "content-type": "application/json; charset=utf-8"
    };
  } else {
    headers = {
      "content-type": "application/json; charset=utf-8"
    };
  }

  const response = await fetch(`${baseUrl}${pathName}`, {
    method: options.method ?? "GET",
    headers,
    body
  });

  return {
    status: response.status,
    body: await response.json()
  };
}
