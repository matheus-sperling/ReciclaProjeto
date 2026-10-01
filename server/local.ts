import { createServer } from "node:http";
import { createServer as createVite, preview } from "vite";
import { handleNode } from "./http.ts";
try {
  process.loadEnvFile(".env.local");
} catch {}
process.env.APP_ORIGIN ||= "http://localhost:5173";
const api = createServer((req, res) => void handleNode(req, res));
api.listen(3001, "127.0.0.1");
const isPreview = process.argv.includes("--preview");
const vite = isPreview
  ? await preview({
      preview: {
        host: "127.0.0.1",
        port: 5173,
        proxy: { "/api": "http://127.0.0.1:3001" },
      },
    })
  : await createVite({ server: { host: "127.0.0.1", port: 5173 } });
if ("listen" in vite) await vite.listen();
vite.printUrls();
const shutdown = async () => {
  await vite.close();
  api.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
