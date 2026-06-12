import { Router } from "express";

import { appConfig } from "../config.js";

export const runtimeConfigRouter = Router();

runtimeConfigRouter.get("/", (_req, res) => {
  res.json(appConfig.runtime);
});
