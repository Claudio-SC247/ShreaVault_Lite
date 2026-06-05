import { describe, expect, it } from "vitest";
import { buildApiUrl, formatBytes, normalizeApiBaseUrl, resolveStatus } from "./share";

describe("share helpers", () => {
  it("normalizes API base URLs", () => {
    expect(normalizeApiBaseUrl(" https://api.example.com/// ")).toBe("https://api.example.com");
    expect(normalizeApiBaseUrl("")).toBe("http://localhost:8787");
  });

  it("builds API URLs with a single slash", () => {
    expect(buildApiUrl("https://api.example.com/", "/api/shares")).toBe("https://api.example.com/api/shares");
  });

  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("resolves share status by revoke and expiration", () => {
    const now = new Date("2026-06-03T00:00:00.000Z");
    expect(resolveStatus({ expiresAt: "2026-06-03T01:00:00.000Z", revokedAt: null }, now)).toBe("active");
    expect(resolveStatus({ expiresAt: "2026-06-02T23:00:00.000Z", revokedAt: null }, now)).toBe("expired");
    expect(resolveStatus({ expiresAt: "2026-06-03T01:00:00.000Z", revokedAt: "2026-06-02T23:30:00.000Z" }, now)).toBe("revoked");
  });
});

