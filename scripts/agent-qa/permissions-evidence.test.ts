import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { writePermissionEvidence } from "./permissions-evidence";
import { jsonObject } from "./types";

describe("permission evidence", () => {
  test("an early discovery failure cannot produce success claims", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yume-agent-evidence-"));
    try {
      await writePermissionEvidence(directory, {
        version: "1.18.21",
        pid: 1,
        port: 2,
        checks: [],
        cleanup: { processGone: true, providerClosed: true, sidecarClosed: true, tempRootRemoved: true },
        failure: { code: "INJECTED_DISCOVERY_TIMEOUT", message: "early tool discovery timeout" },
        sidecarTail: "",
        providerRequestCount: 0,
      });
      const artifact = jsonObject(JSON.parse(await readFile(join(directory, "03-permissions.json"), "utf8")), "permission evidence");
      expect(artifact.status).toBe("failed");
      expect(artifact.checks).toHaveLength(0);
      expect(JSON.stringify(artifact)).not.toContain("three consecutive");
      expect(artifact.cleanup).toEqual({ processGone: true, providerClosed: true, sidecarClosed: true, tempRootRemoved: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
