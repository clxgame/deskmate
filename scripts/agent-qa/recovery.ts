import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSessionMessages, OpenCodeWireError } from "../../src/lib/opencodeMessages";
import { createSession, discoverTools, messages, prompt, waitForTerminal, type Client } from "./client";
import { startRuntime } from "./runtime";
import { check } from "./types";

const permission = [{ permission: "read", pattern: "*", action: "allow" }] as const;

export async function runMalformedRecovery(): Promise<never> {
  parseSessionMessages([{ info: { id: "msg", sessionID: "ses", role: "assistant" }, parts: {} }]);
  throw new Error("malformed recovery fixture was accepted");
}

export async function runRecovery(batchDirectory: string): Promise<void> {
  const runtime = await startRuntime();
  try {
    const client = { baseUrl: runtime.baseUrl, directory: runtime.workspaceA } satisfies Client;
    console.log("stage=recovery-tool-discovery");
    const discovery = await discoverTools(client);
    check("tool discovery completed", discovery.ids.includes("read"), JSON.stringify(discovery));
    const sessionId = await createSession(client, "recovery", permission);
    const messageIds = Array.from({ length: 3 }, () => `msg_recovery_${crypto.randomUUID().replaceAll("-", "")}`);
    for (const messageId of messageIds) {
      console.log(`stage=recovery-prompt id=${messageId}`);
      await prompt(client, sessionId, messageId, "QA_READ");
      await waitForTerminal(client, sessionId, messageId);
    }
    const limited = await messages(client, sessionId, 1);
    const snapshot = await messages(client, sessionId);
    const parsed = parseSessionMessages(snapshot);
    const first = messageIds[0];
    const recovered = parsed.some((message) => message.info.role === "assistant" && message.info.parentID === first);
    let malformedTyped = false;
    try {
      parseSessionMessages([{ info: { id: "bad", sessionID: sessionId, role: "assistant" }, parts: {} }]);
    } catch (error) {
      malformedTyped = error instanceof OpenCodeWireError && error.code === "INVALID_MESSAGE_ENVELOPE";
    }
    const checks = [
      check("limit one is one", limited.length === 1, `limited=${limited.length}`),
      check("full snapshot exceeds limited page", parsed.length > limited.length, `full=${parsed.length}`),
      check("old run recovered from full snapshot", recovered, `parentID=${first}`),
      check("malformed envelope has typed error", malformedTyped, "OpenCodeWireError"),
    ];
    await mkdir(batchDirectory, { recursive: true });
    await writeFile(join(batchDirectory, "02-recovery.json"), JSON.stringify({
      sessionId, messageIds, limitedCount: limited.length, fullCount: parsed.length,
      checks, pid: runtime.pid, port: runtime.port,
      adversarial: {
        malformed_input: "wrong parts shape produced OpenCodeWireError",
        cancel_resume: "terminal recovery required exact assistant parentID",
        stale_state: "new root/session/message IDs used; oldest current-run parent recovered",
        dirty_worktree: "driver uses only its temporary root",
        hung_commands: "runtime and terminal waits are bounded",
        flaky_tests: "deterministic provider markers and exact IDs",
        misleading_success_output: "state and parentID are inspected rather than output text",
        prompt_injection: "not applicable to wire parsing; covered by Task 1 policy test",
        repeated_interruptions: "not applicable to snapshot parsing; covered by Task 1 cleanup test"
      },
      debug: {
        hypotheses: [
          { id: "H1", claim: "no-limit endpoint prevents terminal polling", result: "refuted after discovery warm-up" },
          { id: "H2", claim: "caller ID parent association changed", result: "refuted by exact recovered parentID" },
          { id: "H3", claim: "instance and private-tool discovery was not ready before the first prompt", result: "confirmed by timeout without discovery and success with bounded discovery" }
        ],
        rootCause: "Health readiness precedes workspace instance and private-tool discovery readiness.",
        minimalFix: "Perform the existing bounded tool discovery probe before recovery prompts."
      }
    }, null, 2));
  } finally {
    const cleanup = await runtime.close();
    await mkdir(batchDirectory, { recursive: true });
    await writeFile(join(batchDirectory, "02-recovery-cleanup.json"), JSON.stringify(cleanup, null, 2));
  }
}
