import { describe, expect, it } from "vitest";
import { isAdminAuthorized } from "./auth";

describe("admin auth", () => {
  const adminKey = "test-admin-key";

  it("accepts a valid bearer token", () => {
    const request = new Request("https://api.example.com/api/shares", {
      headers: {
        authorization: "Bearer test-admin-key"
      }
    });

    expect(isAdminAuthorized(request, adminKey)).toBe(true);
  });

  it("rejects missing or invalid credentials", () => {
    expect(isAdminAuthorized(new Request("https://api.example.com/api/shares"), adminKey)).toBe(false);
    expect(
      isAdminAuthorized(
        new Request("https://api.example.com/api/shares", {
          headers: { authorization: "Bearer wrong-key" }
        }),
        adminKey
      )
    ).toBe(false);
    expect(isAdminAuthorized(new Request("https://api.example.com/api/shares"), undefined)).toBe(false);
  });
});
