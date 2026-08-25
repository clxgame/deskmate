import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";
import { findSourceBinary } from "./prepare-opencode";

const projectRoot = resolve(import.meta.dir, "..");

describe("OpenCode sidecar preparation", () => {
  test("packages a real Windows executable instead of the npm error shim", async () => {
    const sourceBinary = await findSourceBinary();
    const bytes = await readFile(sourceBinary);

    if (process.platform === "win32") {
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x4d, 0x5a]));
    }
  });
});
