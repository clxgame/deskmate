import { chmod, copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type PackageManifest = {
  version?: string;
  devDependencies?: Record<string, string>;
};

const projectRoot = resolve(import.meta.dir, "..");
const sourcePackageDir = resolve(projectRoot, "node_modules/opencode-ai");
const sourceBinary = resolve(sourcePackageDir, "bin/opencode.exe");
const installedManifestPath = resolve(sourcePackageDir, "package.json");
const projectManifestPath = resolve(projectRoot, "package.json");
const executableName = process.platform === "win32" ? "opencode.exe" : "opencode";
const staleExecutableName = process.platform === "win32" ? "opencode" : "opencode.exe";
const targetBinary = resolve(
  projectRoot,
  "src-tauri/resources/opencode",
  executableName,
);

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

async function main() {
  const [projectManifest, installedManifest] = await Promise.all([
    readManifest(projectManifestPath),
    readManifest(installedManifestPath),
  ]).catch(() => {
    throw new Error("OpenCode package is missing; run `bun install` first");
  });

  const expectedVersion = projectManifest.devDependencies?.["opencode-ai"];
  if (!expectedVersion || installedManifest.version !== expectedVersion) {
    throw new Error(
      `OpenCode version mismatch: expected ${expectedVersion ?? "a pinned version"}, ` +
        `found ${installedManifest.version ?? "nothing"}; run \`bun install --frozen-lockfile\``,
    );
  }

  const source = await stat(sourceBinary).catch(() => null);
  if (!source?.isFile()) {
    throw new Error(
      `OpenCode did not install a binary for ${process.platform}-${process.arch}`,
    );
  }

  await mkdir(dirname(targetBinary), { recursive: true });
  await rm(resolve(dirname(targetBinary), staleExecutableName), { force: true });
  await copyFile(sourceBinary, targetBinary);
  if (process.platform !== "win32") {
    await chmod(targetBinary, 0o755);
  }

  const sizeMiB = (source.size / 1024 / 1024).toFixed(1);
  console.log(
    `Prepared OpenCode ${installedManifest.version} for ${process.platform}-${process.arch} ` +
      `(${sizeMiB} MiB)`,
  );
}

await main();
