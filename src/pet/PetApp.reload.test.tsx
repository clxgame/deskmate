import { afterEach, beforeEach, expect, test } from "bun:test";
import { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { importPack } from "../lib/packs";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { legacySettingsFixture } from "../testing/settingsFixtures";
import PetApp from "./PetApp";
import { parseFigure2dConfig } from "./figure2d";
import type { LoadedGifPersona } from "./gifAssets";
import config from "../../public/personas/xiaoxiongchong/figure2d.json";

const settings = legacySettingsFixture({ personaId: "xiaoxiongchong", petScale: 0.5 });
const receipt = { packId: "xiaoxiongchong", personaIds: ["xiaoxiongchong"], version: "1.1.0", sha256: "2".repeat(64) };
const v2: LoadedGifPersona = { config: parseFigure2dConfig(config), urls: { idle: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#idle", thinking: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#thinking", working: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#working", talking: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#talking", success: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#success", error: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#error", leaving: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#leaving" } };
const v1: LoadedGifPersona = { ...v2, config: parseFigure2dConfig({ schemaVersion: 1, canvas: config.canvas, feedback: config.feedback, leaving: config.leaving, thinkingEscalationMs: 8000, animations: Object.fromEntries(Object.entries(config.animations).map(([state, action]) => [state, { file: action.file, scale: 1, offsetY: 0 }])) }) };
beforeEach(() => {
  restoreTauriModuleFixture(); mockWindows("pet");
  mockIPC((command) => {
    if (command === "import_pack") throw new Error("invalid archive");
    if (command === "get_settings") return settings;
    if (command === "get_pet_visibility") return true;
    if (command === "plugin:window|cursor_position") return { x: -100, y: -100 };
    if (command === "plugin:window|outer_position") return { x: 0, y: 0 };
    if (command === "plugin:window|scale_factor") return 1;
    return null;
  }, { shouldMockEvents: true });
});
afterEach(async () => { cleanup(); await act(async () => {}); clearMocks(); });

test("same-ID successful pack upgrade replaces active image and geometry under StrictMode", async () => {
  // Given an active legacy image in the real PetApp.
  let installed = v1;
  const load = async () => installed;
  const view = render(<StrictMode><PetApp gifLoad={load} /></StrictMode>);
  await act(async () => {});
  await act(async () => { await emit("deskmate://pet-activity", { type: "start", sessionId: "s", requestId: "r", eventId: "1" }); });
  const oldImage = view.container.querySelector("img.gif-pet-image");
  expect(oldImage?.getAttribute("style")).toContain("160px");
  // When native installation succeeds for the same active persona.
  installed = v2;
  await act(async () => { await emit("deskmate://pack-imported", receipt); });
  // Then the old image instance is gone and calibrated geometry is active.
  const image = view.container.querySelector("img.gif-pet-image");
  expect(image === oldImage).toBe(false);
  expect(image?.getAttribute("style")).not.toBe(oldImage?.getAttribute("style"));
  expect(["thinking", "working"]).toContain(image?.getAttribute("data-state") ?? "");
});

test("failed import and unrelated pack/settings keep the working image usable", async () => {
  // Given a working legacy persona.
  const load = async () => v1;
  const view = render(<PetApp gifLoad={load} />);
  await act(async () => {});
  const image = view.container.querySelector("img.gif-pet-image");
  // When import fails, then an unrelated pack and appearance settings change.
  await expect(importPack("broken.dmpack")).rejects.toThrow("invalid archive");
  await act(async () => { await emit("deskmate://pack-imported", { ...receipt, packId: "aki" }); await emit("deskmate://settings-changed", { ...settings, theme: "light" }); });
  // Then active playback and geometry remain on the same usable image.
  expect(view.container.querySelector("img.gif-pet-image") === image).toBe(true);
  expect(view.container.querySelector("[role=alert]")?.textContent ?? null).toBeNull();
});




test("rapid same-pack revisions abort old loads and cannot restore stale geometry", async () => {
  // Given an active image and controllable subsequent asset reads.
  const pending: { readonly resolve: (data: LoadedGifPersona) => void; readonly signal: AbortSignal; readonly revision: string | undefined }[] = [];
  let initial = true;
  const load = (_id: string, signal: AbortSignal, revision?: string) => initial ? Promise.resolve(v1) : new Promise<LoadedGifPersona>((resolve) => pending.push({ resolve, signal, revision }));
  const view = render(<PetApp gifLoad={load} />);
  await act(async () => {});
  initial = false;
  // When B and then A are installed before B finishes loading.
  await act(async () => { await emit("deskmate://pack-imported", { ...receipt, sha256: "B".repeat(64) }); });
  await act(async () => { await emit("deskmate://pack-imported", { ...receipt, sha256: "A".repeat(64) }); });
  await act(async () => { pending[1]?.resolve(v2); });
  const current = view.container.querySelector("img.gif-pet-image");
  await act(async () => { pending[0]?.resolve(v1); });
  // Then the stale read was aborted and cannot overwrite the current image.
  expect(pending.map(({ revision, signal }) => [revision, signal.aborted])).toEqual([["B".repeat(64), true], ["A".repeat(64), false]]);
  expect(view.container.querySelector("img.gif-pet-image") === current).toBe(true);
  expect(current !== null).toBe(true);
});
