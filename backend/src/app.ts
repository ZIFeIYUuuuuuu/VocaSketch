import cors from "cors";
import express from "express";

import { appConfig } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { commandsRouter } from "./routes/commands.js";
import { healthRouter } from "./routes/health.js";
import { projectsRouter } from "./routes/projects.js";
import { runtimeConfigRouter } from "./routes/runtimeConfig.js";
import { sessionsRouter } from "./routes/sessions.js";
import { audioAssetsRouter, voiceRouter } from "./routes/voice.js";

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || appConfig.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(null, false);
      }
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1/health", healthRouter);
  app.use("/api/v1/config/runtime", runtimeConfigRouter);
  app.use("/api/v1/sessions", sessionsRouter);
  app.use("/api/v1/projects", projectsRouter);
  app.use("/api/v1/commands", commandsRouter);
  app.use("/api/v1/voice", voiceRouter);
  app.use("/api/v1/assets", audioAssetsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
