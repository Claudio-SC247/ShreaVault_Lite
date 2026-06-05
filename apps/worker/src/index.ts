import {
  MAX_FILE_SIZE,
  ValidationError,
  parseExpirationHours,
  resolveShareStatus,
  sanitizeFileName,
  validateFileInput
} from "./validation";
import { createObjectKey, storeUploadedFile } from "./storage";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  PUBLIC_BASE_URL?: string;
  MAX_UPLOAD_BYTES?: string;
}

export type ShareRow = {
  id: string;
  token: string;
  file_name: string;
  mime_type: string;
  size: number;
  object_key: string;
  expires_at: number;
  revoked_at: number | null;
  created_at: number;
  downloaded_at: number | null;
};

export type ShareDto = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  status: ReturnType<typeof resolveShareStatus>;
  shareUrl: string;
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type"
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return withCors(
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        ...JSON_HEADERS,
        ...init.headers
      }
    })
  );
}

function errorResponse(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

function notFound(): Response {
  return errorResponse("Ruta no encontrada.", 404);
}

function getPublicBaseUrl(request: Request, env: Env): string {
  return (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/+$/, "");
}

export function getMaxUploadBytes(env: Env): number {
  const parsed = Number(env.MAX_UPLOAD_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_FILE_SIZE) : MAX_FILE_SIZE;
}

function createToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\r\n]/g, "");
}

export function toShareDto(row: ShareRow, request: Request, env: Env): ShareDto {
  return {
    id: row.id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    size: row.size,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    status: resolveShareStatus({
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at
    }),
    shareUrl: `${getPublicBaseUrl(request, env)}/share/${row.token}`
  };
}

export async function createShare(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const uploadedFile = form.get("file");

  if (!(uploadedFile instanceof File)) {
    throw new ValidationError("Debes enviar un archivo.");
  }

  validateFileInput(uploadedFile, getMaxUploadBytes(env));

  const id = crypto.randomUUID();
  const token = createToken();
  const safeFileName = sanitizeFileName(uploadedFile.name);
  const objectKey = createObjectKey(id, safeFileName);
  const now = Date.now();
  const expiresAt = parseExpirationHours(form.get("expiresInHours"), now);
  const mimeType = uploadedFile.type || "application/octet-stream";

  await storeUploadedFile(env.BUCKET, objectKey, uploadedFile, mimeType, safeFileName);

  await env.DB.prepare(
    `INSERT INTO shares (
      id,
      token,
      file_name,
      mime_type,
      size,
      object_key,
      expires_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, token, safeFileName, mimeType, uploadedFile.size, objectKey, expiresAt, now)
    .run();

  const row: ShareRow = {
    id,
    token,
    file_name: safeFileName,
    mime_type: mimeType,
    size: uploadedFile.size,
    object_key: objectKey,
    expires_at: expiresAt,
    revoked_at: null,
    created_at: now,
    downloaded_at: null
  };

  return json({ share: toShareDto(row, request, env) }, { status: 201 });
}

async function listShares(request: Request, env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT
      id,
      token,
      file_name,
      mime_type,
      size,
      object_key,
      expires_at,
      revoked_at,
      created_at,
      downloaded_at
    FROM shares
    ORDER BY created_at DESC
    LIMIT 100`
  ).all<ShareRow>();

  return json({
    shares: (result.results ?? []).map((row) => toShareDto(row, request, env))
  });
}

async function revokeShare(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT revoked_at FROM shares WHERE id = ?")
    .bind(id)
    .first<Pick<ShareRow, "revoked_at">>();

  if (!row) {
    return errorResponse("Enlace no encontrado.", 404);
  }

  if (row.revoked_at) {
    return json({ revokedAt: new Date(row.revoked_at).toISOString() });
  }

  const now = Date.now();
  await env.DB.prepare("UPDATE shares SET revoked_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return json({ revokedAt: new Date(now).toISOString() });
}

async function viewShare(token: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT
      id,
      token,
      file_name,
      mime_type,
      size,
      object_key,
      expires_at,
      revoked_at,
      created_at,
      downloaded_at
    FROM shares
    WHERE token = ?`
  )
    .bind(token)
    .first<ShareRow>();

  if (!row) {
    return errorResponse("Enlace no encontrado.", 404);
  }

  const status = resolveShareStatus({
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  });

  if (status === "revoked") {
    return errorResponse("El enlace fue revocado.", 410);
  }

  if (status === "expired") {
    return errorResponse("El enlace expiro.", 410);
  }

  const object = await env.BUCKET.get(row.object_key);
  if (!object) {
    return errorResponse("Archivo no disponible.", 404);
  }

  await env.DB.prepare("UPDATE shares SET downloaded_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", row.mime_type || "application/octet-stream");
  headers.set("content-disposition", `inline; filename="${escapeHeaderValue(row.file_name)}"`);
  headers.set("cache-control", "private, no-store");
  headers.set("etag", object.httpEtag);

  return withCors(new Response(object.body, { headers }));
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(new Response(null, { status: 204 }));
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json({ ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/files") {
    return createShare(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/shares") {
    return listShares(request, env);
  }

  if (
    request.method === "POST" &&
    pathParts.length === 4 &&
    pathParts[0] === "api" &&
    pathParts[1] === "shares" &&
    pathParts[3] === "revoke"
  ) {
    return revokeShare(pathParts[2], env);
  }

  if (request.method === "GET" && pathParts.length === 2 && pathParts[0] === "share") {
    return viewShare(pathParts[1], env);
  }

  return notFound();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      if (error instanceof ValidationError) {
        return errorResponse(error.message, error.status);
      }

      console.error(error);
      return errorResponse("Error interno.", 500);
    }
  }
};
