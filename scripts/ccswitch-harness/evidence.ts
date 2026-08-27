import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expectJsonObject, type JsonObject } from "./types";

const projectRoot = resolve(import.meta.dir, "../..");
const evidenceDir = resolve(projectRoot, ".omo/evidence");

function redactConfig(config: JsonObject): JsonObject {
  return { permission: config.permission, provider: Object.keys(expectJsonObject(config.provider, "provider")) };
}

export async function writeEvidence(transcript: string, config: JsonObject, toolIds: readonly string[]): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await Promise.all([
    writeFile(join(evidenceDir, "task-2-yume-ccswitch-opencode-configuration.txt"), transcript),
    writeFile(
      join(evidenceDir, "task-2-yume-ccswitch-opencode-configuration-config.json"),
      `${JSON.stringify(redactConfig(config), null, 2)}\n`,
    ),
    writeFile(
      join(evidenceDir, "task-2-yume-ccswitch-opencode-configuration-tool-ids.json"),
      `${JSON.stringify(toolIds, null, 2)}\n`,
    ),
  ]);
}
