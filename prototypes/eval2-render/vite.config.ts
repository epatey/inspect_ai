import react from "@vitejs/plugin-react";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { defineConfig, type Plugin } from "vite";

// PROTOTYPE — serves extracted .eval2 sample dirs as static files under /data/*.
// Extracted-dir GETs stand in for zip-member range reads (mechanics settled by
// research ticket #3); chunk starts come from the shell's `sequences`, standing
// in for the central directory.
const LOG_ROOT = process.env.LOG_ROOT ?? "/private/tmp/newevals";

const serveLogData = (): Plugin => ({
  name: "serve-log-data",
  configureServer(server) {
    server.middlewares.use("/data", (req, res, next) => {
      const rel = normalize(decodeURIComponent((req.url ?? "/").split("?")[0]));
      if (rel.includes("..")) return next();
      const path = join(LOG_ROOT, rel);
      if (!existsSync(path) || !statSync(path).isFile()) {
        res.statusCode = 404;
        return res.end("not found: " + path);
      }
      res.setHeader("content-type", "application/json");
      res.setHeader("x-content-length", String(statSync(path).size));
      createReadStream(path).pipe(res);
    });
  },
});

export default defineConfig({
  plugins: [react(), serveLogData()],
});
