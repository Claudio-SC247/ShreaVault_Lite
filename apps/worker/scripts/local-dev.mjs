import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const workerRoot = join(__dirname, "..");
const localDir = join(workerRoot, ".local");
const compiledDir = join(localDir, "compiled");
const dataPath = join(localDir, "db.json");
const filesDir = join(localDir, "r2");
const port = Number(process.env.PORT ?? 8787);

async function ensureLocalState() {
  await mkdir(localDir, { recursive: true });
  await mkdir(filesDir, { recursive: true });
  try {
    await readFile(dataPath, "utf8");
  } catch {
    await writeFile(dataPath, JSON.stringify({ shares: [] }, null, 2));
  }
}

async function loadState() {
  await ensureLocalState();
  return JSON.parse(await readFile(dataPath, "utf8"));
}

async function saveState(state) {
  await writeFile(dataPath, JSON.stringify(state, null, 2));
}

function createD1Database() {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              const state = await loadState();
              if (sql.includes("FROM shares") && sql.includes("ORDER BY created_at DESC")) {
                return {
                  results: [...state.shares].sort((a, b) => b.created_at - a.created_at).slice(0, 100)
                };
              }
              return { results: [] };
            },
            async first() {
              const state = await loadState();
              if (sql.includes("SELECT revoked_at FROM shares WHERE id = ?")) {
                const row = state.shares.find((share) => share.id === args[0]);
                return row ? { revoked_at: row.revoked_at } : null;
              }
              if (sql.includes("FROM shares") && sql.includes("WHERE token = ?")) {
                return state.shares.find((share) => share.token === args[0]) ?? null;
              }
              return null;
            },
            async run() {
              const state = await loadState();
              if (sql.includes("INSERT INTO shares")) {
                const [id, token, fileName, mimeType, size, objectKey, expiresAt, createdAt] = args;
                state.shares.push({
                  id,
                  token,
                  file_name: fileName,
                  mime_type: mimeType,
                  size,
                  object_key: objectKey,
                  expires_at: expiresAt,
                  revoked_at: null,
                  created_at: createdAt,
                  downloaded_at: null
                });
                await saveState(state);
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE shares SET revoked_at = ? WHERE id = ?")) {
                const row = state.shares.find((share) => share.id === args[1]);
                if (!row) return { meta: { changes: 0 } };
                row.revoked_at = args[0];
                await saveState(state);
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE shares SET downloaded_at = ? WHERE id = ?")) {
                const row = state.shares.find((share) => share.id === args[1]);
                if (!row) return { meta: { changes: 0 } };
                row.downloaded_at = args[0];
                await saveState(state);
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
          };
        }
      };
    }
  };
}

function objectPath(key) {
  return join(filesDir, Buffer.from(key).toString("base64url"));
}

function createR2Bucket() {
  return {
    async put(key, value, options = {}) {
      const buffer = Buffer.from(await new Response(value).arrayBuffer());
      await writeFile(objectPath(key), buffer);
      await writeFile(`${objectPath(key)}.json`, JSON.stringify(options, null, 2));
      return null;
    },
    async get(key) {
      try {
        const buffer = await readFile(objectPath(key));
        const metadata = JSON.parse(await readFile(`${objectPath(key)}.json`, "utf8"));
        return {
          body: new Blob([buffer]).stream(),
          httpEtag: createHash("sha256").update(buffer).digest("hex"),
          writeHttpMetadata(headers) {
            if (metadata.httpMetadata?.contentType) {
              headers.set("content-type", metadata.httpMetadata.contentType);
            }
          }
        };
      } catch {
        return null;
      }
    }
  };
}

function toHeaders(incomingHeaders) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incomingHeaders)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }
  return headers;
}

function addLocalImportExtensions(source) {
  return source.replace(/from\s+["'](\.\/[^"']+)["']/g, (match, specifier) => {
    if (specifier.endsWith(".mjs") || specifier.endsWith(".js")) {
      return match;
    }
    return `from "${specifier}.mjs"`;
  });
}

async function loadWorker() {
  await ensureLocalState();
  await mkdir(compiledDir, { recursive: true });

  const srcDir = join(workerRoot, "src");
  const files = (await readdir(srcDir)).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));

  for (const file of files) {
    const source = await readFile(join(srcDir, file), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ES2022
      }
    });
    await writeFile(join(compiledDir, file.replace(/\.ts$/, ".mjs")), addLocalImportExtensions(result.outputText));
  }

  return import(`${pathToFileURL(join(compiledDir, "index.mjs")).href}?t=${Date.now()}`);
}

const workerModule = await loadWorker();
const worker = workerModule.default;
const env = {
  BUCKET: createR2Bucket(),
  DB: createD1Database(),
  PUBLIC_BASE_URL: `http://localhost:${port}`
};

const server = createServer(async (req, res) => {
  try {
    const url = `http://localhost:${port}${req.url ?? "/"}`;
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : req;
    const requestInit = {
      headers: toHeaders(req.headers),
      method: req.method
    };
    if (body) {
      requestInit.body = body;
      requestInit.duplex = "half";
    }
    const response = await worker.fetch(new Request(url, requestInit), env);
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      const buffer = Buffer.from(await response.arrayBuffer());
      res.end(buffer);
    } else {
      res.end();
    }
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Local dev server error." }));
  }
});

server.listen(port, () => {
  console.log(`ShareVault Lite local API running at http://localhost:${port}`);
});
