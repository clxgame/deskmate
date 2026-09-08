import * as THREE from "three";

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

const MOUSE_YAW_LIMIT = 0.55;
const MOUSE_PITCH_LIMIT = 0.3;
const MOUSE_YAW_GAIN = 0.45;
const MOUSE_PITCH_GAIN = 0.28;
const MOUSE_SMOOTHING = 10;

/// Idle rendering never exceeds this rate. The animation loop is driven by
/// requestAnimationFrame, which cannot outrun the display, so the effective
/// idle rate is min(refresh rate, IDLE_FPS_CAP).
export const IDLE_FPS_CAP = 60;
const IDLE_FRAME_INTERVAL = 1 / IDLE_FPS_CAP;
/// A display running at exactly the cap must not be gated: frame times jitter
/// slightly below the nominal interval, and comparing against the exact
/// interval would drop every other frame and halve the rate.
const FRAME_INTERVAL_TOLERANCE = 0.9;
const IDLE_FRAME_THRESHOLD = IDLE_FRAME_INTERVAL * FRAME_INTERVAL_TOLERANCE;

/// Decides whether enough time has accumulated to render. Returns the delta to
/// advance animation by, or `null` to skip this frame.
///
/// Skipped time is carried, never dropped, so the deltas handed to the
/// animation mixer always sum to real elapsed time regardless of the cap.
export function gateFrame(
  accumulated: number,
  uncapped: boolean,
): number | null {
  if (uncapped) return accumulated;
  return accumulated >= IDLE_FRAME_THRESHOLD ? accumulated : null;
}

/// Frame-rate independent exponential smoothing. The blend factor is derived
/// from elapsed time, so the same wall-clock duration converges to the same
/// angle whether it arrived as few long frames or many short ones. This keeps
/// the eased motion within a bounded rate at any frame rate.
export function smoothTowards(
  current: number,
  target: number,
  delta: number,
  smoothing: number = MOUSE_SMOOTHING,
): number {
  const blend = 1 - Math.exp(-Math.max(delta, 0) * smoothing);
  return current + (target - current) * blend;
}

export function mouseFollowPitchTarget(normalizedY: number): number {
  const y = Number.isFinite(normalizedY) ? normalizedY : 0;
  return THREE.MathUtils.clamp(
    y * MOUSE_PITCH_GAIN,
    -MOUSE_PITCH_LIMIT,
    MOUSE_PITCH_LIMIT,
  );
}

/// Finds the node whose baked root motion must be pinned to the origin, so the
/// pet animates in place. The result is stable for the lifetime of a model.
export function findRootMotionNode(
  model: THREE.Object3D,
): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  model.traverse((object) => {
    if (found === null && object.name === "Root") found = object;
  });
  return found;
}

export class PetRendererView {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  readonly baseModelRotation = new THREE.Euler();
  private mouseFollowEnabled = false;
  private mouseTargetYaw = 0;
  private mouseTargetPitch = 0;
  private mouseYaw = 0;
  private mousePitch = 0;
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

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x536070, 1.8));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(2, 4, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaecbff, 0.8);
    fill.position.set(-3, 2, 2);
    this.scene.add(fill);

    this.resize();
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

  updateMouseFollow(model: THREE.Object3D | null, delta: number): void {
    const yaw = this.mouseFollowEnabled ? this.mouseTargetYaw : 0;
    const pitch = this.mouseFollowEnabled ? this.mouseTargetPitch : 0;
    this.mouseYaw = smoothTowards(this.mouseYaw, yaw, delta);
    this.mousePitch = smoothTowards(this.mousePitch, pitch, delta);
    if (model !== null) {
      model.rotation.set(
        this.baseModelRotation.x + this.mousePitch,
        this.baseModelRotation.y + this.mouseYaw,
        this.baseModelRotation.z,
      );
    }
  }

  resize(): void {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  frameCamera(box: THREE.Box3): void {
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

}
