import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  VRMLoaderPlugin,
  VRMUtils,
  type VRM,
  VRMHumanBoneName,
} from "@pixiv/three-vrm";
import type { PetMood } from "../lib/petState";

/**
 * VRM mascot renderer on a transparent canvas.
 * Procedural animation only (no external clips): breathing sway, arm pose,
 * blinking, and mood-driven VRM expressions.
 */
export class PetRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private clock = new THREE.Clock();
  private vrm: VRM | null = null;
  private mood: PetMood = "idle";
  private nextBlink = 1 + Math.random() * 3;
  private blinkPhase = -1; // <0 idle, otherwise seconds into blink
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);

    const light = new THREE.DirectionalLight(0xffffff, Math.PI);
    light.position.set(1, 1, 1);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm as VRM;

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false;
    });

    // VRM0 models face +Z; rotate to face the camera consistently.
    VRMUtils.rotateVRM0(vrm);

    this.vrm = vrm;
    this.scene.add(vrm.scene);
    this.frameCamera();
    this.poseArms();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  setMood(mood: PetMood): void {
    this.mood = mood;
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    if (this.vrm) VRMUtils.deepDispose(this.vrm.scene);
    this.renderer.dispose();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Fit the whole body into view. */
  private frameCamera(): void {
    if (!this.vrm) return;
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const fov = (this.camera.fov * Math.PI) / 180;
    const dist = (size.y / 2 / Math.tan(fov / 2)) * 1.15;
    this.camera.position.set(center.x, center.y + size.y * 0.05, dist);
    this.camera.lookAt(center.x, center.y, 0);
  }

  /** Relax the default T-pose: drop arms to the sides. */
  private poseArms(): void {
    const humanoid = this.vrm?.humanoid;
    if (!humanoid) return;
    const l = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
    const r = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
    if (l) l.rotation.z = 1.15;
    if (r) r.rotation.z = -1.15;
  }

  private tick(): void {
    if (this.disposed || !this.vrm) return;
    const delta = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    const vrm = this.vrm;
    const humanoid = vrm.humanoid;

    // Breathing sway.
    const spine = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Spine);
    if (spine) {
      spine.rotation.z = Math.sin(t * 1.2) * 0.02;
      spine.rotation.x = Math.sin(t * 0.8) * 0.015;
    }

    // Head motion per mood.
    const head = humanoid?.getNormalizedBoneNode(VRMHumanBoneName.Head);
    if (head) {
      switch (this.mood) {
        case "thinking":
        case "working":
          head.rotation.z = Math.sin(t * 0.9) * 0.12;
          head.rotation.x = 0.08;
          break;
        case "talking":
          head.rotation.x = Math.sin(t * 4) * 0.03;
          head.rotation.z = Math.sin(t * 1.7) * 0.04;
          break;
        case "error":
          head.rotation.x = 0.18;
          head.rotation.z = 0;
          break;
        default:
          head.rotation.x = Math.sin(t * 0.6) * 0.03;
          head.rotation.z = Math.sin(t * 0.4) * 0.03;
      }
    }

    this.updateExpression(delta);

    vrm.update(delta);
    this.renderer.render(this.scene, this.camera);
  }

  private updateExpression(delta: number): void {
    const em = this.vrm?.expressionManager;
    if (!em) return;

    // Mood-driven base expression.
    const set = (name: string, v: number) => {
      if (em.getExpression(name)) em.setValue(name, v);
    };
    set("happy", this.mood === "talking" ? 0.6 : this.mood === "idle" ? 0.15 : 0);
    set("surprised", this.mood === "thinking" || this.mood === "working" ? 0.4 : 0);
    set("sad", this.mood === "error" ? 0.8 : 0);

    // Talking mouth flap.
    const t = this.clock.elapsedTime;
    set("aa", this.mood === "talking" ? Math.max(0, Math.sin(t * 8)) * 0.5 : 0);

    // Blink state machine (skip while "error" shows closed-ish eyes already).
    this.nextBlink -= delta;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += delta;
      const d = 0.15; // blink duration
      const k = this.blinkPhase / d;
      set("blink", k < 1 ? Math.sin(k * Math.PI) : 0);
      if (k >= 1) {
        this.blinkPhase = -1;
        this.nextBlink = 1.5 + Math.random() * 4;
      }
    } else if (this.nextBlink <= 0) {
      this.blinkPhase = 0;
    }
  }
}
