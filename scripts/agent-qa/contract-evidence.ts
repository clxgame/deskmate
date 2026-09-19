import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Check, CleanupReceipt, JsonObject } from "./types";

export type RunEvidence = {
  readonly batch: string;
  readonly version: string;
  readonly pid: number;
  readonly port: number;
  readonly checks: readonly Check[];
  readonly cleanup: CleanupReceipt;
  readonly adversarial: JsonObject;
};

export async function writeContractEvidence(batchDirectory: string, evidence: RunEvidence, expectedFailure: JsonObject): Promise<void> {
  await mkdir(batchDirectory, { recursive: true });
  await writeFile(join(batchDirectory, "01-contract.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(batchDirectory, "01-contract-failure.json"), JSON.stringify(expectedFailure, null, 2));
  const lines = evidence.checks.map((item) => `- ${item.passed ? "PASS" : "FAIL"}: ${item.name} — ${item.detail}`);
  await writeFile(join(batchDirectory, "01-contract.md"), `# Workspace Agent OpenCode contract\n\nOpenCode ${evidence.version}; PID ${evidence.pid}; loopback port ${evidence.port}.\n\n${lines.join("\n")}\n\nAdversarial: ${JSON.stringify(evidence.adversarial)}\n\nCleanup: ${JSON.stringify(evidence.cleanup)}\n`);
}
