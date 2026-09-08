import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { AnimationMixer, MeshStandardMaterial, SkinnedMesh, Texture } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { personaById } from "./personaCatalog";

const file = Bun.file(resolve(import.meta.dir, "../../public/personas/xiaozhu-sandaime/figure.glb"));
const expectedDurations = { 等待: 4.966667, 思考: 3.133333, 打招呼: 1.8, 跳舞: 2.266667, 哭: 1.633333, 开心: 1.4, 争辩: 7.833333 } as const;

test("preserves all seven authored rigs and binds each clip only to its own variant", async () => {
  const loader = new GLTFLoader();
  // Texture pixels are checked in the browser; this CPU test exercises real geometry and animation parsing.
  loader.register(() => ({ name: "cpu_texture_fixture", loadTexture: async () => new Texture() }));
  const gltf = await loader.parseAsync(await file.arrayBuffer(), "");
  const roots = personaById("xiaozhu-sandaime").clipRoots;
  if (roots === undefined) throw new Error("Missing variant configuration");
  expect(gltf.scene.children).toHaveLength(7);
  expect(gltf.animations).toHaveLength(7);
  expect(file.size).toBeLessThan(80 * 1024 * 1024);
  const nodeNames: string[] = [];
  gltf.scene.traverse((node) => nodeNames.push(node.name));
  expect(new Set(nodeNames).size).toBe(nodeNames.length);
  for (const [name, duration] of Object.entries(expectedDurations)) {
    const rootName = roots[name];
    if (rootName === undefined) throw new Error(`Missing root for ${name}`);
    const variant = gltf.scene.getObjectByName(rootName);
    const clip = gltf.animations.find((candidate) => candidate.name === name);
    if (variant === undefined || clip === undefined) throw new Error(`Missing authored action ${name}`);
    expect(clip.validate()).toBe(true);
    expect(clip.duration).toBeCloseTo(duration, 4);
    expect(clip.tracks.every((track) => track.name.startsWith(`${rootName}__`))).toBe(true);
    const mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(clip).play();
    mixer.update(duration / 2);
    gltf.scene.updateMatrixWorld(true);
    let meshes = 0;
    variant.traverse((node) => {
      if (!(node instanceof SkinnedMesh)) return;
      meshes += 1;
      expect(node.skeleton.bones).toHaveLength(44);
      expect(node.geometry.index?.count).toBe(77_090 * 3);
      expect(node.material).toBeInstanceOf(MeshStandardMaterial);
      node.computeBoundingBox();
      expect(node.boundingBox?.isEmpty()).toBe(false);
      expect(node.boundingBox?.min.toArray().every(Number.isFinite)).toBe(true);
      expect(node.boundingBox?.max.toArray().every(Number.isFinite)).toBe(true);
      for (const bone of node.skeleton.bones) expect(bone.name.startsWith(`${rootName}__`)).toBe(true);
    });
    expect(meshes).toBe(1);
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
});