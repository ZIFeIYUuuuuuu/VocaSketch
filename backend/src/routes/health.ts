import { Router } from "express";

import { appConfig, getProviderStatuses } from "../config.js";
import { asyncHandler } from "../errors.js";
import { getStorageStatus } from "../storage/fileStore.js";

export const healthRouter = Router();

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({
      ok: true,
      version: appConfig.version,
      env: appConfig.env,
      providers: getProviderStatuses(),
      storage: await getStorageStatus()
    });
  })
);
