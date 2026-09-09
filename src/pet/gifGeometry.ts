export type GifPoint = readonly [number, number];
export type GifRect = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
export type GifPlacement = { readonly scale: number; readonly offsetY: number; readonly offsetX?: number };

export function gifDisplayRect(width: number, action: GifPlacement): GifRect {
  const size = width * action.scale;
  return { left: (width - size) / 2 + (action.offsetX ?? 0) * width / 240,
    top: width - size - action.offsetY * width / 240, width: size, height: size };
}

export function gifSourcePoint(point: GifPoint, rect: GifRect): GifPoint {
  return [(point[0] - rect.left) * 240 / rect.width, (point[1] - rect.top) * 240 / rect.height];
}

export function pointInGifPolygon(point: GifPoint, polygon: readonly GifPoint[], tolerance: number): boolean {
  let inside = false;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a === undefined || b === undefined) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
    if (Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy) <= tolerance) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

const silhouettes = new WeakMap<Element, readonly GifPoint[] | null>();
export function setGifHitPolygon(element: Element, polygon: readonly GifPoint[] | null): void {
  silhouettes.set(element, polygon);
}

export function pointInPetContent(root: HTMLElement, x: number, y: number): boolean {
  return [...root.querySelectorAll(".gif-pet-image, .pet-pomodoro, .pet-load-error")].some((element) => {
    if (element.getAttribute("data-hit-disabled") === "true") return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const polygon = silhouettes.get(element);
    return polygon ? pointInGifPolygon(gifSourcePoint([x, y], rect), polygon, 3 * 240 / rect.width)
      : x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  });
}

import type { Figure2dConfig } from "./figure2d";
export type GifEnvelope = { readonly horizontal: number; readonly top: number; readonly bottom: number };
export function gifEnvelope(config: Figure2dConfig): GifEnvelope {
  let horizontal = 1;
  let top = 1;
  let bottom = 0;
  for (const [state, action] of Object.entries(config.animations)) {
    const rect = gifDisplayRect(1, action);
    const departure = state === "leaving" ? config.leaving.translateXRatio * rect.width : 0;
    horizontal = Math.max(horizontal, 0.5 - rect.left - departure, rect.left + rect.width - 0.5);
    top = Math.max(top, 1 - rect.top);
    bottom = Math.max(bottom, rect.top + rect.height - 1);
  }
  return { horizontal, top, bottom };
}
