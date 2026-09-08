import { describe, expect, test } from "bun:test";
import {
  IDLE_FPS_CAP,
  findRootMotionNode,
  gateFrame,
  smoothTowards,
} from "./PetRenderer";
import * as THREE from "three";

/// Replays one second of animation at a given display rate, accumulating time
/// exactly as the render loop does, and returns the eased angle plus how many
/// frames actually rendered.
function replaySecond(displayFps: number, target: number): {
  readonly angle: number;
  readonly rendered: number;
} {
  const frameTime = 1 / displayFps;
  let accumulated = 0;
  let angle = 0;
  let rendered = 0;
  for (let frame = 0; frame < displayFps; frame += 1) {
    accumulated += frameTime;
    const delta = gateFrame(accumulated, false);
    if (delta === null) continue;
    accumulated = 0;
    rendered += 1;
    angle = smoothTowards(angle, target, delta);
  }
  return { angle, rendered };
}

describe("idle frame gate", () => {
  test("caps a 144Hz display near the idle rate while leaving 60Hz untouched", () => {
    // Given: the same one second of wall-clock time on two displays.
    const fast = replaySecond(144, 0.5);
    const nominal = replaySecond(60, 0.5);

    // Then: a high-refresh display is throttled to roughly the cap.
    expect(fast.rendered).toBeLessThanOrEqual(IDLE_FPS_CAP + 1);
    expect(fast.rendered).toBeGreaterThan(IDLE_FPS_CAP * 0.7);
    // And: a display already at the cap keeps every frame, so the gate's
    // tolerance does not halve its rate.
    expect(nominal.rendered).toBe(60);
  });

  test("renders a nudge at full display rate", () => {
    // Given: a frame that the idle gate would skip.
    const tinyDelta = 1 / 144;
    // Then: the gate defers it while idle.
    expect(gateFrame(tinyDelta, false)).toBeNull();
    // And: passes it straight through during a nudge, so the poke reaction
    // keeps the display's full smoothness.
    expect(gateFrame(tinyDelta, true)).toBe(tinyDelta);
  });

  test("carries skipped time forward so animation never loses duration", () => {
    // Given: three gated 144Hz frames' worth of accumulated time.
    const frameTime = 1 / 144;
    let accumulated = 0;
    let advanced = 0;
    for (let frame = 0; frame < 12; frame += 1) {
      accumulated += frameTime;
      const delta = gateFrame(accumulated, false);
      if (delta === null) continue;
      accumulated = 0;
      advanced += delta;
    }
    // Then: the time handed to the mixer plus the pending remainder equals the
    // real elapsed time, so clips never run slow.
    expect(advanced + accumulated).toBeCloseTo(frameTime * 12, 12);
  });
});

describe("mouse-follow easing is frame-rate independent", () => {
  test("converges to the same angle at 30fps and 144fps", () => {
    // Given: the same target and the same one second of real time.
    const target = 0.5;
    // When: eased at a low and a high frame rate.
    const slow = replaySecond(30, target);
    const fast = replaySecond(144, target);
    // Then: both reach the same angle, because the blend factor derives from
    // elapsed time rather than frame count.
    expect(slow.angle).toBeCloseTo(fast.angle, 3);
  });

  test("converges to the same angle across one long frame and many short ones", () => {
    // Given: one second delivered as a single frame versus 144 frames.
    const target = 0.5;
    const single = smoothTowards(0, target, 1);
    let many = 0;
    for (let frame = 0; frame < 144; frame += 1) {
      many = smoothTowards(many, target, 1 / 144);
    }
    // Then: the eased angle matches, so the cap cannot change the motion.
    expect(single).toBeCloseTo(many, 6);
  });

  test("approaches the target monotonically without overshooting it", () => {
    // Given: an eased angle starting away from its target.
    const target = 0.3;
    let angle = 0;
    let previous = -1;
    // When: advanced across many frames.
    for (let frame = 0; frame < 200; frame += 1) {
      angle = smoothTowards(angle, target, 1 / 60);
      // Then: it moves toward the target every frame and never passes it, so
      // the motion stays within a bounded rate.
      expect(angle).toBeGreaterThan(previous);
      expect(angle).toBeLessThanOrEqual(target);
      previous = angle;
    }
    expect(angle).toBeCloseTo(target, 4);
  });

  test("treats a negative delta as no elapsed time", () => {
    // Given: a clock that reports a non-positive delta.
    // Then: the angle holds instead of jumping backwards.
    expect(smoothTowards(0.2, 0.5, -1)).toBe(0.2);
    expect(smoothTowards(0.2, 0.5, 0)).toBe(0.2);
  });
});

describe("root motion node caching", () => {
  test("finds the Root node once for a loaded model", () => {
    // Given: a model with a nested Root node.
    const model = new THREE.Object3D();
    const limb = new THREE.Object3D();
    limb.name = "Limb";
    const root = new THREE.Object3D();
    root.name = "Root";
    limb.add(root);
    model.add(limb);

    // When: resolving the node at load time.
    const found = findRootMotionNode(model);

    // Then: the same node instance is returned, so per-frame traversal is
    // unnecessary.
    expect(found).toBe(root);
  });

  test("returns null for a model without root motion", () => {
    // Given: a model whose nodes are all ordinary.
    const model = new THREE.Object3D();
    const mesh = new THREE.Object3D();
    mesh.name = "Body";
    model.add(mesh);
    // Then: nothing is pinned, and the caller skips the work entirely.
    expect(findRootMotionNode(model)).toBeNull();
  });
});
