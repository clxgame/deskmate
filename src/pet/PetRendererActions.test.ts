import { describe, expect, test } from "bun:test";
import { nonIdleClipNames, pickRandomClip } from "./PetRenderer";

describe("pet renderer poke actions", () => {
  test("offers every non-idle 小著 action for a poke", () => {
    expect(nonIdleClipNames("xiaozhu")).toEqual([
      "Think",
      "Wave",
      "Dance",
      "Sad",
    ]);
  });

  test("picks a deterministic action from the non-idle pool", () => {
    expect(pickRandomClip(["Think", "Wave", "Dance"], 0)).toBe("Think");
    expect(pickRandomClip(["Think", "Wave", "Dance"], 0.99)).toBe("Dance");
    expect(pickRandomClip([], 0.5)).toBeUndefined();
  });
});
