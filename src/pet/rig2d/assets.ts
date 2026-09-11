import { readRig2dResponse, validateRig2dPng, RIG2D_MAX_PNG_BYTES } from './png';
import { personaAssets } from "../personaAssets";
import { parseRig2dConfig, rig2dTextureFiles, Rig2dError, type Rig2dConfig } from "./config";

export interface LoadedRig2dPersona { readonly config: Rig2dConfig; readonly images: ReadonlyMap<string, HTMLImageElement> }
export function preloadRig2dImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); image.src = ""; reject(signal.reason); };
    image.onload = () => { cleanup(); if (image.naturalWidth !== 512 || image.naturalHeight !== 512) reject(new Rig2dError("PNG dimensions must be 512×512")); else resolve(image); };
    image.onerror = () => { cleanup(); reject(new Rig2dError("PNG unavailable")); };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) { cancel(); return; }
    image.src = url;
  });
}
export async function loadRig2dPersona(personaId: string, signal: AbortSignal, revision = ""): Promise<LoadedRig2dPersona> {
  const assets = await personaAssets(personaId);
  if (assets.renderType !== "rig2d") throw new Rig2dError("persona is not rig2d");
  const versioned = (url: string) => revision === "" ? url : `${url}?packRevision=${encodeURIComponent(revision)}`;
  const pending = new AbortController();
  const requestSignal = AbortSignal.any([signal, pending.signal, AbortSignal.timeout(30000)]);
  try {
    const response = await fetch(versioned(assets.configUrl), { signal: requestSignal });
    const config = parseRig2dConfig(JSON.parse(new TextDecoder().decode(await readRig2dResponse(response, 128 * 1024))));
    const images = await Promise.all(rig2dTextureFiles(config).map(async (file): Promise<readonly [string, HTMLImageElement]> => {
      const url = versioned(await assets.textureUrl(file));
      const bytes = await readRig2dResponse(await fetch(url, { signal: requestSignal }), RIG2D_MAX_PNG_BYTES);
      validateRig2dPng(bytes);
      const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      try { return [file, await preloadRig2dImage(objectUrl, requestSignal)]; }
      finally { URL.revokeObjectURL(objectUrl); }
    }));
    requestSignal.throwIfAborted();
    return { config, images: new Map(images) };
  } finally { pending.abort(); }
}
