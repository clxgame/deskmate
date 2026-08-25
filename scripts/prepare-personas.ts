import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

/**
 * Fetch the pinned 3D persona assets (models + textures) into public/personas.
 *
 * These are ~169 MB of binary art, so they live as a release asset on the
 * private clxgame/deskmate-assets repo instead of in this public repository.
 * Mirrors prepare-opencode.ts / prepare-ncmdump.ts: the archive is verified
 * against a pinned SHA-256 before it is unpacked, so a swapped or truncated
 * download fails the build instead of shipping broken personas.
 *
 * Auth: needs a token that can read the private assets repo. Set
 * DESKMATE_ASSETS_TOKEN (CI secret) or GH_TOKEN/GITHUB_TOKEN locally. If no
 * token is available but the assets are already unpacked, the build proceeds.
 */

const ASSETS_REPO = "clxgame/deskmate-assets";
const PERSONAS_VERSION = "1.0.1";
const RELEASE_TAG = `personas-${PERSONAS_VERSION}`;
const ARCHIVE_NAME = `deskmate-personas-${PERSONAS_VERSION}.zip`;
const ARCHIVE_SHA256 =
  "8d719610e0355f7273ce3dedcd8cb04bbb5b4e930313a5353e4b2e96e316b40a";

/** Personas that must exist after unpacking, as a sanity check. */
const EXPECTED_PERSONA_COUNT = 26;

const projectRoot = resolve(import.meta.dir, "..");
const targetDir = resolve(projectRoot, "public/personas");
const stampPath = resolve(targetDir, ".personas-version");

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function assetsToken(): string | undefined {
  return (
    process.env.DESKMATE_ASSETS_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GITHUB_TOKEN ||
    undefined
  );
}

/** True when this exact asset version is already unpacked. */
async function alreadyPrepared(): Promise<boolean> {
  const stamp = await readFile(stampPath, "utf8").catch(() => null);
  if (stamp?.trim() !== RELEASE_TAG) return false;
  const entries = await readdir(targetDir, { withFileTypes: true }).catch(
    () => [],
  );
  return entries.filter((entry) => entry.isDirectory()).length >= 1;
}

/** Resolve the release asset's API download URL. */
async function assetUrl(token: string): Promise<string> {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "YUME-build",
  };
  const response = await fetch(
    `https://api.github.com/repos/${ASSETS_REPO}/releases/tags/${RELEASE_TAG}`,
    { headers },
  );
  if (!response.ok) {
    throw new Error(
      `could not read ${ASSETS_REPO} release ${RELEASE_TAG}: ${response.status} ${response.statusText}`,
    );
  }
  const release = (await response.json()) as {
    assets?: { name: string; url: string }[];
  };
  const asset = release.assets?.find((item) => item.name === ARCHIVE_NAME);
  if (!asset) {
    throw new Error(`release ${RELEASE_TAG} has no asset named ${ARCHIVE_NAME}`);
  }
  return asset.url;
}

async function download(url: string, token: string): Promise<Uint8Array> {
  // The API asset endpoint needs octet-stream to return bytes, not JSON.
  const response = await fetch(url, {
    headers: {
      Accept: "application/octet-stream",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "YUME-build",
    },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`could not download ${ARCHIVE_NAME}: ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function unpack(archivePath: string, destination: string) {
  // `unzip` is unavailable on stock Windows; PowerShell ships everywhere.
  const command =
    process.platform === "win32"
      ? [
          "powershell.exe",
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`,
        ]
      : ["unzip", "-o", "-q", archivePath, "-d", destination];

  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  if ((await proc.exited) !== 0) {
    throw new Error(
      `could not unpack persona assets: ${await new Response(proc.stderr).text()}`,
    );
  }
}

async function main() {
  if (await alreadyPrepared()) {
    console.log(`Persona assets ${PERSONAS_VERSION} already prepared`);
    return;
  }

  const token = assetsToken();
  if (!token) {
    const entries = await readdir(targetDir).catch(() => []);
    if (entries.length > 0) {
      console.warn(
        `No DESKMATE_ASSETS_TOKEN set; reusing the persona assets already in ` +
          `${targetDir} (expected release ${RELEASE_TAG}).`,
      );
      return;
    }
    throw new Error(
      "persona assets are missing and no token is available; set " +
        "DESKMATE_ASSETS_TOKEN (or GH_TOKEN) with read access to " +
        ASSETS_REPO,
    );
  }

  await mkdir(targetDir, { recursive: true });
  const workDir = resolve(targetDir, ".download");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    const archive = await download(await assetUrl(token), token);
    const actual = sha256(archive);
    if (actual !== ARCHIVE_SHA256) {
      throw new Error(
        `persona asset checksum mismatch for ${ARCHIVE_NAME}: ` +
          `expected ${ARCHIVE_SHA256}, got ${actual}`,
      );
    }

    const archivePath = resolve(workDir, ARCHIVE_NAME);
    await writeFile(archivePath, archive);
    await unpack(archivePath, targetDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  const personas = (
    await readdir(targetDir, { withFileTypes: true })
  ).filter((entry) => entry.isDirectory());
  if (personas.length < EXPECTED_PERSONA_COUNT) {
    throw new Error(
      `expected at least ${EXPECTED_PERSONA_COUNT} personas after unpacking, ` +
        `found ${personas.length}`,
    );
  }

  await writeFile(stampPath, `${RELEASE_TAG}\n`, "utf8");
  const sizeMiB = ((await totalSize(targetDir)) / 1024 / 1024).toFixed(1);
  console.log(
    `Prepared ${personas.length} persona assets ${PERSONAS_VERSION} (${sizeMiB} MiB unpacked)`,
  );
}

async function totalSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    total += entry.isDirectory() ? await totalSize(path) : (await stat(path)).size;
  }
  return total;
}

await main();
