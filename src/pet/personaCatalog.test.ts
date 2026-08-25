import { describe, expect, test } from "bun:test";
import {
  AI_SUBSTITUTE_PACK,
  AKI_PACK,
  ALL_PERSONAS,
  BUILTIN_PACKS,
  DEFAULT_PERSONA_ID,
  KNOWN_PACKS,
  PERSONAS,
  packById,
  packLabel,
  personaById,
  personaCatalog,
  personaClipName,
  personaLabel,
} from "./personaCatalog";

describe("persona packs", () => {
  test("ships only the 小著 pack so the installer stays small", () => {
    expect(BUILTIN_PACKS).toHaveLength(1);
    const builtinPack = BUILTIN_PACKS[0];
    if (builtinPack === undefined) throw new Error("Missing built-in persona pack");
    expect(builtinPack.packId).toBe("ai-substitute");
    expect(builtinPack.builtin).toBe(true);
    // Bundling only 小著 keeps ~169 MB of aki assets out of the installer.
    expect(PERSONAS.map((persona) => persona.id)).toEqual(["xiaozhu"]);
  });

  test("keeps the default persona inside a built-in pack", () => {
    // Otherwise a fresh install would have no pet to render.
    const fallback = personaById(DEFAULT_PERSONA_ID);
    expect(fallback.packId).toBe("ai-substitute");
    expect(BUILTIN_PACKS.some((pack) => pack.packId === fallback.packId)).toBe(
      true,
    );
  });

  test("describes the aki pack as removable with all 25 personas", () => {
    expect(AKI_PACK.builtin).toBe(false);
    expect(AKI_PACK.personas).toHaveLength(25);
    expect(AKI_PACK.personas.map((persona) => persona.id)).toContain("aimisi");
    expect(AKI_PACK.personas.map((persona) => persona.id)).not.toContain(
      "xiaozhu",
    );
  });

  test("every known persona id is unique across packs", () => {
    const ids = ALL_PERSONAS.map((persona) => persona.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(26);
  });

  test("adds a pack's personas to the catalog once it is installed", () => {
    const before = personaCatalog();
    const after = personaCatalog([
      { packId: "aki", personaIds: AKI_PACK.personas.map((p) => p.id) },
    ]);

    expect(before).toHaveLength(1);
    expect(after).toHaveLength(26);
    expect(after.map((persona) => persona.id)).toContain("changli");
  });

  test("offers only the personas a pack actually shipped", () => {
    // A pack may be built with a subset of its manifest. Offering a persona
    // whose model is missing leaves the pet unable to render, so install state
    // decides, not the manifest.
    const partial = personaCatalog([
      { packId: "aki", personaIds: ["changli"] },
    ]);

    expect(partial.map((persona) => persona.id)).toEqual(["changli", "xiaozhu"]);
    expect(partial.map((persona) => persona.id)).not.toContain("aimisi");
  });

  test("ignores unknown or duplicated pack ids in install state", () => {
    // A stale setting must never break the catalog.
    expect(personaCatalog([{ packId: "nope", personaIds: ["x"] }])).toHaveLength(
      1,
    );
    // Built-in packs are already present and must not be added twice.
    expect(
      personaCatalog([{ packId: "ai-substitute", personaIds: ["xiaozhu"] }]),
    ).toHaveLength(1);
  });

  test("ignores persona ids a pack's manifest does not describe", () => {
    // The manifest supplies name, scale and clips, so an id it does not know
    // cannot be rendered and must not reach the selector.
    const catalog = personaCatalog([
      { packId: "aki", personaIds: ["changli", "not-a-persona"] },
    ]);

    expect(catalog.map((persona) => persona.id)).toEqual(["changli", "xiaozhu"]);
  });

  test("resolves personas from packs that are not installed", () => {
    // History written while aki was installed must still render its names.
    expect(personaById("changli").name.zh).toBe("长离");
    expect(personaById("changli").packId).toBe("aki");
  });

  test("falls back to the default persona for unknown ids", () => {
    expect(personaById("does-not-exist").id).toBe(DEFAULT_PERSONA_ID);
    // Legacy alias from before the persona was renamed.
    expect(personaById("pixel-glasses-chibi").id).toBe("xiaozhu");
  });

  test("maps standard and 小著 moods to playable clips", () => {
    expect(personaClipName("aimisi", "idle")).toBe("Idle");
    expect(personaClipName("aimisi", "thinking")).toBe("Thinking");
    expect(personaClipName("xiaozhu", "thinking")).toBe("Think");
    expect(personaClipName("xiaozhu", "talking")).toBe("Wave");
    expect(personaClipName("xiaozhu", "working")).toBe("Dance");
    expect(personaClipName("xiaozhu", "error")).toBe("Sad");
  });

  test("localizes persona and pack names", () => {
    expect(personaLabel(personaById("xiaozhu"), "zh-CN")).toBe("小著");
    expect(personaLabel(personaById("xiaozhu"), "en-US")).toBe("Xiaozhu");
    expect(packLabel(AI_SUBSTITUTE_PACK, "zh-CN")).toBe("小著");
    expect(packLabel(AKI_PACK, "zh-CN")).toBe("aki 团子");
    expect(packLabel(AKI_PACK, "en-US")).toBe("aki Dango");
  });

  test("looks packs up by id", () => {
    expect(packById("aki")).toBe(AKI_PACK);
    expect(packById("ai-substitute")).toBe(AI_SUBSTITUTE_PACK);
    expect(packById("missing")).toBeUndefined();
    expect(KNOWN_PACKS).toHaveLength(2);
  });

  test("grants the ncm skill only to 小著", () => {
    // convert_ncm is gated on this, so the declaration must live with the persona.
    expect(personaById("xiaozhu").skills).toEqual([
      { id: "xiaozhu", file: "ncmdump.md" },
    ]);
    expect(personaById("aimisi").skills).toBeUndefined();
  });
});
