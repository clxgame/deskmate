import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startRuntime } from "./runtime";
import { ContractError, isJsonObject, type JsonObject } from "./types";

const evidencePath = resolve(
  ".omo/evidence/yume-agent-mode-sol/2026-09-17T00-03-51-243Z-native-document/permission-verbatim-spike.json",
);

function url(baseUrl: string, path: string, directory?: string): URL {
  const target = new URL(path, baseUrl);
  if (directory !== undefined) target.searchParams.set("directory", directory);
  return target;
}

async function request(target: URL, method: "GET" | "POST" = "GET", body?: JsonObject): Promise<unknown> {
  const response = await fetch(target, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new ContractError(
      "HTTP_FAILURE",
      `${method} ${target} -> ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

function permissionFor(value: unknown, sessionId: string): JsonObject | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.find((item) => isJsonObject(item) && item.sessionID === sessionId && typeof item.id === "string");
}

async function waitForShape(
  baseUrl: string,
  extended: string,
  ordinary: string,
  sessionId: string,
): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const extendedValue = await request(url(baseUrl, "/permission", extended));
    const ordinaryValue = await request(url(baseUrl, "/permission", ordinary));
    const extendedPermission = permissionFor(extendedValue, sessionId);
    const ordinaryPermission = permissionFor(ordinaryValue, sessionId);
    if (extendedPermission !== undefined || ordinaryPermission !== undefined) {
      return {
        extendedValue,
        ordinaryValue,
        matchingShape: ordinaryPermission !== undefined ? "ordinary" : "extended",
        permission: ordinaryPermission ?? extendedPermission,
      };
    }
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", "neither path shape returned the pending read permission");
}

async function waitForCompletion(
  baseUrl: string,
  directory: string,
  sessionId: string,
  messageId: string,
): Promise<readonly unknown[]> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await request(url(baseUrl, `/session/${sessionId}/message`, directory));
    if (Array.isArray(value) && value.some((item) => {
      if (!isJsonObject(item) || !isJsonObject(item.info)) return false;
      return item.info.parentID === messageId
        && isJsonObject(item.info.time)
        && item.info.time.completed !== undefined;
    })) return value;
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", "approved read did not complete");
}

const runtime = await startRuntime({ includeTrusted: false });
const ordinaryWorkspace = join(runtime.root, "中文 工作区");
const extendedWorkspace = `\\\\?\\${ordinaryWorkspace}`;
const messageId = `msg_spike_${crypto.randomUUID().replaceAll("-", "")}`;
let evidence: JsonObject = {
  status: "started",
  ordinaryWorkspace,
  extendedWorkspace,
  messageId,
};
try {
  await mkdir(ordinaryWorkspace, { recursive: true });
  await writeFile(join(ordinaryWorkspace, "same.txt"), "SPIKE_READ_OK", "utf8");
  const createUrl = url(runtime.baseUrl, "/session", extendedWorkspace);
  const created = await request(createUrl, "POST", {
    title: "verbatim directory permission spike",
    permission: [{ permission: "read", pattern: "*", action: "ask" }],
  });
  if (!isJsonObject(created) || typeof created.id !== "string") {
    throw new ContractError("INVALID_WIRE", "session id missing");
  }
  const sessionId = created.id;
  const promptUrl = url(runtime.baseUrl, `/session/${sessionId}/prompt_async`, extendedWorkspace);
  await request(promptUrl, "POST", {
    messageID: messageId,
    model: { providerID: "yume", modelID: "model-a" },
    parts: [{ type: "text", text: "QA_READ" }],
  });
  const comparison = await waitForShape(
    runtime.baseUrl,
    extendedWorkspace,
    ordinaryWorkspace,
    sessionId,
  );
  const permission = comparison.permission;
  if (!isJsonObject(permission) || typeof permission.id !== "string") {
    throw new ContractError("INVALID_WIRE", "permission id missing");
  }
  const matchingDirectory = comparison.matchingShape === "ordinary"
    ? ordinaryWorkspace
    : extendedWorkspace;
  const replyUrl = url(runtime.baseUrl, `/permission/${permission.id}/reply`, matchingDirectory);
  const reply = await request(replyUrl, "POST", { reply: "once" });
  const messages = await waitForCompletion(runtime.baseUrl, matchingDirectory, sessionId, messageId);
  const serialized = JSON.stringify(messages);
  if (!serialized.includes("SPIKE_READ_OK") || !serialized.includes('"status":"completed"')) {
    throw new ContractError("ASSERTION_FAILED", "approved read did not return the exact fixture");
  }
  evidence = {
    status: "passed",
    version: "1.18.21",
    ordinaryWorkspace,
    extendedWorkspace,
    sessionId,
    messageId,
    requests: {
      create: createUrl.toString(),
      prompt: promptUrl.toString(),
      permissionExtended: url(runtime.baseUrl, "/permission", extendedWorkspace).toString(),
      permissionOrdinary: url(runtime.baseUrl, "/permission", ordinaryWorkspace).toString(),
      reply: replyUrl.toString(),
    },
    comparison,
    reply,
    messages,
    providerRequests: runtime.provider.requests,
  };
} catch (error) {
  evidence = {
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    ordinaryWorkspace,
    extendedWorkspace,
    messageId,
  };
  throw error;
} finally {
  const cleanup = await runtime.close();
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({ ...evidence, cleanup }, null, 2), "utf8");
}

console.log(JSON.stringify(evidence));
