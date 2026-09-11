import { expect, test } from "bun:test";
import { parseFigure2dConfig } from "./figure2d";
import contractFixtures from "../../tests/fixtures/figure2d-contract.json";

const fixture = () => ({
  schemaVersion: 1,
  canvas: { width: 240, height: 240 },
  animations: Object.fromEntries(["idle", "thinking", "working", "talking", "success", "error", "leaving"].map(state => [state, { file: `animations/${state}.gif`, scale: 1, offsetY: 0 }])),
  feedback: { successMs: 1400, errorMs: 1440 },
  leaving: { durationMs: 910, translateXRatio: -0.35, positionEasing: "ease-in-out", opacityEasing: "linear" },
  thinkingEscalationMs: 8000,
});

test("accepts an optional sleep animation without changing required states", () => {
  const input = fixture();
  input.animations.sleep = { file: "animations/sleep.gif", scale: 1, offsetY: 0 };
  const config = parseFigure2dConfig(input);
  expect(Object.keys(config.animations)).toHaveLength(8);
});

test("accepts optional v2 sleep geometry and rejects its unsafe path", () => {
  const fixture = contractFixtures.find(value => value.name === "valid-v2");
  if (!fixture) throw new Error("Missing v2 fixture");
  const animations = parseFigure2dConfig(fixture.config).animations;
  const config = parseFigure2dConfig({ ...fixture.config, animations: { ...animations, sleep: animations.idle } });
  expect(config.animations.sleep?.file).toBe(animations.idle.file);
  expect(() => parseFigure2dConfig({ ...fixture.config, animations: { ...animations, sleep: { ...animations.idle, file: "../sleep.gif" } } })).toThrow();
});

test("parses seven animations when schema version is supported", () => {
  const input = fixture();
  const config = parseFigure2dConfig(input);
  expect(config.animations.working.file).toBe("animations/working.gif");
  expect(config.leaving.durationMs).toBe(910);
});

for (const file of ["../idle.gif", "/idle.gif", "https://host/a.gif", "C:/idle.gif", "a\\idle.gif", "a/%2e%2e/idle.gif", "a//idle.gif", "a/idle.png"]) {
  test(`rejects unsafe GIF path ${file}`, () => {
    const input = fixture();
    input.animations.idle = { file, scale: 1, offsetY: 0 };
    expect(() => parseFigure2dConfig(input)).toThrow();
  });
}

test("rejects unknown version when loading a newer contract", () => {
  const input = { ...fixture(), schemaVersion: 3 };
  expect(() => parseFigure2dConfig(input)).toThrow("schemaVersion");
});

test("rejects missing animation when a state is incomplete", () => {
  const input = fixture();
  delete input.animations.success;
  expect(() => parseFigure2dConfig(input)).toThrow();
});

test("rejects nonfinite scale when numeric input is invalid", () => {
  const input = fixture();
  input.animations.idle = { file: "idle.gif", scale: Number.NaN, offsetY: 0 };
  expect(() => parseFigure2dConfig(input)).toThrow();
});

for (const [scale, offsetY] of [[1.1, 0], [1, 1], [0.5, 121], [1, -1]]) {
  test(`rejects clipped presentation scale ${scale} offset ${offsetY}`, () => {
    const input = fixture();
    input.animations.idle = { file: "idle.gif", scale, offsetY };
    expect(() => parseFigure2dConfig(input)).toThrow();
  });
}

test("rejects unknown animation when schema v1 cannot display it", () => {
  const input = fixture();
  input.animations.sleeping = { file: "sleeping.gif", scale: 1, offsetY: 0 };
  expect(() => parseFigure2dConfig(input)).toThrow();
});

for (const ratio of [-0.35, -0.5]) {
  test(`supports departure ratio ${ratio} without changing duration`, () => {
    const input = fixture();
    input.leaving.translateXRatio = ratio;
    const parsed = parseFigure2dConfig(input);
    expect(parsed.leaving.translateXRatio).toBe(ratio);
    expect(parsed.leaving.durationMs).toBe(910);
  });
}

for (const ratio of [-0.6, -0.4, 0.5]) {
  test(`rejects unsupported departure ratio ${ratio}`, () => {
    const input = fixture();
    input.leaving.translateXRatio = ratio;
    expect(() => parseFigure2dConfig(input)).toThrow();
  });
}
