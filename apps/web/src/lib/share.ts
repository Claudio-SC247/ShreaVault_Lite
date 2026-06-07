export const DEFAULT_API_BASE_URL = "http://localhost:8787";

export const EXPIRATION_OPTIONS = [
  { label: "1 h", value: "1" },
  { label: "24 h", value: "24" },
  { label: "3 dias", value: "72" },
  { label: "7 dias", value: "168" }
] as const;

export type ShareStatus = "active" | "expired" | "revoked";

export type ShareRecord = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
  status: ShareStatus;
  shareUrl: string;
};

export type SharesResponse = {
  shares: ShareRecord[];
  nextCursor: number | null;
};

export function normalizeApiBaseUrl(value: string | undefined | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  return trimmed.replace(/\/+$/, "");
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedBase = normalizeApiBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function getAdminAuthHeaders(): HeadersInit {
  const key = process.env.NEXT_PUBLIC_ADMIN_API_KEY?.trim();
  if (!key) {
    return {};
  }

  return {
    authorization: `Bearer ${key}`
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  const formatted = value.toFixed(value >= 10 || exponent === 0 ? 0 : 1).replace(/\.0$/, "");
  return `${formatted} ${units[exponent]}`;
}

export function resolveStatus(
  share: Pick<ShareRecord, "expiresAt" | "revokedAt">,
  now = new Date()
): ShareStatus {
  if (share.revokedAt) {
    return "revoked";
  }

  if (new Date(share.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }

  return "active";
}

export type SharePreviewMode = "image" | "pdf" | "text" | "download";

export function resolveSharePreviewMode(mimeType: string): SharePreviewMode {
  const normalized = mimeType.toLowerCase();

  if (normalized.startsWith("image/")) {
    return "image";
  }

  if (normalized === "application/pdf") {
    return "pdf";
  }

  if (normalized.startsWith("text/")) {
    return "text";
  }

  return "download";
}

export function extractFileName(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) {
    return fallback;
  }

  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] ?? fallback;
}

export function extractShareToken(shareUrl: string): string | null {
  try {
    const pathname = new URL(shareUrl).pathname;
    const token = pathname.split("/").filter(Boolean).at(-1);
    return token || null;
  } catch {
    return null;
  }
}
