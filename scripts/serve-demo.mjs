#!/usr/bin/env node
// One-origin demo server: company app + CK's landing at /, employee app at /app/, the docs at /docs/,
// API proxied at /api. The old layout (/sender/, and invite links at /#/join) redirects to the new one.
// Put it behind `tailscale serve` (HTTPS, so WebCrypto works) to use the apps from another device.
//
//   node scripts/serve-demo.mjs            # PORT=4300, API_TARGET=http://localhost:8787
//
// Build the apps first with the public origin baked in (see scripts/build-demo.sh).
import { createServer, request } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT ?? 4300);
const HOST = process.env.HOST ?? "127.0.0.1";
const API = new URL(process.env.API_TARGET ?? "http://localhost:8787");
const ROOT = new URL("..", import.meta.url).pathname;
const MOUNTS = [
  // Docs first: the most specific prefix must win over "/". A static site, so it has a real 404 page.
  { prefix: "/docs/", dir: join(ROOT, "apps/docs/dist"), notFound: "404.html" },
  { prefix: "/app/", dir: join(ROOT, "apps/recipient/dist") },
  { prefix: "/", dir: join(ROOT, "apps/sender/dist") },
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
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function sendFile(res, path, status = 200) {
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  // Hashed assets can be cached; HTML must not be.
  const cache = path.endsWith(".html") ? "no-store" : "public, max-age=31536000, immutable";
  res.writeHead(status, { "content-type": type, "cache-control": cache });
  createReadStream(path).pipe(res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/app") return res.writeHead(301, { location: "/app/" }).end();
  if (url.pathname === "/docs") return res.writeHead(301, { location: "/docs/" }).end();
  if (url.pathname === "/sender" || url.pathname.startsWith("/sender/")) return res.writeHead(301, { location: "/" }).end();
  const mount = MOUNTS.find((m) => url.pathname.startsWith(m.prefix));
  const rel = normalize(decodeURIComponent(url.pathname.slice(mount.prefix.length))).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(mount.dir, rel);
  if (!candidate.startsWith(mount.dir)) return res.writeHead(400).end();
  try {
    const st = statSync(candidate);
    if (st.isFile()) return sendFile(res, candidate);
    // Static-site directory (the docs build one folder per page): serve its index.
    if (st.isDirectory()) return sendFile(res, join(candidate, "index.html"));
  } catch {
    /* fall through */
  }
  // A static site has a real 404 page; the SPAs fall back to their entry (hash routing).
  if (mount.notFound) return sendFile(res, join(mount.dir, mount.notFound), 404);
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
  HOST,
  () => console.log(`demo server on http://${HOST}:${PORT} (company /, employee /app/, docs /docs/, api /api → ${API.origin})`),
);
