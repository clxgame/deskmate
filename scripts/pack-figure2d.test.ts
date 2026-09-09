import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFigure2dConfig } from "../src/pet/figure2d";
import { personaRenderType } from "./pack-figure2d";

const source = new URL("../public/personas/xiaoxiongchong/", import.meta.url);

test("authors original GIF assets when all seven references are present", async () => {
  const root = decodeURIComponent(source.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  const files = ["figure2d.json", "persona.md", ...["idle", "thinking", "working", "talking", "success", "error", "leaving"].map(state => `animations/${state}.gif`)];
  expect(await personaRenderType(root, files)).toBe("gif");
});

test("rejects missing animation when authoring a GIF pack", async () => {
  const root = decodeURIComponent(source.pathname).replace(/^\/([A-Za-z]:)/, "$1");
  await expect(personaRenderType(root, ["figure2d.json", "persona.md"])).rejects.toThrow("Missing GIF");
});

test("rejects renamed non-GIF content when authoring a GIF pack", async () => {
  const root = await mkdtemp(join(tmpdir(), "deskmate-gif-test-"));
  try {
    const original = parseFigure2dConfig(JSON.parse(await readFile(new URL("figure2d.json", source), "utf8")));
    const config = { ...original, animations: Object.fromEntries(Object.entries(original.animations).map(([state, animation]) => [state, { ...animation, file: "fake.gif" }])) };
    await writeFile(join(root, "figure2d.json"), JSON.stringify(config));
    await writeFile(join(root, "fake.gif"), "not an image");
    await expect(personaRenderType(root, ["figure2d.json", "persona.md", "fake.gif"])).rejects.toThrow("Invalid GIF");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retains legacy GLB contract when no 2D config exists", async () => {
  expect(await personaRenderType("unused", ["figure.glb"])).toBe("glb");
});

test("rejects stale GIF assets when config has been removed", async () => {
  await expect(personaRenderType("unused", ["figure.glb", "idle.gif"])).rejects.toThrow("require figure2d.json");
});
