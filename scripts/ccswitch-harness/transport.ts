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

async function runCurl(
  url: string,
  timeoutSeconds: number,
  method: "GET" | "POST",
  body: JsonObject | undefined,
): Promise<HttpResult> {
  const args = [
    "--fail",
    "--silent",
    "--show-error",
    "--max-time",
    String(timeoutSeconds),
  ];
  if (method === "POST") {
    args.push("-H", "Content-Type: application/json", "-X", "POST");
    if (body) args.push("--data-binary", JSON.stringify(body));
  }
  args.push(url);
  const curl = spawn(
    process.platform === "win32" ? "curl.exe" : "curl",
    args,
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

export async function requestRaw(input: RequestJsonInput): Promise<HttpResult> {
  const timeoutSeconds = input.timeoutSeconds ?? 5;
  const label = endpointLabel(input.path);
  const method = input.method ?? "GET";
  try {
    return await withRequestTimeout(
      input.runner
        ? input.runner(`${input.baseUrl}${input.path}`, timeoutSeconds)
        : runCurl(`${input.baseUrl}${input.path}`, timeoutSeconds, method, input.body),
      timeoutSeconds * 1_000 + 500,
      label,
    );
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    throw new HarnessError(`${label} request failed: transport error`);
  }
}

export async function requestJson(input: RequestJsonInput): Promise<unknown> {
  const label = endpointLabel(input.path);
  const result = await requestRaw(input);
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
    if (current.exit) throw new HarnessError(`OpenCode exited before health: ${current.exit}\n${current.output}`, "scenario_startup_failed");
    try {
      return expectJsonObject(await requestJson({ baseUrl, path: "/global/health" }), "health");
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await Bun.sleep(200);
    }
  }
  throw new HarnessError(`OpenCode did not become healthy: ${lastError}\n${snapshot().output}`, "scenario_startup_failed");
}

type SseCollectInput = {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly accept: (event: JsonObject) => boolean;
};

function parseSseEvent(frame: string): JsonObject | undefined {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data || data === "[DONE]") return undefined;
  return expectJsonObject(JSON.parse(data), "sse event");
}

export async function collectSseUntil(input: SseCollectInput): Promise<readonly JsonObject[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  const events: JsonObject[] = [];
  let buffer = "";
  try {
    const response = await fetch(`${input.baseUrl}/event`, { signal: controller.signal });
    if (!response.ok) throw new HarnessError(`/event request failed: ${response.status}`);
    if (!response.body) throw new HarnessError("/event response had no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) throw new HarnessError("/event ended before expected event");
      buffer += decoder.decode(chunk.value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseEvent(frame);
        if (!event) continue;
        events.push(event);
        if (input.accept(event)) {
          await reader.cancel();
          return events;
        }
      }
    }
  } catch (error) {
    if (error instanceof HarnessError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new HarnessError("/event timed out before expected event");
    }
    throw new HarnessError(`/event failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
