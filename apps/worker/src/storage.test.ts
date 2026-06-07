import { describe, expect, it, vi } from "vitest";
import { createObjectKey, deleteStoredFile, storeUploadedFile } from "./storage";

describe("storage helpers", () => {
  it("builds object keys from share id and sanitized file name", () => {
    expect(createObjectKey("abc-123", "report.pdf")).toBe("shares/abc-123/report.pdf");
  });

  it("stores uploaded files in R2 with metadata", async () => {
    const put = vi.fn(async () => null);
    const bucket = { put } as unknown as R2Bucket;
    const file = new File(["hello"], "note.txt", { type: "text/plain" });

    await storeUploadedFile(bucket, "shares/id/note.txt", file, "text/plain", "note.txt");

    expect(put).toHaveBeenCalledOnce();
    const call = put.mock.calls[0] as unknown as [string, ReadableStream, { httpMetadata: { contentType: string }; customMetadata: { fileName: string; size: string } }];
    const [objectKey, body, options] = call;
    expect(objectKey).toBe("shares/id/note.txt");
    expect(body).toBeInstanceOf(ReadableStream);
    expect(options).toEqual({
      httpMetadata: { contentType: "text/plain" },
      customMetadata: { fileName: "note.txt", size: "5" }
    });
  });

  it("deletes stored files from R2", async () => {
    const del = vi.fn(async () => null);
    const bucket = { delete: del } as unknown as R2Bucket;

    await deleteStoredFile(bucket, "shares/id/note.txt");

    expect(del).toHaveBeenCalledWith("shares/id/note.txt");
  });
});
