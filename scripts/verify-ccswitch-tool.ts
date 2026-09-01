import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";
import { assertTreeCanaryAbsent, pathMissing, portClosed, processGone, removeTempRoot } from "./ccswitch-harness/cleanup";
import { transcript, writeEvidence } from "./ccswitch-harness/evidence";
import {
  assertConfig,
  assertHealth,
  assertToolIds,
  assertToolSourceSecretFree,
  CCSWITCH_TOOL_ID,
  stageCcswitchTool,
  stageMalformedCcswitchTool,
} from "./ccswitch-harness/permissions";
import { freePort, type OpenCodeChild, startOpenCode, stopChild } from "./ccswitch-harness/process";
import {
  assertCanaryAbsent,
  assertMockObservation,
  assertSameCompletedTool,
  expectCompletedTool,
  expectSessionID,
} from "./ccswitch-harness/session";
import { collectSseUntil, requestJson, requestRaw, waitForHealth } from "./ccswitch-harness/transport";
import { startMockOpenAiServer } from "./fixtures/mock-openai-server";
import { HarnessError, type CleanupEvidence, type FullEvidence, type JsonObject, type ProviderDraft } from "./ccswitch-harness/types";
import { findSourceBinary } from "./prepare-opencode";

const discoveryTimeoutMs = 300_000;
const draft: ProviderDraft = {
  version: 1,
  kind: "opencode_provider_draft",
  providerName: "Todo8 Local",
  baseUrl: "https://todo8.invalid/v1",
  modelHint: "model-a",
};

type ScenarioInput = {
  readonly malformedToolFixture: boolean;
};

function remainingSeconds(deadline: number, maxSeconds: number): number {
  const remaining = Math.ceil((deadline - Date.now()) / 1_000);
  if (remaining <= 0) throw new HarnessError("OpenCode discovery timed out");
  return Math.min(maxSeconds, Math.max(1, remaining));
}

function hasCompletedToolEvent(sessionID: string, event: JsonObject): boolean {
  try {
    expectCompletedTool(event, "SSE event", { sessionID, draft });
    return true;
  } catch (error) {
    if (error instanceof HarnessError) return false;
    throw error;
  }
}

function promptBody(): JsonObject {
  return {
    model: { providerID: "yume", modelID: "model-a" },
    parts: [
      {
        type: "text",
        text: `Call ${CCSWITCH_TOOL_ID} exactly once with the provider draft fields supplied by the user.`,
      },
    ],
  };
}

async function waitForMalformedToolOutput(baseUrl: string, sessionID: string, deadline: number): Promise<never> {
  const stopAt = Date.now() + remainingSeconds(deadline, 30) * 1_000;
  let lastError = "not inspected";
  while (Date.now() < stopAt) {
    try {
      const snapshot = await requestJson({
        baseUrl,
        path: `/session/${sessionID}/message?order=asc&limit=200`,
        timeoutSeconds: remainingSeconds(deadline, 10),
      });
      const completed = expectCompletedTool(snapshot, "malformed session snapshot", { sessionID });
      throw new HarnessError(`malformed tool fixture unexpectedly returned valid JSON: ${JSON.stringify(completed.draft)}`);
    } catch (error) {
      if (error instanceof HarnessError && error.code === "malformed_tool_output") throw error;
      lastError = error instanceof Error ? error.message : String(error);
      await Bun.sleep(250);
    }
  }
  throw new HarnessError(`malformed tool fixture did not produce a completed tool output: ${lastError}`);
}

function assertCleanup(cleanup: CleanupEvidence): void {
  if (!cleanup.tempRootRemoved) throw new HarnessError("temporary root was not removed");
  if (!cleanup.opencodePortClosed) throw new HarnessError("OpenCode port remained open");
  if (!cleanup.mockPortClosed) throw new HarnessError("mock OpenAI port remained open");
  if (!cleanup.opencodeProcessGone) throw new HarnessError("OpenCode process remained alive");
}

export function malformedModeFailure(error: Error | undefined): Error {
  if (error instanceof HarnessError && error.code === "malformed_tool_output") {
    return new HarnessError(`malformed tool fixture failed as expected: ${error.message}`, "malformed_tool_output", {
      cause: error,
    });
  }
  if (error) return error;
  return new HarnessError("malformed tool fixture unexpectedly succeeded");
}

async function waitForProcessGone(pid: number | undefined): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await processGone(pid)) return;
    await Bun.sleep(250);
  }
  throw new HarnessError("OpenCode process did not exit after termination");
}

export async function runDiscovery(): Promise<void> {
  await assertToolSourceSecretFree();
  await runScenario({ malformedToolFixture: false });
}

async function runScenario(input: ScenarioInput): Promise<void> {
  const deadline = Date.now() + discoveryTimeoutMs;
  const root = await mkdtemp(join(tmpdir(), "yume-ccswitch-tool-"));
  const workspace = join(root, "workspace");
  const port = await freePort();
  const runtimeCanary = randomUUID();
  const mock = await startMockOpenAiServer({ canary: runtimeCanary, draft });
  let child: OpenCodeChild | undefined;
  let childPid: number | undefined;
  let evidence: Omit<FullEvidence, "cleanup" | "transcript"> | undefined;
  let scenarioError: Error | undefined;
  let cleanupError: Error | undefined;
  try {
    if (input.malformedToolFixture) {
      await stageMalformedCcswitchTool(workspace);
    } else {
      await stageCcswitchTool(workspace);
    }
    const binary = await findSourceBinary();
    child = startOpenCode({ binary, port, providerBaseUrl: mock.baseUrl, workspace, root, runtimeCanary });
    childPid = child.pid;
    let stdout = "";
    let stderr = "";
    let exit: string | undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("exit", (code, signal) => {
      exit = `code=${code ?? "null"} signal=${signal ?? "null"}`;
    });
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await waitForHealth(baseUrl, () => ({
      exit,
      output: `${stdout}${stderr}`.slice(-4_000),
    }));
    const checkedHealth = assertHealth(health);
    checkedHealth.binary = basename(binary);
    const toolIds = assertToolIds(
      await requestJson({
        baseUrl,
        path: "/experimental/tool/ids",
        timeoutSeconds: remainingSeconds(deadline, 240),
      }),
    );
    const config = assertConfig(
      await requestJson({
        baseUrl,
        path: "/config",
        timeoutSeconds: remainingSeconds(deadline, 5),
      }),
    );
    const sessionID = expectSessionID(await requestJson({ baseUrl, path: "/session", method: "POST", body: { title: "Todo8 CC Switch verifier" } }));
    const ssePromise = input.malformedToolFixture
      ? undefined
      : collectSseUntil({
          baseUrl,
          timeoutMs: remainingSeconds(deadline, 120) * 1_000,
          accept: (event) => hasCompletedToolEvent(sessionID, event),
        });
    const promptResult = await requestRaw({
      baseUrl,
      path: `/session/${sessionID}/prompt_async`,
      method: "POST",
      body: promptBody(),
      timeoutSeconds: remainingSeconds(deadline, 10),
    });
    if (promptResult.code !== 0) throw new HarnessError(`/prompt_async request failed: curl exit ${promptResult.code}`);
    if (!ssePromise) await waitForMalformedToolOutput(baseUrl, sessionID, deadline);
    const sseEvents = await ssePromise;
    const sse = expectCompletedTool(sseEvents, "SSE stream", { sessionID, draft });
    const snapshot = expectCompletedTool(
      await requestJson({
        baseUrl,
        path: `/session/${sessionID}/message?order=asc&limit=200`,
        timeoutSeconds: remainingSeconds(deadline, 10),
      }),
      "session snapshot",
      { sessionID, draft },
    );
    assertSameCompletedTool(sse, snapshot);
    const mockObservation = mock.observation();
    assertMockObservation(mockObservation);
    assertCanaryAbsent([stdout, stderr, checkedHealth, toolIds, config, sseEvents, snapshot, mockObservation], runtimeCanary, "runtime evidence");
    evidence = {
      health: checkedHealth,
      config,
      toolIds,
      session: sse,
      sse,
      snapshot,
      mock: mockObservation,
    };
  } catch (error) {
    scenarioError = error instanceof Error ? error : new HarnessError(String(error));
  } finally {
    if (child) {
      await stopChild(child);
      await waitForProcessGone(childPid);
    }
    await mock.close();
    try {
      await assertTreeCanaryAbsent(root, runtimeCanary);
    } catch (error) {
      cleanupError = error instanceof Error ? error : new HarnessError(String(error), "canary_leak");
    }
    await removeTempRoot(root);
  }
  if (cleanupError) scenarioError = cleanupError;
  const cleanup = {
    tempRootRemoved: await pathMissing(root),
    opencodePortClosed: await portClosed(port),
    mockPortClosed: await portClosed(mock.port),
    opencodeProcessGone: await processGone(childPid),
  };
  assertCleanup(cleanup);
  if (input.malformedToolFixture) {
    console.error(`malformed-fixture-cleanup=${JSON.stringify(cleanup)}`);
    throw malformedModeFailure(scenarioError);
  }
  if (scenarioError) throw scenarioError;
  if (!evidence) throw new HarnessError("discovery completed without evidence");
  const fullEvidence = { ...evidence, cleanup, transcript: "" };
  const completedEvidence = { ...fullEvidence, transcript: transcript(fullEvidence) };
  assertCanaryAbsent(completedEvidence, runtimeCanary, "final evidence");
  await writeEvidence(completedEvidence);
}

if (import.meta.main) {
  const malformedToolFixture = process.argv.includes("--malformed-tool-fixture");
  const task = malformedToolFixture ? runScenario({ malformedToolFixture }) : runDiscovery();
  await task.catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
