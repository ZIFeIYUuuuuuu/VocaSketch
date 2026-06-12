import type { CharacterConfig, PaintLayer, ProjectSnapshot, StoredProject } from "../types/project.js";
import { readJson, writeJson } from "./fileStore.js";
import { makeId } from "./ids.js";

export const defaultCharacterConfig: CharacterConfig = {
  gender: "female",
  hairLength: "long",
  hairColor: "blue",
  eyeColor: "blue",
  expression: "微笑",
  outfit: "school",
  accessory: "none",
  backgroundStyle: "watercolor"
};

export function defaultLayers(): PaintLayer[] {
  return [
    { id: "layer-details", name: "细节层", visible: true, opacity: 1, stage: "细节刻画", color: "#facc15" },
    { id: "layer-watercolor", name: "水彩层", visible: true, opacity: 0.72, stage: "水彩晕染", color: "#f472b6" },
    { id: "layer-flats", name: "基础色层", visible: true, opacity: 0.9, stage: "铺色阶段", color: "#60a5fa" },
    { id: "layer-lineart", name: "线稿层", visible: true, opacity: 1, stage: "线稿阶段", color: "#111827" },
    { id: "layer-sketch", name: "草图层", visible: true, opacity: 1, stage: "草图阶段", color: "#7c3aed" },
    { id: "layer-bg", name: "背景层", visible: true, opacity: 0.8, stage: "已完成", color: "#bfdbfe" }
  ];
}

export async function createProject(input: {
  sessionId: string;
  title?: string;
  initialConfig?: Partial<CharacterConfig>;
}): Promise<StoredProject> {
  const now = new Date().toISOString();
  const project: StoredProject = {
    projectId: makeId("proj"),
    sessionId: input.sessionId,
    title: input.title?.trim() || "未命名语音头像",
    config: {
      ...defaultCharacterConfig,
      ...input.initialConfig
    },
    layers: defaultLayers(),
    drawProgress: 0,
    currentStage: "未开始",
    canvasObjects: [],
    serverRevision: 1,
    historyCount: 0,
    createdAt: now,
    updatedAt: now
  };

  return writeJson("projects", project.projectId, project);
}

export async function getProject(projectId: string): Promise<StoredProject | null> {
  return readJson<StoredProject>("projects", projectId);
}

export async function saveSnapshot(
  project: StoredProject,
  snapshot: ProjectSnapshot
): Promise<StoredProject> {
  const updated: StoredProject = {
    ...project,
    config: {
      ...project.config,
      ...snapshot.config
    },
    layers: snapshot.layers,
    drawProgress: snapshot.drawProgress,
    currentStage: snapshot.currentStage,
    canvasObjects: snapshot.canvasObjects,
    serverRevision: project.serverRevision + 1,
    updatedAt: new Date().toISOString()
  };

  return writeJson("projects", updated.projectId, updated);
}
