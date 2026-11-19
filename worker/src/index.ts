export interface Env {
  BUCKET: R2Bucket;
  UPLOAD_TOKEN: string;
  MAX_BYTES: string;
  DEFAULT_TTL_DAYS: string;
  MAX_TTL_DAYS: string;
}

// Tipos que o navegador pode exibir inline com segurança.
// HTML/SVG/JS ficam de fora de propósito (risco de XSS): viram download.
const INLINE_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);
const TEXT_EXT = new Set(["txt", "csv", "log", "md", "json", "tsv"]);
const PREVIEW_LIMIT = 1024 * 1024; // 1 MB de texto no visualizador

type Kind = "image" | "pdf" | "text" | "other";

function detectKind(name: string, type: string): Kind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (INLINE_IMAGE.has(type)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (type.startsWith("text/") && type !== "text/html" || TEXT_EXT.has(ext)) return "text";
  return "other";
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Filename, X-TTL-Days",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getLive(env: Env, id: string): Promise<R2Object | null> {
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(id)) return null;
  const head = await env.BUCKET.head(id);
  if (!head) return null;
  const exp = Number(head.customMetadata?.expiresAt ?? 0);
  if (exp && Date.now() > exp) {
    await env.BUCKET.delete(id);
    return null;
  }
  return head;
}

async function upload(req: Request, env: Env): Promise<Response> {
  const auth = req.headers.get("Authorization") ?? "";
  if (!env.UPLOAD_TOKEN || auth !== `Bearer ${env.UPLOAD_TOKEN}`) return json({ error: "unauthorized" }, 401);

  const len = Number(req.headers.get("Content-Length") ?? 0);
  if (!len) return json({ error: "Content-Length required" }, 411);
  if (len > Number(env.MAX_BYTES)) return json({ error: "file too large" }, 413);

  const name = decodeURIComponent(req.headers.get("X-Filename") ?? "file").slice(0, 200) || "file";
  const type = (req.headers.get("Content-Type") ?? "application/octet-stream").split(";")[0].trim();
  const ttlDays = Math.min(
    Math.max(Number(req.headers.get("X-TTL-Days") ?? env.DEFAULT_TTL_DAYS) || 1, 1),
    Number(env.MAX_TTL_DAYS),
  );

  const id = newId();
  await env.BUCKET.put(id, req.body, {
    httpMetadata: { contentType: type },
    customMetadata: { name, expiresAt: String(Date.now() + ttlDays * 86400_000) },
  });

  const origin = new URL(req.url).origin;
  return json({ id, url: `${origin}/v/${id}`, raw: `${origin}/f/${id}`, expiresInDays: ttlDays });
}

async function raw(env: Env, id: string): Promise<Response> {
  const head = await getLive(env, id);
  if (!head) return new Response("Not found", { status: 404 });
  const obj = await env.BUCKET.get(id);
  if (!obj) return new Response("Not found", { status: 404 });

  const name = head.customMetadata?.name ?? "file";
  const type = head.httpMetadata?.contentType ?? "application/octet-stream";
  const kind = detectKind(name, type);
  const safeName = encodeURIComponent(name);

  const headers = new Headers({
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
  });
  if (kind === "image" || kind === "pdf") {
    headers.set("Content-Type", kind === "pdf" ? "application/pdf" : type);
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${safeName}`);
    headers.set("Content-Security-Policy", "sandbox");
  } else if (kind === "text") {
    headers.set("Content-Type", "text/plain; charset=utf-8");
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${safeName}`);
  } else {
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename*=UTF-8''${safeName}`);
  }
  return new Response(obj.body, { headers });
}

async function viewer(env: Env, id: string): Promise<Response> {
  const head = await getLive(env, id);
  if (!head) return new Response("Arquivo não encontrado ou expirado", { status: 404 });

  const name = head.customMetadata?.name ?? "file";
  const type = head.httpMetadata?.contentType ?? "application/octet-stream";
  const kind = detectKind(name, type);
  const rawUrl = `/f/${id}`;
  const dl = `<a class="btn" href="${rawUrl}" download="${escapeHtml(name)}">Baixar</a>`;

  let body: string;
  if (kind === "image") {
    body = `<img src="${rawUrl}" alt="${escapeHtml(name)}">`;
  } else if (kind === "pdf") {
    body = `<iframe src="${rawUrl}" title="${escapeHtml(name)}"></iframe>`;
  } else if (kind === "text") {
    const obj = await env.BUCKET.get(id, { range: { offset: 0, length: PREVIEW_LIMIT } });
    const text = obj ? await obj.text() : "";
    const truncated = head.size > PREVIEW_LIMIT ? "\n\n[… pré-visualização truncada, baixe o arquivo completo …]" : "";
    body = `<pre>${escapeHtml(text + truncated)}</pre>`;
  } else {
    body = `<p>Não é possível pré-visualizar este tipo de arquivo (${escapeHtml(type)}, ${head.size} bytes).</p>`;
  }

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(name)}</title>
<style>
body{margin:0;font:15px system-ui,sans-serif;background:#f6f7f9;color:#222}
header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:10px 16px;background:#fff;border-bottom:1px solid #ddd}
.btn{background:#0b66e4;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none}
main{padding:16px}img{max-width:100%}iframe{width:100%;height:calc(100vh - 80px);border:0}
pre{white-space:pre-wrap;word-break:break-word;background:#fff;padding:16px;border-radius:6px}
</style></head><body><header><strong>${escapeHtml(name)}</strong>${dl}</header><main>${body}</main></body></html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; frame-src 'self'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "POST" && pathname === "/upload") return upload(req, env);
    if (req.method === "GET") {
      const m = pathname.match(/^\/([fv])\/([^/]+)$/);
      if (m) return m[1] === "f" ? raw(env, m[2]) : viewer(env, m[2]);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
