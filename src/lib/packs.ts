import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { PackName } from "../pet/personaCatalog";

/**
 * Persona pack install state. Packs are imported from a local `.dmpack` file
 * rather than downloaded, so the app needs a real filesystem path — which a
 * WebView `input[type=file]` never exposes. The native picker supplies one.
 */

export const PACK_EXTENSION = "dmpack";

export interface InstalledPack {
  readonly packId: string;
  readonly version: string;
  readonly personaIds: readonly string[];
  readonly name?: PackName;
  readonly thumbnailPath?: string;
}

export interface ImportedPack extends InstalledPack {
  /** Digest of the archive, so a user can confirm which build they installed. */
  readonly sha256: string;
}

export function listInstalledPacks(): Promise<InstalledPack[]> {
  return invoke<InstalledPack[]>("installed_packs");
}

export function importPack(path: string): Promise<ImportedPack> {
  return invoke<ImportedPack>("import_pack", { path });
}

export interface PackImportRevision {
  readonly packId: string;
  readonly sha256: string;
}

export function onPackImported(callback: (pack: PackImportRevision) => void): Promise<UnlistenFn> {
  return listen<unknown>("deskmate://pack-imported", ({ payload }) => {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;
    if (!("packId" in payload) || !("sha256" in payload)) return;
    const { packId, sha256 } = payload;
    if (typeof packId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(packId)) return;
    if (typeof sha256 !== "string" || !/^[A-Fa-f0-9]{64}$/.test(sha256)) return;
    callback({ packId, sha256 });
  });
}

export function uninstallPack(packId: string): Promise<void> {
  return invoke<void>("uninstall_pack", { packId });
}

/** Opens the native picker; resolves to null when the user cancels. */
export async function pickPackFile(title: string): Promise<string | null> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: "YUME pack", extensions: [PACK_EXTENSION] }],
  });
  return typeof selected === "string" ? selected : null;
}
