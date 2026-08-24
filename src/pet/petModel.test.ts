import { describe, expect, test } from "bun:test";
import { clipNameForMood, DEFAULT_PET_PERSONA, PET_MODEL_URL, PET_TEXTURE_ROOT } from "./petModel";

describe("pet model asset mapping", () => {
  test("uses the built-in 小著 GLB so a fresh install has a pet", () => {
    // Given
    const persona = DEFAULT_PET_PERSONA;

    // When
    const model = PET_MODEL_URL;
    const textures = PET_TEXTURE_ROOT;

    // Then
    expect(persona).toBe("xiaozhu");
    expect(model).toBe("/personas/xiaozhu/figure.glb");
    expect(textures).toBe("/personas/xiaozhu/textures");
  });

  test("maps every pet mood to a GLB animation clip", () => {
    // 小著 uses the pixel clip set, not the standard one.
    expect(clipNameForMood("idle")).toBe("Idle");
    expect(clipNameForMood("thinking")).toBe("Think");
    expect(clipNameForMood("talking")).toBe("Wave");
    expect(clipNameForMood("working")).toBe("Dance");
    expect(clipNameForMood("error")).toBe("Sad");
  });
});
