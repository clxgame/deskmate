import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, CleanupReceipt, JsonObject } from "./types";

export type PermissionEvidenceInput = {
  readonly version: string;
  readonly pid: number;
  readonly port: number;
  readonly checks: readonly Check[];
  readonly cleanup: CleanupReceipt;
  readonly failure?: JsonObject;
  readonly sidecarTail: string;
  readonly providerRequestCount: number;
};

const deniedNames = new Set([
  "rejected edit byte stable",
  "B escape denied without authorization",
  "B escape did not modify authorization",
  "report and unknown remain deny",
  "prompt injection inert",
]);

function outcome(checks: readonly Check[], names: readonly string[]): JsonObject {
  const matched = checks.filter((item) => names.includes(item.name));
  return matched.length === names.length
    ? { status: "passed", checks: matched.map((item) => item.name) }
    : { status: "not_evaluated", missingChecks: names.filter((name) => !matched.some((item) => item.name === name)) };
}

export async function writePermissionEvidence(
  batchDirectory: string,
  evidence: PermissionEvidenceInput,
): Promise<void> {
  const status = evidence.failure === undefined && evidence.checks.length > 0 && evidence.checks.every((item) => item.passed)
    ? "passed"
    : "failed";
  const denied = evidence.checks.filter((item) => deniedNames.has(item.name));
  const common = {
    status,
    layer: "direct_opencode_wire",
    failure: evidence.failure ?? null,
    sidecarTail: evidence.sidecarTail,
    providerRequestCount: evidence.providerRequestCount,
    cleanup: evidence.cleanup,
  };
  await mkdir(batchDirectory, { recursive: true });
  await writeFile(join(batchDirectory, "03-permissions.json"), JSON.stringify({
    ...common,
    version: evidence.version,
    pid: evidence.pid,
    port: evidence.port,
    checks: evidence.checks.filter((item) => !deniedNames.has(item.name)),
    requestSource: "This Bun driver reads and replies to OpenCode permission snapshots/events directly; it does not invoke the Tauri agent permission commands.",
    limitation: "Host-owned run registration and renderer-only runId/requestId/once|reject are proven by focused Rust command-boundary tests.",
  }, null, 2));
  await writeFile(join(batchDirectory, "03-denied.json"), JSON.stringify({
    ...common,
    checks: denied,
    adversarial: {
      promptInjection: outcome(evidence.checks, ["prompt injection inert"]),
      cancelResume: outcome(evidence.checks, ["abort does not fabricate completion"]),
      staleState: outcome(evidence.checks, ["stale state root-local"]),
      misleadingSuccess: outcome(evidence.checks, ["approved edit changed owned file", "approved synthetic command exit"]),
      repeatedInterruptions: outcome(evidence.checks, ["repeated interruption acknowledged"]),
    },
  }, null, 2));
  await writeFile(join(batchDirectory, "03-cleanup.json"), JSON.stringify(evidence.cleanup, null, 2));
}
