// Builds a real .dmpack from the persona assets in public/personas, so the
// import path can be exercised against an actual archive rather than a fixture.
//
// Usage: bun scripts/pack-personas.ts <packId> <version> <out.dmpack> [personaId...]

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const personasRoot = resolve(projectRoot, "public/personas");
const skillsRoot = resolve(projectRoot, "src-tauri/resources/skills");

interface SkillRef {
  id: string;
  file: string;
}

interface PersonaEntry {
  id: string;
  skills?: SkillRef[];
}

const [packId, version, outPath, ...requested] = process.argv.slice(2);
if (!packId || !version || !outPath) {
  console.error(
    "usage: bun scripts/pack-personas.ts <packId> <version> <out.dmpack> [personaId...]",
  );
  process.exit(2);
}

async function personaIds(): Promise<string[]> {
  if (requested.length > 0) return requested;
  const entries = await readdir(personasRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Files a persona contributes, as archive-relative paths. */
async function personaFiles(id: string): Promise<string[]> {
  const root = resolve(personasRoot, id);
  const collected: string[] = [];

  async function walk(dir: string, prefix: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = resolve(dir, entry.name);
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, rel);
      } else {
        collected.push(rel);
      }
    }
  }

  await walk(root, "");
  return collected.sort();
}

/** Skills shipped for a persona, if any. */
async function personaSkills(id: string): Promise<SkillRef[]> {
  const dir = resolve(skillsRoot, id);
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) return [];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".md"));
  return files.sort().map((file) => ({ id, file }));
}

const ids = await personaIds();
const staging = resolve(projectRoot, ".dmpack-staging");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

const personas: PersonaEntry[] = [];
let fileCount = 0;

for (const id of ids) {
  const files = await personaFiles(id);
  if (files.length === 0) {
    throw new Error(`persona ${id} has no files under public/personas`);
  }
  for (const rel of files) {
    const target = resolve(staging, "personas", id, rel);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, await readFile(resolve(personasRoot, id, rel)));
    fileCount += 1;
  }

  const skills = await personaSkills(id);
  for (const skill of skills) {
    const target = resolve(staging, "skills", skill.id, skill.file);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(
      target,
      await readFile(resolve(skillsRoot, skill.id, skill.file)),
    );
    fileCount += 1;
  }

  personas.push(skills.length > 0 ? { id, skills } : { id });
}

// pack.json must sit at the archive root; the importer refuses anything else.
await writeFile(
  resolve(staging, "pack.json"),
  `${JSON.stringify({ packId, version, personas }, null, 2)}\n`,
);

// PowerShell ships everywhere on Windows; `zip` is not guaranteed.
const zipCommand =
  process.platform === "win32"
    ? [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Compress-Archive -Path '${staging}\\*' -DestinationPath '${outPath}' -CompressionLevel Optimal -Force`,
      ]
    : ["zip", "-r", "-q", outPath, "."];

await rm(outPath, { force: true });
const proc = Bun.spawn(zipCommand, {
  cwd: process.platform === "win32" ? projectRoot : staging,
  stdout: "pipe",
  stderr: "pipe",
});
if ((await proc.exited) !== 0) {
  throw new Error(`could not archive pack: ${await new Response(proc.stderr).text()}`);
}
await rm(staging, { recursive: true, force: true });

const size = (await stat(outPath)).size;
console.log(
  `Packed ${personas.length} personas, ${fileCount} files -> ${outPath} (${(size / 1024 / 1024).toFixed(1)} MiB)`,
);
