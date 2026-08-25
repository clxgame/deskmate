import {
  chmod,
  copyFile,
  mkdir,
  open,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
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

const optionalPlatform = process.platform === "win32" ? "windows" : process.platform;
const optionalArchitecture = process.arch;

function optionalPackageNames(): string[] {
  const base = `opencode-${optionalPlatform}-${optionalArchitecture}`;
  if (process.platform === "win32" && process.arch === "x64") {
    return [base, `${base}-baseline`];
  }
  return [base];
}

async function isUsableBinary(path: string): Promise<boolean> {
  const file = await open(path, "r").catch(() => null);
  if (!file) return false;

  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile() || fileStats.size < 64) return false;
    if (process.platform !== "win32") return true;

    const dosHeader = Buffer.alloc(64);
    const dosRead = await file.read(dosHeader, 0, dosHeader.length, 0);
    if (dosRead.bytesRead < dosHeader.length || dosHeader.readUInt16LE(0) !== 0x5a4d) {
      return false;
    }

    const peOffset = dosHeader.readUInt32LE(0x3c);
    const peHeader = Buffer.alloc(6);
    const peRead = await file.read(peHeader, 0, peHeader.length, peOffset);
    if (peRead.bytesRead < peHeader.length || peHeader.subarray(0, 4).toString("ascii") !== "PE\0\0") {
      return false;
    }

    const expectedMachine =
      process.arch === "x64" ? 0x8664 : process.arch === "arm64" ? 0xaa64 : 0x014c;
    return peHeader.readUInt16LE(4) === expectedMachine;
  } finally {
    await file.close();
  }
}

export async function findSourceBinary(): Promise<string> {
  const candidates = [
    sourceBinary,
    ...optionalPackageNames().map((name) =>
      resolve(projectRoot, "node_modules", name, "bin", executableName),
    ),
  ];

  for (const candidate of candidates) {
    if (await isUsableBinary(candidate)) return candidate;
  }

  throw new Error(
    `OpenCode did not install a usable binary for ${process.platform}-${process.arch}`,
  );
}

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

  const selectedSource = await findSourceBinary();
  const source = await stat(selectedSource).catch(() => null);
  if (!source?.isFile()) {
    throw new Error(
      `OpenCode did not install a binary for ${process.platform}-${process.arch}`,
    );
  }

  await mkdir(dirname(targetBinary), { recursive: true });
  await rm(resolve(dirname(targetBinary), staleExecutableName), { force: true });
  await copyFile(selectedSource, targetBinary);
  if (process.platform !== "win32") {
    await chmod(targetBinary, 0o755);
  }

  const sizeMiB = (source.size / 1024 / 1024).toFixed(1);
  console.log(
    `Prepared OpenCode ${installedManifest.version} for ${process.platform}-${process.arch} ` +
      `(${sizeMiB} MiB)`,
  );
}

if (import.meta.main) {
  await main();
}
