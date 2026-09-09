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
