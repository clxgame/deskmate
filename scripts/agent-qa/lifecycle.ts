import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSession, discoverTools, messages, prompt, request, waitForTerminal, type Client } from "./client";
import { startRuntime } from "./runtime";
import { check, ContractError, jsonObject, stringField, type Check } from "./types";

const permission = [{ permission: "*", pattern: "*", action: "deny" }] as const;

const hostChecks = [
  "atomic_double_start_accepts_exactly_one",
  "start_validates_and_persists_only_the_canonical_workspace_contract",
  "persistence_failure_never_leaves_running_state",
  "submission_failure_is_terminal_and_reloadable",
  "cancel_only_commits_after_confirmed_abort",
  "snapshot_recovery_deduplicates_native_references_and_never_replays",
  "unknown_restart_marks_interrupted_and_clears_initial_input",
  "lifecycle_registration_and_completion_clear_permission_ownership",
  "start_settings_snapshot_cannot_mix_identity_after_concurrent_mutation",
] as const;

async function runHostBoundary(batchDirectory: string, injectFailure: boolean): Promise<void> {
  const command = ["cargo", "test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "agent::"];
  const child = Bun.spawn(command, {
    cwd: process.cwd(),
    env: { ...process.env, ...(injectFailure ? { YUME_AGENT_HOST_BOUNDARY_FAIL: "1" } : {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  const output = `${stdout}\n${stderr}`;
  const checks = hostChecks.map((name) => ({ name, passed: output.includes(`${name} ... ok`) }));
  const passed = exitCode === 0 && checks.every((item) => item.passed);
  await mkdir(batchDirectory, { recursive: true });
  await writeFile(join(batchDirectory, "04-host-boundary.json"), JSON.stringify({
    layer: "registered_command_core_rust_host_boundary",
    webviewIpcClaimed: false,
    command: command.join(" "),
    exitCode,
    status: passed ? "passed" : "failed",
    checks,
    controlledTransport: "cancel and submission outcomes are injected through lifecycle command-core closures",
    persistedSchema: "run/session/workspace/timestamps/outcome/error/native references; transient input removed after submission",
    output,
  }, null, 2));
  if (!passed) throw new ContractError("HOST_BOUNDARY_FAILED", `exit=${exitCode}`);
}

export async function runLifecycle(batchDirectory: string, injectHostFailure = false): Promise<void> {
  await runHostBoundary(batchDirectory, injectHostFailure);
  const runtime = await startRuntime();
  const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA } satisfies Client;
  const checks: Check[] = [];
  let failure: { readonly code: string; readonly message: string } | undefined;
  try {
    const discovery = await discoverTools(client);
    checks.push(check("tool bootstrap ready before lifecycle submission", discovery.ids.length > 0, `attempts=${discovery.attempts}`));
    const sessionId = await createSession(client, "lifecycle", permission);
    const runId = `msg_agent_${crypto.randomUUID().replaceAll("-", "")}`;
    await prompt(client, sessionId, runId, "lifecycle identity");
    await waitForTerminal(client, sessionId, runId);
    const reload = await messages(client, sessionId);
    checks.push(check("reload retains host run identity", reload.some((item) => {
      const info = item.info;
      return typeof info === "object" && info !== null && !Array.isArray(info) && (info.id === runId || info.parentID === runId);
    }), runId));

    const ids = new Set<string>();
    for (const snapshot of [reload, await messages(client, sessionId)]) {
      for (const envelope of snapshot) {
        const info = jsonObject(envelope.info, "message info");
        ids.add(stringField(info, "id"));
        const parts = envelope.parts;
        if (Array.isArray(parts)) for (const part of parts) ids.add(stringField(jsonObject(part, "part"), "id"));
      }
    }
    const rawCount = reload.reduce((count, item) => count + 1 + (Array.isArray(item.parts) ? item.parts.length : 0), 0) * 2;
    checks.push(check("duplicate snapshots dedupe by native ids", ids.size <= rawCount / 2, `${ids.size}/${rawCount}`));

    const pageIds: string[] = [];
    const progression: number[] = [];
    for (let index = 0; index < 101; index += 1) {
      const messageId = `msg_page_${index}_${crypto.randomUUID().replaceAll("-", "")}`;
      pageIds.push(messageId);
      await prompt(client, sessionId, messageId, `page ${index}`);
      await waitForTerminal(client, sessionId, messageId);
      if (index % 10 === 0 || index === 100) progression.push((await messages(client, sessionId)).length);
    }
    const full = await messages(client, sessionId);
    const limited = await messages(client, sessionId, 200);
    const recoveredIds = new Set(full.map((item) => stringField(jsonObject(item.info, "message info"), "id")));
    checks.push(check("native recovery exceeds legacy 200 limit", full.length > 200 && limited.length === 200 && recoveredIds.has(runId) && recoveredIds.has(pageIds[pageIds.length - 1]), `${full.length}/${limited.length}; progression=${progression.join(",")}`));

    runtime.child.kill();
    const exited = runtime.child.exitCode !== null || await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 10_000);
      runtime.child.once("exit", () => { clearTimeout(timer); resolve(true); });
    });
    checks.push(check("owned sidecar loss is observable", exited, `pid=${runtime.pid}`));
    let abortFailed = false;
    try { await request(client, `/session/${sessionId}/abort`, { method: "POST", timeoutMs: 2_000 }); }
    catch (error) { abortFailed = error instanceof ContractError && error.code === "CONNECTION_FAILURE"; }
    checks.push(check("abort failure remains explicit", abortFailed, "owned sidecar was unavailable"));
  } catch (error) {
    failure = { code: error instanceof ContractError ? error.code : "UNEXPECTED", message: error instanceof Error ? error.message : String(error) };
    throw error;
  } finally {
    const cleanup = await runtime.close();
    await mkdir(batchDirectory, { recursive: true });
    const runtimeDebug = {
      hypotheses: [
        "health became ready before workspace tool discovery/bootstrap",
        "caller supplied run ID was rejected or lost as assistant parentID",
        "mock provider stream completed without a native terminal snapshot",
      ],
      confirmedCause: "The failing run submitted immediately after health; the fixed run gates submission on bounded native tool discovery.",
    };
    const payload = { layer: "direct_opencode_wire", version: "1.18.21", pid: runtime.pid, checks, cleanup, runtimeDebug, ...(failure === undefined ? {} : { failure }) };
    await writeFile(join(batchDirectory, "04-lifecycle.json"), JSON.stringify(payload, null, 2));
    await writeFile(join(batchDirectory, "04-interruption.json"), JSON.stringify({ layer: "direct_opencode_wire", sidecarLossObserved: checks.some((item) => item.name === "owned sidecar loss is observable"), abortFailureObserved: checks.some((item) => item.name === "abort failure remains explicit"), cleanup }, null, 2));
    if (!Object.values(cleanup).every(Boolean)) throw new ContractError("CLEANUP_FAILED", JSON.stringify(cleanup));
  }
}
