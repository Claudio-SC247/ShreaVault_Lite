import { describe, expect, it } from "vitest";
import { buildCorsHeaders, resolveAllowedOrigin } from "./cors";

describe("cors", () => {
  it("allows the configured production origin", () => {
    const request = new Request("https://api.example.com/api/health", {
      headers: { origin: "https://app.example.com" }
    });

    expect(resolveAllowedOrigin(request, "https://app.example.com")).toBe("https://app.example.com");
    expect(buildCorsHeaders(request, "https://app.example.com")).toEqual({
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-allow-origin": "https://app.example.com",
      vary: "Origin"
    });
  });

  it("allows localhost origins during local development", () => {
    const request = new Request("https://api.example.com/api/health", {
      headers: { origin: "http://localhost:3000" }
    });

    expect(resolveAllowedOrigin(request, undefined)).toBe("http://localhost:3000");
  });

  it("does not emit a wildcard origin", () => {
    const request = new Request("https://api.example.com/api/health", {
      headers: { origin: "https://evil.example.com" }
    });

    expect(resolveAllowedOrigin(request, "https://app.example.com")).toBe("https://app.example.com");
    expect(buildCorsHeaders(request, "https://app.example.com")["access-control-allow-origin"]).toBe(
      "https://app.example.com"
    );
  });
});
