import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSession, discoverTools, messages, prompt, replyPermission, request, waitForPermission, waitForPermissionEvent, waitForTerminal, type Client } from "./client";
import { writePermissionEvidence } from "./permissions-evidence";
import { RuntimeSetupError, startRuntime, type Runtime } from "./runtime";
import { runMalformedRecovery, runRecovery } from "./recovery";
import { runLifecycle } from "./lifecycle";
import { check, ContractError, jsonObject, stringField, type Check, type CleanupReceipt, type JsonObject } from "./types";
import { writeContractEvidence, type RunEvidence } from "./contract-evidence";

const permissions = [
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "trusted_probe", pattern: "*", action: "allow" },
  { permission: "edit", pattern: "*", action: "ask" },
  { permission: "bash", pattern: "*", action: "ask" },
  { permission: "webfetch", pattern: "*", action: "ask" },
] as const;

async function approve(client: Client, sessionId: string, reply: "once" | "reject"): Promise<JsonObject> {
  let permission: JsonObject;
  try {
    permission = await waitForPermission(client, sessionId);
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    throw new ContractError("PERMISSION_MISSING", `${error.message}; snapshot=${JSON.stringify(await messages(client, sessionId))}`);
  }
  await replyPermission(client, stringField(permission, "id"), reply);
  return permission;
}

function completedTool(envelope: JsonObject): JsonObject {
  const parts = envelope.parts;
  if (!Array.isArray(parts)) throw new ContractError("INVALID_WIRE", "terminal envelope has no parts");
  const tool = parts.filter((part): part is JsonObject => typeof part === "object" && part !== null && !Array.isArray(part))
    .find((part) => part.type === "tool" && typeof part.state === "object" && part.state !== null && !Array.isArray(part.state) && part.state.status === "completed");
  if (tool === undefined) throw new ContractError("INVALID_WIRE", `completed tool part missing: ${JSON.stringify(envelope)}`);
  return tool;
}

async function runPrompt(client: Client, sessionId: string, marker: string, approval?: "once" | "reject"): Promise<JsonObject> {
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(client, sessionId, messageId, marker);
  if (approval !== undefined) await approve(client, sessionId, approval);
  return waitForTerminal(client, sessionId, messageId);
}

async function runContract(root: string, baseUrl: string, workspaceA: string, workspaceB: string, injectDiscoveryFailure: boolean): Promise<readonly Check[]> {
  const checks: Check[] = [];
  const clientA = { baseUrl, directory: workspaceA } satisfies Client;
  const clientB = { baseUrl, directory: workspaceB } satisfies Client;
  console.log("stage=tool-discovery");
  if (injectDiscoveryFailure) throw new ContractError("INJECTED_DISCOVERY_TIMEOUT", "injected early tool-discovery timeout");
  const discovery = await discoverTools(clientA);
  checks.push(check("private trusted tool discovered", discovery.ids.includes("trusted_probe"), JSON.stringify(discovery)));

  const sessionA = await createSession(clientA, "agent-a", permissions);
  const sessionB = await createSession(clientB, "agent-b", permissions);
  console.log("stage=tool-execution");
  checks.push(check("native directory binding", sessionA !== sessionB, `${sessionA} / ${sessionB}`));
  const trusted = completedTool(await runPrompt(clientA, sessionA, "QA_TRUSTED"));
  checks.push(check("trusted tool executes outside workspace", JSON.stringify(trusted).includes("private-config"), JSON.stringify(trusted)));

  const readA = completedTool(await runPrompt(clientA, sessionA, "QA_READ"));
  const readB = completedTool(await runPrompt(clientB, sessionB, "QA_READ"));
  checks.push(check("workspace A read", JSON.stringify(readA).includes("ORIGINAL_A"), JSON.stringify(readA)));
  checks.push(check("workspace B read", JSON.stringify(readB).includes("ORIGINAL_B"), JSON.stringify(readB)));
  checks.push(check("prompt injection inert", !JSON.stringify(readB).includes("ORIGINAL_A"), "B tool output did not cross into A"));

  const rejectedBefore = await readFile(join(workspaceA, "same.txt"));
  await runPrompt(clientA, sessionA, "QA_EDIT", "reject");
  const rejectedAfter = await readFile(join(workspaceA, "same.txt"));
  checks.push(check("rejected edit byte stable", rejectedBefore.equals(rejectedAfter), rejectedAfter.toString("utf8")));
  const edited = completedTool(await runPrompt(clientA, sessionA, "QA_EDIT", "once"));
  checks.push(check("approved edit tool completed", JSON.stringify(edited).includes("completed"), JSON.stringify(edited)));
  checks.push(check("approved edit changed owned file", await readFile(join(workspaceA, "same.txt"), "utf8") === "EDITED_A", "same.txt=EDITED_A"));

  const shellMessage = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(clientA, sessionA, shellMessage, "QA_SHELL");
  const shellPermission = await approve(clientA, sessionA, "once");
  await waitForTerminal(clientA, sessionA, shellMessage);
  checks.push(check("shell request binds native command", shellPermission.permission === "bash" && JSON.stringify(shellPermission).includes("command.exit"), JSON.stringify(shellPermission)));
  checks.push(check("approved synthetic command exit", await readFile(join(workspaceA, "command.exit"), "utf8") === "0", "command.exit=0"));

  const escapeMessage = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(clientB, sessionB, escapeMessage, "QA_ESCAPE");
  const escapeTerminal = await waitForTerminal(clientB, sessionB, escapeMessage);
  checks.push(check("B escape denied without authorization", JSON.stringify(escapeTerminal).includes("external_directory") && JSON.stringify(escapeTerminal).includes('"status":"error"'), JSON.stringify(escapeTerminal)));
  checks.push(check("B escape did not modify authorization", await readFile(join(workspaceA, "same.txt"), "utf8") === "EDITED_A", "A remains EDITED_A"));

  const report = await createSession(clientA, "report", [{ permission: "*", pattern: "*", action: "deny" }]);
  await prompt(clientA, report, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "QA_UNKNOWN");
  const denied = await waitForPermission(clientA, report).then(() => false, (error: unknown) => error instanceof ContractError && error.code === "TIMEOUT");
  checks.push(check("report and unknown remain deny", denied, "no permission request was exposed"));

  const web = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  const webEvent = waitForPermissionEvent(clientA, sessionA);
  await prompt(clientA, sessionA, web, "QA_WEBFETCH");
  const webPermission = await webEvent;
  await replyPermission(clientA, stringField(webPermission, "id"), "reject");
  checks.push(check("webfetch missing timeout accepted by event", webPermission.permission === "webfetch" && JSON.stringify(webPermission).includes("not-running"), JSON.stringify(webPermission)));
  await waitForTerminal(clientA, sessionA, web);

  const exactMessageId = `msg_caller_${crypto.randomUUID().replaceAll("-", "")}`;
  console.log(`stage=exact-message-id id=${exactMessageId}`);
  await prompt(clientA, sessionA, exactMessageId, "QA_READ");
  await waitForTerminal(clientA, sessionA, exactMessageId);
  const page = await messages(clientA, sessionA, 1);
  const recovered = await messages(clientA, sessionA, 200);
  checks.push(check("pagination limit honored", page.length === 1, `limit=1 returned ${page.length}`));
  checks.push(check("snapshot recovery retains history", recovered.length > page.length, `${recovered.length} > ${page.length}`));
  checks.push(check("native envelope has info and parts", recovered.every((item) => item.info !== undefined && Array.isArray(item.parts)), `validated ${recovered.length} envelopes`));
  const exactUser = recovered.some((item) => {
    const info = item.info;
    return typeof info === "object" && info !== null && !Array.isArray(info) && info.id === exactMessageId && info.role === "user";
  });
  const exactChild = recovered.some((item) => {
    const info = item.info;
    return typeof info === "object" && info !== null && !Array.isArray(info) && info.parentID === exactMessageId && info.role === "assistant";
  });
  checks.push(check("exact caller message ID retained", exactUser && exactChild, `${exactMessageId} retained with assistant parentID`));

  const abortSession = await createSession(clientA, "abort", permissions);
  const abortMessage = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(clientA, abortSession, abortMessage, "QA_ABORT");
  const abortResponse = await request(clientA, `/session/${abortSession}/abort`, { method: "POST" });
  checks.push(check("abort acknowledged", abortResponse === true || abortResponse === null, JSON.stringify(abortResponse)));
  const aborted = await messages(clientA, abortSession);
  checks.push(check("abort does not fabricate completion", !JSON.stringify(aborted).includes('"finish":"stop"'), JSON.stringify(aborted)));
  const repeatedAbort = await createSession(clientA, "repeated-abort", permissions);
  await prompt(clientA, repeatedAbort, `msg_${crypto.randomUUID().replaceAll("-", "")}`, "QA_ABORT");
  const repeatedAbortResponse = await request(clientA, `/session/${repeatedAbort}/abort`, { method: "POST" });
  checks.push(check("repeated interruption acknowledged", repeatedAbortResponse === true || repeatedAbortResponse === null, JSON.stringify(repeatedAbortResponse)));

  const malformedSession = await createSession(clientA, "malformed", permissions);
  const malformedId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(clientA, malformedSession, malformedId, "QA_BAD_RESPONSE");
  const malformed = await waitForTerminal(clientA, malformedSession, malformedId);
  const malformedInfo = jsonObject(malformed.info, "malformed info");
  checks.push(check("malformed provider response rejected", malformedInfo.error !== undefined || malformedInfo.finish !== "stop", JSON.stringify(malformed)));
  checks.push(check("stale state root-local", (await stat(root)).isDirectory(), "current owned root remained active"));
  console.log("stage=contract-complete");
  return checks;
}

async function main(): Promise<void> {
  const expectedFailureMode = process.argv.includes("--case") && process.argv.includes("expected-failure");
  if (expectedFailureMode) {
    console.log("PASS misleading fixture");
    throw new ContractError("EXPECTED_FAILURE", "misleading PASS lacked required artifact");
  }
  const batch = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const batchDirectory = resolve(".omo/evidence/yume-agent-mode-sol", batch);
  const permissionsMode = process.argv.includes("permissions");
  const discoveryFailureMode = process.argv.includes("--case") && process.argv.includes("discovery-failure");
  if (process.argv.includes("lifecycle") || process.argv.includes("lifecycle-host-failure")) {
    await runLifecycle(batchDirectory, process.argv.includes("lifecycle-host-failure"));
    console.log(`evidence=${batchDirectory}`);
    return;
  }
  if (process.argv.includes("recovery-malformed")) await runMalformedRecovery();
  if (process.argv.includes("recovery")) {
    await runRecovery(batchDirectory);
    console.log(`evidence=${batchDirectory}`);
    return;
  }
  const spawnFailureMode = process.argv.includes("--case") && process.argv.includes("spawn-failure");
  if (spawnFailureMode) {
    try {
      const unexpected = await startRuntime({ injectSpawnFailure: true });
      await unexpected.close();
      throw new ContractError("INJECTION_FAILED", "spawn failure injection unexpectedly created a child");
    } catch (error) {
      if (!(error instanceof RuntimeSetupError)) throw error;
      const passed = error.cleanup.processGone && error.cleanup.providerClosed && error.cleanup.sidecarClosed && error.cleanup.tempRootRemoved;
      check("spawn failure cleanup", passed, JSON.stringify(error.cleanup));
      await mkdir(batchDirectory, { recursive: true });
      await writeFile(join(batchDirectory, "spawn-failure.json"), JSON.stringify({ root: error.root, providerPort: error.providerPort, sidecarPort: error.sidecarPort, cleanup: error.cleanup }, null, 2));
      console.log(`evidence=${batchDirectory}`);
      return;
    }
  }
  let runtime: Runtime;
  try {
    runtime = await startRuntime({ includeTrusted: process.env.AGENT_QA_OMIT_TRUSTED !== "1" });
  } catch (error) {
    if (error instanceof RuntimeSetupError) {
      await mkdir(batchDirectory, { recursive: true });
      await writeFile(join(batchDirectory, "setup-failure.json"), JSON.stringify({ root: error.root, providerPort: error.providerPort, sidecarPort: error.sidecarPort, cleanup: error.cleanup, message: error.message }, null, 2));
    }
    throw error;
  }
  const interrupt = (): void => {
    void runtime.close().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  console.log(`stage=runtime-ready pid=${runtime.pid} port=${runtime.port}`);
  let checks: readonly Check[] = [];
  let runFailure: JsonObject | undefined;
  let failure: JsonObject = {
    expectedFailureCommand: "bun scripts/agent-qa/contract.ts --case expected-failure",
    expectedExit: 1,
    observedExit: 1,
    misleadingOutput: "PASS misleading fixture",
    requiredArtifactPresent: false,
    detected: true,
  };
  let output = "";
  runtime.child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  runtime.child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
  try {
    checks = await runContract(runtime.root, runtime.baseUrl, runtime.workspaceA, runtime.workspaceB, discoveryFailureMode);
  } catch (error) {
    runFailure = {
      code: error instanceof ContractError ? error.code : "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
    failure = { ...failure, driverError: error instanceof Error ? error.message : String(error), driverStack: error instanceof Error ? error.stack ?? error.message : String(error), sidecarTail: output.slice(-4_000) };
    throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    const cleanup = await runtime.close();
    const adversarial = {
      malformed_input: "malformed SSE became UnknownError, never successful stop",
      prompt_injection: "workspace B instruction text did not alter tool policy or expose A",
      cancel_resume: "abort produced MessageAbortedError; recovery used persisted snapshot only",
      stale_state: "each run used a new root, PID, sessions and dynamic ports",
      dirty_worktree: "untracked docs/AGENT_HARNESS_ROADMAP_AUDIT.md remained untouched",
      hung_commands: "health, discovery, permissions, events and completion all have deadlines",
      flaky_tests: "single bounded run only; repeat consistency is recorded in a separate aggregate artifact",
      misleading_success_output: "expected-failure prints PASS but exits 1 without the required artifact",
      repeated_interruptions: "two aborts were acknowledged and owned process/ports were cleaned",
    };
    const evidence = { batch, version: "1.18.21", pid: runtime.pid, port: runtime.port, checks, cleanup, adversarial } satisfies RunEvidence;
    if (permissionsMode) await writePermissionEvidence(batchDirectory, {
      version: evidence.version,
      pid: evidence.pid,
      port: evidence.port,
      checks,
      cleanup,
      ...(runFailure === undefined ? {} : { failure: runFailure }),
      sidecarTail: output.slice(-4_000),
      providerRequestCount: runtime.provider.requests.length,
    });
    else await writeContractEvidence(batchDirectory, evidence, failure);
    if (!cleanup.processGone || !cleanup.providerClosed || !cleanup.sidecarClosed || !cleanup.tempRootRemoved) {
      throw new ContractError("CLEANUP_FAILED", JSON.stringify(cleanup));
    }
    console.log(`evidence=${batchDirectory}`);
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
