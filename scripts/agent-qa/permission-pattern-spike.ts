import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startRuntime } from "./runtime";
import { ContractError, isJsonObject, type JsonObject } from "./types";

const evidencePath = resolve(
  ".omo/evidence/yume-agent-mode-sol/2026-09-17T00-32-01-573Z-native-document-wirefix/permission-pattern-spike.json",
);

function url(baseUrl: string, path: string, directory: string): URL {
  const target = new URL(path, baseUrl);
  target.searchParams.set("directory", directory);
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

async function createSession(
  baseUrl: string,
  extendedWorkspace: string,
  permission: readonly JsonObject[],
): Promise<string> {
  const created = await request(url(baseUrl, "/session", extendedWorkspace), "POST", {
    title: "permission pattern spike",
    permission,
  });
  if (!isJsonObject(created) || typeof created.id !== "string") {
    throw new ContractError("INVALID_WIRE", "session id missing");
  }
  return created.id;
}

async function prompt(
  baseUrl: string,
  extendedWorkspace: string,
  sessionId: string,
  messageId: string,
  text: string,
): Promise<void> {
  await request(url(baseUrl, `/session/${sessionId}/prompt_async`, extendedWorkspace), "POST", {
    messageID: messageId,
    model: { providerID: "yume", modelID: "model-a" },
    parts: [{ type: "text", text }],
  });
}

async function waitForPermission(
  baseUrl: string,
  ordinaryWorkspace: string,
  sessionId: string,
  permission?: string,
): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await request(url(baseUrl, "/permission", ordinaryWorkspace));
    if (Array.isArray(value)) {
      const match = value.find((item) => isJsonObject(item)
        && item.sessionID === sessionId
        && (permission === undefined || item.permission === permission));
      if (isJsonObject(match) && typeof match.id === "string") return match;
    }
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", `${permission ?? "any"} permission did not appear`);
}

async function reply(
  baseUrl: string,
  ordinaryWorkspace: string,
  permission: JsonObject,
  decision: "once" | "reject",
): Promise<unknown> {
  if (typeof permission.id !== "string") throw new ContractError("INVALID_WIRE", "permission id missing");
  return request(
    url(baseUrl, `/permission/${permission.id}/reply`, ordinaryWorkspace),
    "POST",
    { reply: decision },
  );
}

const runtime = await startRuntime({ includeTrusted: false, flowTools: true });
const ordinaryWorkspace = join(runtime.root, "中文 工作区");
const extendedWorkspace = `\\\\?\\${ordinaryWorkspace}`;
let evidence: JsonObject = { status: "started", ordinaryWorkspace, extendedWorkspace };
try {
  await mkdir(ordinaryWorkspace, { recursive: true });
  await writeFile(join(ordinaryWorkspace, "same.txt"), "ORIGINAL_A", "utf8");
  await writeFile(join(ordinaryWorkspace, "notes.txt"), "完成需求梳理", "utf8");

  const readSession = await createSession(runtime.baseUrl, extendedWorkspace, [
    { permission: "read", pattern: "*", action: "ask" },
  ]);
  await prompt(runtime.baseUrl, extendedWorkspace, readSession, "msg_pattern_read", "QA_READ");
  const read = await waitForPermission(runtime.baseUrl, ordinaryWorkspace, readSession, "read");
  const readReply = await reply(runtime.baseUrl, ordinaryWorkspace, read, "once");
  evidence = { ...evidence, read: { sessionId: readSession, request: read, reply: readReply } };

  const editSession = await createSession(runtime.baseUrl, extendedWorkspace, [
    { permission: "edit", pattern: "*", action: "ask" },
  ]);
  await prompt(runtime.baseUrl, extendedWorkspace, editSession, "msg_pattern_edit", "QA_EDIT");
  const edit = await waitForPermission(runtime.baseUrl, ordinaryWorkspace, editSession, "edit");
  const editReply = await reply(runtime.baseUrl, ordinaryWorkspace, edit, "reject");
  evidence = { ...evidence, edit: { sessionId: editSession, request: edit, reply: editReply } };

  const writeSession = await createSession(runtime.baseUrl, extendedWorkspace, [
    { permission: "write", pattern: "*", action: "ask" },
  ]);
  await prompt(
    runtime.baseUrl,
    extendedWorkspace,
    writeSession,
    "msg_pattern_write",
    "QA_WRITE",
  );
  const write = await waitForPermission(runtime.baseUrl, ordinaryWorkspace, writeSession);
  const writeReply = await reply(runtime.baseUrl, ordinaryWorkspace, write, "reject");
  evidence = { ...evidence, write: { sessionId: writeSession, request: write, reply: writeReply } };

  evidence = {
    status: "passed",
    version: "1.18.21",
    ordinaryWorkspace,
    extendedWorkspace,
    read: evidence.read,
    edit: evidence.edit,
    write: evidence.write,
    finalFiles: {
      same: await Bun.file(join(ordinaryWorkspace, "same.txt")).text(),
      summaryExists: await Bun.file(join(ordinaryWorkspace, "summary.md")).exists(),
    },
    providerRequests: runtime.provider.requests,
  };
} catch (error) {
  evidence = {
    ...evidence,
    status: "failed",
    error: error instanceof Error ? error.message : String(error),
    ordinaryWorkspace,
    extendedWorkspace,
    providerRequests: runtime.provider.requests,
  };
  throw error;
} finally {
  const cleanup = await runtime.close();
  await mkdir(resolve(evidencePath, ".."), { recursive: true });
  await writeFile(evidencePath, JSON.stringify({ ...evidence, cleanup }, null, 2), "utf8");
}

console.log(JSON.stringify(evidence));
