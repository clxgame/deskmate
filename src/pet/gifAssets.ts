import { personaAssets } from "./personaAssets";
import { parseFigure2dConfig, type Figure2dConfig, type GifAnimationState } from "./figure2d";

export interface LoadedGifPersona {
  readonly config: Figure2dConfig;
  readonly urls: Readonly<Record<GifAnimationState, string>> & { readonly sleep?: string };
}
export class GifAssetError extends Error {
  constructor(readonly asset: string) { super(`GIF asset unavailable: ${asset}`); this.name = "GifAssetError"; }
}

export function preloadGif(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); image.src = ""; reject(signal.reason); };
    image.onload = () => { cleanup(); resolve(); };
    image.onerror = () => { cleanup(); reject(new GifAssetError(url)); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    image.src = url;
  });
}

export async function loadGifPersona(personaId: string, signal: AbortSignal, revision = ""): Promise<LoadedGifPersona> {
  const assets = await personaAssets(personaId);
  if (assets.renderType !== "gif") throw new GifAssetError(personaId);
  const versioned = (url: string) => revision === "" ? url : `${url}?packRevision=${encodeURIComponent(revision)}`;
  const response = await fetch(versioned(assets.configUrl), { signal });
  if (!response.ok) throw new GifAssetError(assets.configUrl);
  const config = parseFigure2dConfig(await response.json());
  const resolve = async (state: GifAnimationState): Promise<string> => {
    const url = versioned(await assets.animationUrl(config.animations[state].file));
    await preloadGif(url, signal);
    return url;
  };
  const [idle, thinking, working, talking, success, error, leaving] = await Promise.all([
    resolve("idle"), resolve("thinking"), resolve("working"), resolve("talking"), resolve("success"), resolve("error"), resolve("leaving"),
  ]);
  if (config.animations.sleep) {
    const sleep = versioned(await assets.animationUrl(config.animations.sleep.file));
    await preloadGif(sleep, signal);
    return { config, urls: { idle, thinking, working, talking, success, error, leaving, sleep } };
  }
  return { config, urls: { idle, thinking, working, talking, success, error, leaving } };
}
