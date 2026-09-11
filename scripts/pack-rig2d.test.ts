import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import { resolve } from "node:path";
import { parseRig2dConfig, rig2dTextureFiles } from "../src/pet/rig2d/config";
import { personaRenderType } from "./pack-figure2d";
import { validateRig2dPng } from "./pack-rig2d";
import config from "../public/personas/baobao/figure-rig2d.json";
import fixtures from "../tests/fixtures/rig2d-contract.json";

const root = resolve(import.meta.dir, "../public/personas/baobao");
const files = ["figure-rig2d.json", "persona.md", ...rig2dTextureFiles(parseRig2dConfig(config))];

for (const fixture of fixtures) {
  test(`shared rig2d contract: ${fixture.name}`, () => {
    if (fixture.valid) expect(parseRig2dConfig(fixture.config).renderer).toBe("silver-cat-v1");
    else expect(() => parseRig2dConfig(fixture.config)).toThrow();
  });
}

test("authors rig2d when all real texture references decode", async () => {
  expect(await personaRenderType(root, files)).toBe("rig2d");
});
test("rejects a missing texture before authoring rig2d", async () => {
  await expect(personaRenderType(root, files.filter(file => file !== "assets/sleep-0.png"))).rejects.toThrow("Missing rig2d PNG");
});
test("rejects a conflicting renderer declaration", async () => {
  await expect(personaRenderType(root, [...files, "figure2d.json"])).rejects.toThrow("conflicting");
});
test("rejects PNG corruption after the valid IHDR header", async () => {
  const bytes = await readFile(resolve(root, "assets/sleep-0.png"));
  const corrupted = Buffer.from(bytes);
  corrupted[corrupted.length - 5] ^= 1;
  expect(() => validateRig2dPng(corrupted)).toThrow("Invalid rig2d PNG");
});
test("rejects PNG truncation after a valid image header", async () => {
  const bytes = await readFile(resolve(root, "assets/sleep-0.png"));
  expect(() => validateRig2dPng(bytes.subarray(0, bytes.length - 12))).toThrow("Invalid rig2d PNG");
});

test("rejects broken image data even when the chunk CRC is repaired", async () => {
  const bytes = await readFile(resolve(root, "assets/sleep-0.png"));
  let offset = 8;
  while (offset + 12 < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      bytes[offset + 8] = 0;
      bytes.writeUInt32BE(crc32(bytes.subarray(offset + 4, offset + 8 + length)), offset + 8 + length);
      break;
    }
    offset += length + 12;
  }
  expect(() => validateRig2dPng(bytes)).toThrow("Invalid rig2d PNG");
});

test("rejects padded config beyond the shared runtime byte limit", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "rig2d-limit-"));
  try {
    await writeFile(resolve(directory, "figure-rig2d.json"), JSON.stringify(config).padEnd(128 * 1024 + 1));
    await expect(personaRenderType(directory, files)).rejects.toThrow("config too large");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
