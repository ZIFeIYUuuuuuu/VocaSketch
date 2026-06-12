import { createApp } from "./app.js";
import { appConfig } from "./config.js";
import { ensureStorageReady } from "./storage/fileStore.js";
import { attachRealtimeAsrSocket } from "./voice/realtimeAsrSocket.js";

await ensureStorageReady();

const app = createApp();

const server = app.listen(appConfig.port, () => {
  console.log(`VocaSketch backend listening on http://localhost:${appConfig.port}`);
});

attachRealtimeAsrSocket(server);
