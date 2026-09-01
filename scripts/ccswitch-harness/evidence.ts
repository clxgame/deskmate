import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { CCSWITCH_TOOL_ID } from "./permissions";
import { expectJsonObject, type FullEvidence, type JsonObject } from "./types";

const projectRoot = resolve(import.meta.dir, "../..");
const evidenceDir = resolve(projectRoot, ".omo/evidence");
export const task8EvidencePath = join(evidenceDir, "task-8-yume-ccswitch-opencode-configuration.txt");
export const task8ResultsPath = join(evidenceDir, "task-8-yume-ccswitch-opencode-configuration-results.json");
export const task8DoneClaimPath = join(evidenceDir, "task-8-yume-ccswitch-opencode-configuration-doneclaim.md");

function redactConfig(config: JsonObject): JsonObject {
  return { permission: config.permission, provider: Object.keys(expectJsonObject(config.provider, "provider")) };
}

function doneClaim(input: FullEvidence): string {
  return [
    "# DoneClaim - Task 8 YUME CC Switch OpenCode Configuration",
    "",
    "- Scenario: isolated pinned OpenCode 1.18.21 `serve --pure` launched with temp HOME/appdata/workspace and localhost mock OpenAI-compatible provider.",
    "- Invocation: `bun run verify:ccswitch-tool`.",
    `- Binary observable: health version ${String(input.health.version)}; exact allowed tool ${input.session.tool}; SSE and snapshot completed call ${input.session.callID}.`,
    `- Captured transcript: ${task8EvidencePath}.`,
    `- Captured redacted structured result: ${task8ResultsPath}.`,
    "- Secret posture: no real CC Switch, global HOME/config, keyring, or provider was used; runtime canary was scanned and not recorded.",
    "- Cleanup posture: temp root removed; OpenCode/mock ports closed; launched OpenCode process gone.",
    "",
  ].join("\n");
}

export function transcript(input: FullEvidence): string {
  return [
    "scenario=full-session-draft-tool; launch=opencode 1.18.21 --pure serve",
    "invocation=bun run verify:ccswitch-tool",
    "isolation=temp HOME+USERPROFILE+APPDATA+LOCALAPPDATA+XDG dirs; no CC Switch/global config/keyring/provider",
    `binary=${String(input.health.binary ?? "opencode.exe")}`,
    `health=${JSON.stringify({ healthy: input.health.healthy, version: input.health.version })}`,
    `tool=${CCSWITCH_TOOL_ID}`,
    `tool-discovery=${JSON.stringify(input.toolIds)}`,
    `permission=${JSON.stringify(input.config.permission)}`,
    `session=${input.session.sessionID}`,
    `sse-completed=${input.sse.callID}`,
    `snapshot-completed=${input.snapshot.callID}`,
    `mock=${JSON.stringify(input.mock)}`,
    `cleanup=${JSON.stringify(input.cleanup)}`,
    "canary=checked-not-recorded",
    "",
  ].join("\n");
}

export async function writeEvidence(input: FullEvidence): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await Promise.all([
    writeFile(task8EvidencePath, input.transcript),
    writeFile(
      task8ResultsPath,
      `${JSON.stringify(
        {
          health: input.health,
          config: redactConfig(input.config),
          toolIds: input.toolIds,
          session: input.session,
          sse: input.sse,
          snapshot: input.snapshot,
          mock: input.mock,
          cleanup: input.cleanup,
        },
        null,
        2,
      )}\n`,
    ),
    writeFile(task8DoneClaimPath, doneClaim(input)),
  ]);
}
