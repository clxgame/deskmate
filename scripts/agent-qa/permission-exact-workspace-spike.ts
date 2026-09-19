import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startRuntime } from "./runtime";
import { ContractError, isJsonObject, type JsonObject } from "./types";

const workspaceArgument = process.argv[2];
const evidenceArgument = process.argv[3];
if (workspaceArgument === undefined || evidenceArgument === undefined) {
  throw new ContractError("ARGUMENT", "usage: permission-exact-workspace-spike.ts WORKSPACE EVIDENCE");
}

function url(baseUrl: string, path: string, directory: string): URL {
  const target = new URL(path, baseUrl);
  target.searchParams.set("directory", directory);
  return target;
}

async function request(
  target: URL,
  method: "GET" | "POST" = "GET",
  body?: JsonObject,
): Promise<unknown> {
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

async function waitForPermission(
  baseUrl: string,
  directory: string,
  sessionId: string,
  permissionName: "read" | "edit",
): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await request(url(baseUrl, "/permission", directory));
    if (Array.isArray(value)) {
      const match = value.find((item) => isJsonObject(item)
        && item.sessionID === sessionId
        && item.permission === permissionName);
      if (isJsonObject(match) && typeof match.id === "string") return match;
    }
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", `${permissionName} permission did not appear`);
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

const ordinaryWorkspace = resolve(workspaceArgument);
const canonicalWorkspace = await realpath(ordinaryWorkspace);
const extendedWorkspace = canonicalWorkspace.startsWith("\\\\?\\")
  ? canonicalWorkspace
  : `\\\\?\\${canonicalWorkspace}`;
const wireDirectory = extendedWorkspace.slice(4);
const evidencePath = resolve(evidenceArgument);
const runtime = await startRuntime({ includeTrusted: false, flowTools: true });
const messageId = `msg_exact_${crypto.randomUUID().replaceAll("-", "")}`;
let evidence: JsonObject = {
  status: "started",
  ordinaryWorkspace,
  canonicalWorkspace,
  extendedWorkspace,
  wireDirectory,
};
try {
  const created = await request(url(runtime.baseUrl, "/session", extendedWorkspace), "POST", {
    title: "exact workspace permission spike",
    permission: [
      { permission: "read", pattern: "*", action: "ask" },
      { permission: "edit", pattern: "*", action: "ask" },
    ],
  });
  if (!isJsonObject(created) || typeof created.id !== "string") {
    throw new ContractError("INVALID_WIRE", "session id missing");
  }
  const sessionId = created.id;
  await request(url(runtime.baseUrl, `/session/${sessionId}/prompt_async`, extendedWorkspace), "POST", {
    messageID: messageId,
    model: { providerID: "yume", modelID: "model-a" },
    parts: [{ type: "text", text: "QA_READ" }],
  });
  const permission = await waitForPermission(runtime.baseUrl, ordinaryWorkspace, sessionId, "read");
  const withoutDirectory = await request(new URL("/permission", runtime.baseUrl));
  const extendedDirectory = await request(url(runtime.baseUrl, "/permission", extendedWorkspace));
  if (typeof permission.id !== "string") {
    throw new ContractError("INVALID_WIRE", "permission id missing");
  }
  const reply = await request(
    url(runtime.baseUrl, `/permission/${permission.id}/reply`, ordinaryWorkspace),
    "POST",
    { reply: "once" },
  );
  const messages = await waitForCompletion(runtime.baseUrl, ordinaryWorkspace, sessionId, messageId);
  const serialized = JSON.stringify(messages);
  if (!serialized.includes("ORIGINAL_A") || !serialized.includes('"status":"completed"')) {
    throw new ContractError("ASSERTION_FAILED", "approved exact-workspace read did not complete");
  }
  const editMessageId = `msg_exact_edit_${crypto.randomUUID().replaceAll("-", "")}`;
  await request(url(runtime.baseUrl, `/session/${sessionId}/prompt_async`, extendedWorkspace), "POST", {
    messageID: editMessageId,
    model: { providerID: "yume", modelID: "model-a" },
    parts: [{ type: "text", text: "QA_EDIT" }],
  });
  const editPermission = await waitForPermission(
    runtime.baseUrl,
    ordinaryWorkspace,
    sessionId,
    "edit",
  );
  if (typeof editPermission.id !== "string") {
    throw new ContractError("INVALID_WIRE", "edit permission id missing");
  }
  const editReply = await request(
    url(runtime.baseUrl, `/permission/${editPermission.id}/reply`, ordinaryWorkspace),
    "POST",
    { reply: "reject" },
  );
  const editMessages = await waitForCompletion(
    runtime.baseUrl,
    ordinaryWorkspace,
    sessionId,
    editMessageId,
  );
  const finalText = await Bun.file(join(ordinaryWorkspace, "same.txt")).text();
  if (finalText !== "ORIGINAL_A") {
    throw new ContractError("ASSERTION_FAILED", "rejected edit changed exact workspace file");
  }
  evidence = {
    status: "passed",
    version: "1.18.21",
    ordinaryWorkspace,
    canonicalWorkspace,
    extendedWorkspace,
    wireDirectory,
    sessionId,
    messageId,
    editMessageId,
    permission,
    editPermission,
    withoutDirectory,
    extendedDirectory,
    reply,
    messages,
    editReply,
    editMessages,
    finalText,
    providerRequests: runtime.provider.requests,
  };
} catch (error) {
  evidence = {
    ...evidence,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    providerRequests: runtime.provider.requests,
  };
  throw error;
} finally {
  const cleanup = await runtime.close();
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({ ...evidence, cleanup }, null, 2), "utf8");
}

console.log(JSON.stringify(evidence));
