import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Fetch the pinned ncmdump release into src-tauri/resources so packaged builds
 * ship the converter without committing a binary to Git.
 *
 * Mirrors prepare-opencode.ts: the sidecar binary is a build-time artifact, not
 * source. Every download is verified against a pinned SHA-256 before use, so a
 * tampered or swapped release fails the build instead of shipping silently.
 *
 * Upstream: https://github.com/taurusxin/ncmdump (MIT)
 */

const NCMDUMP_VERSION = "1.5.1";
const RELEASE_BASE = `https://github.com/taurusxin/ncmdump/releases/download/${NCMDUMP_VERSION}`;

type PlatformKey = "win32-x64" | "darwin-arm64" | "linux-x64";

interface PlatformAsset {
  /** Release asset file name. */
  asset: string;
  /** File name inside the archive. */
  entry: string;
  /** SHA-256 of the extracted executable; the build fails on any mismatch. */
  binarySha256: string;
  /** File name to write into resources. */
  output: string;
}

const ASSETS: Record<PlatformKey, PlatformAsset> = {
  "win32-x64": {
    asset: `ncmdump-${NCMDUMP_VERSION}-windows-amd64.zip`,
    entry: "ncmdump.exe",
    binarySha256:
      "a1f6f6ce87500b7b1f2a89dbf85b13e81d327eea4641daf8afe0ab840f2c518c",
    output: "ncmdump.exe",
  },
  "darwin-arm64": {
    asset: `ncmdump-${NCMDUMP_VERSION}-macos-arm64.zip`,
    entry: "ncmdump",
    binarySha256:
      "8d655ea31ea5ea543f8f9a45979c59a1410bcc016e542765eb2fd4d751941a94",
    output: "ncmdump",
  },
  "linux-x64": {
    asset: `ncmdump-${NCMDUMP_VERSION}-linux-amd64.zip`,
    entry: "ncmdump",
    binarySha256:
      "1fb62a06487c1c2a4bcc4bdf61bd9191e6dd83dfd61cd3425b56a4379f916eea",
    output: "ncmdump",
  },
};

const projectRoot = resolve(import.meta.dir, "..");
const targetDir = resolve(projectRoot, "src-tauri/resources/ncmdump");

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function platformKey(): PlatformKey {
  const key = `${process.platform}-${process.arch}`;
  if (key in ASSETS) return key as PlatformKey;
  throw new Error(
    `ncmdump has no pinned release for ${key}; ` +
      `supported: ${Object.keys(ASSETS).join(", ")}`,
  );
}

/** Reuse an already-prepared binary so repeat builds stay offline. */
async function alreadyPrepared(
  path: string,
  expectedSha256: string,
): Promise<boolean> {
  const existing = await stat(path).catch(() => null);
  if (!existing?.isFile()) return false;
  return sha256(await readFile(path)) === expectedSha256;
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`could not download ${url}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function extract(
  archive: Uint8Array,
  entry: string,
  workDir: string,
): Promise<Uint8Array> {
  const archivePath = resolve(workDir, "ncmdump-release.zip");
  await writeFile(archivePath, archive);
  // `unzip` is unavailable on stock Windows; PowerShell ships everywhere.
  const command =
    process.platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${workDir}' -Force`,
        ]
      : ["unzip", "-o", "-q", archivePath, "-d", workDir];

  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    throw new Error(
      `could not extract ${entry}: ${await new Response(proc.stderr).text()}`,
    );
  }
  return new Uint8Array(await readFile(resolve(workDir, entry)));
}

async function main() {
  const spec = ASSETS[platformKey()];
  const targetBinary = resolve(targetDir, spec.output);

  if (await alreadyPrepared(targetBinary, spec.binarySha256)) {
    console.log(`ncmdump ${NCMDUMP_VERSION} already prepared`);
    return;
  }

  await mkdir(targetDir, { recursive: true });
  const workDir = resolve(targetDir, ".download");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    const archive = await download(`${RELEASE_BASE}/${spec.asset}`);
    const binary = await extract(archive, spec.entry, workDir);

    const actual = sha256(binary);
    if (actual !== spec.binarySha256) {
      throw new Error(
        `ncmdump checksum mismatch for ${spec.asset}: ` +
          `expected ${spec.binarySha256}, got ${actual}`,
      );
    }

    await writeFile(targetBinary, binary);
    if (process.platform !== "win32") {
      await chmod(targetBinary, 0o755);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const sizeMiB = ((await stat(targetBinary)).size / 1024 / 1024).toFixed(1);
  console.log(
    `Prepared ncmdump ${NCMDUMP_VERSION} for ${process.platform}-${process.arch} (${sizeMiB} MiB)`,
  );
}

await main();
