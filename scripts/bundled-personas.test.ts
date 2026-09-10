import { beforeAll, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { BUILTIN_PACKS } from "../src/pet/personaCatalog";
import config from "../src-tauri/tauri.conf.json";

const root = resolve(import.meta.dir, "..");
const builtinIds = BUILTIN_PACKS.flatMap(pack => pack.personas.map(persona => persona.id)).sort();

beforeAll(async () => {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    cwd: root, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, NODE_ENV: "production" },
  });
  const [code, stdout, stderr] = await Promise.all([
    build.exited, new Response(build.stdout).text(), new Response(build.stderr).text(),
  ]);
  expect(code, stdout + stderr).toBe(0);
}, 120_000);

test("ships only built-in persona assets when building with optional source packs present", async () => {
  const entries = await readdir(resolve(root, "dist/personas"));
  expect(entries.sort()).toEqual(builtinIds);
  for (const id of builtinIds) {
    expect(await Bun.file(resolve(root, "dist/personas", id, "figure.glb")).exists()).toBe(true);
  }
});

test("excludes development tooling from the production build", async () => {
  for await (const file of new Bun.Glob("assets/*.js").scan({ cwd: resolve(root, "dist") })) {
    const source = await Bun.file(resolve(root, "dist", file)).text();
    expect(/react-grab|react-scan/.test(source), file).toBe(false);
  }
});

test("bundles only built-in prompts and skills while retaining runtime tools", async () => {
  const files = new Set<string>();
  for (const pattern of config.bundle.resources) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: resolve(root, "src-tauri"), onlyFiles: true })) {
      files.add(file.replaceAll("\\", "/"));
    }
  }
  const shippedIds = [...new Set([...files].filter(file => file.startsWith("resources/personas/"))
    .map(file => file.split("/")[2]))].sort();
  expect(shippedIds).toEqual(builtinIds);
  for (const id of builtinIds) {
    expect(files.has(`resources/personas/${id}/persona.md`)).toBe(true);
  }
  for (const file of files) {
    if (file.startsWith("resources/skills/")) expect(builtinIds).toContain(file.split("/")[2]);
  }
  expect(files.has("resources/worklog-bridge.ts")).toBe(true);
  expect(files.has("resources/opencode-tools/worklog_record.ts")).toBe(true);
});
