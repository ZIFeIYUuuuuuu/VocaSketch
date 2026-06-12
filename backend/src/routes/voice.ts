import multer from "multer";
import { Router } from "express";

import { appConfig } from "../config.js";
import { ApiError, asyncHandler, validationError } from "../errors.js";
import { getProject } from "../storage/projectStore.js";
import { getSession } from "../storage/sessionStore.js";
import { deleteTempAudio, readTtsAudio, saveTempAudio } from "../voice/audioStore.js";
import { transcribeWithDashScope } from "../voice/dashscopeAsr.js";
import { synthesizeWithDashScope } from "../voice/dashscopeTts.js";
import { asrFieldsSchema, ttsRequestSchema } from "../voice/voiceSchemas.js";

export const voiceRouter = Router();
export const audioAssetsRouter = Router();
let voiceFetchImplForTest: typeof fetch | undefined;

export function setVoiceFetchForTest(fetchImpl: typeof fetch | undefined) {
  voiceFetchImplForTest = fetchImpl;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: appConfig.voice.maxAudioMb * 1024 * 1024,
    files: 1
  }
});

voiceRouter.post(
  "/asr",
  upload.single("audio"),
  asyncHandler(async (req, res) => {
    const parsed = asrFieldsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    if (!req.file) {
      throw new ApiError({
        statusCode: 400,
        code: "REQUEST_INVALID",
        message: "缺少音频文件 audio。"
      });
    }

    await assertVoiceProjectAccess(parsed.data.sessionId, parsed.data.projectId);

    const tempAudioPath = await saveTempAudio(req.file.buffer, parsed.data.format);
    let result: Awaited<ReturnType<typeof transcribeWithDashScope>>;
    try {
      result = await transcribeWithDashScope({
        audioPath: tempAudioPath,
        fields: parsed.data
      }, {
        fetchImpl: voiceFetchImplForTest
      });
    } finally {
      await deleteTempAudio(tempAudioPath);
    }

    res.json(result);
  })
);

voiceRouter.post(
  "/tts",
  asyncHandler(async (req, res) => {
    const parsed = ttsRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw validationError(parsed.error);
    }

    if (parsed.data.text.length > appConfig.voice.maxTtsChars) {
      throw new ApiError({
        statusCode: 400,
        code: "REQUEST_INVALID",
        message: `语音回复文本不能超过 ${appConfig.voice.maxTtsChars} 个字符。`
      });
    }

    if (parsed.data.projectId) {
      await assertVoiceProjectAccess(parsed.data.sessionId, parsed.data.projectId);
    } else {
      await assertSessionExists(parsed.data.sessionId);
    }

    const result = await synthesizeWithDashScope(parsed.data, {
      fetchImpl: voiceFetchImplForTest
    });
    res.json(result);
  })
);

async function assertSessionExists(sessionId: string) {
  const session = await getSession(sessionId);
  if (!session) {
    throw new ApiError({
      statusCode: 404,
      code: "SESSION_NOT_FOUND",
      message: "会话不存在，请先创建 session。"
    });
  }
}

async function assertVoiceProjectAccess(sessionId: string, projectId: string) {
  await assertSessionExists(sessionId);

  const project = await getProject(projectId);
  if (!project) {
    throw new ApiError({
      statusCode: 404,
      code: "PROJECT_NOT_FOUND",
      message: "工程不存在。"
    });
  }

  if (project.sessionId !== sessionId) {
    throw new ApiError({
      statusCode: 404,
      code: "SESSION_PROJECT_MISMATCH",
      message: "工程不属于当前会话。"
    });
  }
}

audioAssetsRouter.get(
  "/audio/:filename",
  asyncHandler(async (req, res) => {
    const audio = await readTtsAudio(req.params.filename);
    res.type(audio.mimeType).send(audio.buffer);
  })
);
