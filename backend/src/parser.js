import { makeId } from "./store.js";

const affectedPaintLayers = [
  "layer-sketch",
  "layer-lineart",
  "layer-flats",
  "layer-watercolor",
  "layer-details",
  "layer-bg"
];

const colorMap = [
  ["蓝", "blue"],
  ["粉", "pink"],
  ["紫", "purple"],
  ["金", "gold"],
  ["黑", "black"],
  ["白", "white"],
  ["绿", "green"],
  ["红", "red"]
];

export const defaultCharacterConfig = {
  gender: "female",
  hairLength: "long",
  hairColor: "blue",
  eyeColor: "blue",
  expression: "微笑",
  outfit: "school",
  accessory: "none",
  backgroundStyle: "watercolor"
};

export function interpretCommand(request) {
  const text = (request.text ?? "").trim();
  const normalizedText = normalizeText(text);
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
      normalizedText,
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

  const patch = parseTraitPatch(text);
  const hasCreateIntent = /画|绘制|生成|创建|头像|角色/.test(text);
  const hasPatch = Object.keys(patch).length > 0;

  if (!hasCreateIntent && !hasPatch) {
    return clarify(sessionId, projectId, text, "你想创建角色、修改颜色，还是控制暂停和继续？");
  }

  const operations = [];
  if (hasPatch) {
    operations.push({ type: "set_character", patch });
  }

  if (hasCreateIntent) {
    operations.push({
      type: "start_auto_painting",
      fromProgress: request.currentState?.drawProgress ?? 0
    });
  } else {
    operations.push({
      type: "redraw_component",
      target: inferRedrawTarget(text),
      patch
    });
  }

  return {
    interpretationId: makeId("interp"),
    sessionId,
    projectId,
    transcript: text,
    normalizedText,
    intent: hasCreateIntent ? "create_avatar" : "edit_traits",
    confidence: hasPatch ? 0.9 : 0.72,
    requiresConfirmation: true,
    needsClarification: false,
    aiReplyText: buildConfirmationReply(patch, hasCreateIntent),
    traitPatch: patch,
    operations,
    affectedLayers: hasCreateIntent ? affectedPaintLayers : [targetToLayer(inferRedrawTarget(text))],
    costHint: localCostHint()
  };
}

function normalizeText(text) {
  return text.replace(/\s+/g, "").replace(/[，。！？,.!?]/g, "");
}

function parseControl(text) {
  if (/暂停|停一下|先停/.test(text)) return { type: "pause" };
  if (/继续|恢复/.test(text)) return { type: "resume" };
  if (/撤销|上一步|退回/.test(text)) return { type: "undo" };
  if (/重做|恢复刚才/.test(text)) return { type: "redo" };
  if (/回放|重播/.test(text)) return { type: "replay" };
  if (/导出|保存图片|下载/.test(text)) return { type: "export" };
  return null;
}

function parseTraitPatch(text) {
  const patch = {};

  if (/男生|男性|男孩/.test(text)) patch.gender = "male";
  if (/女生|女性|女孩|少女/.test(text)) patch.gender = "female";
  if (/中性|无性别/.test(text)) patch.gender = "neutral";

  if (/长发/.test(text)) patch.hairLength = "long";
  if (/短发/.test(text)) patch.hairLength = "short";
  if (/中长发|中发/.test(text)) patch.hairLength = "medium";

  const hairColor = findHairColor(text);
  if (hairColor) patch.hairColor = hairColor;

  const eyeColor = findColorBefore(text, "眼");
  if (eyeColor) patch.eyeColor = eyeColor;

  if (/害羞/.test(text)) patch.expression = "害羞";
  if (/冷淡|高冷/.test(text)) patch.expression = "冷淡";
  if (/惊讶|吃惊/.test(text)) patch.expression = "惊讶";
  if (/微笑|笑/.test(text)) patch.expression = "微笑";

  if (/校服/.test(text)) patch.outfit = "school";
  if (/卫衣/.test(text)) patch.outfit = "hoodie";
  if (/衬衫/.test(text)) patch.outfit = "shirt";

  if (/眼镜/.test(text)) patch.accessory = "glasses";
  if (/蝴蝶结|发结/.test(text)) patch.accessory = "butterfly_knot";
  if (/不要配饰|去掉配饰|无配饰/.test(text)) patch.accessory = "none";

  if (/星空|星星/.test(text)) patch.backgroundStyle = "stars";
  if (/樱花/.test(text)) patch.backgroundStyle = "cherry";
  if (/渐变/.test(text)) patch.backgroundStyle = "gradient";
  if (/水彩/.test(text)) patch.backgroundStyle = "watercolor";

  return patch;
}

function findColorBefore(text, target) {
  for (const [keyword, value] of colorMap) {
    if (text.includes(`${keyword}色${target}`) || text.includes(`${keyword}${target}`)) {
      return value;
    }
  }
  return undefined;
}

function findHairColor(text) {
  for (const [keyword, value] of colorMap) {
    const pattern = new RegExp(`${keyword}色?(长发|短发|中长发|中发|头发|发)`);
    if (pattern.test(text)) {
      return value;
    }
  }
  return undefined;
}

function inferRedrawTarget(text) {
  if (/眼/.test(text)) return "eyes";
  if (/表情|笑|害羞|冷淡|惊讶/.test(text)) return "expression";
  if (/衣|校服|卫衣|衬衫/.test(text)) return "outfit";
  if (/眼镜|蝴蝶结|配饰/.test(text)) return "accessory";
  if (/背景|星空|樱花|渐变|水彩/.test(text)) return "background";
  return "hair";
}

function targetToLayer(target) {
  if (target === "background") return "layer-bg";
  if (target === "eyes" || target === "expression" || target === "accessory") return "layer-details";
  if (target === "outfit") return "layer-flats";
  return "layer-lineart";
}

function buildConfirmationReply(patch, isCreate) {
  const parts = [];
  if (patch.gender) parts.push(genderText(patch.gender));
  if (patch.hairLength) parts.push(lengthText(patch.hairLength));
  if (patch.hairColor) parts.push(`${colorText(patch.hairColor)}头发`);
  if (patch.eyeColor) parts.push(`${colorText(patch.eyeColor)}眼睛`);
  if (patch.expression) parts.push(`${patch.expression}表情`);
  if (patch.outfit) parts.push(outfitText(patch.outfit));
  if (patch.accessory && patch.accessory !== "none") parts.push(accessoryText(patch.accessory));
  if (patch.backgroundStyle) parts.push(backgroundText(patch.backgroundStyle));

  const description = parts.length > 0 ? parts.join("、") : "当前描述的角色设定";
  return isCreate ? `我会绘制${description}，确认开始吗？` : `我会把角色调整为${description}，确认修改吗？`;
}

function clarify(sessionId, projectId, transcript, question) {
  return {
    interpretationId: makeId("interp"),
    sessionId,
    projectId,
    transcript,
    normalizedText: normalizeText(transcript),
    intent: "clarify",
    confidence: 0.45,
    requiresConfirmation: false,
    needsClarification: true,
    aiReplyText: question,
    clarificationQuestion: question,
    operations: [],
    affectedLayers: [],
    costHint: localCostHint()
  };
}

function controlReply(type) {
  const replies = {
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

function genderText(value) {
  return value === "male" ? "男生" : value === "neutral" ? "中性角色" : "女生";
}

function lengthText(value) {
  return value === "short" ? "短发" : value === "medium" ? "中长发" : "长发";
}

function colorText(value) {
  const names = {
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

function outfitText(value) {
  return value === "hoodie" ? "卫衣" : value === "shirt" ? "衬衫" : "校服";
}

function accessoryText(value) {
  return value === "glasses" ? "眼镜" : value === "butterfly_knot" ? "蝴蝶结" : "无配饰";
}

function backgroundText(value) {
  const names = {
    gradient: "渐变背景",
    watercolor: "水彩风格",
    stars: "星空背景",
    cherry: "樱花背景"
  };
  return names[value];
}
