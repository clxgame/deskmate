import { simplePolygon } from "../figure2dPolygon";

export const RIG2D_STATES = ["idle", "thinking", "talking", "working", "error", "sleep"] as const;
export type Rig2dState = typeof RIG2D_STATES[number];
export type Vec2 = readonly [number, number];
export type Vec4 = readonly [number, number, number, number];
export type Affine = readonly [readonly [number, number, number], readonly [number, number, number]];
export type Rig2dPose = {
  readonly textures: readonly string[];
  readonly rig: { readonly neck: Vec2; readonly eyes: Vec4; readonly eyeAngle: number; readonly eyeRadius: Vec2; readonly mouth: Vec4 };
  readonly alignment: { readonly blink: Affine; readonly mouth: Affine };
  readonly hitPolygon: readonly Vec2[];
};
export type Rig2dConfig = {
  readonly schemaVersion: 1;
  readonly renderer: "silver-cat-v1";
  readonly canvas: { readonly width: 512; readonly height: 512 };
  readonly states: Readonly<Record<Rig2dState, Rig2dPose>>;
};
export class Rig2dError extends Error {
  constructor(readonly detail: string) { super(`Rig2d: ${detail}`); this.name = "Rig2dError"; }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const allowed = new Set(keys);
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some(key => !allowed.has(key))) throw new Rig2dError("invalid object fields");
  return Object.fromEntries(Object.entries(value));
}
function finite(value: unknown, min = 0, max = 512): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Rig2dError("invalid numeric parameter");
  return value;
}
function vector(value: unknown, count: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== count) throw new Rig2dError("invalid vector");
  return value;
}
function vec2(value: unknown, positive = false): Vec2 {
  const v = vector(value, 2);
  return [finite(v[0], positive ? Number.MIN_VALUE : 0), finite(v[1], positive ? Number.MIN_VALUE : 0)];
}
function vec4(value: unknown, radii = false): Vec4 {
  const v = vector(value, 4);
  return [finite(v[0]), finite(v[1]), finite(v[2], radii ? Number.MIN_VALUE : 0), finite(v[3], radii ? Number.MIN_VALUE : 0)];
}
function affine(value: unknown): Affine {
  const v = vector(value, 2);
  const row = (raw: unknown): readonly [number, number, number] => {
    const a = vector(raw, 3); return [finite(a[0], -4, 4), finite(a[1], -4, 4), finite(a[2], -512, 512)];
  };
  return [row(v[0]), row(v[1])];
}
export function parseRig2dPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !/^assets\/[a-z0-9][a-z0-9_-]*\.png$/.test(value)) throw new Rig2dError("unsafe PNG path");
  return value;
}
export function parseRig2dConfig(input: unknown): Rig2dConfig {
  const root = object(input, ["schemaVersion", "renderer", "canvas", "states"]);
  const canvas = object(root.canvas, ["width", "height"]);
  if (root.schemaVersion !== 1 || root.renderer !== "silver-cat-v1" || canvas.width !== 512 || canvas.height !== 512) throw new Rig2dError("unsupported renderer or canvas");
  const states = object(root.states, RIG2D_STATES);
  const pose = (state: Rig2dState): Rig2dPose => {
    const p = object(states[state], ["textures", "rig", "alignment", "hitPolygon"]);
    const textures = vector(p.textures, state === "sleep" ? 1 : state === "talking" ? 3 : 2).map(parseRig2dPath);
    const r = object(p.rig, ["neck", "eyes", "eyeAngle", "eyeRadius", "mouth"]);
    const a = object(p.alignment, ["blink", "mouth"]);
    if (!Array.isArray(p.hitPolygon) || p.hitPolygon.length < 3 || p.hitPolygon.length > 128) throw new Rig2dError("invalid hit polygon");
    const hitPolygon = p.hitPolygon.map((v: unknown) => vec2(v));
    if (!simplePolygon(hitPolygon)) throw new Rig2dError("hit polygon must be simple");
    return { textures, rig: { neck: vec2(r.neck), eyes: vec4(r.eyes), eyeAngle: finite(r.eyeAngle, -Math.PI, Math.PI), eyeRadius: vec2(r.eyeRadius, true), mouth: vec4(r.mouth, true) }, alignment: { blink: affine(a.blink), mouth: affine(a.mouth) }, hitPolygon };
  };
  return { schemaVersion: 1, renderer: "silver-cat-v1", canvas: { width: 512, height: 512 }, states: { idle: pose("idle"), thinking: pose("thinking"), talking: pose("talking"), working: pose("working"), error: pose("error"), sleep: pose("sleep") } };
}
export function rig2dTextureFiles(config: Rig2dConfig): string[] { return [...new Set(RIG2D_STATES.flatMap(state => config.states[state].textures))]; }
export function rig2dEnvelope() { return { horizontal: 1, top: 1, bottom: 0 }; }

