import http from "node:http";
import { URL } from "node:url";
import { defaultCharacterConfig, interpretCommand } from "./parser.js";
import {
  getInterpretation,
  getProject,
  getSession,
  makeId,
  saveInterpretation,
  saveProject,
  saveSession
} from "./store.js";

const port = Number(process.env.PORT ?? 8787);
const apiBase = "/api/v1";

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务内部错误。";
    sendJson(res, 500, {
      error: {
        code: "INTERNAL_ERROR",
        message,
        retryable: true,
        details: {}
      }
    });
  }
});

server.listen(port, () => {
  console.log(`VocaSketch backend listening on http://localhost:${port}`);
});

async function route(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;

  if (req.method === "GET" && path === `${apiBase}/health`) {
    sendJson(res, 200, {
      ok: true,
      version: "0.1.0",
      providers: {
        parser: "local-rule-parser",
        asr: "not-configured",
        tts: "not-configured"
      },
      storage: "memory"
    });
    return;
  }

  if (req.method === "GET" && path === `${apiBase}/config/runtime`) {
    sendJson(res, 200, {
      asrMode: "web-speech-fallback",
      ttsEnabled: false,
      parserMode: "local-rule-parser",
      defaultLocale: "zh-CN",
      maxAudioSeconds: 20,
      maxCommandChars: 500
    });
    return;
  }

  if (req.method === "POST" && path === `${apiBase}/sessions`) {
    const body = await readJsonBody(req);
    const now = new Date().toISOString();
    const session = saveSession({
      sessionId: makeId("sess"),
      clientId: body.clientId ?? "anonymous-browser",
      locale: body.locale ?? "zh-CN",
      createdAt: now,
      expiresAt: null
    });
    sendJson(res, 201, session);
    return;
  }

  if (req.method === "POST" && path === `${apiBase}/projects`) {
    const body = await readJsonBody(req);

    if (!body.sessionId || !getSession(body.sessionId)) {
      sendError(res, 404, "SESSION_NOT_FOUND", "会话不存在，请先创建 session。", false);
      return;
    }

    const now = new Date().toISOString();
    const project = saveProject({
      projectId: makeId("proj"),
      sessionId: body.sessionId,
      title: body.title ?? "未命名语音头像",
      config: { ...defaultCharacterConfig, ...body.initialConfig },
      layers: defaultLayers(),
      drawProgress: 0,
      currentStage: "未开始",
      serverRevision: 1,
      createdAt: now,
      updatedAt: now
    });

    sendJson(res, 201, project);
    return;
  }

  const projectMatch = path.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (req.method === "GET" && projectMatch) {
    const project = getProject(projectMatch[1]);
    if (!project || project.sessionId !== url.searchParams.get("sessionId")) {
      sendError(res, 404, "PROJECT_NOT_FOUND", "工程不存在或不属于当前会话。", false);
      return;
    }
    sendJson(res, 200, {
      ...project,
      historyCount: 0
    });
    return;
  }

  const snapshotMatch = path.match(/^\/api\/v1\/projects\/([^/]+)\/snapshot$/);
  if (req.method === "PUT" && snapshotMatch) {
    const project = getProject(snapshotMatch[1]);
    const body = await readJsonBody(req);

    if (!project || project.sessionId !== body.sessionId) {
      sendError(res, 404, "PROJECT_NOT_FOUND", "工程不存在或不属于当前会话。", false);
      return;
    }

    const updated = {
      ...project,
      config: body.config ?? project.config,
      layers: body.layers ?? project.layers,
      drawProgress: body.drawProgress ?? project.drawProgress,
      currentStage: body.currentStage ?? project.currentStage,
      serverRevision: project.serverRevision + 1,
      updatedAt: new Date().toISOString()
    };
    saveProject(updated);
    sendJson(res, 200, {
      projectId: updated.projectId,
      serverRevision: updated.serverRevision,
      savedAt: updated.updatedAt
    });
    return;
  }

  if (req.method === "POST" && path === `${apiBase}/commands/interpret`) {
    const body = await readJsonBody(req);
    const interpretation = saveInterpretation(interpretCommand(body));
    sendJson(res, 200, interpretation);
    return;
  }

  const confirmMatch = path.match(/^\/api\/v1\/commands\/([^/]+)\/confirm$/);
  if (req.method === "POST" && confirmMatch) {
    const body = await readJsonBody(req);
    const interpretation = getInterpretation(confirmMatch[1]);
    if (!interpretation || interpretation.sessionId !== body.sessionId || interpretation.projectId !== body.projectId) {
      sendError(res, 404, "CONFIRMATION_EXPIRED", "确认记录不存在或已过期。", false);
      return;
    }
    sendJson(res, 200, {
      projectId: interpretation.projectId,
      interpretationId: interpretation.interpretationId,
      confirmed: body.confirmed ?? true,
      aiReplyText: body.confirmed === false ? "好的，我先不执行这次修改。" : "好的，我开始绘制。",
      operations: body.confirmed === false ? [] : interpretation.operations,
      serverRevision: 1
    });
    return;
  }

  const rejectMatch = path.match(/^\/api\/v1\/commands\/([^/]+)\/reject$/);
  if (req.method === "POST" && rejectMatch) {
    const interpretation = getInterpretation(rejectMatch[1]);
    if (!interpretation) {
      sendError(res, 404, "CONFIRMATION_EXPIRED", "确认记录不存在或已过期。", false);
      return;
    }
    sendJson(res, 200, {
      interpretationId: interpretation.interpretationId,
      cancelled: true,
      aiReplyText: "好的，我先不执行这次修改。"
    });
    return;
  }

  sendError(res, 404, "NOT_FOUND", "接口不存在。", false);
}

function defaultLayers() {
  return [
    { id: "layer-sketch", name: "草图", visible: true, opacity: 1, stage: "草图阶段", color: "#7c3aed" },
    { id: "layer-lineart", name: "线稿", visible: true, opacity: 1, stage: "线稿阶段", color: "#111827" },
    { id: "layer-flats", name: "铺色", visible: true, opacity: 0.9, stage: "铺色阶段", color: "#60a5fa" },
    { id: "layer-watercolor", name: "水彩", visible: true, opacity: 0.72, stage: "水彩晕染", color: "#f472b6" },
    { id: "layer-details", name: "细节", visible: true, opacity: 1, stage: "细节刻画", color: "#facc15" },
    { id: "layer-bg", name: "背景", visible: true, opacity: 0.8, stage: "已完成", color: "#bfdbfe" }
  ];
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, statusCode, code, message, retryable) {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
      retryable,
      details: {}
    }
  });
}

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
