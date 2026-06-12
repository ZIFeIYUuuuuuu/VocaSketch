import type { CommandInterpretation, DrawingOperation } from "./schemas/commandSchemas.js";
import { makeId } from "./storage/ids.js";
import type { CharacterConfig } from "./types/project.js";

interface InterpretRequest {
  sessionId?: string;
  projectId?: string;
  text?: string;
  currentState?: {
    drawProgress?: number;
  };
}

type TraitPatch = Partial<CharacterConfig>;
type RedrawTarget = "hair" | "eyes" | "expression" | "outfit" | "accessory" | "background";

const affectedPaintLayers = [
  "layer-sketch",
  "layer-lineart",
  "layer-flats",
  "layer-watercolor",
  "layer-details",
  "layer-bg"
];

const colorAliases = [
  { value: "blue", pattern: /蓝色?|湖蓝/ },
  { value: "pink", pattern: /粉红色?|粉色?|蜜桃粉/ },
  { value: "purple", pattern: /紫色?|紫罗兰/ },
  { value: "gold", pattern: /金色?|黄色?|金黄色|黄金/ },
  { value: "black", pattern: /黑色?|曜石黑/ },
  { value: "white", pattern: /白色?|银白/ },
  { value: "green", pattern: /绿色?|绿/ },
  { value: "red", pattern: /红色?|红/ }
] as const;

export function interpretCommand(request: InterpretRequest): CommandInterpretation {
  const text = (request.text ?? "").trim();
  const sessionId = request.sessionId ?? "sess_demo";
  const projectId = request.projectId ?? "proj_demo";

  if (!text) {
    return clarify(sessionId, projectId, text, "我没有听清楚，请再说一遍你的绘图指令。");
  }

  const controlOperation = parseControl(text);
  if (controlOperation) {
    return {
      interpretationId: makeId("interp"),
      sessionId,
      projectId,
      transcript: text,
      normalizedText: controlReply(controlOperation.type).replace(/[。！？]/g, ""),
      intent: "control",
      confidence: 0.98,
      requiresConfirmation: false,
      needsClarification: false,
      aiReplyText: controlReply(controlOperation.type),
      operations: [controlOperation],
      affectedLayers: [],
      costHint: localCostHint()
    };
  }

  const traitPatch = parseTraitPatch(text);
  const hasCreateIntent = /画一个|画一张|画个|绘制|生成|创建|头像|半身像|半身头像|角色|开始制作/.test(text);
  const hasTraitPatch = Object.keys(traitPatch).length > 0;

  if (!hasCreateIntent && !hasTraitPatch) {
    if (/颜色|调一下|调整|怪怪/.test(text)) {
      return clarify(sessionId, projectId, text, "你想调整头发、眼睛、衣服，还是背景？", 0.52);
    }
    return clarify(sessionId, projectId, text, "你想创建角色、修改颜色，还是控制暂停和继续？");
  }

  const operations = buildOperations(text, traitPatch, hasCreateIntent, request.currentState?.drawProgress ?? 0);
  const target = inferRedrawTarget(text, traitPatch);

  return {
    interpretationId: makeId("interp"),
    sessionId,
    projectId,
    transcript: text,
    normalizedText: buildNormalizedText(traitPatch, hasCreateIntent),
    intent: buildIntent(traitPatch, hasCreateIntent),
    confidence: hasTraitPatch ? 0.9 : 0.72,
    requiresConfirmation: true,
    needsClarification: false,
    aiReplyText: buildConfirmationReply(traitPatch, hasCreateIntent),
    traitPatch,
    operations,
    affectedLayers: hasCreateIntent ? affectedPaintLayers : [targetToLayer(target)],
    costHint: localCostHint()
  };
}

function parseControl(text: string): DrawingOperation | null {
  if (/暂停|停一下|先停/.test(text)) return { type: "pause" };
  if (/继续|接着|恢复/.test(text)) return { type: "resume" };
  if (/撤销|撤消|上一步|退回/.test(text)) return { type: "undo" };
  if (/重做|恢复下一步|恢复刚才|前进/.test(text)) return { type: "redo" };
  if (/回放|重新放|重演|重播/.test(text)) return { type: "replay" };
  if (/导出|保存图片|下载|导出作品/.test(text)) return { type: "export" };
  return null;
}

function parseTraitPatch(text: string): TraitPatch {
  const patch: TraitPatch = {};

  if (/男生|男孩子|男性|男孩|少年|帅哥/.test(text)) {
    patch.gender = "male";
  } else if (/女生|女性|女孩|女孩子|少女|二次元女生/.test(text)) {
    patch.gender = "female";
  } else if (/中性|中性角色|无性别/.test(text)) {
    patch.gender = "neutral";
  }

  if (/短发|狼尾/.test(text)) {
    patch.hairLength = "short";
  } else if (/中长发|中发/.test(text)) {
    patch.hairLength = "medium";
  } else if (/长发|过肩长发/.test(text)) {
    patch.hairLength = "long";
  }

  const hairColor = findHairColor(text, patch);
  if (hairColor) patch.hairColor = hairColor;

  const eyeColor = findEyeColor(text);
  if (eyeColor) patch.eyeColor = eyeColor;

  if (/害羞|脸红|羞涩|腮红/.test(text)) {
    patch.expression = "害羞";
  } else if (/微笑|开心|大笑|笑一个|笑/.test(text)) {
    patch.expression = "微笑";
  } else if (/冷淡|无表情|高冷|酷/.test(text)) {
    patch.expression = "冷淡";
  } else if (/惊讶|张嘴|萌/.test(text)) {
    patch.expression = "惊讶";
  }

  if (/校服/.test(text)) {
    patch.outfit = "school";
  } else if (/卫衣/.test(text)) {
    patch.outfit = "hoodie";
  } else if (/衬衫/.test(text)) {
    patch.outfit = "shirt";
  }

  if (/摘下眼镜|脱掉眼镜|不戴眼镜|取消眼镜|不要配饰|去掉配饰|无配饰/.test(text)) {
    patch.accessory = "none";
  } else if (/眼镜|红框眼镜|红框大圆眼镜|大圆眼镜|圆框眼镜|戴眼镜/.test(text)) {
    patch.accessory = "glasses";
  } else if (/蝴蝶结|红领结|丝带|领结|领带/.test(text)) {
    patch.accessory = "butterfly_knot";
  }

  if (/樱花|花瓣|粉色背景/.test(text)) {
    patch.backgroundStyle = "cherry";
  } else if (/星光|星空|星星/.test(text)) {
    patch.backgroundStyle = "stars";
  } else if (/渐变/.test(text)) {
    patch.backgroundStyle = "gradient";
  } else if (/水彩|水彩背景|混色背景/.test(text)) {
    patch.backgroundStyle = "watercolor";
  }

  return patch;
}

function findHairColor(text: string, patch: TraitPatch): CharacterConfig["hairColor"] | undefined {
  if (/蓝发|蓝色发|蓝色头发|湖蓝/.test(text)) return "blue";
  if (/粉发|粉色发|粉红发|粉红色头发|粉色头发|蜜桃粉/.test(text)) return "pink";
  if (/紫发|紫色发|紫色头发/.test(text)) return "purple";
  if (/金发|金色发|黄色发|金色头发|金黄色/.test(text)) return "gold";
  if (/黑发|黑色发|黑头发|黑色头发/.test(text)) return "black";
  if (/白发|白色发|白色头发|银白/.test(text)) return "white";

  const mentionsHair = /头发|发色|发|长发|短发|中长发|狼尾/.test(text);
  const mentionsEyes = mentionsEyeColorTarget(text);
  const color = findColor(text);

  if (mentionsHair && color) return color;
  if (patch.hairLength && color && !mentionsEyes) return color;

  return undefined;
}

function findEyeColor(text: string): CharacterConfig["eyeColor"] | undefined {
  if (!mentionsEyeColorTarget(text)) return undefined;
  if (/紫色眼|紫眼|紫色瞳|紫瞳/.test(text)) return "purple";
  if (/蓝色眼|蓝眼|蓝色瞳|蓝瞳/.test(text)) return "blue";
  if (/红色眼|红眼|红瞳/.test(text)) return "red";
  if (/金色眼|金眼|金瞳|黄金眼/.test(text)) return "gold";
  if (/绿色眼|绿眼|绿色瞳|绿瞳/.test(text)) return "green";
  if (/粉色眼|粉眼|粉色瞳|粉瞳|粉红色瞳/.test(text)) return "pink";
  return findColor(text);
}

function findColor(text: string): string | undefined {
  return colorAliases.find((entry) => entry.pattern.test(text))?.value;
}

function buildOperations(
  text: string,
  traitPatch: TraitPatch,
  hasCreateIntent: boolean,
  fromProgress: number
): DrawingOperation[] {
  if (hasCreateIntent) {
    const operations: DrawingOperation[] = [];
    if (Object.keys(traitPatch).length > 0) {
      operations.push({ type: "set_character", patch: traitPatch });
    }
    operations.push({ type: "start_auto_painting", fromProgress });
    return operations;
  }

  return [
    {
      type: "redraw_component",
      target: inferRedrawTarget(text, traitPatch),
      patch: traitPatch
    }
  ];
}

function inferRedrawTarget(text: string, patch: TraitPatch): RedrawTarget {
  if (mentionsEyeColorTarget(text) || patch.eyeColor) return "eyes";
  if (/表情|笑|害羞|脸红|腮红|冷淡|惊讶|萌/.test(text) || patch.expression) return "expression";
  if (/衣|校服|卫衣|衬衫/.test(text) || patch.outfit) return "outfit";
  if (/眼镜|蝴蝶结|配饰|丝带|领结/.test(text) || patch.accessory) return "accessory";
  if (/背景|星空|星光|樱花|花瓣|渐变|水彩|混色/.test(text) || patch.backgroundStyle) return "background";
  return "hair";
}

function mentionsEyeColorTarget(text: string): boolean {
  return /眼睛|眼珠|眼眸|眼色|瞳|紫眼|蓝眼|红眼|金眼|黄金眼|绿眼|粉眼/.test(text);
}

function targetToLayer(target: RedrawTarget): string {
  if (target === "background") return "layer-bg";
  if (target === "eyes" || target === "expression" || target === "accessory") {
    return "layer-details";
  }
  if (target === "outfit") return "layer-flats";
  return "layer-lineart";
}

function buildIntent(traitPatch: TraitPatch, hasCreateIntent: boolean): CommandInterpretation["intent"] {
  if (hasCreateIntent) return "create_avatar";
  if (traitPatch.accessory === "glasses" || traitPatch.accessory === "butterfly_knot") {
    return "add_accessory";
  }
  if (traitPatch.accessory === "none") return "remove_accessory";
  return "edit_traits";
}

function buildNormalizedText(traitPatch: TraitPatch, isCreate: boolean): string {
  const parts = describePatch(traitPatch);
  if (isCreate) {
    return `创建${parts.length > 0 ? parts.join("") : "角色"}半身头像`;
  }
  return parts.length > 0 ? `调整${parts.join("、")}` : "调整角色设定";
}

function buildConfirmationReply(patch: TraitPatch, isCreate: boolean): string {
  const parts = describePatch(patch);
  const description = parts.length > 0 ? parts.join("、") : "当前描述的角色设定";
  return isCreate ? `我会绘制${description}，确认开始吗？` : `我会把角色调整为${description}，确认修改吗？`;
}

function describePatch(patch: TraitPatch): string[] {
  const parts: string[] = [];
  if (patch.gender) parts.push(genderText(patch.gender));
  if (patch.hairLength) parts.push(lengthText(patch.hairLength));
  if (patch.hairColor) parts.push(`${colorText(patch.hairColor)}头发`);
  if (patch.eyeColor) parts.push(`${colorText(patch.eyeColor)}眼睛`);
  if (patch.expression) parts.push(`${patch.expression}表情`);
  if (patch.outfit) parts.push(outfitText(patch.outfit));
  if (patch.accessory) parts.push(accessoryText(patch.accessory));
  if (patch.backgroundStyle) parts.push(backgroundText(patch.backgroundStyle));
  return parts;
}

function clarify(
  sessionId: string,
  projectId: string,
  transcript: string,
  question: string,
  confidence = 0.45
): CommandInterpretation {
  return {
    interpretationId: makeId("interp"),
    sessionId,
    projectId,
    transcript,
    normalizedText: /颜色|调一下|调整|怪怪/.test(transcript)
      ? "用户想调整颜色，但目标不明确"
      : normalizeText(transcript),
    intent: "clarify",
    confidence,
    requiresConfirmation: false,
    needsClarification: true,
    aiReplyText: question,
    clarificationQuestion: question,
    operations: [],
    affectedLayers: [],
    costHint: localCostHint()
  };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?]/g, "");
}

function controlReply(type: string): string {
  const replies: Record<string, string> = {
    pause: "好的，先暂停在当前进度。",
    resume: "好的，继续绘制。",
    undo: "已准备撤销上一步。",
    redo: "已准备重做刚才的操作。",
    replay: "好的，我会回放绘画过程。",
    export: "好的，我会准备导出作品。"
  };
  return replies[type] ?? "好的。";
}

function localCostHint() {
  return {
    provider: "local-rule-parser",
    cacheHit: false
  };
}

function genderText(value: string): string {
  return value === "male" ? "男生" : value === "neutral" ? "中性角色" : "女生";
}

function lengthText(value: string): string {
  return value === "short" ? "短发" : value === "medium" ? "中长发" : "长发";
}

function colorText(value: string): string {
  const names: Record<string, string> = {
    blue: "蓝色",
    pink: "粉色",
    purple: "紫色",
    gold: "金色",
    black: "黑色",
    white: "白色",
    green: "绿色",
    red: "红色"
  };
  return names[value] ?? value;
}

function outfitText(value: string): string {
  return value === "hoodie" ? "卫衣" : value === "shirt" ? "衬衫" : "校服";
}

function accessoryText(value: string): string {
  if (value === "glasses") return "眼镜";
  if (value === "butterfly_knot") return "蝴蝶结";
  return "无配饰";
}

function backgroundText(value: string): string {
  const names: Record<string, string> = {
    gradient: "渐变背景",
    watercolor: "水彩风格",
    stars: "星空背景",
    cherry: "樱花背景"
  };
  return names[value] ?? value;
}
