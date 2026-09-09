import { convertFileSrc } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { parseGifPath } from "./figure2d";
import { AI_SUBSTITUTE_PACK, personaById } from "./personaCatalog";

/**
 * Resolves where a persona's model and textures live.
 *
 * Built-in packs are bundled into the frontend, so they load from the app's own
 * origin. Imported packs live under `<appData>/packs/<packId>/` on disk and can
 * only be read through the asset protocol, whose scope is restricted to that
 * directory in tauri.conf.json.
 */

const BUILTIN_PACK_IDS: ReadonlySet<string> = new Set([
  AI_SUBSTITUTE_PACK.packId,
]);

/**
 * A persona's asset URLs. Textures resolve per file rather than by appending to
 * a root, because `convertFileSrc` percent-encodes the path and concatenating
 * onto an already-encoded URL would corrupt it.
 */
export interface GlbPersonaAssets {
  readonly renderType: "glb";
  readonly modelUrl: string;
  /** URL for `textures/<slot>/baseColor.png`. */
  textureUrl(slot: string): Promise<string>;
}

export interface GifPersonaAssets {
  readonly renderType: "gif";
  readonly configUrl: string;
  animationUrl(file: string): Promise<string>;
}
export type PersonaAssets = GlbPersonaAssets | GifPersonaAssets;

/** Platform calls, injectable so tests need not mock Tauri modules globally. */
export interface AssetHost {
  appDataDir(): Promise<string>;
  join(...parts: string[]): Promise<string>;
  convertFileSrc(path: string): string;
}

const tauriHost: AssetHost = { appDataDir, join, convertFileSrc };

export function isBuiltinPack(packId: string): boolean {
  return BUILTIN_PACK_IDS.has(packId);
}

/** Built-in assets are served from the bundled frontend. */
function builtinAssets(personaId: string): GlbPersonaAssets {
  const root = `/personas/${personaId}`;
  return {
    renderType: "glb",
    modelUrl: `${root}/figure.glb`,
    textureUrl: (slot) =>
      Promise.resolve(`${root}/textures/${slot}/baseColor.png`),
  };
}

/**
 * Imported packs are read from disk. `convertFileSrc` turns an absolute path
 * into an `asset:`-backed URL the WebView is allowed to fetch.
 */
async function importedAssets(
  packId: string,
  personaId: string,
  host: AssetHost,
): Promise<PersonaAssets> {
  const personaRoot = await host.join(
    await host.appDataDir(),
    "packs",
    packId,
    "personas",
    personaId,
  );
  if (personaById(personaId).renderType === "gif") {
    return { renderType: "gif", configUrl: host.convertFileSrc(await host.join(personaRoot, "figure2d.json")),
      animationUrl: async (file) => host.convertFileSrc(await host.join(personaRoot, ...parseGifPath(file).split("/"))), };
  }
  return {
    renderType: "glb",
    modelUrl: host.convertFileSrc(await host.join(personaRoot, "figure.glb")),
    textureUrl: async (slot) =>
      host.convertFileSrc(
        await host.join(personaRoot, "textures", slot, "baseColor.png"),
      ),
  };
}

/**
 * Assets for a persona, whichever pack owns it. Unknown persona ids fall back to
 * the default persona via `personaById`.
 */
export async function personaAssets(
  id: string,
  host: AssetHost = tauriHost,
): Promise<PersonaAssets> {
  const persona = personaById(id);
  return isBuiltinPack(persona.packId)
    ? builtinAssets(persona.id)
    : importedAssets(persona.packId, persona.id, host);
}
