import { spawn } from "node:child_process";
import {
  expectJsonObject,
  HarnessError,
  type HttpResult,
  type JsonObject,
  type RequestJsonInput,
  type Snapshot,
} from "./types";

function endpointLabel(path: string): string {
  return path.split("?")[0] || "/";
}

async function withRequestTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new HarnessError(`${label} request failed: timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runCurl(url: string, timeoutSeconds: number): Promise<HttpResult> {
  const curl = spawn(
    process.platform === "win32" ? "curl.exe" : "curl",
    ["--fail", "--silent", "--show-error", "--max-time", String(timeoutSeconds), url],
    { windowsHide: true },
  );
  let stdout = "";
  curl.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  curl.stderr.resume();
  const timer = setTimeout(() => curl.kill(), timeoutSeconds * 1_000);
  const code = await new Promise<number | null>((resolveExit) => {
    curl.once("exit", (exitCode) => resolveExit(exitCode));
  });
  clearTimeout(timer);
  return { code, stdout };
}

export async function requestJson(input: RequestJsonInput): Promise<unknown> {
  const timeoutSeconds = input.timeoutSeconds ?? 5;
  const label = endpointLabel(input.path);
  let result: HttpResult;
  try {
    result = await withRequestTimeout(
      (input.runner ?? runCurl)(`${input.baseUrl}${input.path}`, timeoutSeconds),
      timeoutSeconds * 1_000 + 500,
      label,
    );
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(`${label} request failed: transport error`);
  }
  if (result.code !== 0) throw new HarnessError(`${label} request failed: curl exit ${result.code}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HarnessError(`${label} returned invalid JSON: ${message}`);
  }
}

export async function waitForHealth(baseUrl: string, snapshot: () => Snapshot): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  let lastError = "not started";
  while (Date.now() < deadline) {
    const current = snapshot();
    if (current.exit) throw new HarnessError(`OpenCode exited before health: ${current.exit}\n${current.output}`);
    try {
      return expectJsonObject(await requestJson({ baseUrl, path: "/global/health" }), "health");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await Bun.sleep(200);
    }
  }
  throw new HarnessError(`OpenCode did not become healthy: ${lastError}\n${snapshot().output}`);
}
