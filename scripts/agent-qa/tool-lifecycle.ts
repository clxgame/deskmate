import { strict as assert } from "node:assert";
import { readFile, rm, mkdir, writeFile, readdir, cp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { startRuntime } from "./runtime";
import { startLifecycleProvider } from "./tool-lifecycle-provider";
import { createSession, messages, prompt, replyPermission, request, type Client } from "./client";
import { isJsonObject, jsonObject, stringField, type JsonObject } from "./types";
import { processGone } from "../ccswitch-harness/cleanup";
import { prepareProcessTerminator } from "../prepare-opencode";

async function until<T>(probe: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await probe();
    if (accept(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error("Lifecycle observation deadline expired");
}

function tools(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : []).filter((part) => part.type === "tool");
}

function terminal(part: JsonObject): boolean {
  const state = jsonObject(part.state, "tool state");
  return state.status === "completed" || state.status === "error";
}

async function pending(client: Client, session: string): Promise<JsonObject[]> {
  const value = await request(client, "/permission");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).filter((item) => item.sessionID === session);
}

async function complete(client: Client, session: string, marker: string): Promise<readonly JsonObject[]> {
  return until(async () => {
    const permissions = await pending(client, session);
    if (marker.startsWith("deny") && permissions[0]) {
      await replyPermission(client, stringField(permissions[0], "id"), "reject");
    } else {
      for (const permission of permissions) await replyPermission(client, stringField(permission, "id"), "once");
    }
    return messages(client, session);
  }, (snapshot) => JSON.stringify(snapshot).includes(`LIFECYCLE_COMPLETE:${marker}`));
}

function modelResults(requests: readonly JsonObject[]): JsonObject[] {
  const last = requests.at(-1);
  const history = Array.isArray(last?.messages) ? last.messages.filter(isJsonObject) : [];
  const user = history.findLastIndex((item) => item.role === "user");
  return history.slice(user + 1).filter((item) => item.role === "tool");
}

const processToolsDirectory = await prepareProcessTerminator();
const runtime = await startRuntime({ providerFactory: startLifecycleProvider, includeTrusted: false, continueLoopOnDeny: true,
  ...(processToolsDirectory ? { processToolsDirectory } : {}),
});
const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
const evidence: JsonObject[] = [];
try {
  await writeFile(join(client.directory, "taskkill.cmd"), "@echo off\r\necho UNSAFE_SHADOW>shadow-used.txt\r\nexit /b 1\r\n");
  for (const marker of ["single", "multi", "failure", "timeout", "timeout-child", "deny", "deny-multi"]) {
    const session = await createSession(client, marker, [{ permission: "bash", pattern: "*", action: "ask" }]);
    await prompt(client, session, `msg_${crypto.randomUUID().replaceAll("-", "")}`, marker);
    const snapshot = await complete(client, session, marker);
    const parts = tools(snapshot);
    const expected = marker === "multi" ? 3 : marker === "deny-multi" ? 2 : 1;
    assert.equal(parts.length, expected);
    assert.ok(parts.every(terminal));
    const results = modelResults(runtime.provider.requests);
    assert.equal(results.length, expected);
    assert.equal(new Set(results.map((item) => item.tool_call_id)).size, expected);
    assert.deepEqual(new Set(results.map((item) => item.tool_call_id)), new Set(parts.map((part) => part.callID)));
    if (marker === "failure") assert.ok(JSON.stringify(results).includes("YUME_EXPECTED_FAILURE"));
    if (marker.startsWith("timeout")) {
      assert.ok(JSON.stringify(results).includes(`exceeding timeout ${marker === "timeout-child" ? 1500 : 500} ms`));
      await Bun.sleep(3_200);
      assert.equal(await Bun.file(join(client.directory, `${marker}-late.txt`)).exists(), false);
      assert.equal(await Bun.file(join(client.directory, "shadow-used.txt")).exists(), false);
      if (marker === "timeout-child") assert.ok(Number((await readFile(join(client.directory, "child.pid"), "utf8")).trim()) > 0);
    }
    if (marker.startsWith("deny")) assert.ok(parts.every((part) => jsonObject(part.state, "state").status === "error"));
    evidence.push({ marker, toolCount: parts.length, results, continued: true });
    console.log("PASS", marker, "tool results", results.length);
  }

  for (const marker of ["cancel", "cancel-child"]) {
  const session = await createSession(client, `${marker} then reuse`, [{ permission: "bash", pattern: "*", action: "ask" }]);
  await rm(join(client.directory, "probe.pid"), { force: true });
  await rm(join(client.directory, "child.pid"), { force: true });
  await prompt(client, session, `msg_${crypto.randomUUID().replaceAll("-", "")}`, marker);
  const permissions = await until(() => pending(client, session), (items) => items.length > 0);
  await replyPermission(client, stringField(jsonObject(permissions[0], "permission"), "id"), "once");
  console.log("CANCEL approved, observing execution pid", Date.now());
  const pid = await until(async () => {
    try { return Number((await readFile(join(client.directory, "probe.pid"), "utf8")).trim()); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return 0; throw error; }
  }, (value) => value > 0);
  if (marker === "cancel-child") await until(() => Bun.file(join(client.directory, "child.pid")).exists(), Boolean);
  console.log("CANCEL execution started", pid, Date.now());
  await request(client, `/session/${session}/abort`, { method: "POST", body: {} });
  const cancelled = await until(() => messages(client, session), (snapshot) => tools(snapshot).length === 1 && tools(snapshot).every(terminal));
  console.log("CANCEL terminal received", Date.now());
  assert.equal(await until(() => processGone(pid), Boolean), true);
  await prompt(client, session, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "single");
  await complete(client, session, "single");
  await Bun.sleep(3_200);
  const lateWrite = await Bun.file(join(client.directory, marker === "cancel-child" ? "cancel-child-late.txt" : "late.txt")).exists();
  const timeoutLateWrite = await Bun.file(join(client.directory, "timeout-late.txt")).exists();
  assert.equal(lateWrite, false);
  assert.equal(timeoutLateWrite, false);
  assert.equal(await Bun.file(join(client.directory, "shadow-used.txt")).exists(), false);
  assert.equal(tools(await messages(client, session)).length, 2);
  evidence.push({ marker: `${marker}-reuse-isolated`, cancelled, processGone: true, lateWrite, timeoutLateWrite, reused: true });
  console.log("PASS", marker, "process exited, no late write, immediate reuse");
  }

  const orphanSession = await createSession(client, "restart orphan", [{ permission: "bash", pattern: "*", action: "ask" }]);
  const orphanRun = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(client, orphanSession, orphanRun, "orphan");
  await until(() => pending(client, orphanSession), (items) => items.length > 0);
  await runtime.restartSidecar();
  const orphan = await messages(client, orphanSession);
  const status = jsonObject(await request(client, "/session/status"), "status");
  assert.equal(status[orphanSession], undefined);
  assert.equal((await pending(client, orphanSession)).length, 0);
  assert.ok(tools(orphan).some((part) => jsonObject(part.state, "state").status === "running"));
  evidence.push({ marker: "native-restart-orphan-confirmed", snapshot: orphan, status });
  console.log("CONFIRMED native restart retains running tool without busy owner or permission");

  const testBinary = process.env.YUME_AGENT_TEST_BINARY;
  if (testBinary) {
    await rm(join(client.directory, "probe.pid"), { force: true });
    await rm(join(client.directory, "late.txt"), { force: true });
    await rm(join(client.directory, "timeout-late.txt"), { force: true });
    const child = spawn(testBinary, ["live_tool_lifecycle", "--ignored", "--nocapture", "--test-threads=1"], {
      env: { ...process.env, YUME_AGENT_TEST_BASE: client.baseUrl, YUME_AGENT_TEST_WORKSPACE: client.directory,
        YUME_AGENT_TEST_ORPHAN_SESSION: orphanSession, YUME_AGENT_TEST_ORPHAN_RUN: orphanRun },
      stdio: "inherit", windowsHide: true,
    });
    const code = await new Promise<number | null>((resolveExit, reject) => { child.once("error", reject); child.once("exit", resolveExit); });
    for (const name of await readdir(client.directory)) {
      if (name.startsWith("rust-host-")) await cp(join(client.directory, name), resolve(".omo/evidence/agent-rust-host", name), { recursive: true });
    }
    assert.equal(code, 0, "Rust host lifecycle integration failed");
    evidence.push({ marker: "rust-host-integration", passed: true });
  }
} catch (error) {
  console.error("LIFECYCLE_FAILURE", error);
  throw error;
} finally {
  const cleanup = await runtime.close();
  evidence.push({ marker: "cleanup", ...cleanup });
  const path = resolve(".omo/evidence/agent-tool-lifecycle.json");
  await mkdir(resolve(".omo/evidence"), { recursive: true });
  await writeFile(path, JSON.stringify(evidence, null, 2));
  console.log("EVIDENCE", path, "CLEANUP", cleanup);
}
