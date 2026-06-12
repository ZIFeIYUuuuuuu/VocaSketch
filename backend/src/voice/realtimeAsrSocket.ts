import crypto from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import net from "node:net";
import tls from "node:tls";

import { appConfig } from "../config.js";
import { getProject } from "../storage/projectStore.js";
import { getSession } from "../storage/sessionStore.js";

const REALTIME_ASR_PATH = "/api/v1/voice/asr/realtime";
const DASHSCOPE_HOST = "dashscope.aliyuncs.com";
const DASHSCOPE_PATH = "/api-ws/v1/inference";

const OP_TEXT = 1;
const OP_BINARY = 2;
const OP_CLOSE = 8;
const OP_PING = 9;
const OP_PONG = 10;

type Frame = { opcode: number; payload: Buffer };

type BrowserStart = {
  type: "start";
  sessionId: string;
  projectId: string;
  locale?: string;
};

type DashScopeEvent = {
  header?: {
    event?: string;
    error_code?: string;
    error_message?: string;
  };
  payload?: {
    output?: {
      sentence?: {
        text?: string;
        heartbeat?: boolean;
        sentence_end?: boolean;
      };
    };
  };
};

export function attachRealtimeAsrSocket(server: Server) {
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== REALTIME_ASR_PATH) {
      return;
    }

    handleUpgrade(req, socket as net.Socket, head).catch((error) => {
      console.error("[realtime-asr] upgrade failed", error);
      socket.destroy();
    });
  });
}

async function handleUpgrade(req: IncomingMessage, socket: net.Socket, head: Buffer) {
  if (!isOriginAllowed(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );

  console.log("[realtime-asr] browser websocket accepted");
  bindBrowserSocket(socket, head);
}

function bindBrowserSocket(socket: net.Socket, head: Buffer) {
  const parser = new WebSocketFrameParser();
  let dashscope: DashScopeRealtimeSession | null = null;
  let ready = false;
  let finishing = false;
  const pendingAudio: Buffer[] = [];

  const sendJson = (payload: Record<string, unknown>) => {
    if (!socket.destroyed) {
      socket.write(encodeFrame(Buffer.from(JSON.stringify(payload)), OP_TEXT, false));
    }
  };

  const closeBrowser = () => {
    if (!socket.destroyed) {
      socket.end(encodeFrame(Buffer.alloc(0), OP_CLOSE, false));
    }
  };

  const cleanup = () => {
    dashscope?.close();
    dashscope = null;
    pendingAudio.length = 0;
  };

  const start = async (message: BrowserStart) => {
    if (dashscope) return;

    const accessError = await validateProjectAccess(message.sessionId, message.projectId);
    if (accessError) {
      sendJson({ type: "error", message: accessError });
      closeBrowser();
      return;
    }

    sendJson({ type: "starting" });
    console.log("[realtime-asr] start requested", {
      sessionId: message.sessionId,
      projectId: message.projectId,
      model: appConfig.voice.asrModel
    });

    try {
      dashscope = new DashScopeRealtimeSession(message.locale ?? "zh-CN", {
        ready: () => {
          ready = true;
          console.log("[realtime-asr] dashscope task-started");
          sendJson({ type: "ready" });
          while (pendingAudio.length > 0) {
            dashscope?.sendAudio(pendingAudio.shift()!);
          }
        },
        transcript: (transcript, final) => {
          sendJson({ type: final ? "final" : "partial", transcript });
        },
        done: () => {
          console.log("[realtime-asr] dashscope task-finished");
          sendJson({ type: "done" });
          closeBrowser();
        },
        error: (messageText) => {
          console.error("[realtime-asr] dashscope error", messageText);
          sendJson({ type: "error", message: messageText });
          closeBrowser();
        }
      });
      await dashscope.connect();
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "实时语音识别连接失败。";
      sendJson({ type: "error", message: messageText });
      closeBrowser();
    }
  };

  const handleFrame = (frame: Frame) => {
    if (frame.opcode === OP_TEXT) {
      const message = parseBrowserMessage(frame.payload);
      if (!message) {
        sendJson({ type: "error", message: "实时语音消息格式不合法。" });
        closeBrowser();
        return;
      }

      if (message.type === "start") {
        void start(message);
        return;
      }

      if (!finishing) {
        finishing = true;
        dashscope?.finish();
      }
      return;
    }

    if (frame.opcode === OP_BINARY && dashscope) {
      if (ready) {
        dashscope.sendAudio(frame.payload);
      } else {
        pendingAudio.push(frame.payload);
      }
      return;
    }

    if (frame.opcode === OP_PING) {
      socket.write(encodeFrame(frame.payload, OP_PONG, false));
      return;
    }

    if (frame.opcode === OP_CLOSE) {
      cleanup();
      closeBrowser();
    }
  };

  socket.on("data", (chunk) => {
    for (const frame of parser.push(chunk)) {
      handleFrame(frame);
    }
  });
  socket.on("close", cleanup);
  socket.on("error", cleanup);

  if (head.length > 0) {
    for (const frame of parser.push(head)) {
      handleFrame(frame);
    }
  }
}

class DashScopeRealtimeSession {
  private readonly parser = new WebSocketFrameParser();
  private readonly taskId = crypto.randomUUID();
  private socket: tls.TLSSocket | null = null;
  private handshake = Buffer.alloc(0);
  private connected = false;

  constructor(
    private readonly locale: string,
    private readonly callbacks: {
      ready: () => void;
      transcript: (text: string, final: boolean) => void;
      done: () => void;
      error: (message: string) => void;
    }
  ) {}

  connect(): Promise<void> {
    const apiKey = appConfig.voice.dashscopeApiKey;
    if (!apiKey) {
      throw new Error("DashScope ASR 未配置：缺少 DASHSCOPE_API_KEY。");
    }

    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: DASHSCOPE_HOST, port: 443, servername: DASHSCOPE_HOST });
      this.socket = socket;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("DashScope 实时 ASR 连接超时。"));
      }, 10000);

      socket.once("secureConnect", () => {
        socket.write(createHandshake(apiKey));
      });

      socket.on("data", (chunk) => {
        if (!this.connected) {
          this.handshake = Buffer.concat([this.handshake, chunk]);
          const headerEnd = this.handshake.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;

          const header = this.handshake.subarray(0, headerEnd).toString("utf8");
          if (!header.startsWith("HTTP/1.1 101")) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error(`DashScope WebSocket 握手失败：${header.split("\r\n")[0]}`));
            return;
          }

          this.connected = true;
          clearTimeout(timeout);
          resolve();
          this.sendJson(createRunTaskPayload(this.taskId, this.locale));

          const rest = this.handshake.subarray(headerEnd + 4);
          this.handshake = Buffer.alloc(0);
          if (rest.length > 0) {
            this.handleData(rest);
          }
          return;
        }

        this.handleData(chunk);
      });

      socket.on("error", (error) => {
        clearTimeout(timeout);
        if (!this.connected) {
          reject(error);
        } else {
          this.callbacks.error(error.message);
        }
      });
    });
  }

  sendAudio(audio: Buffer) {
    this.socket?.write(encodeFrame(audio, OP_BINARY, true));
  }

  finish() {
    this.sendJson({
      header: {
        action: "finish-task",
        task_id: this.taskId,
        streaming: "duplex"
      },
      payload: {
        input: {}
      }
    });
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end(encodeFrame(Buffer.alloc(0), OP_CLOSE, true));
    }
  }

  private sendJson(payload: unknown) {
    this.socket?.write(encodeFrame(Buffer.from(JSON.stringify(payload)), OP_TEXT, true));
  }

  private handleData(chunk: Buffer) {
    for (const frame of this.parser.push(chunk)) {
      if (frame.opcode === OP_TEXT) {
        this.handleMessage(frame.payload.toString("utf8"));
      } else if (frame.opcode === OP_PING) {
        this.socket?.write(encodeFrame(frame.payload, OP_PONG, true));
      }
    }
  }

  private handleMessage(raw: string) {
    let event: DashScopeEvent;
    try {
      event = JSON.parse(raw) as DashScopeEvent;
    } catch {
      return;
    }

    if (event.header?.event === "task-started") {
      this.callbacks.ready();
      return;
    }

    if (event.header?.event === "result-generated") {
      const sentence = event.payload?.output?.sentence;
      if (!sentence?.text || sentence.heartbeat) return;
      this.callbacks.transcript(sentence.text, Boolean(sentence.sentence_end));
      return;
    }

    if (event.header?.event === "task-finished") {
      this.callbacks.done();
      return;
    }

    if (event.header?.event === "task-failed") {
      this.callbacks.error(
        `${event.header.error_code ?? "TASK_FAILED"}: ${event.header.error_message ?? "DashScope 实时识别失败。"}`
      );
    }
  }
}

class WebSocketFrameParser {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Frame[] = [];

    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 0x0f;
      const masked = (this.buffer[1] & 0x80) !== 0;
      let length = this.buffer[1] & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.length < offset + 2) break;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) break;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (this.buffer.length < offset + maskLength + length) break;

      let payload = this.buffer.subarray(offset + maskLength, offset + maskLength + length);
      if (masked) {
        const mask = this.buffer.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }

      this.buffer = this.buffer.subarray(offset + maskLength + length);
      frames.push({ opcode, payload });
    }

    return frames;
  }
}

function createHandshake(apiKey: string) {
  const key = crypto.randomBytes(16).toString("base64");
  return [
    `GET ${DASHSCOPE_PATH} HTTP/1.1`,
    `Host: ${DASHSCOPE_HOST}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    `Authorization: Bearer ${apiKey}`,
    "X-DashScope-DataInspection: enable",
    "\r\n"
  ].join("\r\n");
}

function createRunTaskPayload(taskId: string, locale: string) {
  const sampleRate = appConfig.voice.asrModel.includes("8k") ? 8000 : 16000;
  return {
    header: {
      action: "run-task",
      task_id: taskId,
      streaming: "duplex"
    },
    payload: {
      task_group: "audio",
      task: "asr",
      function: "recognition",
      model: appConfig.voice.asrModel,
      parameters: {
        format: "pcm",
        sample_rate: sampleRate,
        max_sentence_silence: 800,
        punctuation_prediction_enabled: true,
        inverse_text_normalization_enabled: true,
        language_hints: [locale === "zh-CN" ? "zh" : locale]
      },
      input: {}
    }
  };
}

function encodeFrame(payload: Buffer, opcode: number, masked: boolean) {
  const length = payload.length;
  const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const maskBytes = masked ? 4 : 0;
  const frame = Buffer.alloc(2 + lengthBytes + maskBytes + length);
  frame[0] = 0x80 | opcode;

  if (length < 126) {
    frame[1] = masked ? 0x80 | length : length;
  } else if (length <= 0xffff) {
    frame[1] = masked ? 0x80 | 126 : 126;
    frame.writeUInt16BE(length, 2);
  } else {
    frame[1] = masked ? 0x80 | 127 : 127;
    frame.writeBigUInt64BE(BigInt(length), 2);
  }

  const payloadOffset = 2 + lengthBytes + maskBytes;
  if (!masked) {
    payload.copy(frame, payloadOffset);
    return frame;
  }

  const mask = crypto.randomBytes(4);
  mask.copy(frame, 2 + lengthBytes);
  for (let index = 0; index < payload.length; index += 1) {
    frame[payloadOffset + index] = payload[index] ^ mask[index % 4];
  }
  return frame;
}

function parseBrowserMessage(payload: Buffer): BrowserStart | { type: "finish" } | null {
  try {
    const parsed = JSON.parse(payload.toString("utf8")) as Partial<BrowserStart | { type: "finish" }>;
    if (parsed.type === "start" && parsed.sessionId && parsed.projectId) {
      return {
        type: "start",
        sessionId: parsed.sessionId,
        projectId: parsed.projectId,
        locale: parsed.locale
      };
    }
    if (parsed.type === "finish") {
      return { type: "finish" };
    }
  } catch {
    return null;
  }
  return null;
}

async function validateProjectAccess(sessionId: string, projectId: string) {
  const session = await getSession(sessionId);
  if (!session) return "会话不存在，请刷新后重试。";

  const project = await getProject(projectId);
  if (!project) return "工程不存在，请刷新后重试。";
  if (project.sessionId !== sessionId) return "工程不属于当前会话。";

  return null;
}

function isOriginAllowed(origin: string | undefined) {
  return !origin || appConfig.corsOrigins.includes(origin);
}
