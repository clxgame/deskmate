import { convertFileSrc } from "@tauri-apps/api/core";
import type { InstalledPack } from "../lib/packs";
import { BUILTIN_PACKS, packById, type PackManifest } from "../pet/personaCatalog";

export type PackActivity = "idle" | "import" | "uninstall";

export function packLibrary(installed: readonly InstalledPack[]): readonly PackManifest[] {
  const seen = new Set(BUILTIN_PACKS.map((pack) => pack.packId));
  const imported: PackManifest[] = [];
  for (const local of installed) {
    if (seen.has(local.packId)) continue;
    seen.add(local.packId);
    const known = packById(local.packId);
    const present = new Set(local.personaIds);
    imported.push({
      packId: local.packId,
      version: local.version,
      builtin: false,
      personas: known?.personas.filter((persona) => present.has(persona.id)) ?? [],
      ...(local.name === undefined ? {} : { name: local.name }),
      ...(local.thumbnailPath === undefined ? {} : { thumbnail: convertFileSrc(local.thumbnailPath) }),
    });
  }
  return [...BUILTIN_PACKS, ...imported];
}