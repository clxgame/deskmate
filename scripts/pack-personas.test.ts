import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const projectRoot = resolve(import.meta.dir, "..");

async function workspaceFixture(): Promise<AsyncDisposable & { readonly path: string }> {
  const path = await mkdtemp(resolve(projectRoot, ".pack-test-"));
  return {
    path,
    async [Symbol.asyncDispose]() {
      const withinRoot = relative(projectRoot, path);
      if (withinRoot.startsWith("..") || isAbsolute(withinRoot)) {
        throw new RangeError("Test cleanup must stay inside the project");
      }
      await rm(path, { recursive: true, force: true });
    },
  };
}

async function pack(output: string, ids: readonly string[]) {
  const child = Bun.spawn(
    [process.execPath, resolve(import.meta.dir, "pack-personas.ts"), "aki", "1.0.1", output, ...ids],
    { cwd: projectRoot, stdout: "pipe", stderr: "pipe" },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

async function syntheticPersona(): Promise<AsyncDisposable & { readonly id: string }> {
  const path = await mkdtemp(resolve(projectRoot, "public/personas/qa-pack-"));
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }).padEnd(96, " "));
  const model = Buffer.alloc(20 + json.length);
  model.writeUInt32LE(0x46546c67, 0);
  model.writeUInt32LE(2, 4);
  model.writeUInt32LE(model.length, 8);
  model.writeUInt32LE(json.length, 12);
  model.writeUInt32LE(0x4e4f534a, 16);
  json.copy(model, 20);
  try {
    await writeFile(resolve(path, "figure.glb"), model);
    await writeFile(resolve(path, "persona.md"), "Synthetic persona prompt");
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  return { id: basename(path), async [Symbol.asyncDispose]() { await rm(path, { recursive: true, force: true }); } };
}

async function inspectPack(output: string): Promise<unknown> {
  if (process.platform === "win32") {
    const reader = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", resolve(import.meta.dir, "pack-inspect.ps1"), "-ArchivePath", output],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [exitCode, text, error] = await Promise.all([reader.exited, new Response(reader.stdout).text(), new Response(reader.stderr).text()]);
    expect(exitCode, error).toBe(0);
    return JSON.parse(text);
  }
  const listing = Bun.spawn(["unzip", "-Z1", output], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, text, error] = await Promise.all([listing.exited, new Response(listing.stdout).text(), new Response(listing.stderr).text()]);
  expect(exitCode, error).toBe(0);
  let manifest: unknown;
  const entries: { path: string; sha256: string }[] = [];
  for (const path of text.trim().split("\n").filter((path) => !path.endsWith("/"))) {
    const reader = Bun.spawn(["unzip", "-p", output, path], { stdout: "pipe", stderr: "pipe" });
    const [code, bytes, detail] = await Promise.all([reader.exited, new Response(reader.stdout).arrayBuffer(), new Response(reader.stderr).text()]);
    expect(code, detail).toBe(0);
    if (path === "pack.json") manifest = JSON.parse(Buffer.from(bytes).toString("utf8"));
    entries.push({ path, sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex") });
  }
  return { manifest, entries };
}

describe("persona pack authoring", () => {
  test("includes localized metadata and an existing cover when packing a synthetic subset", async () => {
    // Given a subset which does not contain the preferred cover's persona.
    await using fixture = await workspaceFixture();
    await using first = await syntheticPersona();
    await using second = await syntheticPersona();
    const output = resolve(fixture.path, "subset's [pack].dmpack");

    // When the real CLI builds the pack, including a shell-sensitive output path.
    const result = await pack(output, [first.id, second.id]);

    // Then its archive contains self-contained display metadata and unchanged assets.
    expect(result.exitCode, result.stderr).toBe(0);
    const inspection = await inspectPack(output);
    const cover = await readFile(resolve(import.meta.dir, "persona-packs/aki.png"));
    const persona = await readFile(resolve(projectRoot, "public/personas", first.id, "persona.md"));
    expect(inspection).toMatchObject({
      manifest: {
        packId: "aki",
        version: "1.0.1",
        name: { zh: "aki 团子", en: "aki Dango", ja: "aki 団子", ko: "aki 당고" },
        thumbnail: `personas/${first.id}/pack-thumbnail.png`,
        personas: [{ id: first.id }, { id: second.id }],
      },
      entries: expect.arrayContaining([
        { path: `personas/${first.id}/pack-thumbnail.png`, sha256: createHash("sha256").update(cover).digest("hex") },
        { path: `personas/${first.id}/persona.md`, sha256: createHash("sha256").update(persona).digest("hex") },
      ]),
    });
  }, 60_000);

  test("rejects an unrelated source note instead of publishing it inside a valid model pack", async () => {
    await using fixture = await workspaceFixture();
    await using persona = await syntheticPersona();
    await writeFile(resolve(projectRoot, "public/personas", persona.id, "reference.json"), "{}");
    const output = resolve(fixture.path, "unexpected-note.dmpack");
    const result = await pack(output, [persona.id]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unsupported glb persona asset: reference.json");
    expect(await Bun.file(output).exists()).toBe(false);
  });

  test("preserves an existing destination when a pack is requested at that path", async () => {
    // Given an existing archive which belongs to its caller.
    await using fixture = await workspaceFixture();
    const output = resolve(fixture.path, "existing.dmpack");
    const original = Buffer.from("existing archive must survive");
    await writeFile(output, original);

    // When authoring targets that existing file.
    const result = await pack(output, ["changli"]);

    // Then it refuses the write and leaves the original bytes intact.
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
    expect(await readFile(output)).toEqual(original);
  }, 30_000);

  test.each([{ ids: ["../changli"] }, { ids: ["changli", "changli"] }])(
    "rejects unsafe or duplicate persona selections: %j",
    async ({ ids }) => {
      // Given an unsafe or duplicate persona selection.
      await using fixture = await workspaceFixture();

      // When the real CLI parses that selection.
      const result = await pack(resolve(fixture.path, "invalid.dmpack"), ids);

      // Then it stops at the argument boundary.
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/safe|duplicate/i);
    },
  );
});
