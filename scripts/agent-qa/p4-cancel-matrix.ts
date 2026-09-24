import { strict as assert } from "node:assert";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { processGone } from "../ccswitch-harness/cleanup";
import { prepareProcessTerminator } from "../prepare-opencode";
import { createSession, messages, prompt, replyPermission, request, type Client } from "./client";
import { startRuntime } from "./runtime";
import { startLifecycleProvider } from "./tool-lifecycle-provider";
import { isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

type CaseEvidence = {
  readonly scenario: string;
  readonly sessionId: string;
  readonly callId: string | null;
  readonly permissionId: string | null;
  readonly abortResponse: unknown;
  readonly statusBefore: string;
  readonly statusAfter: string;
  readonly processPids: readonly number[];
  readonly processesGone: boolean;
  readonly lateSideEffect: boolean;
  readonly finalToolState: string | null;
  readonly finalMessageError: string | null;
};

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error("P4 cancellation observation deadline expired");
}

function tools(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : []).filter((part) => part.type === "tool");
}

function statusKind(statuses: JsonObject, sessionId: string): string {
  const value = statuses[sessionId];
  return isJsonObject(value) && typeof value.type === "string" ? value.type : "idle";
}

async function status(client: Client, sessionId: string): Promise<string> {
  return statusKind(jsonObject(await request(client, "/session/status"), "session statuses"), sessionId);
}

async function pending(client: Client, sessionId: string): Promise<JsonObject[]> {
  const value = await request(client, "/permission");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).filter((item) => item.sessionID === sessionId);
}

async function pendingQuestions(client: Client, sessionId: string): Promise<JsonObject[]> {
  const value = await request(client, "/question");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).filter((item) => item.sessionID === sessionId);
}

async function rejectPendingInteractions(client: Client, sessionId: string): Promise<void> {
  for (const permission of await pending(client, sessionId)) {
    await replyPermission(client, stringField(permission, "id"), "reject");
  }
  for (const question of await pendingQuestions(client, sessionId)) {
    await request(client, `/question/${stringField(question, "id")}/reject`, { method: "POST" });
  }
  assert.equal((await pending(client, sessionId)).length, 0);
  assert.equal((await pendingQuestions(client, sessionId)).length, 0);
}

async function numericFile(path: string): Promise<number> {
  return until(async () => {
    try { return Number((await readFile(path, "utf8")).trim()); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0; throw error; }
  }, (value) => value > 0);
}

function finalFacts(snapshot: readonly JsonObject[]): Pick<CaseEvidence, "callId" | "finalToolState" | "finalMessageError"> {
  const part = tools(snapshot).at(-1);
  const state = part !== undefined && isJsonObject(part.state) && typeof part.state.status === "string" ? part.state.status : null;
  const assistant = snapshot.findLast((item) => isJsonObject(item.info) && item.info.role === "assistant");
  const error = assistant !== undefined && isJsonObject(assistant.info) && isJsonObject(assistant.info.error) && typeof assistant.info.error.name === "string"
    ? assistant.info.error.name
    : null;
  return {
    callId: part !== undefined && typeof part.callID === "string" ? part.callID : null,
    finalToolState: state,
    finalMessageError: error,
  };
}

async function abortAndSettle(client: Client, sessionId: string): Promise<{ response: unknown; after: string; snapshot: readonly JsonObject[] }> {
  const response = await request(client, `/session/${sessionId}/abort`, { method: "POST", body: {} });
  assert.equal(response, true);
  await until(() => status(client, sessionId), (value) => value === "idle");
  await rejectPendingInteractions(client, sessionId);
  if (await status(client, sessionId) === "busy") {
    assert.equal(await request(client, `/session/${sessionId}/abort`, { method: "POST", body: {} }), true);
  }
  const after = await until(() => status(client, sessionId), (value) => value === "idle");
  const snapshot = await until(() => messages(client, sessionId), (value) => value.some((item) => {
    const info = item.info;
    return isJsonObject(info) && info.role === "assistant" && isJsonObject(info.time) && typeof info.time.completed === "number";
  }));
  return { response, after, snapshot };
}

async function executableCase(client: Client, scenario: "cancel" | "cancel-child"): Promise<CaseEvidence> {
  for (const name of ["probe.pid", "child.pid", "late.txt", "cancel-child-late.txt"]) await rm(join(client.directory, name), { force: true });
  const sessionId = await createSession(client, `P4 ${scenario}`, [{ permission: "bash", pattern: "*", action: "ask" }]);
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, scenario);
  const permissions = await until(() => pending(client, sessionId), (value) => value.length > 0);
  const permissionId = stringField(jsonObject(permissions[0], "permission"), "id");
  await replyPermission(client, permissionId, "once");
  const processPids = [await numericFile(join(client.directory, "probe.pid"))];
  if (scenario === "cancel-child") processPids.push(await numericFile(join(client.directory, "child.pid")));
  const before = await until(() => status(client, sessionId), (value) => value === "busy");
  const settled = await abortAndSettle(client, sessionId);
  assert.equal(await until(async () => (await Promise.all(processPids.map(processGone))).every(Boolean), Boolean), true);
  await Bun.sleep(3_200);
  const lateSideEffect = await Bun.file(join(client.directory, scenario === "cancel-child" ? "cancel-child-late.txt" : "late.txt")).exists();
  assert.equal(lateSideEffect, false);
  return { scenario, sessionId, permissionId, abortResponse: settled.response, statusBefore: before, statusAfter: settled.after,
    processPids, processesGone: true, lateSideEffect, ...finalFacts(settled.snapshot) };
}

async function approvalCase(client: Client): Promise<CaseEvidence> {
  const scenario = "waiting-approval";
  const sessionId = await createSession(client, `P4 ${scenario}`, [{ permission: "bash", pattern: "*", action: "ask" }]);
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "cancel");
  const permissions = await until(() => pending(client, sessionId), (value) => value.length > 0);
  const permissionId = stringField(jsonObject(permissions[0], "permission"), "id");
  const before = await until(() => status(client, sessionId), (value) => value === "busy");
  const settled = await abortAndSettle(client, sessionId);
  assert.equal((await pending(client, sessionId)).length, 0);
  return { scenario, sessionId, permissionId, abortResponse: settled.response, statusBefore: before, statusAfter: settled.after,
    processPids: [], processesGone: true, lateSideEffect: false, ...finalFacts(settled.snapshot) };
}

async function failureCase(client: Client): Promise<CaseEvidence> {
  const scenario = "tool-failure";
  const sessionId = await createSession(client, `P4 ${scenario}`, [{ permission: "bash", pattern: "*", action: "ask" }]);
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "failure-cancel");
  const permissions = await until(() => pending(client, sessionId), (value) => value.length > 0);
  const permissionId = stringField(jsonObject(permissions[0], "permission"), "id");
  await replyPermission(client, permissionId, "once");
  await until(() => messages(client, sessionId), (snapshot) => tools(snapshot).some((part) =>
    isJsonObject(part.state)
    && (part.state.status === "completed" || part.state.status === "error")
    && JSON.stringify(part.state).includes("YUME_EXPECTED_FAILURE")));
  const before = await until(() => status(client, sessionId), (value) => value === "busy");
  const settled = await abortAndSettle(client, sessionId);
  return { scenario, sessionId, permissionId, abortResponse: settled.response, statusBefore: before, statusAfter: settled.after,
    processPids: [], processesGone: true, lateSideEffect: false, ...finalFacts(settled.snapshot) };
}

async function networkCase(client: Client): Promise<CaseEvidence> {
  const scenario = "network-loss";
  const sessionId = await createSession(client, `P4 ${scenario}`, [{ permission: "*", pattern: "*", action: "deny" }]);
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, scenario);
  const before = await until(() => status(client, sessionId), (value) => value === "busy");
  const settled = await abortAndSettle(client, sessionId);
  return { scenario, sessionId, permissionId: null, abortResponse: settled.response, statusBefore: before, statusAfter: settled.after,
    processPids: [], processesGone: true, lateSideEffect: false, ...finalFacts(settled.snapshot) };
}

const processToolsDirectory = await prepareProcessTerminator();
const runtime = await startRuntime({ providerFactory: startLifecycleProvider, includeTrusted: false, continueLoopOnDeny: true,
  ...(processToolsDirectory ? { processToolsDirectory } : {}),
});
const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
const cases: CaseEvidence[] = [];
let cleanup: JsonObject = {};
try {
  cases.push(await executableCase(client, "cancel"));
  cases.push(await executableCase(client, "cancel-child"));
  cases.push(await approvalCase(client));
  cases.push(await failureCase(client));
  cases.push(await networkCase(client));
  assert.ok(cases.every((item) => item.abortResponse === true && item.statusBefore === "busy" && item.statusAfter === "idle"));
} finally {
  cleanup = await runtime.close();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p4-${stamp}-cancel-matrix`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "cancellation-matrix.json"), `${JSON.stringify({ cases, providerRequestCount: runtime.provider.requests.length, cleanup }, null, 2)}\n`);
  console.log(`evidence=${join(directory, "cancellation-matrix.json")}`);
}

console.log("PASS P4 cancellation matrix: long, child, approval, failure, and network loss");
