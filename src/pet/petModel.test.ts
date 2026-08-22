import { describe, expect, test } from "bun:test";
import { clipNameForMood, DEFAULT_PET_PERSONA, PET_MODEL_URL, PET_TEXTURE_ROOT } from "./petModel";

describe("pet model asset mapping", () => {
  test("uses the bundled aimisi GLB and sidecar texture root", () => {
    // Given
    const persona = DEFAULT_PET_PERSONA;

    // When
    const model = PET_MODEL_URL;
    const textures = PET_TEXTURE_ROOT;

    // Then
    expect(persona).toBe("aimisi");
    expect(model).toBe("/personas/aimisi/figure.glb");
    expect(textures).toBe("/personas/aimisi/textures");
  });

  test("maps every pet mood to a GLB animation clip", () => {
    expect(clipNameForMood("idle")).toBe("Idle");
    expect(clipNameForMood("thinking")).toBe("Thinking");
    expect(clipNameForMood("talking")).toBe("Talking");
    expect(clipNameForMood("working")).toBe("Working");
    expect(clipNameForMood("error")).toBe("Error");
  });
});
