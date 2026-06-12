import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { ApiError } from "../errors.js";

const audioRoot = path.join(appConfig.storageDir, "audio");
const tmpDir = path.join(audioRoot, "tmp");
const ttsDir = path.join(audioRoot, "tts");

export async function ensureAudioStorageReady(): Promise<void> {
  await Promise.all([
    fs.mkdir(tmpDir, { recursive: true }),
    fs.mkdir(ttsDir, { recursive: true })
  ]);
}

export async function saveTempAudio(buffer: Buffer, extension: string): Promise<string> {
  await ensureAudioStorageReady();
  const safeExtension = normalizeAudioExtension(extension);
  const filePath = path.join(tmpDir, `${makeAudioId("aud")}.${safeExtension}`);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function deleteTempAudio(filePath: string): Promise<void> {
  const resolvedPath = path.resolve(filePath);
  const relative = path.relative(path.resolve(tmpDir), resolvedPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return;
  }
  await fs.rm(resolvedPath, { force: true });
}

export async function saveTtsAudio(buffer: Buffer, extension: string): Promise<{
  filename: string;
  filePath: string;
  mimeType: string;
}> {
  await ensureAudioStorageReady();
  const safeExtension = normalizeAudioExtension(extension);
  const filename = `${makeAudioId("tts")}.${safeExtension}`;
  const filePath = path.join(ttsDir, filename);
  await fs.writeFile(filePath, buffer);
  return { filename, filePath, mimeType: audioMimeType(safeExtension) };
}

export async function readTtsAudio(filename: string): Promise<{
  buffer: Buffer;
  mimeType: string;
}> {
  if (!/^[a-zA-Z0-9_-]+\.(mp3|wav)$/.test(filename)) {
    throw new ApiError({
      statusCode: 400,
      code: "REQUEST_INVALID",
      message: "音频文件名不合法。"
    });
  }

  const filePath = path.resolve(ttsDir, filename);
  if (!filePath.startsWith(path.resolve(ttsDir) + path.sep)) {
    throw new ApiError({
      statusCode: 400,
      code: "REQUEST_INVALID",
      message: "音频文件路径不合法。"
    });
  }

  try {
    const buffer = await fs.readFile(filePath);
    return {
      buffer,
      mimeType: filename.endsWith(".wav") ? "audio/wav" : "audio/mpeg"
    };
  } catch {
    throw new ApiError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "音频文件不存在。"
    });
  }
}

export function audioMimeType(format: string): string {
  if (format === "wav") return "audio/wav";
  if (format === "mp3") return "audio/mpeg";
  return "audio/webm";
}

function normalizeAudioExtension(extension: string): "webm" | "wav" | "mp3" {
  if (extension === "wav" || extension === "mp3" || extension === "webm") {
    return extension;
  }
  return "webm";
}

function makeAudioId(prefix: "aud" | "tts"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 10)}`;
}
