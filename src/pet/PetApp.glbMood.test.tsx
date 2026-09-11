import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { PetMood } from "../lib/petState";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { PetRenderer } from "./PetRenderer";
import { manualClock } from "./petSleepTestClock";
import PetApp from "./PetApp";

const originalRenderer = PetRenderer;
class GpuBoundary {
  constructor(private readonly canvas: HTMLCanvasElement) { canvas.dataset.mood = "idle"; }
  async load(id: string) { this.canvas.dataset.persona = id; }
  setMood(mood: PetMood) { this.canvas.dataset.mood = mood; }
  setRenderTuning() {}
  setMouseFollowEnabled() {}
  dispose() {}
}
const settings = legacySettingsFixture({ personaId: "xiaozhu", mouseFollow: false });
beforeEach(() => {
  restoreTauriModuleFixture(); mockWindows("pet");
  mock.module("./PetRenderer", () => ({ PetRenderer: GpuBoundary }));
  mockIPC(command => {
    if (command === "get_settings") return settings;
    if (command === "get_pet_visibility") return true;
    return null;
  }, { shouldMockEvents: true });
});
afterEach(async () => { cleanup(); await act(async () => {}); clearMocks(); mock.module("./PetRenderer", () => ({ PetRenderer: originalRenderer })); });
for (const change of ["persona", "revision"]) test(`GLB retains true busy mood through ${change} replacement without another mood event`, async () => {
  // Given the real event subscriber and an already loaded GLB renderer.
  const time = manualClock(); const view = render(<PetApp clock={time.clock} />); await act(async () => {});
  await act(async () => { await emit("deskmate://pet-activity", { type: "start", sessionId: "session", requestId: "request", eventId: "start" }); await emit("deskmate://pet-mood", { mood: "thinking" }); });
  const before = view.container.querySelector("canvas"); expect(before?.getAttribute("data-mood")).toBe("thinking");
  // When the renderer is replaced, without sending another mood notification.
  await act(async () => {
    if (change === "persona") await emit("deskmate://settings-changed", { ...settings, personaId: "xiaozhu-nidaime" });
    else await emit("deskmate://pack-imported", { packId: "ai-substitute", personaIds: ["xiaozhu"], version: "1.1.0", sha256: "2".repeat(64) });
  });
  // Then the replacement immediately inherits thinking rather than its idle default.
  act(() => time.advance(90000));
  expect(view.container.querySelector(".pet-root")?.getAttribute("data-sleep-state")).toBe("awake");
  const after = view.container.querySelector("canvas"); expect(after === before).toBe(false); expect(after?.getAttribute("data-mood")).toBe("thinking");
});
