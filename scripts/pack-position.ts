import { resolve } from "node:path";
import { PackAuthoringError } from "./pack-metadata";

export type DefaultPosition = {
  readonly anchor: "drawing-center";
  readonly x: number;
  readonly y: number;
};

export function parseDefaultPosition(value: unknown): DefaultPosition {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || Object.keys(value).some(key => !["anchor", "x", "y"].includes(key))
    || !("anchor" in value) || value.anchor !== "drawing-center"
    || !("x" in value) || typeof value.x !== "number" || !Number.isFinite(value.x) || value.x < 0 || value.x > 1
    || !("y" in value) || typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 1) {
    throw new PackAuthoringError("defaultPosition requires drawing-center and finite x/y ratios in [0, 1]");
  }
  return { anchor: value.anchor, x: value.x, y: value.y };
}

export async function personaDefaultPosition(root: string): Promise<DefaultPosition | undefined> {
  const file = Bun.file(resolve(root, "placement.json"));
  if (!await file.exists()) return undefined;
  const value: unknown = await file.json();
  return parseDefaultPosition(value);
}
