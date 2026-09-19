import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createSession, discoverTools, messages, prompt, replyPermission, waitForPermission, type Client } from "./client";
import { startRuntime } from "./runtime";
import { check, ContractError, stringField, type JsonObject } from "./types";

const permissions = [
  { permission: "read", pattern: "*", action: "allow" },
  { permission: "write", pattern: "*", action: "ask" },
  { permission: "edit", pattern: "*", action: "ask" },
  { permission: "bash", pattern: "*", action: "ask" },
] as const;

function toolParts(snapshot: readonly JsonObject[]): readonly JsonObject[] {
  return snapshot.flatMap((envelope) => Array.isArray(envelope.parts)
    ? envelope.parts.filter((part): part is JsonObject => typeof part === "object" && part !== null && !Array.isArray(part) && part.type === "tool") : []);
}

async function runWithApprovals(client: Client, sessionId: string, marker: string, approvals: number): Promise<readonly JsonObject[]> {
  const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
  await prompt(client, sessionId, messageId, marker);
  for (let index = 0; index < approvals; index += 1) {
    const request = await waitForPermission(client, sessionId).catch(async (error: unknown) => {
      throw new ContractError("FLOW_PERMISSION", `${error instanceof Error ? error.message : String(error)}; snapshot=${JSON.stringify(await messages(client, sessionId))}`);
    });
    await replyPermission(client, stringField(request, "id"), "once");
  }
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await messages(client, sessionId);
    const stopped = snapshot.some((envelope) => {
      const info = envelope.info;
      return typeof info === "object" && info !== null && !Array.isArray(info) && info.parentID === messageId && info.finish === "stop";
    });
    if (stopped) return snapshot;
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", `flow ${sessionId} did not reach final stop`);
}

function completed(parts: readonly JsonObject[], tool: string): readonly JsonObject[] {
  return parts.filter((part) => part.tool === tool && typeof part.state === "object" && part.state !== null && !Array.isArray(part.state) && part.state.status === "completed");
}

async function main(): Promise<void> {
  const batch = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const evidence = resolve(".omo/evidence/yume-agent-mode-sol", batch);
  await mkdir(evidence, { recursive: true });
  const negative = process.argv.includes("negative");
  const runtime = await startRuntime({ flowTools: true });
  let documentEvidence: JsonObject = { status: "failed" };
  let codeEvidence: JsonObject = { status: "failed" };
  let negativeEvidence: JsonObject = { status: negative ? "running" : "not_requested" };
  try {
    const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA } satisfies Client;
    await discoverTools(client);
    const notes = "完成需求梳理\n确认接口方案\n补充边界测试\n";
    await writeFile(join(runtime.workspaceA, "notes.txt"), notes, "utf8");
    const before = await readFile(join(runtime.workspaceA, "notes.txt"));
    const documentSession = await createSession(client, "document-flow", permissions);
    const documentParts = toolParts(await runWithApprovals(client, documentSession, "FLOW_DOCUMENT", 1));
    const summary = await readFile(join(runtime.workspaceA, "summary.md"), "utf8");
    if (negative) await writeFile(join(runtime.workspaceA, "summary.md"), "PASS", "utf8");
    check("document read tool", completed(documentParts, "read").length === 1, JSON.stringify(documentParts));
    check("document write tool", completed(documentParts, "write").length === 1, JSON.stringify(documentParts));
    check("notes byte stable", before.equals(await readFile(join(runtime.workspaceA, "notes.txt"))), "notes unchanged");
    check("summary exact categories", summary === "## 已完成\n- 完成需求梳理\n- 确认接口方案\n\n## 待办\n- 补充边界测试\n", summary);
    if (negative) check("negative detects misleading output", await readFile(join(runtime.workspaceA, "summary.md"), "utf8") === summary, "fixture printed PASS after corrupting artifact");
    documentEvidence = { status: "passed", sessionId: documentSession, tools: documentParts, summary, notesByteStable: true };

    await writeFile(join(runtime.workspaceA, "sum.ts"), "export function sum(a: number, b: number) { return a - b; }\n", "utf8");
    const testSource = "import { expect, test } from 'bun:test'; import { sum } from './sum'; test('adds', () => expect(sum(2, 3)).toBe(5));\n";
    await writeFile(join(runtime.workspaceA, "sum.test.ts"), testSource, "utf8");
    const codeSession = await createSession(client, "code-flow", permissions);
    const codeParts = toolParts(await runWithApprovals(client, codeSession, "FLOW_CODE", 3));
    check("code bash ordering", completed(codeParts, "bash").length === 2, JSON.stringify(codeParts));
    check("code edit tool", completed(codeParts, "edit").length === 1, JSON.stringify(codeParts));
    check("implementation fixed", (await readFile(join(runtime.workspaceA, "sum.ts"), "utf8")).includes("a + b"), "sum.ts uses addition");
    check("test byte stable", await readFile(join(runtime.workspaceA, "sum.test.ts"), "utf8") === testSource, "test unchanged");
    const direct = Bun.spawnSync({ cmd: ["bun", "test", "sum.test.ts"], cwd: runtime.workspaceA });
    check("final real test exit", direct.exitCode === 0, direct.stderr.toString());
    codeEvidence = { status: "passed", sessionId: codeSession, tools: codeParts, finalExitCode: direct.exitCode, testByteStable: true };
    negativeEvidence = { status: negative ? "unexpected_pass" : "not_requested", detected: false };
  } catch (error) {
    negativeEvidence = { status: negative ? "passed" : "failed", detected: negative, error: error instanceof Error ? error.message : String(error) };
    if (!negative) throw error;
  } finally {
    const cleanup = await runtime.close();
    await writeFile(join(evidence, "06-document.json"), JSON.stringify({ ...documentEvidence, cleanup }, null, 2));
    await writeFile(join(evidence, "06-code.json"), JSON.stringify({ ...codeEvidence, cleanup }, null, 2));
    await writeFile(join(evidence, "06-negative.json"), JSON.stringify({ ...negativeEvidence, cleanup }, null, 2));
    check("flow cleanup", cleanup.processGone && cleanup.providerClosed && cleanup.sidecarClosed && cleanup.tempRootRemoved, JSON.stringify(cleanup));
    console.log(`evidence=${evidence}`);
  }
  if (negative) throw new ContractError("EXPECTED_FAILURE", "negative artifact corruption was detected");
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
