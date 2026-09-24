import { strict as assert } from "node:assert";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { messages, prompt, replyPermission, request, type Client } from "./client";
import { startP5McpProvider } from "./p5-mcp-provider";
import { startRuntime } from "./runtime";
import { isJsonObject, jsonObject, stringField, type JsonObject } from "./types";

type Scenario = "success" | "reject" | "disappear" | "save_failure" | "stop";
type PermissionReceipt = { readonly id: string; readonly permission: string; readonly reply: "once" | "reject" };

const windowsTools = ["app", "window_management", "ui_snapshot", "ui_find", "ui_click", "ui_type", "ui_read", "ui_wait", "screenshot_control", "keyboard_control"] as const;
const requested = process.argv[2];
const scenarios: readonly Scenario[] = requested === undefined
  ? ["success", "reject", "disappear", "save_failure", "stop"]
  : [(["success", "reject", "disappear", "save_failure", "stop"] as const).find((scenario) => scenario === requested) ?? (() => { throw new Error(`unknown scenario ${requested}`); })()];

function toolParts(snapshot: readonly JsonObject[]): JsonObject[] {
  return snapshot.flatMap((item) => Array.isArray(item.parts) ? item.parts.filter(isJsonObject) : []).filter((part) => part.type === "tool");
}

function state(part: JsonObject): JsonObject {
  return isJsonObject(part.state) ? part.state : {};
}

function statusName(part: JsonObject): string {
  const value = state(part).status;
  return typeof value === "string" ? value : "unknown";
}

function statusFor(statuses: JsonObject, sessionId: string): string {
  const status = statuses[sessionId];
  return isJsonObject(status) && typeof status.type === "string" ? status.type : "idle";
}

function launchedPid(parts: readonly JsonObject[]): number | null {
  for (const part of parts.toReversed()) {
    if (!(["yume_windows_window_management", "yume_windows_app"].includes(String(part.tool))) || statusName(part) !== "completed") continue;
    const output = state(part).output;
    if (typeof output !== "string") continue;
    const match = output.match(/"(?:processId|pid)"\s*:\s*"?(\d+)"?/i) ?? output.match(/(?:process id|pid)\D+(\d+)/i);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return null;
}

async function setReadOnly(path: string, enabled: boolean): Promise<void> {
  const child = Bun.spawn(["C:\\Windows\\System32\\attrib.exe", enabled ? "+R" : "-R", path], { stdout: "pipe", stderr: "pipe", windowsHide: true });
  const code = await child.exited;
  if (code !== 0) throw new Error(`attrib ${enabled ? "+R" : "-R"} failed for ${path}: ${await new Response(child.stderr).text()}`);
}

async function pending(client: Client, sessionId: string): Promise<JsonObject | undefined> {
  const value = await request(client, "/permission");
  assert.ok(Array.isArray(value));
  return value.filter(isJsonObject).find((item) => item.sessionID === sessionId);
}

async function terminateOwnedNotepad(pid: number | null): Promise<boolean> {
  if (pid === null || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch { return true; }
    await Bun.sleep(100);
  }
  return false;
}

async function removeControlledRoot(path: string): Promise<boolean> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await rm(path, { recursive: true, force: true });
      return true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || !["EBUSY", "EPERM"].includes(String(error.code))) throw error;
      await Bun.sleep(250);
    }
  }
  return false;
}

async function waitForFile(path: string, accept: (value: string) => boolean): Promise<string> {
  const deadline = Date.now() + 5_000;
  let value = "";
  while (Date.now() < deadline) {
    value = await readFile(path, "utf8");
    if (accept(value)) return value;
    await Bun.sleep(100);
  }
  return value;
}

async function runScenario(client: Client, scenario: Scenario, file: string, shot: string, marker: string, ownedPids: Set<number>, journal: JsonObject[]): Promise<{ readonly evidence: JsonObject; readonly pid: number | null }> {
  const created = jsonObject(await request(client, "/session", { method: "POST", body: { title: `P5 Windows ${scenario}` } }), "session");
  const sessionId = stringField(created, "id");
  const permissions: PermissionReceipt[] = [];
  const promptText = `P5_WINDOWS_${scenario.toUpperCase()} file=${encodeURIComponent(file)} cwd=${encodeURIComponent(resolve(file, ".."))} marker=${encodeURIComponent(marker)} shot=${encodeURIComponent(shot)}`;
  await prompt(client, sessionId, `msg_${crypto.randomUUID().replaceAll("-", "")}`, promptText);
  const deadline = Date.now() + 120_000;
  let snapshot: readonly JsonObject[] = [];
  let pid: number | null = null;
  let killedForDisappear = false;
  let aborted = false;
  let screenshotGateUsed = false;
  while (Date.now() < deadline) {
    snapshot = await messages(client, sessionId);
    const parts = toolParts(snapshot);
    const observedPid = launchedPid(parts);
    if (observedPid !== null) {
      pid = observedPid;
      ownedPids.add(observedPid);
    }
    if (scenario === "disappear" && !killedForDisappear && parts.some((part) => part.tool === "yume_windows_ui_snapshot" && statusName(part) === "completed")) {
      killedForDisappear = await terminateOwnedNotepad(pid);
      assert.equal(killedForDisappear, true);
    }
    const permission = await pending(client, sessionId);
    if (permission !== undefined) {
      const id = stringField(permission, "id");
      const name = stringField(permission, "permission");
      const reply = scenario === "reject" && permissions.length === 0 ? "reject" : "once";
      const screenshotGateMs = Number(process.env.YUME_P5_SCREENSHOT_GATE_MS ?? "0");
      if (!screenshotGateUsed && name === "yume_windows_screenshot_control" && Number.isFinite(screenshotGateMs) && screenshotGateMs > 0) {
        screenshotGateUsed = true;
        console.log(`SCREENSHOT_GATE_READY title=${basename(file, ".txt")} waitMs=${screenshotGateMs}`);
        await Bun.sleep(screenshotGateMs);
      }
      permissions.push({ id, permission: name, reply });
      await replyPermission(client, id, reply);
    }
    if (scenario === "stop" && !aborted && parts.some((part) => part.tool === "yume_windows_ui_wait" && statusName(part) === "running")) {
      await request(client, `/session/${sessionId}/abort`, { method: "POST" });
      aborted = true;
    }
    const statuses = jsonObject(await request(client, "/session/status"), "statuses");
    const idle = statusFor(statuses, sessionId) === "idle";
    const completed = snapshot.some((item) => isJsonObject(item.info) && item.info.role === "assistant" && isJsonObject(item.info.time) && typeof item.info.time.completed === "number");
    if (idle && (completed || aborted)) break;
    await Bun.sleep(100);
  }
  const statuses = jsonObject(await request(client, "/session/status"), "statuses");
  assert.equal(statusFor(statuses, sessionId), "idle");
  const parts = toolParts(snapshot);
  pid ??= launchedPid(parts);
  const tools = parts.map((part) => ({
    callId: typeof part.callID === "string" ? part.callID : null,
    tool: typeof part.tool === "string" ? part.tool : null,
    status: statusName(part),
    state: part.state,
  }));
  const scenarioEvidence = { scenario, sessionId, permissions, tools, pid, killedForDisappear, aborted, file, shot };
  journal.push(scenarioEvidence);
  if (scenario === "success") {
    assert.ok(parts.some((part) => part.tool === "yume_windows_screenshot_control" && statusName(part) === "completed"));
    await access(shot);
    assert.equal(await waitForFile(file, (value) => value === marker), marker);
  } else if (scenario === "reject") {
    assert.equal(permissions[0]?.reply, "reject");
    assert.equal(pid, null);
  } else if (scenario === "disappear") {
    assert.equal(killedForDisappear, true);
    assert.ok(parts.some((part) => part.tool === "yume_windows_ui_read" && statusName(part) === "error"));
  } else if (scenario === "save_failure") {
    assert.equal(await readFile(file, "utf8"), "READ_ONLY_ORIGINAL");
    assert.ok(parts.some((part) => part.tool === "yume_windows_screenshot_control" && statusName(part) === "completed"));
    await access(shot);
  } else {
    assert.equal(aborted, true);
    assert.equal(await readFile(file, "utf8"), "");
    assert.equal(parts.some((part) => part.tool === "yume_windows_ui_type"), false);
  }
  return { evidence: scenarioEvidence, pid };
}

const root = await mkdtemp(join(tmpdir(), "yume-p5-windows-"));
const successFile = join(root, "yume-p5-success.txt");
const rejectFile = join(root, "yume-p5-reject.txt");
const disappearFile = join(root, "yume-p5-disappear.txt");
const failureFile = join(root, "yume-p5-read-only.txt");
const stopFile = join(root, "yume-p5-stop.txt");
await Promise.all([successFile, rejectFile, disappearFile, stopFile].map((path) => writeFile(path, "")));
await writeFile(failureFile, "READ_ONLY_ORIGINAL");
if (scenarios.includes("save_failure")) await setReadOnly(failureFile, true);
const executable = resolve(process.argv[3] ?? ".tmp/sbroenne-windows-mcp-1.3.24/expanded/Sbroenne.WindowsMcp.exe");
await access(executable);
const mcp = {
  yume_windows: {
    type: "local",
    command: [executable, "--tools", windowsTools.join(",")],
    enabled: true,
    timeout: 120_000,
  },
} satisfies JsonObject;
const extraPermission = Object.fromEntries(windowsTools.map((tool) => [`yume_windows_${tool}`, "ask"]));
const runtime = await startRuntime({ providerFactory: startP5McpProvider, includeTrusted: false, continueLoopOnDeny: true, mcp, extraPermission });
const ownedPids = new Set<number>();
const journal: JsonObject[] = [];
const sidecarLog: string[] = [];
for (const stream of [runtime.child.stdout, runtime.child.stderr]) {
  stream.on("data", (chunk: Buffer | string) => {
    sidecarLog.push(String(chunk));
    if (sidecarLog.join("").length > 80_000) sidecarLog.shift();
  });
}
let cleanup: JsonObject = {};
let evidence: JsonObject = {};
let failure: JsonObject | undefined;
try {
  const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA };
  const marker = `YUME-P5-WINDOWS-${crypto.randomUUID()}`;
  const files: Record<Scenario, string> = { success: successFile, reject: rejectFile, disappear: disappearFile, save_failure: failureFile, stop: stopFile };
  const results: Awaited<ReturnType<typeof runScenario>>[] = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(client, scenario, files[scenario], join(root, `${scenario}.png`), scenario === "success" ? marker : `${marker}-${scenario}`, ownedPids, journal));
  }
  for (const result of results) if (result.pid !== null) ownedPids.add(result.pid);
  evidence = { selected: { repo: "sbroenne/mcp-windows", version: "1.3.24", commit: "b90485c3d1a228fc4f5341bc2bdfc7be7672c6d0", license: "MIT" }, versions: { opencode: "1.18.21", windowsMcp: "1.3.24" }, marker, controlledRoot: root, scenarios: results.map((result) => result.evidence), providerRequestCount: runtime.provider.requests.length };
} catch (error) {
  failure = { name: error instanceof Error ? error.name : "Error", message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? "" : "" };
  throw error;
} finally {
  for (const pid of ownedPids) await terminateOwnedNotepad(pid);
  if (scenarios.includes("save_failure")) await setReadOnly(failureFile, false).catch(() => undefined);
  cleanup = await runtime.close();
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const directory = resolve("artifacts", "opencode-native", `p5-${stamp}-windows-e2e`);
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "windows-e2e.json");
  const controlledRootRemoved = await removeControlledRoot(root);
  await writeFile(path, `${JSON.stringify({ ...evidence, partialScenarios: journal, cleanup, controlledRootRemoved, failure }, null, 2)}\n`);
  await writeFile(resolve(directory, "sidecar.log"), sidecarLog.join(""));
  console.log(`evidence=${path}`);
}
assert.ok(Object.values(cleanup).every(Boolean));
assert.equal(await Bun.file(root).exists(), false);
console.log(`PASS P5 Windows MCP scenarios for ${basename(successFile)}`);
