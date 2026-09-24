/**
 * P3.7 E2E harness: MCP tool exposure under Yume's deny-by-default permission map.
 *
 * Proves, against the REAL OpenCode 1.18.21 sidecar binary and a real stdio MCP
 * server (scripts/agent-qa/fixtures/mcp-echo-server.ts):
 *
 *   control run — baseline map {"*":"deny", ...}: the connected MCP server's tools
 *     do NOT reach the outgoing provider request's tools array.
 *   fix run — baseline + {yume_qa_mcp_yume_qa_echo: "ask"}: the approved MCP tool
 *     DOES reach the tools array, the unapproved sibling stays hidden, and the
 *     "ask" rule still gates real execution through the permission API
 *     (approval round-trip yields the tool's real YUME_MCP_ECHO output marker).
 *
 * Run from the repo root:
 *   bun scripts/agent-qa/verify-mcp-permission.ts
 *
 * Writes artifacts/opencode-native/p3-mcp-<timestamp>/mcp-tool-exposure.json.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";

import { pathMissing, portClosed, processGone, removeTempRoot } from "../ccswitch-harness/cleanup";
import {
  TEST_MCP_APPROVED_TOOL_ID,
  TEST_MCP_SERVER_NAME,
  TEST_MCP_UNAPPROVED_TOOL_ID,
} from "../ccswitch-harness/mcp-permissions";
import { buildPermissionMap } from "../ccswitch-harness/permissions";
import { childEnv, freePort, stopChild } from "../ccswitch-harness/process";
import { findSourceBinary } from "../prepare-opencode";

type JsonObject = Record<string, unknown>;
type OwnedChild = ChildProcessByStdio<null, Readable, Readable>;

type RunCleanup = {
  readonly processGone: boolean;
  readonly sidecarClosed: boolean;
  readonly tempRootRemoved: boolean;
};

type RunEvidence = {
  readonly approved_tool_present: boolean;
  readonly unapproved_tool_present: boolean;
  readonly session_id: string;
  readonly marker: string;
  readonly request_count: number;
  readonly mcp_status: string;
  readonly approval_round_trip?: "pass";
  readonly tool_result_marker?: string;
  readonly permission_request_id?: string;
  readonly cleanup: RunCleanup;
};

class HarnessError extends Error {
  cleanup?: RunCleanup;

  constructor(message: string) {
    super(message);
    this.name = "HarnessError";
  }
}

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const FIXTURE_SERVER = resolve(import.meta.dir, "fixtures/mcp-echo-server.ts");
const PROVIDER_SCRIPT = resolve(PROJECT_ROOT, "scripts/workbench-qa/provider.ts");
const EXPECTED_VERSION = "1.18.21";
const TRIGGER = "call mcp echo";
const ECHO_PREFIX = "YUME_MCP_ECHO:";

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new HarnessError(message);
}

async function poll<T>(label: string, timeoutMs: number, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await Bun.sleep(150);
  }
  return fail(`TIMEOUT waiting for ${label} (${timeoutMs}ms)`);
}

async function pollQuiet<T>(label: string, timeoutMs: number, probe: () => Promise<T | undefined>): Promise<T> {
  return poll(label, timeoutMs, async () => {
    try {
      return await probe();
    } catch (error) {
      if (error instanceof Error) return undefined;
      throw error;
    }
  });
}

function toolNamesOf(body: JsonObject): readonly string[] {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((tool) => {
    if (!isJsonObject(tool)) return [];
    const fn = tool.function;
    if (isJsonObject(fn) && typeof fn.name === "string") return [fn.name];
    return typeof tool.name === "string" ? [tool.name] : [];
  });
}

async function api(
  baseUrl: string,
  directory: string,
  path: string,
  init: { readonly method?: "GET" | "POST"; readonly body?: JsonObject } = {},
): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "Content-Type": "application/json", "x-opencode-directory": directory },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) fail(`${init.method ?? "GET"} ${path} -> ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

function streamTap(child: OwnedChild, logPath: string): { readonly tail: () => string } {
  const limit = 12_000;
  let collected = "";
  const append = (chunk: Buffer): void => {
    collected = (collected + chunk.toString("utf8")).slice(-limit);
    void writeFile(logPath, collected, "utf8").catch(() => undefined);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { tail: () => collected };
}

async function waitHealth(baseUrl: string): Promise<JsonObject> {
  const health = await pollQuiet("GET /global/health 200", 30_000, async () => {
    const response = await fetch(`${baseUrl}/global/health`, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return undefined;
    const value: unknown = await response.json();
    return isJsonObject(value) ? value : undefined;
  });
  if (health.version !== EXPECTED_VERSION) fail(`unexpected sidecar health: ${JSON.stringify(health)}`);
  return health;
}

async function waitMcpConnected(baseUrl: string, directory: string): Promise<string> {
  return poll(`MCP server ${TEST_MCP_SERVER_NAME} connected`, 30_000, async () => {
    const value: unknown = await api(baseUrl, directory, "/mcp");
    if (!isJsonObject(value)) return undefined;
    const entry = value[TEST_MCP_SERVER_NAME];
    if (!isJsonObject(entry)) return undefined;
    if (entry.status === "connected") return "connected";
    if (entry.status === "failed") fail(`MCP server failed to connect: ${JSON.stringify(entry)}`);
    return undefined;
  });
}

async function waitToolsListed(logPath: string): Promise<void> {
  await pollQuiet("MCP tools/list exchange in fixture log", 30_000, async () => {
    const text = await readFile(logPath, "utf8").catch(() => "");
    return text.includes("method: tools/list") ? true : undefined;
  });
}

async function providerRequests(providerOrigin: string): Promise<readonly JsonObject[]> {
  const response = await fetch(`${providerOrigin}/control/requests`, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) fail(`provider /control/requests -> ${response.status}`);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) fail("provider /control/requests did not return an array");
  return value.filter(isJsonObject);
}

async function providerReset(providerOrigin: string): Promise<void> {
  const response = await fetch(`${providerOrigin}/control/reset`, { method: "POST", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) fail(`provider /control/reset -> ${response.status}`);
}

async function markerRequests(providerOrigin: string, marker: string): Promise<readonly JsonObject[]> {
  return poll(`provider request containing ${marker}`, 45_000, async () => {
    const requests = await providerRequests(providerOrigin);
    const matched = requests.filter((body) => JSON.stringify(body).includes(marker));
    return matched.length > 0 ? matched : undefined;
  });
}

async function sessionMessages(baseUrl: string, directory: string, sessionId: string): Promise<readonly JsonObject[]> {
  const value: unknown = await api(baseUrl, directory, `/session/${sessionId}/message`);
  if (!Array.isArray(value)) fail("session messages endpoint did not return an array");
  return value.filter(isJsonObject);
}

async function waitSessionSettled(baseUrl: string, directory: string, sessionId: string): Promise<void> {
  await poll(`session ${sessionId} assistant completion`, 60_000, async () => {
    const snapshot = await sessionMessages(baseUrl, directory, sessionId);
    const completed = snapshot.some((envelope) => {
      const info = envelope.info;
      return isJsonObject(info) && info.role === "assistant" && isJsonObject(info.time) && "completed" in info.time;
    });
    return completed ? true : undefined;
  });
}

async function startProviderChild(
  runDir: string,
): Promise<{ readonly child: OwnedChild; readonly baseUrl: string; readonly port: number; readonly pid: number }> {
  const child = spawn(process.execPath, [PROVIDER_SCRIPT, runDir], {
    cwd: PROJECT_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const pid = child.pid;
  if (pid === undefined) fail("provider PID unavailable");
  streamTap(child, join(runDir, "provider.harness.log"));
  const receipt = await pollQuiet("provider receipt file", 20_000, async () => {
    const raw = await readFile(join(runDir, "provider-receipt.json"), "utf8").catch(() => "");
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    if (!isJsonObject(value)) return undefined;
    const baseUrl = value.baseUrl;
    const port = value.port;
    if (typeof baseUrl !== "string" || typeof port !== "number") return undefined;
    return { baseUrl, port };
  });
  return { child, baseUrl: receipt.baseUrl, port: receipt.port, pid };
}

function buildConfig(variant: "control" | "fix", providerBaseUrl: string, mcpLogPath: string): JsonObject {
  const permission: Record<string, "allow" | "deny" | "ask"> = { ...buildPermissionMap() };
  if (variant === "fix") permission[TEST_MCP_APPROVED_TOOL_ID] = "ask";
  return {
    $schema: "https://opencode.ai/config.json",
    model: "yume-2/model-a",
    provider: {
      "yume-2": {
        npm: "@ai-sdk/openai-compatible",
        name: "yume-2",
        options: { baseURL: providerBaseUrl },
        models: { "model-a": { name: "model-a" } },
      },
    },
    permission,
    mcp: {
      [TEST_MCP_SERVER_NAME]: {
        type: "local",
        command: [process.execPath, FIXTURE_SERVER],
        enabled: true,
        environment: { MCP_ECHO_SERVER_LOG: mcpLogPath },
        timeout: 10_000,
      },
    },
  };
}

async function executeRun(
  variant: "control" | "fix",
  provider: { readonly baseUrl: string; readonly origin: string },
  artifactDir: string,
  binary: string,
): Promise<RunEvidence> {
  console.log(`\n=== ${variant.toUpperCase()} RUN ===`);
  const root = await mkdtemp(join(tmpdir(), `yume-mcp-qa-${variant}-`));
  const workspace = join(root, "workspace");
  const configDir = join(root, "opencode-config");
  await Promise.all([mkdir(workspace, { recursive: true }), mkdir(configDir, { recursive: true })]);
  const mcpLogPath = join(artifactDir, `mcp-echo-${variant}.log`);
  const sidecarLogPath = join(artifactDir, `sidecar-${variant}.log`);
  const port = await freePort();
  let child: OwnedChild | undefined;
  let pid: number | undefined;
  const cleanup = async (): Promise<RunCleanup> => {
    if (child !== undefined) await stopChild(child);
    const gone = await processGone(pid);
    let removed = await pathMissing(root);
    if (!removed) {
      for (let attempt = 0; attempt < 40 && !removed; attempt += 1) {
        await removeTempRoot(root).catch((error: unknown) => {
          console.log(`[${variant}] temp root removal attempt failed: ${error instanceof Error ? error.message : String(error)}`);
        });
        removed = await pathMissing(root);
        if (!removed) await Bun.sleep(250);
      }
    }
    const receipt = { processGone: gone, sidecarClosed: await portClosed(port), tempRootRemoved: removed };
    console.log(
      `[${variant}] cleanup: processGone=${receipt.processGone} sidecarClosed=${receipt.sidecarClosed} tempRootRemoved=${receipt.tempRootRemoved}`,
    );
    return receipt;
  };

  let tap: { readonly tail: () => string } | undefined;
  try {
    const config = buildConfig(variant, provider.baseUrl, mcpLogPath);
    const env = childEnv({ root, providerBaseUrl: provider.baseUrl, runtimeCanary: crypto.randomUUID() });
    env.OPENCODE_CONFIG_DIR = configDir;
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify(config);
    console.log(
      `[${variant}] config baked into OPENCODE_CONFIG_CONTENT ` +
        `(permission[${TEST_MCP_APPROVED_TOOL_ID}]=${variant === "fix" ? "ask" : "<absent>"})`,
    );

    child = spawn(binary, ["--pure", "serve", "--port", String(port), "--hostname", "127.0.0.1", "--print-logs"], {
      cwd: workspace,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    pid = child.pid;
    if (pid === undefined) fail("sidecar PID unavailable");
    tap = streamTap(child, sidecarLogPath);
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`[${variant}] sidecar pid=${pid} port=${port}`);

    await waitHealth(baseUrl);
    console.log(`[${variant}] health ok (version ${EXPECTED_VERSION})`);

    const mcpStatus = await waitMcpConnected(baseUrl, workspace);
    await waitToolsListed(mcpLogPath);
    console.log(`[${variant}] MCP server ${mcpStatus}; fixture served tools/list`);

    await providerReset(provider.origin);
    const created: unknown = await api(baseUrl, workspace, "/session", {
      method: "POST",
      body: { title: `p3-mcp-${variant}` },
    });
    if (!isJsonObject(created) || typeof created.id !== "string") {
      fail(`session create returned ${JSON.stringify(created)}`);
    }
    const sessionId = created.id;
    const marker = `mk${variant === "fix" ? "f" : "c"}${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    await api(baseUrl, workspace, `/session/${sessionId}/prompt_async`, {
      method: "POST",
      body: {
        messageID: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        model: { providerID: "yume-2", modelID: "model-a" },
        parts: [{ type: "text", text: `${TRIGGER} ${marker}` }],
      },
    });
    console.log(`[${variant}] session=${sessionId} prompt sent (marker=${marker})`);

    const matched = await markerRequests(provider.origin, marker);
    const last = matched.at(-1);
    if (last === undefined) fail("no marker request recorded");
    const names = new Set(toolNamesOf(last));
    const approvedPresent = names.has(TEST_MCP_APPROVED_TOOL_ID);
    const unapprovedPresent = names.has(TEST_MCP_UNAPPROVED_TOOL_ID);
    console.log(
      `[${variant}] provider recorded ${matched.length} request(s); tools: ` +
        `${TEST_MCP_APPROVED_TOOL_ID}=${approvedPresent ? "present" : "absent"}, ` +
        `${TEST_MCP_UNAPPROVED_TOOL_ID}=${unapprovedPresent ? "present" : "absent"}`,
    );

    if (variant === "control") {
      if (approvedPresent) fail(`control run: ${TEST_MCP_APPROVED_TOOL_ID} unexpectedly reached the provider tools array`);
      if (unapprovedPresent) {
        fail(`control run: ${TEST_MCP_UNAPPROVED_TOOL_ID} unexpectedly reached the provider tools array`);
      }
      // Session settle is hygiene here, not a spec assertion: a denied bash reply
      // may legitimately end the loop with an error state in some builds.
      await waitSessionSettled(baseUrl, workspace, sessionId).catch((error: unknown) => {
        console.log(
          `[control] settle wait inconclusive (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return {
        approved_tool_present: false,
        unapproved_tool_present: false,
        session_id: sessionId,
        marker,
        request_count: matched.length,
        mcp_status: mcpStatus,
        cleanup: await cleanup(),
      };
    }

    if (!approvedPresent) fail(`fix run: ${TEST_MCP_APPROVED_TOOL_ID} did not reach the provider tools array`);
    if (unapprovedPresent) fail(`fix run: ${TEST_MCP_UNAPPROVED_TOOL_ID} unexpectedly reached the provider tools array`);

    const permission = await poll(`pending permission for ${TEST_MCP_APPROVED_TOOL_ID}`, 30_000, async () => {
      const value: unknown = await api(baseUrl, workspace, "/permission");
      if (!Array.isArray(value)) return undefined;
      for (const item of value.filter(isJsonObject)) {
        if (item.sessionID !== sessionId || item.permission !== TEST_MCP_APPROVED_TOOL_ID) continue;
        const id = item.id;
        if (typeof id !== "string") continue;
        return { id };
      }
      return undefined;
    });
    console.log(`[fix] permission request pending: id=${permission.id} permission=${TEST_MCP_APPROVED_TOOL_ID}`);
    await api(baseUrl, workspace, `/permission/${permission.id}/reply`, { method: "POST", body: { reply: "once" } });
    console.log("[fix] approved once; waiting for the real MCP tool result");

    const expectedMarker = `${ECHO_PREFIX}${marker}`;
    await poll(`session messages containing ${expectedMarker}`, 60_000, async () => {
      const snapshot = await sessionMessages(baseUrl, workspace, sessionId);
      return JSON.stringify(snapshot).includes(expectedMarker) ? true : undefined;
    });
    if (JSON.stringify(await sessionMessages(baseUrl, workspace, sessionId)).includes("YUME_MCP_ECHO_UNAPPROVED")) {
      fail("fix run: unapproved MCP tool executed");
    }
    await waitSessionSettled(baseUrl, workspace, sessionId);
    console.log(`[fix] tool result marker observed: ${expectedMarker}`);
    return {
      approved_tool_present: true,
      unapproved_tool_present: false,
      approval_round_trip: "pass",
      tool_result_marker: expectedMarker,
      permission_request_id: permission.id,
      session_id: sessionId,
      marker,
      request_count: matched.length,
      mcp_status: mcpStatus,
      cleanup: await cleanup(),
    };
  } catch (error) {
    const receipt = await cleanup();
    if (error instanceof HarnessError) {
      error.cleanup = receipt;
      const tail = tap?.tail();
      if (tail !== undefined && tail.length > 0) {
        error.message = `${error.message}\n--- sidecar output tail ---\n${tail.slice(-4_000)}`;
      }
    }
    throw error;
  }
}

async function binarySha256(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function binaryVersion(path: string): Promise<string> {
  const child = spawn(path, ["--version"], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", resolveExit);
  });
  if (code !== 0) fail(`opencode --version exited ${String(code)}`);
  return stdout.trim();
}

async function main(): Promise<void> {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const artifactDir = resolve(PROJECT_ROOT, "artifacts/opencode-native", `p3-mcp-${stamp}`);
  const providerRunDir = join(artifactDir, "provider");
  await mkdir(providerRunDir, { recursive: true });
  console.log(`artifact dir: ${artifactDir}`);

  const binary = await findSourceBinary();
  const [version, sha256] = await Promise.all([binaryVersion(binary), binarySha256(binary)]);
  if (version !== EXPECTED_VERSION) fail(`sidecar version mismatch: expected ${EXPECTED_VERSION}, got ${version}`);
  console.log(`sidecar: ${binary}\nversion: ${version}\nsha256: ${sha256}`);

  const provider = await startProviderChild(providerRunDir);
  const providerOrigin = provider.baseUrl.replace(/\/v1\/?$/, "");
  console.log(`provider: pid=${provider.pid} baseUrl=${provider.baseUrl}`);

  const runs: { control?: RunEvidence; fix?: RunEvidence } = {};
  let failure: string | undefined;
  let failureCleanup: RunCleanup | undefined;
  try {
    const providerRef = { baseUrl: provider.baseUrl, origin: providerOrigin };
    runs.control = await executeRun("control", providerRef, artifactDir, binary);
    runs.fix = await executeRun("fix", providerRef, artifactDir, binary);
  } catch (error) {
    failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    if (error instanceof HarnessError) failureCleanup = error.cleanup;
    console.error(`HARNESS FAILURE: ${failure}`);
  }

  await stopChild(provider.child);
  const providerReceipt = {
    processGone: await processGone(provider.pid),
    portClosed: await portClosed(provider.port),
  };
  console.log(`provider cleanup: processGone=${providerReceipt.processGone} portClosed=${providerReceipt.portClosed}`);

  const cleanup = {
    control: runs.control?.cleanup ?? failureCleanup ?? null,
    fix: runs.fix?.cleanup ?? failureCleanup ?? null,
    provider: providerReceipt,
  };
  const closed = (receipt: RunCleanup | null): boolean =>
    receipt !== null && receipt.processGone && receipt.sidecarClosed && receipt.tempRootRemoved;
  const allClosed =
    closed(cleanup.control) && closed(cleanup.fix) && providerReceipt.processGone && providerReceipt.portClosed;

  const evidence = {
    harness: "scripts/agent-qa/verify-mcp-permission.ts",
    status: failure === undefined && allClosed ? "pass" : "fail",
    failure: failure ?? null,
    sidecar_version: version,
    binary_sha256: sha256,
    binary_path: binary,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    tool_ids: { approved: TEST_MCP_APPROVED_TOOL_ID, unapproved: TEST_MCP_UNAPPROVED_TOOL_ID },
    control_run: runs.control ?? null,
    fix_run: runs.fix ?? null,
    cleanup: { ...cleanup, allClosed },
  };
  const evidencePath = join(artifactDir, "mcp-tool-exposure.json");
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\nevidence: ${evidencePath}`);
  console.log(JSON.stringify(evidence, null, 2));
  if (failure !== undefined || !allClosed) {
    if (!allClosed) console.error("CLEANUP INCOMPLETE: a spawned process or port is still open");
    process.exitCode = 1;
  }
}

await main();
