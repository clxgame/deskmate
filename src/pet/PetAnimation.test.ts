import { describe, expect, it } from "bun:test";
import * as THREE from "three";
import { PetAnimation, pickWeightedClip, variantAnimationBounds } from "./PetAnimation";

function fixture(variants = true) {
  const root = new THREE.Group();
  const names = ["wait", "think", "wave", "dance", "cry", "happy", "argue"];
  const clips = names.map((name) => {
    const node = new THREE.Group();
    node.name = `rig_${name}`;
    root.add(node);
    return new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack(`${node.name}.position[y]`, [0, 1], [0.065, 1])]);
  });
  const animation = new PetAnimation(root, clips, {
    clips: { idle: "wait", thinking: "think", talking: "wave", working: "dance", error: "cry" },
    ...(variants ? { clipRoots: Object.fromEntries(names.map((name) => [name, `rig_${name}`])) } : {}),
  });
  animation.setMood("idle");
  return { root, animation };
}

describe("PetAnimation real mixer", () => {
  it("shows only the selected variant and preserves its initial translation", () => {
    // Given
    const { root, animation } = fixture();
    // When
    animation.setMood("working");
    // Then
    expect(root.children.filter((node) => node.visible).map((node) => node.name)).toEqual(["rig_dance"]);
    expect(root.getObjectByName("rig_dance")?.position.y).toBeCloseTo(0.065);
  });
  it("finishes a poke before resuming the latest deferred mood", () => {
    // Given
    const { root, animation } = fixture();
    animation.playNudge("happy");
    animation.setMood("working");
    expect(root.getObjectByName("rig_happy")?.visible).toBe(true);
    // When
    animation.update(1.1);
    // Then
    expect(animation.nudging).toBe(false);
    expect(root.getObjectByName("rig_dance")?.visible).toBe(true);
    animation.update(1.1);
    expect(root.getObjectByName("rig_dance")?.visible).toBe(true);
  });
  it("restarts repeated pokes without a stale completion", () => {
    // Given
    const { root, animation } = fixture();
    animation.playNudge("happy");
    animation.update(0.7);
    animation.playNudge("argue");
    // When
    animation.update(0.4);
    // Then
    expect(animation.nudging).toBe(true);
    expect(root.getObjectByName("rig_argue")?.visible).toBe(true);
    animation.update(0.7);
    expect(root.getObjectByName("rig_wait")?.visible).toBe(true);
  });
  it("does not resume disposed animations", () => {
    // Given
    const { root, animation } = fixture();
    animation.playNudge("happy");
    // When
    animation.dispose();
    animation.update(2);
    // Then
    expect(animation.nudging).toBe(false);
    expect(root.getObjectByName("rig_wait")?.visible).toBe(false);
  });
  it("retains legacy mood interruption and visibility", () => {
    // Given
    const { root, animation } = fixture(false);
    animation.playNudge("happy");
    // When
    animation.setMood("working");
    // Then
    expect(animation.nudging).toBe(false);
    expect(root.children.every((node) => node.visible)).toBe(true);
  });
  it("selects weighted poke boundaries", () => {
    // Given
    const weights = [{ name: "wave", weight: 60 }, { name: "happy", weight: 20 }, { name: "argue", weight: 20 }];
    // When / Then
    expect([0, 0.599, 0.6, 0.799, 0.8, 1].map((value) => pickWeightedClip(weights, value))).toEqual(["wave", "wave", "happy", "happy", "argue", "argue"]);
  });
});


it("resumes a looping mood when legacy poke uses the same clip", () => {
  // Given
  const { root, animation } = fixture(false);
  animation.playNudge("dance");
  // When
  animation.setMood("working");
  animation.update(1.5);
  // Then
  expect(root.getObjectByName("rig_dance")?.position.y).toBeCloseTo(0.5325);
});

it("recomputes animated skin bounds and restores the original rig", () => {
  // Given
  const model = new THREE.Group();
  const variant = new THREE.Group();
  variant.name = "variant";
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const vertices = geometry.getAttribute("position").count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4));
  const weights = new Float32Array(vertices * 4);
  for (let i = 0; i < vertices; i += 1) weights[i * 4] = 1;
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  bone.name = "bone";
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  variant.add(mesh);
  model.add(variant);
  const clip = new THREE.AnimationClip("dance", 1, [new THREE.NumberKeyframeTrack("bone.position[x]", [0, 1], [0, 10])]);
  // When
  const bounds = variantAnimationBounds(model, [clip], { dance: "variant" });
  // Then
  expect(bounds.min.x).toBeCloseTo(-0.5);
  expect(bounds.max.x).toBeCloseTo(10.5);
  expect(bone.position.x).toBe(0);
});
