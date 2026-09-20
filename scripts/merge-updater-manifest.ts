#!/usr/bin/env bun
import { readFile } from "node:fs/promises";

type Platform = { signature: string; url: string };
type Manifest = {
  version: string;
  notes?: string;
  pub_date?: string;
  platforms: Record<string, Platform>;
};

const VERSION = /^\d+\.\d+\.\d+$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function mergeMacUpdater(
  value: unknown,
  version: string,
  repository: string,
  signature: string,
): Manifest {
  if (!VERSION.test(version) || !REPOSITORY.test(repository) || !signature.trim()) {
    throw new Error("invalid macOS updater metadata");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("invalid existing updater manifest");
  }
  const current = value as Partial<Manifest>;
  if (current.version !== version || typeof current.platforms !== "object" || current.platforms === null) {
    throw new Error("updater manifest version/platform mismatch");
  }
  for (const [target, platform] of Object.entries(current.platforms)) {
    if (!target.startsWith("windows-") || typeof platform?.url !== "string"
      || typeof platform?.signature !== "string" || !platform.url || !platform.signature) {
      throw new Error(`unexpected or invalid existing platform: ${target}`);
    }
  }
  const file = `YUME_${version}_aarch64.app.tar.gz`;
  return {
    ...current,
    version,
    platforms: {
      ...current.platforms,
      "darwin-aarch64": {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/v${version}/${file}`,
      },
    },
  } as Manifest;
}

if (import.meta.main) {
  const [input, output, version, repository, signatureFile] = process.argv.slice(2);
  if (!input || !output || !version || !repository || !signatureFile) {
    throw new Error("usage: merge-updater-manifest.ts input output version owner/repo signature-file");
  }
  const existing = JSON.parse(await readFile(input, "utf8")) as unknown;
  const signature = await readFile(signatureFile, "utf8");
  await Bun.write(output, `${JSON.stringify(mergeMacUpdater(existing, version, repository, signature), null, 2)}\n`);
}
