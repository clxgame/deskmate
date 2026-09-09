import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import type { PetMood } from "../lib/petState";
import { personaAssets } from "./personaAssets";
import { personaById } from "./personaCatalog";
import { ToonShading } from "./toonShader";
import { PetAnimation, pickWeightedClip, variantAnimationBounds } from "./PetAnimation";
import { PetRendererView, gateFrame, findRootMotionNode, type PetRenderTuning, type PetMouseTarget } from "./PetRendererView";
import { applyPersonaTextures, disposeObject, errorMessage, isVrm, poseArms, updateVrm } from "./PetRendererResources";
export { gateFrame, smoothTowards, mouseFollowPitchTarget, findRootMotionNode, IDLE_FPS_CAP } from "./PetRendererView";
export type { PetRenderTuning, PetMouseTarget } from "./PetRendererView";

export function nonIdleClipNames(personaId: string): readonly string[] {
  const clips = personaById(personaId).clips;
  return [...new Set([clips.thinking, clips.talking, clips.working, clips.error])].filter(
    (name) => name !== clips.idle,
  );
}

export function pickRandomClip(
  clipNames: readonly string[],
  randomValue: number,
): string | undefined {
  if (clipNames.length === 0) return undefined;
  const normalized = Number.isFinite(randomValue)
    ? THREE.MathUtils.clamp(randomValue, 0, 1)
    : 0;
  const index = Math.min(
    clipNames.length - 1,
    Math.floor(normalized * clipNames.length),
  );
  return clipNames[index];
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
  private readonly view: PetRendererView;
  private readonly clock = new THREE.Clock();
  private readonly loader = new GLTFLoader();
  private model: THREE.Object3D | null = null;
  private vrm: VRM | null = null;
  private toon: ToonShading | null = null;
  private animation: PetAnimation | null = null;
  private mood: PetMood = "idle";
  private renderTuning: PetRenderTuning = { outlineWidth: 0.0008, rimWidth: 0.1, rimIntensity: 0.3, specularIntensity: 0.05 };
  private rootMotionNode: THREE.Object3D | null = null;
  private pendingDelta = 0;
  private personaId = "xiaozhu";
  private loadToken = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.view = new PetRendererView(canvas);
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    window.addEventListener("resize", this.handleResize);
  }

  async load(requestedId: string): Promise<void> {
    const persona = personaById(requestedId);
    if (this.disposed) return;
    const token = ++this.loadToken;
    if (this.model !== null && this.personaId === persona.id) return;
    const assets = await personaAssets(persona.id);
    if (assets.renderType !== "glb") throw new Error("GIF personas require the GIF view");
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
    } else if (!persona.embeddedMaterials) {
      try {
        await applyPersonaTextures(model, assets);
      } catch (error: unknown) {
        throw new Error(
          `角色 ${persona.id} 贴图加载失败: ${errorMessage(error)}`,
        );
      }
    }

    const toon = vrm === null && !persona.embeddedMaterials ? new ToonShading() : null;
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
      disposeObject(model);
      return;
    }

    this.unloadModel();
    this.personaId = persona.id;
    this.view.baseModelRotation.copy(model.rotation);
    this.model = model;
    this.rootMotionNode = persona.clipRoots === undefined ? findRootMotionNode(model) : null;
    this.vrm = vrm;
    this.toon = toon;
    this.view.scene.add(model);
    const bounds = persona.clipRoots === undefined ? null : variantAnimationBounds(model, gltf.animations, persona.clipRoots);
    this.animation = vrm === null ? new PetAnimation(model, gltf.animations, persona) : null;
    this.animation?.setMood(this.mood);
    this.rootMotionNode?.position.set(0, 0, 0);
    poseArms(vrm);
    this.view.frameCamera(bounds ?? new THREE.Box3().setFromObject(model));
    try {
      this.view.renderer.setAnimationLoop(this.tick);
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
    this.animation?.setMood(mood);
  }

  playNudge(): void {
    if (this.animation === null || this.model === null) return;
    const persona = personaById(this.personaId);
    const random = Math.random();
    const name = persona.pokeClips === undefined
      ? pickRandomClip(nonIdleClipNames(this.personaId), random)
      : pickWeightedClip(persona.pokeClips, random);
    if (name !== undefined) this.animation.playNudge(name);
  }

  setScale(scale: number): void {
    if (Number.isFinite(scale)) this.view.resize();
  }

  setRenderTuning(tuning: PetRenderTuning): void {
    this.renderTuning = { ...tuning };
    this.applyRenderTuning(this.toon);
  }

  setMouseFollowEnabled(enabled: boolean): void { this.view.setMouseFollowEnabled(enabled); }
  setMouseTarget(target: PetMouseTarget): void { this.view.setMouseTarget(target); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.loadToken += 1;
    window.removeEventListener("resize", this.handleResize);
    this.view.renderer.setAnimationLoop(null);
    this.unloadModel();
    this.view.renderer.dispose();
    this.view.renderer.forceContextLoss();
  }

  private readonly handleResize = (): void => {
    this.view.resize();
  };

  private readonly tick = (): void => {
    if (this.disposed) return;
    // Accumulate real elapsed time so gated frames carry their time forward
    // instead of discarding it.
    this.pendingDelta += this.clock.getDelta();
    // A nudge is a one-shot interaction animation: render it at full rate so
    // poking the pet stays responsive.
    const delta = gateFrame(this.pendingDelta, this.animation?.nudging ?? false);
    if (delta === null) return;
    this.pendingDelta = 0;
    if (this.vrm !== null) {
      updateVrm(this.vrm, delta, this.clock.elapsedTime);
    } else {
      this.animation?.update(delta);
      this.rootMotionNode?.position.set(0, 0, 0);
    }
    this.view.updateMouseFollow(this.model, delta);
    if (this.model !== null) this.view.renderer.render(this.view.scene, this.view.camera);
  };

  private applyRenderTuning(toon: ToonShading | null): void {
    if (toon === null) return;
    toon.setOutlineWidth(this.renderTuning.outlineWidth);
    toon.setLighting({
      rimWidth: this.renderTuning.rimWidth,
      rimIntensity: this.renderTuning.rimIntensity,
      specularIntensity: this.renderTuning.specularIntensity,
    });
  }

  private unloadModel(): void {
    this.animation?.dispose();
    this.animation = null;
    this.toon?.dispose();
    this.toon = null;
    if (this.model !== null) {
      this.view.scene.remove(this.model);
      disposeObject(this.model);
    }
    this.model = null;
    this.rootMotionNode = null;
    this.vrm = null;
  }
}
