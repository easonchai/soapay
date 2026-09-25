#!/usr/bin/env node
// One-origin demo server: recipient app at /, sender app at /sender/, API proxied at /api.
// Put it behind `tailscale serve` (HTTPS, so WebCrypto works) to use the apps from another device.
//
//   node scripts/serve-demo.mjs            # PORT=4300, API_TARGET=http://localhost:8787
//
// Build the apps first with the public origin baked in (see scripts/build-demo.sh).
import { createServer, request } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4300);
const API = new URL(process.env.API_TARGET ?? "http://localhost:8787");
const ROOT = new URL("..", import.meta.url).pathname;
const MOUNTS = [
  { prefix: "/sender/", dir: join(ROOT, "apps/sender/dist") },
  { prefix: "/", dir: join(ROOT, "apps/recipient/dist") },
];
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".ico": "image/x-icon",
};

function sendFile(res, path) {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  // Hashed assets can be cached; index.html must not be.
  const cache = path.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable";
  res.writeHead(200, { "content-type": type, "cache-control": cache });
  createReadStream(path).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/sender") return res.writeHead(301, { location: "/sender/" }).end();
  const mount = MOUNTS.find((m) => url.pathname.startsWith(m.prefix));
  const rel = normalize(decodeURIComponent(url.pathname.slice(mount.prefix.length))).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(mount.dir, rel);
  if (!candidate.startsWith(mount.dir)) return res.writeHead(400).end();
  try {
    if (statSync(candidate).isFile()) return sendFile(res, candidate);
  } catch {
    /* fall through to the SPA entry (hash routing) */
  }
  sendFile(res, join(mount.dir, "index.html"));
}

function proxyApi(req, res) {
  const path = req.url.replace(/^\/api/, "") || "/";
  const upstream = request(
    { hostname: API.hostname, port: API.port, path, method: req.method, headers: { ...req.headers, host: API.host } },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => res.writeHead(502, { "content-type": "application/json" }).end('{"error":{"code":"api_down"}}'));
  req.pipe(upstream);
}

createServer((req, res) => (req.url.startsWith("/api/") || req.url === "/api" ? proxyApi(req, res) : serveStatic(req, res))).listen(
  PORT,
  "127.0.0.1",
  () => console.log(`demo server on http://127.0.0.1:${PORT} (recipient /, sender /sender/, api /api → ${API.origin})`),
);
