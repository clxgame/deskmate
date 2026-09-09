import { expect, test } from "bun:test";
import { pointInPetContent } from "./useGifPassthrough";

test("transparent travel padding passes through while pet and timer remain interactive", () => {
  const root = document.createElement("div");
  const image = document.createElement("img");
  image.className = "gif-pet-image";
  image.getBoundingClientRect = () => new DOMRect(56, 50, 160, 160);
  const timer = document.createElement("div");
  timer.className = "pet-pomodoro";
  timer.getBoundingClientRect = () => new DOMRect(60, 10, 150, 30);
  root.append(image, timer);
  expect(pointInPetContent(root, 20, 100)).toBe(false);
  expect(pointInPetContent(root, 260, 100)).toBe(false);
  expect(pointInPetContent(root, 100, 100)).toBe(true);
  expect(pointInPetContent(root, 100, 20)).toBe(true);
});

import { createCursorWriter } from "./useGifPassthrough";
import { setGifHitPolygon } from "./gifGeometry";

test("v2 body polygon uses CSS pixel tolerance and hides departing body", () => {
  const root = document.createElement("div");
  const image = document.createElement("img");
  image.className = "gif-pet-image";
  image.getBoundingClientRect = () => new DOMRect(10, 20, 120, 120);
  setGifHitPolygon(image, [[60, 60], [180, 60], [180, 180], [60, 180]]);
  root.append(image);
  expect(pointInPetContent(root, 70, 80)).toBe(true);
  expect(pointInPetContent(root, 37, 80)).toBe(true);
  expect(pointInPetContent(root, 36.99, 80)).toBe(false);
  expect(pointInPetContent(root, 120, 130)).toBe(false);
  image.setAttribute("data-hit-disabled", "true");
  expect(pointInPetContent(root, 70, 80)).toBe(false);
});

test("an in-flight ignore write is corrected when a lock or disposal restores interaction", async () => {
  const calls: boolean[] = [];
  let finish: (() => void) | undefined;
  const setIgnored = createCursorWriter((value) => { calls.push(value); return new Promise<void>((resolve) => { finish = resolve; }); });
  setIgnored(true);
  setIgnored(false);
  expect(calls).toEqual([true]);
  finish?.();
  await Promise.resolve();
  expect(calls).toEqual([true, false]);
  finish?.();
  await Promise.resolve();
  setIgnored(false);
  expect(calls).toEqual([true, false]);
});
