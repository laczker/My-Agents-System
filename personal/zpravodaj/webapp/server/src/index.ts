import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { HOST, PORT, CLIENT_DIST } from "./config.js";
import { listDigests, getDigest, type DigestType } from "./store.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

async function serveStatic(urlPath: string, res: import("node:http").ServerResponse): Promise<void> {
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(CLIENT_DIST, safePath === "/" ? "index.html" : safePath);
  if (!existsSync(filePath) || !filePath.startsWith(CLIENT_DIST)) {
    filePath = join(CLIENT_DIST, "index.html"); // SPA fallback (hash routing stejně server nevidí)
  }
  const body = await readFile(filePath);
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (url.pathname === "/api/digests") {
      const type = url.searchParams.get("type") as DigestType | null;
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(listDigests(type ?? undefined)));
      return;
    }

    const detailMatch = url.pathname.match(/^\/api\/digests\/([^/]+)$/);
    if (detailMatch) {
      const digest = getDigest(detailMatch[1]);
      if (!digest) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(digest));
      return;
    }

    await serveStatic(url.pathname, res);
  } catch (err) {
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Zpravodaj webapp naslouchá na http://${HOST}:${PORT}`);
});
