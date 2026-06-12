import type { Session } from "../types/session.js";
import { writeJson, readJson } from "./fileStore.js";
import { makeId } from "./ids.js";

export async function createSession(input: {
  clientId?: string;
  locale: string;
}): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = {
    sessionId: makeId("sess"),
    clientId: input.clientId,
    locale: input.locale,
    expiresAt: null,
    createdAt: now
  };

  return writeJson("sessions", session.sessionId, session);
}

export async function getSession(sessionId: string): Promise<Session | null> {
  return readJson<Session>("sessions", sessionId);
}
