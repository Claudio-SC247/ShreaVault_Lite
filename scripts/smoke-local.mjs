const apiUrl = (process.env.SHAREVAULT_API_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
const adminApiKey = process.env.ADMIN_API_KEY || "dev-admin-key";
const expectedBody = "sharevault local smoke test";

function adminHeaders() {
  return {
    authorization: `Bearer ${adminApiKey}`
  };
}

async function assertOk(response, label) {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${label} fallo con ${response.status}: ${body}`);
  }
  return response;
}

await assertOk(await fetch(`${apiUrl}/api/health`), "healthcheck");

const form = new FormData();
form.set("file", new Blob([expectedBody], { type: "text/plain" }), "local-smoke.txt");
form.set("expiresInHours", "1");

const uploadResponse = await assertOk(
  await fetch(`${apiUrl}/api/files`, {
    method: "POST",
    headers: adminHeaders(),
    body: form
  }),
  "upload"
);

const payload = await uploadResponse.json();
const shareUrl = payload?.share?.shareUrl;
if (!shareUrl || payload.share.status !== "active") {
  throw new Error("upload no devolvio un enlace activo");
}

const token = new URL(shareUrl).pathname.split("/").filter(Boolean).at(-1);
if (!token) {
  throw new Error("shareUrl no contiene token");
}

const downloadResponse = await assertOk(await fetch(`${apiUrl}/share/${token}`), "descarga");
const downloadedBody = await downloadResponse.text();
if (downloadedBody !== expectedBody) {
  throw new Error("el contenido descargado no coincide con el archivo subido");
}

console.log("Smoke local OK");
console.log(`Share URL: ${shareUrl}`);
