import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { removeTempRoot } from "./ccswitch-harness/cleanup";
import { writeEvidence } from "./ccswitch-harness/evidence";
import {
  assertConfig,
  assertToolIds,
  assertToolSourceSecretFree,
  CCSWITCH_TOOL_ID,
  EXPECTED_OPENCODE_VERSION,
  stageCcswitchTool,
} from "./ccswitch-harness/permissions";
import { freePort, startOpenCode, stopChild } from "./ccswitch-harness/process";
import { requestJson, waitForHealth } from "./ccswitch-harness/transport";
import { HarnessError, type DiscoveryEvidence } from "./ccswitch-harness/types";
import { findSourceBinary } from "./prepare-opencode";

const discoveryTimeoutMs = 300_000;

function remainingSeconds(deadline: number, maxSeconds: number): number {
  const remaining = Math.ceil((deadline - Date.now()) / 1_000);
  if (remaining <= 0) throw new HarnessError("OpenCode discovery timed out");
  return Math.min(maxSeconds, Math.max(1, remaining));
}

export async function runDiscovery(): Promise<void> {
  await assertToolSourceSecretFree();
  const deadline = Date.now() + discoveryTimeoutMs;
  const root = await mkdtemp(join(tmpdir(), "yume-ccswitch-tool-"));
  const workspace = join(root, "workspace");
  const port = await freePort();
  let child: ChildProcessWithoutNullStreams | undefined;
  let evidence: DiscoveryEvidence | undefined;
  try {
    await stageCcswitchTool(workspace);
    const binary = await findSourceBinary();
    child = startOpenCode({ binary, port, workspace, root });
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
    if (health.healthy !== true || health.version !== EXPECTED_OPENCODE_VERSION) {
      throw new HarnessError(`unexpected health: ${JSON.stringify(health)}`);
    }
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
    evidence = [
      [
        "scenario=discovery-only; launch=--pure serve",
        `binary=${basename(binary)}`,
        `health=${JSON.stringify(health)}`,
        `tool=${CCSWITCH_TOOL_ID}`,
        `permission=${JSON.stringify(config.permission)}`,
        `stderr-bytes=${Buffer.byteLength(stderr)}`,
        "cleanup=temp-removed",
      ].join("\n"),
      config,
      toolIds,
    ];
  } finally {
    if (child) await stopChild(child);
    await removeTempRoot(root);
  }
  if (!evidence) throw new HarnessError("discovery completed without evidence");
  await writeEvidence(...evidence);
}

if (import.meta.main) {
  await runDiscovery().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
