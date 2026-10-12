// nginx 相当の小さな Node サーバー: frontend/ を静的配信し、/api を backend へ中継する。
// frontend/nginx.conf と同じセキュリティヘッダを付ける（本物の nginx の検証は @compose の 4 ケースだけ）。
import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "cross-origin-embedder-policy": "require-corp",
};

const BAD_GATEWAY =
  "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>";
const MAX_RECORDED_BYTES = 200_000;

function readBody(stream) {
  return new Promise((resolve) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", () => resolve(Buffer.concat(chunks)));
  });
}

function parseJson(buffer) {
  if (buffer.length === 0 || buffer.length > MAX_RECORDED_BYTES) return undefined;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return undefined;
  }
}

async function proxy(req, res, { port, record }) {
  const requestBody = await readBody(req);
  const entry = { method: req.method, path: req.url, requestBody: parseJson(requestBody) };
  if (!port) {
    record({ ...entry, status: 502 });
    res.writeHead(502, { "content-type": "text/html", ...SECURITY_HEADERS });
    res.end(BAD_GATEWAY);
    return;
  }
  const upstream = httpRequest(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      agent: false,
      headers: { ...req.headers, host: `127.0.0.1:${port}` },
    },
    async (upstreamRes) => {
      const body = await readBody(upstreamRes);
      record({ ...entry, status: upstreamRes.statusCode, responseBody: parseJson(body) });
      res.writeHead(upstreamRes.statusCode, { ...upstreamRes.headers, ...SECURITY_HEADERS });
      res.end(body);
    },
  );
  upstream.on("error", () => {
    record({ ...entry, status: 502 });
    res.writeHead(502, { "content-type": "text/html", ...SECURITY_HEADERS });
    res.end(BAD_GATEWAY);
  });
  upstream.end(requestBody);
}

async function serveStatic(req, res, frontendDir) {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  const file = path.resolve(frontendDir, relative);
  const insideRoot = file.startsWith(`${path.resolve(frontendDir)}${path.sep}`);
  const isTestOrConfig = /^(test|nginx\.conf|Dockerfile|package\.json)/.test(relative);
  try {
    if (!insideRoot || isTestOrConfig) throw new Error("not found");
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
      ...SECURITY_HEADERS,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain", ...SECURITY_HEADERS });
    res.end("not found");
  }
}

/**
 * @param {{ frontendDir: string, getBackendPort: () => number | null, record: (entry: object) => void }} options
 * @returns {Promise<{ port: number, close: () => Promise<void> }>}
 */
export async function startFrontendServer({ frontendDir, getBackendPort, record }) {
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok\n");
    } else if (req.url.startsWith("/api/")) {
      proxy(req, res, { port: getBackendPort(), record });
    } else {
      serveStatic(req, res, frontendDir);
    }
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
