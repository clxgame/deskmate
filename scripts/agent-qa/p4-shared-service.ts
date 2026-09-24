import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { processGone } from "../ccswitch-harness/cleanup";
import { prepareProcessTerminator } from "../prepare-opencode";
import { createSession, messages, prompt, replyPermission, request, type Client } from "./client";
import { startRuntime } from "./runtime";
import { lateCommand, startLifecycleProvider } from "./tool-lifecycle-provider";
import { isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error("P4 shared-service observation deadline expired");
}

function toolParts(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : []).filter((part) => part.type === "tool");
}

async function pending(client: Client, sessionId: string): Promise<JsonObject[]> {
  const value = await request(client, "/permission");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).filter((item) => item.sessionID === sessionId);
}

async function readCoordination(path: string): Promise<JsonObject | undefined> {
  try { return jsonObject(JSON.parse(await readFile(path, "utf8")), "report coordination"); }
  catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && "code" in error && error.code === "ENOENT")) return undefined;
    throw error;
  }
}

function statusKind(statuses: JsonObject, sessionId: string): string {
  const value = statuses[sessionId];
  return isJsonObject(value) && typeof value.type === "string" ? value.type : "idle";
}

const processToolsDirectory = await prepareProcessTerminator();
const runtime = await startRuntime({
  providerFactory: startLifecycleProvider,
  includeTrusted: false,
  continueLoopOnDeny: true,
  ...(processToolsDirectory ? { processToolsDirectory } : {}),
});
const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
const coordination = join(runtime.workspaceA, `p4-report-${crypto.randomUUID()}.json`);
const cargo = spawn("cargo", [
  "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib",
  "worklog::runner::http_tests::shared_service_report_live", "--", "--ignored", "--nocapture", "--test-threads=1",
], {
  cwd: resolve("."),
  env: {
    ...process.env,
    YUME_P4_MATRIX_BASE: runtime.baseUrl,
    YUME_P4_MATRIX_WORKSPACE: runtime.workspaceA,
    YUME_P4_MATRIX_COORDINATION: coordination,
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let cargoStdout = "";
let cargoStderr = "";
cargo.stdout.on("data", (chunk: Buffer) => { cargoStdout += chunk.toString("utf8"); });
cargo.stderr.on("data", (chunk: Buffer) => { cargoStderr += chunk.toString("utf8"); });

let evidence: JsonObject = {};
try {
  const reportRunning = await until(
    () => readCoordination(coordination),
    (value) => value?.phase === "running",
    120_000,
  );
  assert.ok(reportRunning !== undefined);
  const reportSession = stringField(reportRunning, "sessionId");

  const sessionB = await createSession(client, "P4 normal chat B", [{ permission: "*", pattern: "*", action: "deny" }]);
  await prompt(client, sessionB, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "normal-chat");

  const sessionA = await createSession(client, "P4 long tool A", [{ permission: "bash", pattern: "*", action: "ask" }]);
  await prompt(client, sessionA, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "cancel");
  const permissions = await until(() => pending(client, sessionA), (items) => items.length > 0);
  await replyPermission(client, stringField(jsonObject(permissions[0], "permission"), "id"), "once");
  const pid = await until(async () => {
    try { return Number((await readFile(join(client.directory, "probe.pid"), "utf8")).trim()); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0; throw error; }
  }, (value) => value > 0);

  const simultaneous = jsonObject(await request(client, "/session/status"), "simultaneous statuses");
  assert.equal(statusKind(simultaneous, sessionA), "busy");
  assert.equal(statusKind(simultaneous, sessionB), "busy");
  assert.equal(statusKind(simultaneous, reportSession), "busy");

  const abortResponse = await request(client, `/session/${sessionA}/abort`, { method: "POST", body: {} });
  assert.equal(abortResponse, true);
  const afterAbort = await until(async () => jsonObject(await request(client, "/session/status"), "post-abort statuses"), (value) => statusKind(value, sessionA) === "idle");
  const cancelledMessages = await until(() => messages(client, sessionA), (snapshot) => toolParts(snapshot).length === 1 && toolParts(snapshot).every((part) => {
    const state = part.state;
    return isJsonObject(state) && (state.status === "completed" || state.status === "error");
  }));
  assert.equal(await until(() => processGone(pid), Boolean), true);

  const normalMessages = await until(() => messages(client, sessionB), (snapshot) => JSON.stringify(snapshot).includes("LIFECYCLE_COMPLETE:normal-chat"));
  const cargoCode = cargo.exitCode ?? await new Promise<number | null>((resolveExit, reject) => {
    cargo.once("error", reject);
    cargo.once("exit", resolveExit);
  });
  assert.equal(cargoCode, 0, `${cargoStdout}\n${cargoStderr}`);
  const reportCompleted = await until(() => readCoordination(coordination), (value) => value?.phase === "completed");
  assert.ok(reportCompleted !== undefined);
  const finalStatuses = jsonObject(await request(client, "/session/status"), "final statuses");
  assert.equal(statusKind(finalStatuses, sessionB), "idle");
  assert.equal(statusKind(finalStatuses, reportSession), "idle");
  await Bun.sleep(3_200);
  const lateWrite = await Bun.file(join(client.directory, "late.txt")).exists();
  assert.equal(lateWrite, false);

  evidence = {
    command: lateCommand,
    sessions: { longToolA: sessionA, normalChatB: sessionB, backgroundReportC: reportSession },
    simultaneous,
    abort: { response: abortResponse, status: statusKind(afterAbort, sessionA), pid, processGone: true, lateWrite },
    longTool: { messages: cancelledMessages },
    normalChat: { completed: true, messages: normalMessages },
    backgroundReport: reportCompleted,
    finalStatuses,
    providerRequestCount: runtime.provider.requests.length,
  };
} finally {
  if (cargo.exitCode === null && cargo.signalCode === null) cargo.kill();
  const cleanup = await runtime.close();
  evidence = { ...evidence, cleanup };
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p4-${stamp}-shared-service`);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "shared-service-isolation.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`evidence=${join(directory, "shared-service-isolation.json")}`);
}

console.log("PASS P4 shared service: A cancelled; B and C completed independently");
