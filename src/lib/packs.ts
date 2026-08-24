import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

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

export function uninstallPack(packId: string): Promise<void> {
  return invoke<void>("uninstall_pack", { packId });
}

/** Opens the native picker; resolves to null when the user cancels. */
export async function pickPackFile(title: string): Promise<string | null> {
  const selected = await open({
    title,
    multiple: false,
    directory: false,
    filters: [{ name: "deskmate pack", extensions: [PACK_EXTENSION] }],
  });
  return typeof selected === "string" ? selected : null;
}
