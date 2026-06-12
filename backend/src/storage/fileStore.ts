import fs from "node:fs/promises";
import path from "node:path";

import { appConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { isSafeId } from "./ids.js";

export type StoreCollection = "sessions" | "projects" | "interpretations";

export async function ensureStorageReady(): Promise<void> {
  await Promise.all([
    fs.mkdir(collectionDir("sessions"), { recursive: true }),
    fs.mkdir(collectionDir("projects"), { recursive: true }),
    fs.mkdir(collectionDir("interpretations"), { recursive: true })
  ]);
}

export async function getStorageStatus(): Promise<"ready" | "missing"> {
  try {
    await ensureStorageReady();
    await fs.access(appConfig.storageDir);
    return "ready";
  } catch {
    return "missing";
  }
}

export async function readJson<T>(
  collection: StoreCollection,
  id: string
): Promise<T | null> {
  const filePath = jsonPath(collection, id);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJson<T>(
  collection: StoreCollection,
  id: string,
  value: T
): Promise<T> {
  const filePath = jsonPath(collection, id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return value;
}

export function collectionDir(collection: StoreCollection): string {
  return path.join(appConfig.storageDir, collection);
}

function jsonPath(collection: StoreCollection, id: string): string {
  if (!isSafeId(id)) {
    throw new ApiError({
      statusCode: 400,
      code: "REQUEST_INVALID",
      message: "资源 ID 包含非法字符。"
    });
  }

  return path.join(collectionDir(collection), `${id}.json`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
