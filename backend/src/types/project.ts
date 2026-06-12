export type DrawStage =
  | "未开始"
  | "草图阶段"
  | "线稿阶段"
  | "铺色阶段"
  | "水彩晕染"
  | "细节刻画"
  | "已完成";

export interface CharacterConfig {
  gender: "female" | "male" | "neutral";
  hairLength: "long" | "short" | "medium";
  hairColor: string;
  eyeColor: string;
  expression: "微笑" | "害羞" | "冷淡" | "惊讶";
  outfit: "school" | "hoodie" | "shirt";
  accessory: "butterfly_knot" | "glasses" | "none";
  backgroundStyle: "gradient" | "watercolor" | "stars" | "cherry";
}

export interface PaintLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  stage: DrawStage;
  color: string;
  objectCount?: number;
  locked?: boolean;
}

export interface ProjectSnapshot {
  sessionId: string;
  config: Partial<CharacterConfig>;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  canvasObjects: unknown[];
  clientRevision: number;
}

export interface StoredProject {
  projectId: string;
  sessionId: string;
  title: string;
  config: CharacterConfig;
  layers: PaintLayer[];
  drawProgress: number;
  currentStage: DrawStage;
  canvasObjects: unknown[];
  serverRevision: number;
  historyCount: number;
  createdAt: string;
  updatedAt: string;
}
