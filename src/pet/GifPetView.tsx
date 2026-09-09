import { useEffect, useState, type CSSProperties } from "react";
import type { GifAnimationState } from "./figure2d";
import { loadGifPersona, type LoadedGifPersona } from "./gifAssets";
import { gifDisplayRect, gifEnvelope, setGifHitPolygon } from "./gifGeometry";
import "./gifPet.css";

interface GifPetViewProps {
  readonly personaId: string;
  readonly revision?: string;
  readonly state: GifAnimationState;
  readonly width: number;
  readonly leaving: boolean;
  readonly visible?: boolean;
  readonly onError: (error: string | null) => void;
  readonly onLoaded?: (persona: LoadedGifPersona) => void;
  readonly load?: typeof loadGifPersona;
}

export function GifPetView({ personaId, revision = "", state, width, leaving, visible = true, onError, onLoaded, load = loadGifPersona }: GifPetViewProps) {
  const [loaded, setLoaded] = useState<{ readonly id: string; readonly data: LoadedGifPersona } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    onError(null);
    void load(personaId, abort.signal, revision).then((result) => {
      if (abort.signal.aborted) return;
      setLoaded({ id: personaId, data: result });
      onLoaded?.(result);
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) onError(error instanceof Error ? error.message : String(error));
    });
    return () => abort.abort();
  }, [personaId, revision, load, onError, onLoaded]);
  if (loaded === null || loaded.id !== personaId) return null;
  const data = loaded.data;
  const action = data.config.animations[state];
  const rect = gifDisplayRect(width, action);
  const displayWidth = rect.width;
  const departure = data.config.leaving;
  const style: CSSProperties = {
    width: displayWidth, height: displayWidth, left: rect.left,
    bottom: action.offsetY * width / data.config.canvas.height,
    transform: leaving ? `translateX(${departure.translateXRatio * displayWidth}px)` : "translateX(0px)",
    opacity: leaving ? 0 : 1,
    transition: leaving ? `transform ${departure.durationMs}ms ${departure.positionEasing}, opacity ${departure.durationMs}ms ${departure.opacityEasing}` : "none",
  };
  return <span className="gif-pet-frame" style={{ width, height: width, bottom: data.config.schemaVersion === 2 ? gifEnvelope(data.config).bottom * width : 0 }}>
    <img className="gif-pet-image" src={data.urls[state]} alt="Desktop pet" draggable={false}
      ref={(element) => { if (element) setGifHitPolygon(element, data.config.schemaVersion === 2 ? data.config.animations[state].hitPolygon : null); }}
      data-hit-disabled={!visible || leaving} data-state={state} style={style} onError={() => { setLoaded(null); onError("GIF image unavailable"); }} />
  </span>;
}
