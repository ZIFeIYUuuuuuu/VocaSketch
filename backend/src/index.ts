import { createApp } from "./app.js";
import { appConfig } from "./config.js";
import { ensureStorageReady } from "./storage/fileStore.js";

await ensureStorageReady();

const app = createApp();

app.listen(appConfig.port, () => {
  console.log(`VocaSketch backend listening on http://localhost:${appConfig.port}`);
});
