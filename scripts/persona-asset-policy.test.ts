import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseRig2dConfig, rig2dTextureFiles } from "../src/pet/rig2d/config";
import { personaPackageFiles, pruneRetiredPersonaMetadata } from "./persona-asset-policy";

test("GLB packs require their model and prompt while keeping textures and supported authoring metadata", async () => {
  const files = ["figure.glb", "persona.md", "textures/Hair/baseColor.png", "placeholders.json", "placement.json"];
  expect(await personaPackageFiles("unused", files, "glb")).toEqual([...files].sort());
  await expect(personaPackageFiles("unused", ["persona.md"], "glb")).rejects.toThrow("Missing glb persona asset: figure.glb");
});

test("notes, retired 3D settings, provenance and extra models cannot silently enter GLB packs", async () => {
  for (const extra of ["notes.md", "reference.json", "figure3d.json", "provenance.json", "old.glb"]) {
    await expect(personaPackageFiles("unused", ["figure.glb", "persona.md", extra], "glb")).rejects.toThrow(`Unsupported glb persona asset: ${extra}`);
  }
});

test("GIF packs keep exactly the configured animations and portable metadata", async () => {
  const root = resolve(import.meta.dir, "../public/personas/xiaoxiongchong");
  const config = JSON.parse(await readFile(resolve(root, "figure2d.json"), "utf8")) as { animations: Record<string, { file: string }> };
  const files = ["persona.md", "figure2d.json", "placement.json", ...Object.values(config.animations).map((animation) => animation.file)];
  expect(await personaPackageFiles(root, files, "gif")).toEqual([...files].sort());
  await expect(personaPackageFiles(root, [...files, "animations/old.gif"], "gif")).rejects.toThrow("Unsupported gif persona asset: animations/old.gif");
});

test("rig2d packs keep exactly the configured textures", async () => {
  const root = resolve(import.meta.dir, "../public/personas/baobao");
  const config = parseRig2dConfig(JSON.parse(await readFile(resolve(root, "figure-rig2d.json"), "utf8")));
  const files = ["persona.md", "figure-rig2d.json", ...rig2dTextureFiles(config)];
  expect(await personaPackageFiles(root, files, "rig2d")).toEqual([...files].sort());
  await expect(personaPackageFiles(root, [...files, "assets/unused.png"], "rig2d")).rejects.toThrow("Unsupported rig2d persona asset: assets/unused.png");
});

test("pinned legacy archive metadata is filtered before copying without changing current persona inputs", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "yume-persona-download-"));
  try {
    const unpacked = resolve(fixture, "unpacked");
    const persona = resolve(unpacked, "test-persona");
    await mkdir(resolve(persona, "textures/Hair"), { recursive: true });
    for (const file of ["figure.glb", "persona.md", "placeholders.json", "placement.json", "figure3d.json", "provenance.json"]) {
      await writeFile(resolve(persona, file), file);
    }
    await writeFile(resolve(persona, "textures/Hair/baseColor.png"), "texture");
    expect(await pruneRetiredPersonaMetadata(unpacked)).toBe(2);
    const destination = resolve(fixture, "public-personas");
    await cp(unpacked, destination, { recursive: true });
    expect((await readdir(resolve(destination, "test-persona"))).sort()).toEqual(["figure.glb", "persona.md", "placeholders.json", "placement.json", "textures"]);
    expect(await readFile(resolve(destination, "test-persona/textures/Hair/baseColor.png"), "utf8")).toBe("texture");
    expect(await pruneRetiredPersonaMetadata(destination)).toBe(0);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("the actual prepare CLI removes retired metadata even when its version marker already matches", async () => {
  const fixture = await mkdtemp(resolve(tmpdir(), "yume-persona-warm-cache-"));
  try {
    // Run current source in an isolated checkout with a synthetic warm cache;
    // matching the marker must avoid credentials and network entirely.
    const sourceRoot = resolve(import.meta.dir, "..");
    for (const file of ["scripts/prepare-personas.ts", "scripts/persona-asset-policy.ts", "scripts/pack-metadata.ts", "src/pet/figure2d.ts", "src/pet/figure2dPolygon.ts", "src/pet/rig2d/config.ts"]) {
      await mkdir(dirname(resolve(fixture, file)), { recursive: true });
      await cp(resolve(sourceRoot, file), resolve(fixture, file));
    }
    const personas = resolve(fixture, "public/personas");
    const persona = resolve(personas, "test-persona");
    await mkdir(persona, { recursive: true });
    await writeFile(resolve(personas, ".personas-version"), "personas-1.0.1\n");
    for (const file of ["figure.glb", "persona.md", "figure3d.json", "provenance.json"]) await writeFile(resolve(persona, file), file);
    const child = Bun.spawn([process.execPath, resolve(fixture, "scripts/prepare-personas.ts")], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, DESKMATE_ASSETS_TOKEN: "", GH_TOKEN: "", GITHUB_TOKEN: "" },
    });
    const [code, output, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code, error).toBe(0);
    expect(output).toContain("already prepared");
    expect((await readdir(persona)).sort()).toEqual(["figure.glb", "persona.md"]);
    expect(await readFile(resolve(persona, "figure.glb"), "utf8")).toBe("figure.glb");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
