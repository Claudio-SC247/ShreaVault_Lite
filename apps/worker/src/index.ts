import { isAdminAuthorized, unauthorizedResponse } from "./auth";
import { withCors } from "./cors";
import { checkRateLimit, getClientIp } from "./rate-limit";
import {
  MAX_FILE_SIZE,
  ValidationError,
  parseExpirationHours,
  resolveShareStatus,
  sanitizeFileName,
  validateFileInput
} from "./validation";
import { createObjectKey, deleteStoredFile, storeUploadedFile } from "./storage";

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  PUBLIC_BASE_URL?: string;
  MAX_UPLOAD_BYTES?: string;
  ADMIN_API_KEY?: string;
  CORS_ORIGIN?: string;
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

const ADMIN_RATE_LIMIT = { limit: 60, windowMs: 60_000 };
const SHARE_VIEW_RATE_LIMIT = { limit: 120, windowMs: 60_000 };
const adminRateLimitStore = new Map<string, { count: number; resetAt: number }>();
const shareViewRateLimitStore = new Map<string, { count: number; resetAt: number }>();

function json(request: Request, env: Env, data: unknown, init: ResponseInit = {}): Response {
  return withCors(
    request,
    new Response(JSON.stringify(data), {
      ...init,
      headers: {
        ...JSON_HEADERS,
        ...init.headers
      }
    }),
    env.CORS_ORIGIN
  );
}

function errorResponse(request: Request, env: Env, message: string, status = 400): Response {
  return json(request, env, { error: message }, { status });
}

function notFound(request: Request, env: Env): Response {
  return errorResponse(request, env, "Ruta no encontrada.", 404);
}

function rateLimitedResponse(request: Request, env: Env, retryAfterSeconds: number): Response {
  return json(request, env, { error: "Demasiadas solicitudes. Intenta de nuevo mas tarde." }, {
    status: 429,
    headers: {
      "retry-after": String(retryAfterSeconds)
    }
  });
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

function requireAdmin(request: Request, env: Env): Response | null {
  if (!isAdminAuthorized(request, env.ADMIN_API_KEY)) {
    return withCors(request, unauthorizedResponse(), env.CORS_ORIGIN);
  }

  const rateLimit = checkRateLimit(`admin:${getClientIp(request)}`, ADMIN_RATE_LIMIT, adminRateLimitStore);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(request, env, rateLimit.retryAfterSeconds);
  }

  return null;
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

  return json(request, env, { share: toShareDto(row, request, env) }, { status: 201 });
}

function parseListLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }

  return Math.min(Math.floor(parsed), 100);
}

function parseListCursor(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function listShares(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const limit = parseListLimit(url.searchParams.get("limit"));
  const cursor = parseListCursor(url.searchParams.get("cursor"));
  const fetchLimit = limit + 1;

  const statement = cursor
    ? env.DB.prepare(
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
        WHERE created_at < ?
        ORDER BY created_at DESC
        LIMIT ?`
      ).bind(cursor, fetchLimit)
    : env.DB.prepare(
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
        LIMIT ?`
      ).bind(fetchLimit);

  const result = await statement.all<ShareRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null;

  return json(request, env, {
    shares: page.map((row) => toShareDto(row, request, env)),
    nextCursor
  });
}

async function deleteShare(request: Request, id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT object_key FROM shares WHERE id = ?")
    .bind(id)
    .first<Pick<ShareRow, "object_key">>();

  if (!row) {
    return errorResponse(request, env, "Enlace no encontrado.", 404);
  }

  await deleteStoredFile(env.BUCKET, row.object_key);
  await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(id).run();

  return json(request, env, { deleted: true });
}

async function revokeShare(request: Request, id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT revoked_at FROM shares WHERE id = ?")
    .bind(id)
    .first<Pick<ShareRow, "revoked_at">>();

  if (!row) {
    return errorResponse(request, env, "Enlace no encontrado.", 404);
  }

  if (row.revoked_at) {
    return json(request, env, { revokedAt: new Date(row.revoked_at).toISOString() });
  }

  const now = Date.now();
  await env.DB.prepare("UPDATE shares SET revoked_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return json(request, env, { revokedAt: new Date(now).toISOString() });
}

async function viewShare(request: Request, token: string, env: Env): Promise<Response> {
  const rateLimit = checkRateLimit(`share:${getClientIp(request)}`, SHARE_VIEW_RATE_LIMIT, shareViewRateLimitStore);
  if (!rateLimit.allowed) {
    return rateLimitedResponse(request, env, rateLimit.retryAfterSeconds);
  }

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
    return errorResponse(request, env, "Enlace no encontrado.", 404);
  }

  const status = resolveShareStatus({
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at
  });

  if (status === "revoked") {
    return errorResponse(request, env, "El enlace fue revocado.", 410);
  }

  if (status === "expired") {
    return errorResponse(request, env, "El enlace expiro.", 410);
  }

  const object = await env.BUCKET.get(row.object_key);
  if (!object) {
    return errorResponse(request, env, "Archivo no disponible.", 404);
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

  return withCors(request, new Response(object.body, { headers }), env.CORS_ORIGIN);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, { status: 204 }), env.CORS_ORIGIN);
  }

  const url = new URL(request.url);
  const pathParts = url.pathname.split("/").filter(Boolean);

  if (request.method === "GET" && url.pathname === "/api/health") {
    return json(request, env, { ok: true });
  }

  if (request.method === "POST" && url.pathname === "/api/files") {
    const authError = requireAdmin(request, env);
    if (authError) {
      return authError;
    }

    return createShare(request, env);
  }

  if (request.method === "GET" && url.pathname === "/api/shares") {
    const authError = requireAdmin(request, env);
    if (authError) {
      return authError;
    }

    return listShares(request, env);
  }

  if (
    request.method === "DELETE" &&
    pathParts.length === 3 &&
    pathParts[0] === "api" &&
    pathParts[1] === "shares"
  ) {
    const authError = requireAdmin(request, env);
    if (authError) {
      return authError;
    }

    return deleteShare(request, pathParts[2], env);
  }

  if (
    request.method === "POST" &&
    pathParts.length === 4 &&
    pathParts[0] === "api" &&
    pathParts[1] === "shares" &&
    pathParts[3] === "revoke"
  ) {
    const authError = requireAdmin(request, env);
    if (authError) {
      return authError;
    }

    return revokeShare(request, pathParts[2], env);
  }

  if (request.method === "GET" && pathParts.length === 2 && pathParts[0] === "share") {
    return viewShare(request, pathParts[1], env);
  }

  return notFound(request, env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      if (error instanceof ValidationError) {
        return errorResponse(request, env, error.message, error.status);
      }

      console.error(error);
      return errorResponse(request, env, "Error interno.", 500);
    }
  }
};
