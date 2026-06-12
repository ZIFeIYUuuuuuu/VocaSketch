import { randomBytes } from "node:crypto";

const safeIdPattern = /^[A-Za-z0-9_-]+$/;

export function makeId(prefix: "sess" | "proj" | "interp" | "hist"): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
}

export function isSafeId(id: string): boolean {
  return safeIdPattern.test(id);
}
