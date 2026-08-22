import { describe, expect, test } from "bun:test";
import {
  DEFAULT_PERSONA_ID,
  PERSONAS,
  personaById,
  personaClipName,
  personaLabel,
} from "./personaCatalog";

describe("persona catalog", () => {
  test("contains every bundled persona and the new 小著 entry", () => {
    expect(PERSONAS).toHaveLength(26);
    expect(PERSONAS.map((persona) => persona.id)).toContain(DEFAULT_PERSONA_ID);
    expect(personaById("xiaozhu").name.zh).toBe("小著");
  });

  test("maps standard and 小著 moods to playable clips", () => {
    expect(personaClipName("aimisi", "idle")).toBe("Idle");
    expect(personaClipName("xiaozhu", "idle")).toBe("Idle");
    expect(personaClipName("xiaozhu", "thinking")).toBe("Think");
    expect(personaClipName("xiaozhu", "talking")).toBe("Wave");
    expect(personaClipName("xiaozhu", "working")).toBe("Dance");
    expect(personaClipName("xiaozhu", "error")).toBe("Sad");
    expect(personaLabel(personaById("xiaozhu"), "zh-CN")).toBe("小著");
  });
});
