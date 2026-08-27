import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { expectJsonObject, HarnessError, isJsonObject, type JsonObject } from "./types";

export const CCSWITCH_TOOL_ID = "ccswitch_prepare_opencode_provider";
export const EXPECTED_OPENCODE_VERSION = "1.18.21";

const projectRoot = resolve(import.meta.dir, "../..");
const shippedTool = resolve(projectRoot, "src-tauri/resources/opencode-tools", `${CCSWITCH_TOOL_ID}.ts`);
const deniedToolIds = ["bash", "edit", "write", "patch", "external_directory", "task"] as const;

export function buildPermissionMap(): Record<string, "allow" | "deny"> {
  return {
    "*": "deny",
    [CCSWITCH_TOOL_ID]: "allow",
    bash: "deny",
    edit: "deny",
    write: "deny",
    patch: "deny",
    external_directory: "deny",
    task: "deny",
  };
}

export function buildSidecarConfig(): JsonObject {
  return {
    $schema: "https://opencode.ai/config.json",
    permission: buildPermissionMap(),
    provider: {
      yume: {
        npm: "@ai-sdk/openai-compatible",
        name: "YUME",
        options: { baseURL: "http://127.0.0.1:9" },
        models: { "model-a": { name: "Model A" } },
      },
    },
  };
}

export function validatePermissionMap(value: unknown): readonly string[] {
  const map = isJsonObject(value) ? value : {};
  const errors: string[] = [];
  if (map["*"] !== "deny") errors.push("permission.* must deny");
  if (map[CCSWITCH_TOOL_ID] !== "allow") errors.push(`${CCSWITCH_TOOL_ID} must allow`);
  for (const id of deniedToolIds) {
    if (map[id] !== "deny") errors.push(`permission.${id} must deny`);
  }
  const extraAllows = Object.entries(map)
    .filter(([id, action]) => id !== CCSWITCH_TOOL_ID && action === "allow")
    .map(([id]) => id);
  if (extraAllows.length > 0) errors.push(`unexpected allow: ${extraAllows.join(",")}`);
  return errors;
}

export async function stageCcswitchTool(workspace: string): Promise<string> {
  const target = join(workspace, ".opencode", "tools", basename(shippedTool));
  await mkdir(dirname(target), { recursive: true });
  await copyFile(shippedTool, target);
  return target;
}

export async function assertToolSourceSecretFree(path = shippedTool): Promise<void> {
  const forbiddenField = /\b(apiKey|api_key|secret|token|credential|password)\s*:/i;
  if (forbiddenField.test(await readFile(path, "utf8"))) {
    throw new HarnessError("tool source contains a credential-like argument or output field");
  }
}

export function assertToolIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new HarnessError("tool ids endpoint did not return a string array");
  }
  if (!value.includes(CCSWITCH_TOOL_ID)) throw new HarnessError(`${CCSWITCH_TOOL_ID} is missing from tool ids`);
  return value;
}

export function assertConfig(value: unknown): JsonObject {
  const config = expectJsonObject(value, "config");
  const errors = validatePermissionMap(config.permission);
  if (errors.length > 0) throw new HarnessError(errors.join("; "));
  return config;
}
