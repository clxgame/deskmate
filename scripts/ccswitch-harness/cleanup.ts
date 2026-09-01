import { spawn } from "node:child_process";
import { access, readdir, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { HarnessError } from "./types";

export async function removeTempRoot(root: string): Promise<void> {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 120,
    retryDelay: 250,
  });
}

export async function pathMissing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch (error) {
    const code = errorCode(error);
    if (code === "ENOENT") return true;
    throw new HarnessError(`could not prove path absence for ${path}: ${code ?? "unknown error"}`, "cleanup_probe_failed", {
      cause: error,
    });
  }
}

export function portClosed(port: number): Promise<boolean> {
  return new Promise((resolveClosed) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolveClosed(false);
    });
    socket.once("error", () => resolveClosed(true));
    socket.setTimeout(1_000, () => {
      socket.destroy();
      resolveClosed(true);
    });
  });
}

export async function processGone(pid: number | undefined): Promise<boolean> {
  if (pid === undefined) return true;
  if (process.platform !== "win32") {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      const code = errorCode(error);
      if (code === "ESRCH") return true;
      if (code === "EPERM") return false;
      throw new HarnessError(`could not prove process absence for pid ${pid}: ${code ?? "unknown error"}`, "cleanup_probe_failed", {
        cause: error,
      });
    }
  }
  const tasklist = spawn("tasklist.exe", ["/FI", `PID eq ${pid}`], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  let stdout = "";
  tasklist.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  await new Promise<void>((resolveExit) => tasklist.once("exit", () => resolveExit()));
  return !stdout.includes(String(pid));
}

export async function assertTreeCanaryAbsent(root: string, canary: string): Promise<void> {
  await assertDirectoryCanaryAbsent(root, canary);
}

async function assertDirectoryCanaryAbsent(directory: string, canary: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await assertDirectoryCanaryAbsent(fullPath, canary);
      continue;
    }
    if (!entry.isFile()) continue;
    if ((await readFile(fullPath)).includes(canary)) {
      throw new HarnessError(`temporary file leaked runtime canary: ${fullPath}`);
    }
  }
}

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
