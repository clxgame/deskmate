import * as THREE from "three";
import type { PetMood } from "../lib/petState";
import type { PersonaClips } from "./personaCatalog";

interface AnimationConfig {
  readonly clips: PersonaClips;
  readonly clipRoots?: Readonly<Record<string, string>>;
}
export interface WeightedClip {
  readonly name: string;
  readonly weight: number;
}
export function pickWeightedClip(clips: readonly WeightedClip[], value: number): string | undefined {
  const choices = clips.filter((clip) => Number.isFinite(clip.weight) && clip.weight > 0);
  const total = choices.reduce((sum, clip) => sum + clip.weight, 0);
  let threshold = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 0, 0, 1) * total;
  for (const clip of choices) {
    threshold -= clip.weight;
    if (threshold < 0) return clip.name;
  }
  return choices.at(-1)?.name;
}

export class PetAnimation {
  private readonly mixer: THREE.AnimationMixer;
  private readonly roots = new Map<string, THREE.Object3D>();
  private activeClip = "";
  private mood: PetMood = "idle";
  private pokeAction: THREE.AnimationAction | null = null;
  private disposed = false;

  constructor(private readonly model: THREE.Object3D, private readonly clips: readonly THREE.AnimationClip[], private readonly config: AnimationConfig) {
    this.mixer = new THREE.AnimationMixer(model);
    for (const [clip, name] of Object.entries(config.clipRoots ?? {})) {
      const root = model.getObjectByName(name);
      if (root !== undefined) this.roots.set(clip, root);
    }
    this.mixer.addEventListener("finished", this.onFinished);
  }
  get nudging(): boolean { return this.pokeAction !== null; }
  setMood(mood: PetMood): void {
    this.mood = mood;
    if (this.nudging && this.config.clipRoots !== undefined) return;
    if (this.nudging) this.activeClip = "";
    this.pokeAction = null;
    this.select(this.config.clips[mood], false);
  }
  playNudge(name: string): void {
    if (this.disposed || !this.clips.some((clip) => clip.name === name)) return;
    this.select(name, true);
  }
  update(delta: number): void {
    if (!this.disposed) this.mixer.update(delta);
  }
  dispose(): void {
    this.disposed = true;
    this.pokeAction = null;
    this.mixer.removeEventListener("finished", this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
  }
  private readonly onFinished = (event: { action: THREE.AnimationAction }): void => {
    if (this.disposed || event.action !== this.pokeAction) return;
    this.pokeAction = null;
    this.activeClip = "";
    this.select(this.config.clips[this.mood], false);
  };
  private select(name: string, once: boolean): void {
    if (this.disposed) return;
    const clip = this.clips.find((candidate) => candidate.name === name)
      ?? this.clips.find((candidate) => candidate.name === "Idle") ?? this.clips[0];
    if (clip === undefined || (!once && !this.nudging && this.activeClip === clip.name)) return;
    this.mixer.stopAllAction();
    for (const [clipName, root] of this.roots) root.visible = clipName === clip.name;
    const action = this.mixer.clipAction(clip).reset();
    action.clampWhenFinished = once;
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    this.pokeAction = once ? action : null;
    this.activeClip = clip.name;
    action.play();
    this.mixer.update(0);
  }
}

export function variantAnimationBounds(model: THREE.Object3D, clips: readonly THREE.AnimationClip[], roots: Readonly<Record<string, string>>): THREE.Box3 {
  const bounds = new THREE.Box3();
  const mixer = new THREE.AnimationMixer(model);
  for (const clip of clips) {
    const name = roots[clip.name];
    const root = name === undefined ? undefined : model.getObjectByName(name);
    if (root === undefined) continue;
    const action = mixer.clipAction(clip).reset().setLoop(THREE.LoopOnce, 1).play();
    action.clampWhenFinished = true;
    const times = new Set<number>([0, clip.duration]);
    for (let index = 1; index < 24; index += 1) times.add(clip.duration * index / 24);
    for (const time of [...times].sort((a, b) => a - b)) {
      mixer.setTime(time);
      model.updateMatrixWorld(true);
      root.traverse((node) => {
        if (node instanceof THREE.SkinnedMesh) {
          node.skeleton.update();
          node.computeBoundingBox();
        }
      });
      bounds.union(new THREE.Box3().setFromObject(root));
    }
    mixer.stopAllAction();
  }
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return bounds;
}
