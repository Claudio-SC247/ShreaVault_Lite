import { describe, expect, it, vi } from "vitest";
import worker, { Env, ShareRow } from "./index";

const ADMIN_API_KEY = "test-admin-key";

function adminHeaders(): HeadersInit {
  return {
    authorization: `Bearer ${ADMIN_API_KEY}`
  };
}

function createUploadEnv() {
  const bindCalls: unknown[][] = [];
  const putCalls: Array<[string, unknown, unknown]> = [];
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn((...args: unknown[]) => {
    bindCalls.push(args);
    return { run };
  });
  const prepare = vi.fn(() => ({ bind }));
  const put = vi.fn(async (key: string, value: unknown, options: unknown) => {
    putCalls.push([key, value, options]);
    return null;
  });

  const env = {
    BUCKET: {
      put
    },
    DB: {
      prepare
    },
    ADMIN_API_KEY,
    MAX_UPLOAD_BYTES: "1048576",
    PUBLIC_BASE_URL: "https://files.example.com"
  } as unknown as Env;

  return {
    bind,
    bindCalls,
    env,
    prepare,
    put,
    putCalls,
    run
  };
}

function createShareEnv(row: ShareRow | null) {
  const first = vi.fn(async () => row);
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));
  const get = vi.fn(async () => ({
    body: new Blob(["private file"]).stream(),
    httpEtag: "etag-123",
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", row?.mime_type ?? "text/plain");
    }
  }));

  const env = {
    BUCKET: {
      get
    },
    DB: {
      prepare
    },
    PUBLIC_BASE_URL: "https://files.example.com"
  } as unknown as Env;

  return {
    bind,
    env,
    first,
    get,
    prepare,
    run
  };
}

function createListEnv(rows: ShareRow[]) {
  const all = vi.fn(async () => ({ results: rows }));
  const bind = vi.fn(() => ({ all }));
  const prepare = vi.fn(() => ({ bind, all }));

  const env = {
    ADMIN_API_KEY,
    DB: {
      prepare
    },
    PUBLIC_BASE_URL: "https://files.example.com"
  } as unknown as Env;

  return {
    all,
    bind,
    env,
    prepare
  };
}

function createRevokeEnv(row: Pick<ShareRow, "revoked_at"> | null) {
  const first = vi.fn(async () => row);
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));

  const env = {
    ADMIN_API_KEY,
    DB: {
      prepare
    }
  } as unknown as Env;

  return {
    bind,
    env,
    first,
    prepare,
    run
  };
}

function createDeleteEnv(row: Pick<ShareRow, "object_key"> | null) {
  const first = vi.fn(async () => row);
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));
  const del = vi.fn(async () => null);

  const env = {
    ADMIN_API_KEY,
    BUCKET: {
      delete: del
    },
    DB: {
      prepare
    }
  } as unknown as Env;

  return {
    bind,
    del,
    env,
    first,
    prepare,
    run
  };
}

function createShareRow(overrides: Partial<ShareRow> = {}): ShareRow {
  return {
    id: "share-1",
    token: "token-1",
    file_name: "contrato.txt",
    mime_type: "text/plain",
    size: 12,
    object_key: "shares/share-1/contrato.txt",
    expires_at: Date.now() + 60 * 60 * 1000,
    revoked_at: null,
    created_at: Date.now(),
    downloaded_at: null,
    ...overrides
  };
}

describe("file upload", () => {
  it("stores a validated upload in R2 and persists its metadata in D1", async () => {
    const { bind, bindCalls, env, prepare, put, putCalls, run } = createUploadEnv();
    const form = new FormData();
    form.set("file", new File(["hello"], "../contrato final.txt", { type: "text/plain" }));
    form.set("expiresInHours", "1");

    const response = await worker.fetch(
      new Request("https://api.example.com/api/files", {
        body: form,
        headers: adminHeaders(),
        method: "POST"
      }),
      env
    );
    const data = (await response.json()) as {
      share: {
        expiresAt: string;
        fileName: string;
        mimeType: string;
        shareUrl: string;
        size: number;
        status: string;
      };
    };

    expect(response.status).toBe(201);
    expect(data.share.fileName).toBe("contrato-final.txt");
    expect(data.share.mimeType).toBe("text/plain");
    expect(data.share.size).toBe(5);
    expect(data.share.status).toBe("active");
    expect(data.share.expiresAt).toEqual(expect.any(String));
    expect(data.share.shareUrl).toMatch(/^https:\/\/files\.example\.com\/share\/[a-f0-9]{48}$/);
    expect("objectKey" in data.share).toBe(false);
    expect("object_key" in data.share).toBe(false);

    expect(put).toHaveBeenCalledOnce();
    const [objectKey, body, options] = putCalls[0];
    expect(objectKey).toMatch(/^shares\/[0-9a-f-]{36}\/contrato-final\.txt$/);
    expect(body).toBeInstanceOf(ReadableStream);
    expect(options).toEqual({
      httpMetadata: {
        contentType: "text/plain"
      },
      customMetadata: {
        fileName: "contrato-final.txt",
        size: "5"
      }
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenCalledOnce();
    const bindArgs = bindCalls[0];
    expect(bindArgs[2]).toBe("contrato-final.txt");
    expect(bindArgs[3]).toBe("text/plain");
    expect(bindArgs[4]).toBe(5);
    expect(bindArgs[5]).toBe(objectKey);
  });

  it("uses a 24 hour default expiration when expiresInHours is omitted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));

    try {
      const { bindCalls, env } = createUploadEnv();
      const form = new FormData();
      form.set("file", new File(["hello"], "nota.txt", { type: "text/plain" }));

      const response = await worker.fetch(
        new Request("https://api.example.com/api/files", {
          body: form,
          headers: adminHeaders(),
          method: "POST"
        }),
        env
      );
      const data = (await response.json()) as { share: { expiresAt: string } };
      const expectedExpiration = Date.parse("2026-06-04T00:00:00.000Z");

      expect(response.status).toBe(201);
      expect(data.share.expiresAt).toBe(new Date(expectedExpiration).toISOString());
      expect(bindCalls[0][6]).toBe(expectedExpiration);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects invalid expiration before writing to R2 or D1", async () => {
    const { env, prepare, put } = createUploadEnv();
    const form = new FormData();
    form.set("file", new File(["hello"], "nota.txt", { type: "text/plain" }));
    form.set("expiresInHours", "169");

    const response = await worker.fetch(
      new Request("https://api.example.com/api/files", {
        body: form,
        headers: adminHeaders(),
        method: "POST"
      }),
      env
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(data.error).toBe("La expiracion debe estar entre 1 hora y 7 dias.");
    expect(put).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects unsupported uploads before writing to R2", async () => {
    const { env, prepare, put } = createUploadEnv();
    const form = new FormData();
    form.set("file", new File(["binary"], "app.exe", { type: "application/x-msdownload" }));

    const response = await worker.fetch(
      new Request("https://api.example.com/api/files", {
        body: form,
        headers: adminHeaders(),
        method: "POST"
      }),
      env
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(data.error).toBe("Tipo de archivo no permitido.");
    expect(put).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("private share links", () => {
  it("serves a file for an active private token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));

    try {
      const { bind, env, get, prepare, run } = createShareEnv(
        createShareRow({
          expires_at: Date.parse("2026-06-03T01:00:00.000Z")
        })
      );

      const response = await worker.fetch(new Request("https://api.example.com/share/token-1"), env);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("private file");
      expect(response.headers.get("content-type")).toBe("text/plain");
      expect(response.headers.get("content-disposition")).toBe('inline; filename="contrato.txt"');
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("etag")).toBe("etag-123");
      expect(get).toHaveBeenCalledWith("shares/share-1/contrato.txt");
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(run).toHaveBeenCalledOnce();
      expect(bind).toHaveBeenLastCalledWith(Date.parse("2026-06-03T00:00:00.000Z"), "share-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 410 for an expired private token without reading R2", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));

    try {
      const { env, get, run } = createShareEnv(
        createShareRow({
          expires_at: Date.parse("2026-06-02T23:59:59.000Z")
        })
      );

      const response = await worker.fetch(new Request("https://api.example.com/share/token-1"), env);
      const data = (await response.json()) as { error: string };

      expect(response.status).toBe(410);
      expect(data.error).toBe("El enlace expiro.");
      expect(get).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns 410 for a revoked private token without reading R2", async () => {
    const { env, get, run } = createShareEnv(
      createShareRow({
        revoked_at: Date.parse("2026-06-03T00:30:00.000Z")
      })
    );

    const response = await worker.fetch(new Request("https://api.example.com/share/token-1"), env);
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(410);
    expect(data.error).toBe("El enlace fue revocado.");
    expect(get).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown private token without reading R2", async () => {
    const { env, get, run } = createShareEnv(null);

    const response = await worker.fetch(new Request("https://api.example.com/share/missing-token"), env);
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toBe("Enlace no encontrado.");
    expect(get).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("revocation", () => {
  it("sets revoked_at for an existing active share", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T02:00:00.000Z"));

    try {
      const { bind, env, first, prepare, run } = createRevokeEnv({ revoked_at: null });

      const response = await worker.fetch(
        new Request("https://api.example.com/api/shares/share-1/revoke", {
          headers: adminHeaders(),
          method: "POST"
        }),
        env
      );
      const data = (await response.json()) as { revokedAt: string };

      expect(response.status).toBe(200);
      expect(data.revokedAt).toBe("2026-06-03T02:00:00.000Z");
      expect(prepare).toHaveBeenCalledTimes(2);
      expect(first).toHaveBeenCalledOnce();
      expect(run).toHaveBeenCalledOnce();
      expect(bind).toHaveBeenLastCalledWith(Date.parse("2026-06-03T02:00:00.000Z"), "share-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns the original revoked_at for an already revoked share", async () => {
    const revokedAt = Date.parse("2026-06-03T01:15:00.000Z");
    const { env, run } = createRevokeEnv({ revoked_at: revokedAt });

    const response = await worker.fetch(
      new Request("https://api.example.com/api/shares/share-1/revoke", {
        headers: adminHeaders(),
        method: "POST"
      }),
      env
    );
    const data = (await response.json()) as { revokedAt: string };

    expect(response.status).toBe(200);
    expect(data.revokedAt).toBe("2026-06-03T01:15:00.000Z");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns 404 when revoking an unknown share", async () => {
    const { env, run } = createRevokeEnv(null);

    const response = await worker.fetch(
      new Request("https://api.example.com/api/shares/missing/revoke", {
        headers: adminHeaders(),
        method: "POST"
      }),
      env
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toBe("Enlace no encontrado.");
    expect(run).not.toHaveBeenCalled();
  });
});

describe("deletion", () => {
  it("removes the R2 object and D1 row for an existing share", async () => {
    const { bind, del, env, first, prepare, run } = createDeleteEnv({
      object_key: "shares/share-1/contrato.txt"
    });

    const response = await worker.fetch(
      new Request("https://api.example.com/api/shares/share-1", {
        headers: adminHeaders(),
        method: "DELETE"
      }),
      env
    );
    const data = (await response.json()) as { deleted: boolean };

    expect(response.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledWith("shares/share-1/contrato.txt");
    expect(run).toHaveBeenCalledOnce();
    expect(bind).toHaveBeenLastCalledWith("share-1");
  });

  it("returns 404 when deleting an unknown share", async () => {
    const { del, env, run } = createDeleteEnv(null);

    const response = await worker.fetch(
      new Request("https://api.example.com/api/shares/missing", {
        headers: adminHeaders(),
        method: "DELETE"
      }),
      env
    );
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(data.error).toBe("Enlace no encontrado.");
    expect(del).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("share listing", () => {
  it("returns derived statuses for active, expired and revoked shares", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));

    try {
      const { env } = createListEnv([
        createShareRow({
          id: "active",
          token: "active-token",
          expires_at: Date.parse("2026-06-03T01:00:00.000Z")
        }),
        createShareRow({
          id: "expired",
          token: "expired-token",
          expires_at: Date.parse("2026-06-02T23:00:00.000Z")
        }),
        createShareRow({
          id: "revoked",
          token: "revoked-token",
          expires_at: Date.parse("2026-06-03T01:00:00.000Z"),
          revoked_at: Date.parse("2026-06-02T23:30:00.000Z")
        })
      ]);

      const response = await worker.fetch(
        new Request("https://api.example.com/api/shares", {
          headers: adminHeaders()
        }),
        env
      );
      const data = (await response.json()) as { shares: Array<{ id: string; status: string }> };

      expect(response.status).toBe(200);
      expect(data.shares).toEqual([
        expect.objectContaining({ id: "active", status: "active" }),
        expect.objectContaining({ id: "expired", status: "expired" }),
        expect.objectContaining({ id: "revoked", status: "revoked" })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("admin protection", () => {
  it("returns 401 for admin endpoints without credentials", async () => {
    const { env } = createUploadEnv();

    const response = await worker.fetch(new Request("https://api.example.com/api/shares"), env);
    const data = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(data.error).toBe("No autorizado.");
  });

  it("keeps health and public share routes accessible without admin auth", async () => {
    const { env } = createShareEnv(
      createShareRow({
        expires_at: Date.now() + 60 * 60 * 1000
      })
    );

    const health = await worker.fetch(new Request("https://api.example.com/api/health"), env);
    const share = await worker.fetch(new Request("https://api.example.com/share/token-1"), env);

    expect(health.status).toBe(200);
    expect(share.status).toBe(200);
  });
});
