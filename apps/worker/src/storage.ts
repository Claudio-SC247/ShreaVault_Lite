export function createObjectKey(shareId: string, safeFileName: string): string {
  return `shares/${shareId}/${safeFileName}`;
}

export async function storeUploadedFile(
  bucket: R2Bucket,
  objectKey: string,
  file: File,
  mimeType: string,
  safeFileName: string
): Promise<void> {
  await bucket.put(objectKey, file.stream(), {
    httpMetadata: {
      contentType: mimeType
    },
    customMetadata: {
      fileName: safeFileName,
      size: String(file.size)
    }
  });
}

