export const GIF_ANIMATION_STATES = ["idle", "thinking", "working", "talking", "success", "error", "leaving"] as const;
export type GifAnimationState = typeof GIF_ANIMATION_STATES[number];
export type Figure2dAnimation = { readonly file: string; readonly scale: number; readonly offsetY: number };
export type Figure2dConfig = {
  readonly schemaVersion: 1;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly animations: Readonly<Record<GifAnimationState, Figure2dAnimation>>;
  readonly feedback: { readonly successMs: number; readonly errorMs: number };
  readonly leaving: { readonly durationMs: number; readonly translateXRatio: number; readonly positionEasing: "ease-in-out"; readonly opacityEasing: "linear" };
  readonly thinkingEscalationMs: number;
};

export class Figure2dConfigError extends Error {
  constructor(field: string) { super(`Invalid figure2d configuration: ${field}`); this.name = "Figure2dConfigError"; }
}

// Keep this dependency-free boundary usable by both the frontend and pack CLI.
function object(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Figure2dConfigError(field);
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Figure2dConfigError(field);
  return Object.fromEntries(Object.entries(value));
}
function number(value: unknown, field: string, [min, max]: readonly [number, number]): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Figure2dConfigError(field);
  return value;
}
export function parseGifPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.gif$/.test(value)) throw new Figure2dConfigError("animation file must be a safe relative GIF path");
  return value;
}
export function parseFigure2dConfig(input: unknown): Figure2dConfig {
  const root = object(input, "root", ["schemaVersion", "canvas", "animations", "feedback", "leaving", "thinkingEscalationMs"]);
  if (root.schemaVersion !== 1) throw new Figure2dConfigError("schemaVersion");
  const canvas = object(root.canvas, "canvas", ["width", "height"]);
  const source = object(root.animations, "animations", GIF_ANIMATION_STATES);
  function animation(state: GifAnimationState): Figure2dAnimation {
    const value = object(source[state], `animations.${state}`, ["file", "scale", "offsetY"]);
    const scale = number(value.scale, "scale", [0.1, 1]);
    return { file: parseGifPath(value.file), scale, offsetY: number(value.offsetY, "offsetY", [0, 240 * (1 - scale)]) };
  }
  const feedback = object(root.feedback, "feedback", ["successMs", "errorMs"]);
  const leaving = object(root.leaving, "leaving", ["durationMs", "translateXRatio", "positionEasing", "opacityEasing"]);
  if (leaving.positionEasing !== "ease-in-out" || leaving.opacityEasing !== "linear") throw new Figure2dConfigError("leaving easing");
  const translateXRatio = leaving.translateXRatio;
  if (translateXRatio !== -0.35 && translateXRatio !== -0.5) throw new Figure2dConfigError("translateXRatio");
  const width = number(canvas.width, "canvas.width", [240, 240]);
  const height = number(canvas.height, "canvas.height", [240, 240]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) throw new Figure2dConfigError("canvas dimensions");
  return {
    schemaVersion: 1, canvas: { width, height },
    animations: { idle: animation("idle"), thinking: animation("thinking"), working: animation("working"), talking: animation("talking"), success: animation("success"), error: animation("error"), leaving: animation("leaving") },
    feedback: { successMs: number(feedback.successMs, "successMs", [1, 10000]), errorMs: number(feedback.errorMs, "errorMs", [1, 10000]) },
    leaving: { durationMs: number(leaving.durationMs, "durationMs", [1, 1100]), translateXRatio, positionEasing: "ease-in-out", opacityEasing: "linear" },
    thinkingEscalationMs: number(root.thinkingEscalationMs, "thinkingEscalationMs", [1, 60000]),
  };
}
