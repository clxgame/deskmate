import { describe, expect, test } from "bun:test";
import { mouseFollowPitchTarget } from "./PetRenderer";

describe("mouse-follow vertical direction", () => {
  test("screen Y keeps its sign when mapped to pitch", () => {
    expect(mouseFollowPitchTarget(-1)).toBeLessThan(0);
    expect(mouseFollowPitchTarget(1)).toBeGreaterThan(0);
  });

  test("vertical pitch remains clamped", () => {
    expect(mouseFollowPitchTarget(-10)).toBe(-0.3);
    expect(mouseFollowPitchTarget(10)).toBe(0.3);
  });
});
