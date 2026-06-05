export const MAX_FILE_SIZE = 25 * 1024 * 1024;

export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain"
]);

export type FileInput = {
  name: string;
  size: number;
  type: string;
};

export type ShareStatus = "active" | "expired" | "revoked";

export type ShareStatusInput = {
  expiresAt: number;
  revokedAt: number | null;
};

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function sanitizeFileName(fileName: string): string {
  const rawBaseName = fileName.split(/[\\/]/).pop()?.trim() || "file";
  const cleaned = rawBaseName
    .normalize("NFKD")
    .replace(/[^\w. -]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);

  return cleaned || "file";
}

export function validateFileInput(file: FileInput, maxSize = MAX_FILE_SIZE): void {
  if (file.size <= 0) {
    throw new ValidationError("El archivo esta vacio.");
  }

  if (file.size > maxSize) {
    throw new ValidationError(`El archivo supera el limite de ${Math.floor(maxSize / 1024 / 1024)} MB.`);
  }

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new ValidationError("Tipo de archivo no permitido.");
  }
}

export function parseExpirationHours(value: FormDataEntryValue | null, now = Date.now()): number {
  const rawValue = typeof value === "string" && value.trim() ? Number(value) : 24;

  if (!Number.isFinite(rawValue)) {
    throw new ValidationError("Expiracion invalida.");
  }

  const hours = Math.trunc(rawValue);
  if (hours < 1 || hours > 168) {
    throw new ValidationError("La expiracion debe estar entre 1 hora y 7 dias.");
  }

  return now + hours * 60 * 60 * 1000;
}

export function resolveShareStatus(share: ShareStatusInput, now = Date.now()): ShareStatus {
  if (share.revokedAt) {
    return "revoked";
  }

  if (share.expiresAt <= now) {
    return "expired";
  }

  return "active";
}

