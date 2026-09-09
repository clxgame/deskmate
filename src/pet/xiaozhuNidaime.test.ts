import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { personaAssets } from "./personaAssets";
import { DEFAULT_PERSONA_ID, personaById, personaClipName } from "./personaCatalog";
import type { PetMood } from "../lib/petState";

const root = resolve(import.meta.dir, "../..");
const id = "xiaozhu-nidaime";

test("ships the approved rig and a playable expression clip for every mood", async () => {
  const persona = personaById(id);
  expect(persona.id).toBe(id);
  expect(persona.packId).toBe("ai-substitute");
  expect(persona.name.zh).toBe("小著（二代目）");
  expect(persona.embeddedMaterials).toBe(true);
  expect(DEFAULT_PERSONA_ID).toBe("xiaozhu");
  const assets = await personaAssets(id);
  if (assets.renderType !== "glb") throw new Error("Expected GLB assets");
  expect(assets.modelUrl).toBe(`/personas/${id}/figure.glb`);
  const bytes = await Bun.file(resolve(root, `public${assets.modelUrl}`)).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const moods: readonly PetMood[] = ["idle", "thinking", "talking", "working", "error"];
  expect(gltf.animations).toHaveLength(5);
  for (const mood of moods) {
    const clip = gltf.animations.find((entry) => entry.name === personaClipName(id, mood));
    if (clip === undefined) throw new Error(`Missing animation for ${mood}`);
    expect(clip.validate()).toBe(true);
    expect(clip.duration).toBeGreaterThan(0);
    expect(clip.tracks.some((track) => track.name.endsWith(".quaternion"))).toBe(true);
    expect(clip.tracks.some((track) => track.name.includes("morphTargetInfluences"))).toBe(true);
  }
  let skinnedMeshes = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof SkinnedMesh)) return;
    skinnedMeshes += 1;
    expect(object.skeleton.bones.length).toBeGreaterThan(0);
  });
  expect(skinnedMeshes).toBeGreaterThan(0);
});

test("bundles the second generation identity and declared music skill", async () => {
  const prompt = await Bun.file(resolve(root, `public/personas/${id}/persona.md`)).text();
  const bundled = await Bun.file(resolve(root, `src-tauri/resources/personas/${id}/persona.md`)).text();
  expect(prompt).toBe(bundled);
  expect(prompt).toContain(`id: ${id}`);
  expect(prompt).toContain("display_name: 小著（二代目）");
  const skills = personaById(id).skills;
  expect(skills).toEqual([{ id, file: "ncmdump.md" }]);
  for (const skill of skills ?? []) {
    expect(await Bun.file(resolve(root, `src-tauri/resources/skills/${skill.id}/${skill.file}`)).exists()).toBe(true);
  }
});
