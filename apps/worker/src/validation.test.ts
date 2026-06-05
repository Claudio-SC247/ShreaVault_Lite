import { describe, expect, it } from "vitest";
import {
  MAX_FILE_SIZE,
  parseExpirationHours,
  resolveShareStatus,
  sanitizeFileName,
  validateFileInput
} from "./validation";

describe("validation", () => {
  it("sanitizes filenames without path segments", () => {
    expect(sanitizeFileName("../contrato final.pdf")).toBe("contrato-final.pdf");
    expect(sanitizeFileName("factura:junio?.txt")).toBe("facturajunio.txt");
  });

  it("accepts known file types under the size limit", () => {
    expect(() =>
      validateFileInput({
        name: "evidencia.pdf",
        size: 1024,
        type: "application/pdf"
      })
    ).not.toThrow();
  });

  it("rejects empty, oversized and unsupported files", () => {
    expect(() => validateFileInput({ name: "empty.txt", size: 0, type: "text/plain" })).toThrow("vacio");
    expect(() => validateFileInput({ name: "large.zip", size: MAX_FILE_SIZE + 1, type: "application/zip" })).toThrow("limite");
    expect(() => validateFileInput({ name: "app.exe", size: 1024, type: "application/x-msdownload" })).toThrow("no permitido");
  });

  it("parses bounded expiration hours", () => {
    const now = Date.parse("2026-06-03T00:00:00.000Z");
    expect(parseExpirationHours("1", now)).toBe(now + 60 * 60 * 1000);
    expect(() => parseExpirationHours("0", now)).toThrow("entre 1 hora y 7 dias");
    expect(() => parseExpirationHours("169", now)).toThrow("entre 1 hora y 7 dias");
  });

  it("resolves share status", () => {
    const now = Date.parse("2026-06-03T00:00:00.000Z");
    expect(resolveShareStatus({ expiresAt: now + 1000, revokedAt: null }, now)).toBe("active");
    expect(resolveShareStatus({ expiresAt: now - 1000, revokedAt: null }, now)).toBe("expired");
    expect(resolveShareStatus({ expiresAt: now + 1000, revokedAt: now - 500 }, now)).toBe("revoked");
  });
});

