import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
const base = path.resolve(process.env.SERVE_DIR || ".");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
http
  .createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        base,
        "." + pathname,
        pathname.endsWith("/") ? "index.html" : "",
      );
      if (!file.startsWith(base + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": mime[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  })
  .listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
    console.log("Wordloop: http://localhost:" + (process.env.PORT || 4173)),
  );
