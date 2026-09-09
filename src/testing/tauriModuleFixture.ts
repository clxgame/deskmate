import { mock } from "bun:test";
import * as core from "@tauri-apps/api/core";
import * as event from "@tauri-apps/api/event";
import * as tauriWindow from "@tauri-apps/api/window";

const originalCore = { ...core } as const;
const originalEvent = { ...event } as const;
export const originalTauriWindow = { ...tauriWindow } as const;

export function restoreTauriModuleFixture(): void {
  mock.module("@tauri-apps/api/core", () => originalCore);
  mock.module("@tauri-apps/api/event", () => originalEvent);
}
