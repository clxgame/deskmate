import * as THREE from "three";
import { VRMHumanBoneName, type VRM } from "@pixiv/three-vrm";
import type { GlbPersonaAssets } from "./personaAssets";
export function isVrm(value: unknown): value is VRM {  return (
    value !== null &&
    typeof value === "object" &&
    "scene" in value &&
    "humanoid" in value
  );
}

function materialsOf(object: THREE.Object3D): readonly THREE.Material[] {
  if (!(object instanceof THREE.Mesh)) return [];
  return Array.isArray(object.material) ? object.material : [object.material];
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function poseArms(vrm: VRM | null): void {
    const humanoid = vrm?.humanoid;
    if (humanoid === undefined) return;
    const left = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const right = humanoid.getNormalizedBoneNode(
      VRMHumanBoneName.RightUpperArm,
    );
    if (left !== null) left.rotation.z = 1.15;
    if (right !== null) right.rotation.z = -1.15;
  }

export function updateVrm(vrm: VRM, delta: number, t: number): void {
    const spine = vrm.humanoid?.getNormalizedBoneNode(
      VRMHumanBoneName.Spine,
    );
    if (spine !== null && spine !== undefined) {
      spine.rotation.z = Math.sin(t * 1.2) * 0.02;
      spine.rotation.x = Math.sin(t * 0.8) * 0.015;
    }
    const head = vrm.humanoid?.getNormalizedBoneNode(
      VRMHumanBoneName.Head,
    );
    if (head !== null && head !== undefined) {
      head.rotation.z = Math.sin(t * 0.5) * 0.03;
      head.rotation.x = Math.sin(t * 0.7) * 0.03;
    }
    vrm.update(delta);
  }

export async function applyPersonaTextures(
    root: THREE.Object3D,
    assets: GlbPersonaAssets,
  ): Promise<void> {
    const textureLoader = new THREE.TextureLoader();
    const tasks: Promise<void>[] = [];
    root.traverse((object) => {
      for (const material of materialsOf(object)) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (material.map !== null) continue;
        const slot = material.name.replace(/^MI_/, "");
        if (slot.length === 0) continue;
        tasks.push(
          assets
            .textureUrl(slot)
            .then((url) => applyTexture(material, textureLoader, url)),
        );
      }
    });
    await Promise.all(tasks);
  }

async function applyTexture(
    material: THREE.MeshStandardMaterial,
    loader: THREE.TextureLoader,
    url: string,
  ): Promise<void> {
    try {
      const texture = await loader.loadAsync(url);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.color.setScalar(1);
      material.needsUpdate = true;
    } catch (error: unknown) {
      if (error instanceof Error || error instanceof Event) return;
      throw error;
    }
  }

export function disposeObject(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const bitmaps = new Set<ImageBitmap>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.add(object.geometry);
    for (const material of materialsOf(object)) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    const data: unknown = texture.source.data;
    if (typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap) bitmaps.add(data);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}
