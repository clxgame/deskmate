import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";
import type { PetMood } from "../lib/petState";
import { personaAssets, type PersonaAssets } from "./personaAssets";
import { personaById, personaClipName } from "./personaCatalog";
import { ToonShading } from "./toonShader";

type StandardMaterial = THREE.MeshStandardMaterial;

export interface PetRenderTuning {
  outlineWidth: number;
  rimWidth: number;
  rimIntensity: number;
  specularIntensity: number;
}

export interface PetMouseTarget {
  x: number;
  y: number;
}

const DEFAULT_RENDER_TUNING: PetRenderTuning = {
  outlineWidth: 0.0073,
  rimWidth: 0.4,
  rimIntensity: 1,
  specularIntensity: 0.5,
};

const MOUSE_YAW_LIMIT = 0.55;
const MOUSE_PITCH_LIMIT = 0.3;
const MOUSE_YAW_GAIN = 0.45;
const MOUSE_PITCH_GAIN = 0.28;
const MOUSE_SMOOTHING = 10;

export function mouseFollowPitchTarget(normalizedY: number): number {
  const y = Number.isFinite(normalizedY) ? normalizedY : 0;
  return THREE.MathUtils.clamp(
    y * MOUSE_PITCH_GAIN,
    -MOUSE_PITCH_LIMIT,
    MOUSE_PITCH_LIMIT,
  );
}

function isVrm(value: unknown): value is VRM {
  return (
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function expressionTagForMood(mood: PetMood): number {
  switch (mood) {
    case "idle":
      return 0;
    case "thinking":
      return 6;
    case "talking":
      return 3;
    case "working":
      return 6;
    case "error":
      return 1;
  }
  return 0;
}

export class PetRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private model: THREE.Object3D | null = null;
  private vrm: VRM | null = null;
  private toon: ToonShading | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private clips: readonly THREE.AnimationClip[] = [];
  private activeClip = "";
  private mood: PetMood = "idle";
  private renderTuning: PetRenderTuning = { ...DEFAULT_RENDER_TUNING };
  private mouseFollowEnabled = false;
  private mouseTargetYaw = 0;
  private mouseTargetPitch = 0;
  private mouseYaw = 0;
  private mousePitch = 0;
  private readonly baseModelRotation = new THREE.Euler();
  private personaId = "xiaozhu";
  private loadToken = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536070, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2, 4, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaecbff, 0.8);
    fill.position.set(-3, 2, 2);
    this.scene.add(fill);

    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.resize();
    window.addEventListener("resize", this.handleResize);
  }

  async load(requestedId: string): Promise<void> {
    const token = ++this.loadToken;
    const persona = personaById(requestedId);
    if (this.model !== null && this.personaId === persona.id) return;
    // Built-in personas load from the bundled frontend; imported packs come off
    // disk through the asset protocol.
    const assets = await personaAssets(persona.id);
    let gltf: Awaited<ReturnType<GLTFLoader["loadAsync"]>>;
    try {
      gltf = await this.loader.loadAsync(assets.modelUrl);
    } catch (error: unknown) {
      throw new Error(`模型 ${persona.id} 加载失败: ${errorMessage(error)}`);
    }
    const vrm = isVrm(gltf.userData.vrm) ? gltf.userData.vrm : null;
    const model = vrm?.scene ?? gltf.scene;
    if (model === undefined) throw new Error("3D model has no scene");

    model.scale.setScalar(persona.scale);
    model.traverse((object) => {
      object.frustumCulled = false;
    });
    if (vrm !== null) {
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.combineSkeletons(gltf.scene);
      VRMUtils.rotateVRM0(vrm);
    } else {
      try {
        await this.applyPersonaTextures(model, assets);
      } catch (error: unknown) {
        throw new Error(
          `角色 ${persona.id} 贴图加载失败: ${errorMessage(error)}`,
        );
      }
    }

    const toon = vrm === null ? new ToonShading() : null;
    if (toon !== null) {
      try {
        toon.attach(model);
        toon.setEnabled(toon.available);
        toon.setExpression(expressionTagForMood(this.mood));
        this.applyRenderTuning(toon);
      } catch (error: unknown) {
        throw new Error(
          `角色 ${persona.id} 卡通着色失败: ${errorMessage(error)}`,
        );
      }
    }

    if (this.disposed || token !== this.loadToken) {
      toon?.dispose();
      this.disposeObject(model);
      return;
    }

    this.unloadModel();
    this.personaId = persona.id;
    this.baseModelRotation.copy(model.rotation);
    this.model = model;
    this.vrm = vrm;
    this.toon = toon;
    this.clips = gltf.animations;
    this.scene.add(model);
    this.frameCamera(model);
    this.setupAnimation();
    this.poseArms();
    try {
      this.renderer.setAnimationLoop(this.tick);
      this.tick();
    } catch (error: unknown) {
      throw new Error(
        `角色 ${persona.id} 首次渲染失败: ${errorMessage(error)}`,
      );
    }
  }

  setMood(mood: PetMood): void {
    this.mood = mood;
    this.toon?.setExpression(expressionTagForMood(mood));
    if (this.vrm === null)
      this.selectClip(personaClipName(this.personaId, mood));
  }

  setScale(scale: number): void {
    if (Number.isFinite(scale)) this.resize();
  }

  setRenderTuning(tuning: PetRenderTuning): void {
    this.renderTuning = { ...tuning };
    this.applyRenderTuning(this.toon);
  }

  setMouseFollowEnabled(enabled: boolean): void {
    this.mouseFollowEnabled = enabled;
    if (!enabled) {
      this.mouseTargetYaw = 0;
      this.mouseTargetPitch = 0;
    }
  }

  setMouseTarget(target: PetMouseTarget): void {
    if (!this.mouseFollowEnabled) return;
    const x = Number.isFinite(target.x) ? target.x : 0;
    this.mouseTargetYaw = THREE.MathUtils.clamp(
      x * MOUSE_YAW_GAIN,
      -MOUSE_YAW_LIMIT,
      MOUSE_YAW_LIMIT,
    );
    this.mouseTargetPitch = mouseFollowPitchTarget(target.y);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken += 1;
    window.removeEventListener("resize", this.handleResize);
    this.renderer.setAnimationLoop(null);
    this.unloadModel();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  private readonly handleResize = (): void => {
    this.resize();
  };

  private readonly tick = (): void => {
    if (this.disposed) return;
    const delta = this.clock.getDelta();
    if (this.vrm !== null) {
      this.updateVrm(delta);
    } else {
      this.mixer?.update(delta);
      this.stripRootMotion();
    }
    this.updateMouseFollow(delta);
    if (this.model !== null) this.renderer.render(this.scene, this.camera);
  };

  private updateMouseFollow(delta: number): void {
    const blend = 1 - Math.exp(-Math.max(delta, 0) * MOUSE_SMOOTHING);
    const yaw = this.mouseFollowEnabled ? this.mouseTargetYaw : 0;
    const pitch = this.mouseFollowEnabled ? this.mouseTargetPitch : 0;
    this.mouseYaw = THREE.MathUtils.lerp(this.mouseYaw, yaw, blend);
    this.mousePitch = THREE.MathUtils.lerp(this.mousePitch, pitch, blend);
    if (this.model !== null) {
      this.model.rotation.set(
        this.baseModelRotation.x + this.mousePitch,
        this.baseModelRotation.y + this.mouseYaw,
        this.baseModelRotation.z,
      );
    }
  }

  private applyRenderTuning(toon: ToonShading | null): void {
    if (toon === null) return;
    toon.setOutlineWidth(this.renderTuning.outlineWidth);
    toon.setLighting({
      rimWidth: this.renderTuning.rimWidth,
      rimIntensity: this.renderTuning.rimIntensity,
      specularIntensity: this.renderTuning.specularIntensity,
    });
  }

  private resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private frameCamera(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const heightDistance = size.y / (2 * Math.tan(fov / 2));
    const widthDistance = size.x / (2 * Math.tan(fov / 2) * this.camera.aspect);
    const distance = Math.max(heightDistance, widthDistance, size.z) * 1.55;
    this.camera.near = Math.max(distance / 1000, 0.001);
    this.camera.far = Math.max(distance * 100, 100);
    this.camera.updateProjectionMatrix();
    this.camera.position.set(
      center.x,
      center.y + size.y * 0.03,
      center.z + distance,
    );
    this.camera.lookAt(center.x, center.y + size.y * 0.02, center.z);
  }

  private setupAnimation(): void {
    if (this.model === null || this.clips.length === 0) return;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.selectClip(personaClipName(this.personaId, this.mood));
  }

  private selectClip(name: string): void {
    if (this.mixer === null || this.model === null || this.clips.length === 0)
      return;
    const clip =
      this.clips.find((candidate) => candidate.name === name) ??
      this.clips.find((candidate) => candidate.name === "Idle") ??
      this.clips[0];
    if (clip === undefined || clip.name === this.activeClip) return;
    this.mixer.stopAllAction();
    const action = this.mixer.clipAction(clip);
    action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
    this.mixer.update(0);
    this.stripRootMotion();
    this.activeClip = clip.name;
  }

  private stripRootMotion(): void {
    this.model?.traverse((object) => {
      if (object.name === "Root") object.position.set(0, 0, 0);
    });
  }

  private poseArms(): void {
    const humanoid = this.vrm?.humanoid;
    if (humanoid === undefined) return;
    const left = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const right = humanoid.getNormalizedBoneNode(
      VRMHumanBoneName.RightUpperArm,
    );
    if (left !== null) left.rotation.z = 1.15;
    if (right !== null) right.rotation.z = -1.15;
  }

  private updateVrm(delta: number): void {
    if (this.vrm === null) return;
    const t = this.clock.elapsedTime;
    const spine = this.vrm.humanoid?.getNormalizedBoneNode(
      VRMHumanBoneName.Spine,
    );
    if (spine !== null && spine !== undefined) {
      spine.rotation.z = Math.sin(t * 1.2) * 0.02;
      spine.rotation.x = Math.sin(t * 0.8) * 0.015;
    }
    const head = this.vrm.humanoid?.getNormalizedBoneNode(
      VRMHumanBoneName.Head,
    );
    if (head !== null && head !== undefined) {
      head.rotation.z = Math.sin(t * 0.5) * 0.03;
      head.rotation.x = Math.sin(t * 0.7) * 0.03;
    }
    this.vrm.update(delta);
  }

  private async applyPersonaTextures(
    root: THREE.Object3D,
    assets: PersonaAssets,
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
            .then((url) => this.applyTexture(material, textureLoader, url)),
        );
      }
    });
    await Promise.all(tasks);
  }

  private async applyTexture(
    material: StandardMaterial,
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
    } catch {
      return;
    }
  }

  private unloadModel(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.toon?.dispose();
    this.toon = null;
    if (this.model !== null) {
      this.scene.remove(this.model);
      this.disposeObject(this.model);
    }
    this.model = null;
    this.vrm = null;
    this.clips = [];
    this.activeClip = "";
  }

  private disposeObject(root: THREE.Object3D): void {
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      for (const material of materialsOf(object)) {
        material.dispose();
        if (material instanceof THREE.MeshStandardMaterial) {
          material.map?.dispose();
          material.normalMap?.dispose();
        }
      }
    });
  }
}
