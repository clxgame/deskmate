import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { personaAssets } from "./personaAssets";
import { AI_SUBSTITUTE_PACK, DEFAULT_PERSONA_ID, personaById, personaClipName, personaLabel } from "./personaCatalog";

const id = "xiaozhu-sandaime";
const root = resolve(import.meta.dir, "../..");

test("offers the third generation in the built-in pack without changing the default", async () => {
  const persona = personaById(id);
  expect(persona.id).toBe(id);
  expect(persona.packId).toBe("ai-substitute");
  expect(AI_SUBSTITUTE_PACK.version).toBe("1.2.0");
  expect(DEFAULT_PERSONA_ID).toBe("xiaozhu");
  expect(persona.scale).toBe(1);
  expect(persona.embeddedMaterials).toBe(true);
  expect((await personaAssets(id)).modelUrl).toBe(`/personas/${id}/figure.glb`);
  expect(personaLabel(persona, "zh-CN")).toBe("小著（三代目）");
  expect(personaLabel(persona, "en-US")).toBe("Xiaozhu (3rd Gen)");
  expect(personaLabel(persona, "ja-JP")).toBe("小著（三代目）");
  expect(personaLabel(persona, "ko-KR")).toBe("샤오주 (3세대)");
});

test("keeps extra expressions out of the normal mood mapping", () => {
  const mappings = [
    ["idle", "等待"], ["thinking", "思考"], ["talking", "打招呼"],
    ["working", "跳舞"], ["error", "哭"],
  ] as const;
  for (const [mood, clip] of mappings) expect(personaClipName(id, mood)).toBe(clip);
  expect(Object.values(personaById(id).clips)).not.toContain("开心");
  expect(Object.values(personaById(id).clips)).not.toContain("争辩");
});

test("configures weighted poke reactions and all seven independent roots", () => {
  const persona = personaById(id);
  expect(persona.pokeClips).toEqual([
    { name: "打招呼", weight: 60 }, { name: "开心", weight: 20 }, { name: "争辩", weight: 20 },
  ]);
  expect(persona.clipRoots).toEqual({
    等待: "Sandaime_等待", 思考: "Sandaime_思考", 打招呼: "Sandaime_打招呼",
    跳舞: "Sandaime_跳舞", 哭: "Sandaime_哭", 开心: "Sandaime_开心", 争辩: "Sandaime_争辩",
  });
});

test("bundles matching third generation identity and declared music skill", async () => {
  const prompt = await Bun.file(resolve(root, `public/personas/${id}/persona.md`)).text();
  expect(prompt).toBe(await Bun.file(resolve(root, `src-tauri/resources/personas/${id}/persona.md`)).text());
  expect(prompt).toContain(`id: ${id}`);
  expect(prompt).toContain("display_name: 小著（三代目）");
  expect(personaById(id).skills).toEqual([{ id, file: "ncmdump.md" }]);
  expect(await Bun.file(resolve(root, `src-tauri/resources/skills/${id}/ncmdump.md`)).exists()).toBe(true);
});
