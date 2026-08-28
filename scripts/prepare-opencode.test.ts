import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, test } from "bun:test";
import { findSourceBinary } from "./prepare-opencode";
import {
  CCSWITCH_TOOL_ID,
  assertToolSourceSecretFree,
  buildPermissionMap,
  stageCcswitchTool,
  validatePermissionMap,
} from "./ccswitch-harness/permissions";
import { requestJson } from "./ccswitch-harness/transport";

const projectRoot = resolve(import.meta.dir, "..");
const shippedTool = resolve(
  projectRoot,
  "src-tauri/resources/opencode-tools",
  `${CCSWITCH_TOOL_ID}.ts`,
);

type ExecutableTool = {
  readonly execute: (args: {
    readonly providerName?: string;
    readonly baseUrl?: string;
    readonly modelHint?: string;
  }) => Promise<string>;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutableTool(value: unknown): value is ExecutableTool {
  return isJsonObject(value) && typeof value.execute === "function";
}

describe("OpenCode sidecar preparation", () => {
  test("packages a real Windows executable instead of the npm error shim", async () => {
    const sourceBinary = await findSourceBinary();
    const bytes = await readFile(sourceBinary);

    if (process.platform === "win32") {
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x4d, 0x5a]));
    }
  });

  test("declares a deny-by-default permission map for the CC Switch draft tool", () => {
    const permission = buildPermissionMap();
    const errors = validatePermissionMap(permission);

    expect(errors).toEqual([]);
    expect(permission["*"]).toBe("deny");
    expect(permission[CCSWITCH_TOOL_ID]).toBe("allow");
  });

  test("ships a secret-free CC Switch provider draft tool", async () => {
    await assertToolSourceSecretFree(shippedTool);

    const loaded: unknown = await import(pathToFileURL(shippedTool).href);
    if (!isJsonObject(loaded) || !isExecutableTool(loaded.default)) {
      throw new Error("shipped CC Switch tool is not executable");
    }
    const output = await loaded.default.execute({
      providerName: "  Local YUME  ",
      baseUrl: "https://models.example.test",
      modelHint: "model-a",
    });
    const draft: unknown = JSON.parse(output);

    expect(isJsonObject(draft)).toBe(true);
    if (!isJsonObject(draft)) return;
    expect(draft.version).toBe(1);
    expect(draft.kind).toBe("opencode_provider_draft");
    expect(draft.providerName).toBe("Local YUME");
    expect(JSON.stringify(draft)).not.toContain("apiKey");
    expect(JSON.stringify(draft)).not.toContain("secret");
    expect(JSON.stringify(draft)).not.toContain("token");
  });

  test("does not emit sensitive-looking values from accepted draft fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "yume-opencode-tool-sensitive-"));
    try {
      const staged = await stageCcswitchTool(join(root, "workspace"));
      const loaded: unknown = await import(pathToFileURL(staged).href);
      if (!isJsonObject(loaded) || !isExecutableTool(loaded.default)) {
        throw new Error("staged CC Switch tool is not executable");
      }

      const sensitiveProviderValue = ["sk", "review", "canary", "1234567890"].join("-");
      const sensitiveModelValue = `${"bear"}${"er"} DROP_VALUE_MODEL`;
      let message = "";
      try {
        await loaded.default.execute({
          providerName: sensitiveProviderValue,
          baseUrl: "https://models.example.test?api_key=DROP_VALUE_BASE",
          modelHint: sensitiveModelValue,
        });
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        message = error.message;
      }

      expect(message).toBe("secret-free draft refused");
      expect(message).not.toContain("DROP_VALUE");
      expect(message).not.toContain("review-canary");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("refuses token-shaped draft fields before emitting an envelope", async () => {
    const loaded: unknown = await import(pathToFileURL(shippedTool).href);
    if (!isJsonObject(loaded) || !isExecutableTool(loaded.default)) {
      throw new Error("shipped CC Switch tool is not executable");
    }
    const tokenLike = [
      ["gh", "p_", "A".repeat(36)].join(""),
      ["github", "_pat_", "11", "B".repeat(82)].join(""),
      ["gl", "pat-", "C".repeat(20)].join(""),
      ["hf", "_", "D".repeat(32)].join(""),
      ["xox", "b-", "E".repeat(24)].join(""),
      ["AK", "IA", "F".repeat(16)].join(""),
    ];

    for (const candidate of tokenLike) {
      await expect(
        loaded.default.execute({
          providerName: candidate,
          baseUrl: `https://models.example.test/v1?access_token=${candidate}`,
          modelHint: `model-${candidate}`,
        }),
      ).rejects.toThrow("secret-free draft refused");
    }
  });

  test("refreshes only the YUME-owned tool in a temporary workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "yume-opencode-tool-test-"));
    try {
      const toolDir = join(root, "workspace", ".opencode", "tools");
      const staleTool = join(toolDir, `${CCSWITCH_TOOL_ID}.ts`);
      const sentinel = join(toolDir, "keep-me.ts");
      await mkdir(toolDir, { recursive: true });
      await writeFile(staleTool, "stale yume tool");
      await writeFile(sentinel, "sentinel");

      const staged = await stageCcswitchTool(join(root, "workspace"));

      expect(await readFile(staged, "utf8")).toContain(
        "opencode_provider_draft",
      );
      expect(await readFile(sentinel, "utf8")).toBe("sentinel");
      expect(validatePermissionMap(buildPermissionMap())).toEqual([]);
      expect(buildPermissionMap()["*"]).toBe("deny");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("reports slow discovery requests without leaking query details", async () => {
    let message = "";
    try {
      await requestJson({
        baseUrl: "http://127.0.0.1",
        path: "/config?opaque=canary",
        timeoutSeconds: 0.01,
        runner: () => new Promise<never>(() => {}),
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      message = error.message;
    }

    expect(message).toContain("/config request failed: timeout");
    expect(message).not.toContain("opaque");
    expect(message).not.toContain("canary");
  });
});
