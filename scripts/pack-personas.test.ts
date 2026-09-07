import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
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

describe("persona pack authoring", () => {
  test.skipIf(process.platform !== "win32")("includes localized metadata and an existing cover when packing a subset", async () => {
    // Given a subset which does not contain the preferred cover's persona.
    await using fixture = await workspaceFixture();
    const output = resolve(fixture.path, "subset's [pack].dmpack");

    // When the real CLI builds the pack, including a shell-sensitive output path.
    const result = await pack(output, ["changli", "jinxi"]);

    // Then its archive contains self-contained display metadata and unchanged assets.
    expect(result.exitCode, result.stderr).toBe(0);
    const reader = Bun.spawn(
      ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", resolve(import.meta.dir, "pack-inspect.ps1"), "-ArchivePath", output],
      { stdout: "pipe", stderr: "pipe" },
    );
    const [inspectionExit, inspectionText, inspectionError] = await Promise.all([
      reader.exited,
      new Response(reader.stdout).text(),
      new Response(reader.stderr).text(),
    ]);
    expect(inspectionExit, inspectionError).toBe(0);
    const inspection: unknown = JSON.parse(inspectionText);
    const cover = await readFile(resolve(import.meta.dir, "persona-packs/aki.png"));
    const persona = await readFile(resolve(projectRoot, "public/personas/changli/persona.md"));
    expect(inspection).toMatchObject({
      manifest: {
        packId: "aki",
        version: "1.0.1",
        name: { zh: "aki 团子", en: "aki Dango", ja: "aki 団子", ko: "aki 당고" },
        thumbnail: "personas/changli/pack-thumbnail.png",
        personas: [{ id: "changli" }, { id: "jinxi" }],
      },
      entries: expect.arrayContaining([
        { path: "personas/changli/pack-thumbnail.png", sha256: createHash("sha256").update(cover).digest("hex") },
        { path: "personas/changli/persona.md", sha256: createHash("sha256").update(persona).digest("hex") },
      ]),
    });
  }, 60_000);

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
