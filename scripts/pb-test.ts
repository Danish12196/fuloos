import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const migrationsDir = path.join(rootDir, "pocketbase", "pb_migrations");
const cacheDir = path.join(rootDir, ".pocketbase");
const pbVersion = process.env.POCKETBASE_VERSION ?? "0.40.6";

function platformAsset(): { osName: string; arch: string; ext: string } {
  const osMap: Record<string, string> = {
    linux: "linux",
    darwin: "darwin",
    win32: "windows",
  };
  const archMap: Record<string, string> = {
    x64: "amd64",
    arm64: "arm64",
  };
  const osName = osMap[process.platform];
  const arch = archMap[process.arch];
  if (!osName || !arch) {
    throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  }
  return { osName, arch, ext: process.platform === "win32" ? ".exe" : "" };
}

async function ensurePocketBaseBinary(): Promise<string> {
  if (process.env.POCKETBASE_BIN && fs.existsSync(process.env.POCKETBASE_BIN)) {
    return process.env.POCKETBASE_BIN;
  }
  const { osName, arch, ext } = platformAsset();
  const binPath = path.join(cacheDir, `pocketbase${ext}`);
  if (fs.existsSync(binPath)) return binPath;

  fs.mkdirSync(cacheDir, { recursive: true });
  const zipName = `pocketbase_${pbVersion}_${osName}_${arch}.zip`;
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${pbVersion}/${zipName}`;
  console.log(`Downloading ${url}...`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download PocketBase (${res.status} ${res.statusText})`);
  }
  const zipPath = path.join(cacheDir, zipName);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);

  await new Promise<void>((resolve, reject) => {
    const proc = spawn("unzip", ["-o", zipPath, `pocketbase${ext}`, "-d", cacheDir], {
      stdio: "inherit",
    });
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`unzip exited with ${code}`)),
    );
  });
  fs.rmSync(zipPath, { force: true });
  if (process.platform !== "win32") {
    fs.chmodSync(binPath, 0o755);
  }
  return binPath;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Could not allocate port")));
        return;
      }
      const { port } = addr;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl: string, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // Server not ready yet.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`PocketBase did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  const binPath = await ensurePocketBaseBinary();
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fuloos-pb-test-"));

  console.log(`Starting PocketBase ${pbVersion} on ${baseUrl} (migrations: ${migrationsDir})`);
  const pb = spawn(
    binPath,
    [
      "serve",
      `--http=127.0.0.1:${port}`,
      `--dir=${dataDir}`,
      `--migrationsDir=${migrationsDir}`,
    ],
    {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let pbOutput = "";
  pb.stdout.on("data", (d) => (pbOutput += d.toString()));
  pb.stderr.on("data", (d) => (pbOutput += d.toString()));

  try {
    await waitForHealth(baseUrl);
    const exitCode = await new Promise<number>((resolve, reject) => {
      const runner = spawn(
        process.execPath,
        ["--experimental-strip-types", "--test", "e2e/pb-isolation.test.ts"],
        {
          cwd: rootDir,
          stdio: "inherit",
          env: {
            ...process.env,
            FULOOS_PB_URL: baseUrl,
          },
        },
      );
      runner.on("error", reject);
      runner.on("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) {
      console.error("PocketBase logs:\n" + pbOutput);
      process.exitCode = exitCode;
    }
  } finally {
    pb.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    if (!pb.killed) pb.kill("SIGKILL");
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
