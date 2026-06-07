import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const apiUrl = process.env.SHAREVAULT_API_BASE_URL || "http://localhost:8787";
const webUrl = process.env.SHAREVAULT_WEB_BASE_URL || "http://localhost:3000";
const children = new Set();
let shuttingDown = false;

function log(service, message) {
  const lines = String(message).split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    console.log(`[${service}] ${line}`);
  }
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForUrl(url, service, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`${service} no respondio en ${url}`);
}

function start(service, args, extraEnv = {}) {
  const child = spawn(npmCommand, args, {
    cwd: projectRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      ...extraEnv
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.add(child);
  child.stdout.on("data", (chunk) => log(service, chunk));
  child.stderr.on("data", (chunk) => log(service, chunk));
  child.on("exit", (code) => {
    children.delete(child);
    if (!shuttingDown && code !== 0) {
      console.error(`[${service}] proceso finalizado con codigo ${code}`);
      shutdown(1);
    }
  });

  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill();
  }
  process.exitCode = code;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("ShareVault Lite local");

if (await isReachable(`${apiUrl}/api/health`)) {
  log("api", `ya disponible en ${apiUrl}`);
} else {
  start("api", ["run", "dev:api-local"]);
  await waitForUrl(`${apiUrl}/api/health`, "api");
}

if (await isReachable(webUrl)) {
  log("web", `ya disponible en ${webUrl}`);
} else {
  start("web", ["run", "dev:web"], {
    NEXT_PUBLIC_ADMIN_API_KEY: process.env.ADMIN_API_KEY || "dev-admin-key",
    NEXT_PUBLIC_API_BASE_URL: apiUrl
  });
  await waitForUrl(webUrl, "web", 90000);
}

console.log(`API: ${apiUrl}`);
console.log(`Web: ${webUrl}`);
console.log("Presiona Ctrl+C para detener los procesos iniciados por este comando.");

setInterval(() => {}, 60_000);
