import { useEffect, useState, type CSSProperties } from "react";
import type { GifAnimationState } from "./figure2d";
import { loadGifPersona, type LoadedGifPersona } from "./gifAssets";
import "./gifPet.css";

interface GifPetViewProps {
  readonly personaId: string;
  readonly state: GifAnimationState;
  readonly width: number;
  readonly leaving: boolean;
  readonly onError: (error: string | null) => void;
  readonly onLoaded?: (persona: LoadedGifPersona) => void;
  readonly load?: typeof loadGifPersona;
}

export function GifPetView({ personaId, state, width, leaving, onError, onLoaded, load = loadGifPersona }: GifPetViewProps) {
  const [loaded, setLoaded] = useState<LoadedGifPersona | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    onError(null);
    void load(personaId, abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      setLoaded(result);
      onLoaded?.(result);
    }).catch((error: unknown) => {
      if (!abort.signal.aborted) onError(error instanceof Error ? error.message : String(error));
    });
    return () => abort.abort();
  }, [personaId, load, onError, onLoaded]);
  if (loaded === null) return null;
  const action = loaded.config.animations[state];
  const displayWidth = width * action.scale;
  const departure = loaded.config.leaving;
  const style: CSSProperties = {
    width: displayWidth, height: displayWidth,
    bottom: action.offsetY * width / loaded.config.canvas.height,
    transform: leaving ? `translateX(${departure.translateXRatio * displayWidth}px)` : "translateX(0px)",
    opacity: leaving ? 0 : 1,
    transition: leaving ? `transform ${departure.durationMs}ms ${departure.positionEasing}, opacity ${departure.durationMs}ms ${departure.opacityEasing}` : "none",
  };
  return <span className="gif-pet-frame" style={{ width, height: width }}>
    <img className="gif-pet-image" src={loaded.urls[state]} alt="Desktop pet" draggable={false}
      data-state={state} style={style} onError={() => onError("GIF image unavailable")} />
  </span>;
}
