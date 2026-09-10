import { constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { PackAuthoringError, packMetadata, parsePersonaIds } from "./pack-metadata";

import { personaRenderType } from "./pack-figure2d";
import { personaDefaultPosition, type DefaultPosition } from "./pack-position";

const projectRoot = resolve(import.meta.dir, "..");
const personasRoot = resolve(projectRoot, "public/personas");
const skillsRoot = resolve(projectRoot, "src-tauri/resources/skills");

type SkillRef = { readonly id: string; readonly file: string };
type PersonaEntry = { readonly id: string; readonly renderType?: "gif"; readonly skills?: readonly SkillRef[]; readonly defaultPosition?: DefaultPosition };

async function personaFiles(id: string): Promise<readonly string[]> {
  const root = resolve(personasRoot, id);
  const collected: string[] = [];
  if (!(await lstat(root)).isDirectory()) {
    throw new PackAuthoringError("Persona must be a real directory: " + id);
  }
  async function walk(dir: string, prefix: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const child = resolve(dir, entry.name);
      const relative = prefix === "" ? entry.name : prefix + "/" + entry.name;
      if (entry.isDirectory()) {
        await walk(child, relative);
      } else if (entry.isFile()) {
        if (!/\.(glb|gif|json|md|png)$/i.test(entry.name)) {
          throw new PackAuthoringError("Unsupported persona asset: " + id + "/" + relative);
        }
        collected.push(relative);
      } else {
        throw new PackAuthoringError("Symbolic links are not allowed in persona assets: " + id + "/" + relative);
      }
    }
  }
  await walk(root, "");
  return collected.sort();
}

async function personaSkills(id: string): Promise<readonly SkillRef[]> {
  const dir = resolve(skillsRoot, id);
  try {
    if (!(await lstat(dir)).isDirectory()) {
      throw new PackAuthoringError("Skills must be a real directory: " + id);
    }
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.name.endsWith(".md")).map((entry) => {
      if (!entry.isFile()) throw new PackAuthoringError("Skill must be a regular file: " + id + "/" + entry.name);
      return { id, file: entry.name };
    }).sort((left, right) => left.file.localeCompare(right.file));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function main(): Promise<void> {
  const [packId, version, output, ...requested] = process.argv.slice(2);
  if (!packId || !version || !output) {
    throw new PackAuthoringError("usage: bun scripts/pack-personas.ts <packId> <version> <out.dmpack> [personaId...]");
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(packId)) {
    throw new PackAuthoringError("Pack id must be a safe path segment");
  }
  if (!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
    throw new PackAuthoringError("Version must be a semantic version such as 1.0.1");
  }
  if (extname(output).toLowerCase() !== ".dmpack") {
    throw new PackAuthoringError("Output must have the .dmpack extension");
  }
  const outputPath = resolve(output);
  if (await Bun.file(outputPath).exists()) {
    throw new PackAuthoringError("Destination already exists: " + outputPath);
  }
  const ids = parsePersonaIds(requested.length > 0 ? requested :
    (await readdir(personasRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort());
  const metadata = packMetadata(packId, ids);
  const staging = await mkdtemp(resolve(projectRoot, ".dmpack-"));
  const contents = resolve(staging, "contents");
  const archivePath = resolve(staging, "pack.zip");
  try {
    await mkdir(contents);
    const personas: PersonaEntry[] = [];
    let fileCount = 0;
    for (const id of ids) {
      const files = await personaFiles(id);
      const renderType = await personaRenderType(resolve(personasRoot, id), files);
      const defaultPosition = await personaDefaultPosition(resolve(personasRoot, id));
      if (files.length === 0) throw new PackAuthoringError("Persona has no assets: " + id);
      for (const relative of files) {
        const target = resolve(contents, "personas", id, relative);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(resolve(personasRoot, id, relative), target);
        fileCount += 1;
      }
      const skills = await personaSkills(id);
      for (const skill of skills) {
        const target = resolve(contents, "skills", skill.id, skill.file);
        await mkdir(dirname(target), { recursive: true });
        await copyFile(resolve(skillsRoot, skill.id, skill.file), target);
        fileCount += 1;
      }
      personas.push({ id, ...(renderType === "gif" ? { renderType } : {}), ...(skills.length > 0 ? { skills } : {}), ...(defaultPosition ? { defaultPosition } : {}) });
    }
    await copyFile(
      resolve(import.meta.dir, "persona-packs", metadata.cover),
      resolve(contents, metadata.thumbnail),
      constants.COPYFILE_EXCL,
    );
    await writeFile(resolve(contents, "pack.json"), JSON.stringify({
      packId, version, name: metadata.name, thumbnail: metadata.thumbnail, personas,
    }, null, 2) + "\n");
    const command = process.platform === "win32"
      ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", resolve(import.meta.dir, "pack-archive.ps1"), "-SourceDirectory", contents, "-ArchivePath", archivePath]
      : ["zip", "-r", "-q", archivePath, "."];
    const child = Bun.spawn(command, { cwd: contents, stdout: "pipe", stderr: "pipe" });
    const [exitCode, , stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) throw new PackAuthoringError("Could not archive pack: " + stderr);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(archivePath, outputPath, constants.COPYFILE_EXCL);
    const size = (await stat(outputPath)).size;
    console.log("Packed " + personas.length + " personas, " + (fileCount + 1) + " assets -> " + outputPath + " (" + (size / 1024 / 1024).toFixed(1) + " MiB)");
  } finally {
    if (dirname(resolve(staging)) !== projectRoot) {
      throw new PackAuthoringError("Staging cleanup must stay inside the project");
    }
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    if (error instanceof Error) console.error(error.message);
    else throw error;
    process.exitCode = 1;
  }
}
