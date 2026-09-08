import { expect, it } from "bun:test";
import * as THREE from "three";
import { disposeObject } from "./PetRendererResources";

it("disposes shared geometry, material and texture once across variants", () => {
  const geometry = new THREE.BoxGeometry();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  let geometries = 0;
  let materials = 0;
  let textures = 0;
  geometry.addEventListener("dispose", () => { geometries += 1; });
  material.addEventListener("dispose", () => { materials += 1; });
  texture.addEventListener("dispose", () => { textures += 1; });
  disposeObject(root);
  expect({ geometries, materials, textures }).toEqual({ geometries: 1, materials: 1, textures: 1 });
});