import { readJson, writeJson } from "./fileStore.js";

export async function saveInterpretation<T extends { interpretationId: string }>(
  interpretation: T
): Promise<T> {
  return writeJson("interpretations", interpretation.interpretationId, interpretation);
}

export async function getInterpretation<T>(
  interpretationId: string
): Promise<T | null> {
  return readJson<T>("interpretations", interpretationId);
}
