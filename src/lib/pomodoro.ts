import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface PomodoroPreferences {
  readonly focusMinutes: number;
  readonly breakMinutes: number;
}

export const DEFAULT_POMODORO_PREFERENCES = {
  focusMinutes: 25,
  breakMinutes: 5,
} as const satisfies PomodoroPreferences;

export type PomodoroPhase = "focus" | "break";
export type PomodoroStatus = "idle" | "running" | "paused" | "ready";

export interface PomodoroSnapshot {
  readonly phase: PomodoroPhase;
  readonly status: PomodoroStatus;
  readonly remainingMs: number;
  readonly durationMs: number;
  readonly preferences: PomodoroPreferences;
  readonly revision: number;
}

export const POMODORO_CHANGED_EVENT = "deskmate://pomodoro-changed";

export function getPomodoro(): Promise<PomodoroSnapshot> {
  return invoke<unknown>("pomodoro_get").then(parsePomodoroSnapshot);
}

export function startPomodoro(preferences: PomodoroPreferences): Promise<PomodoroSnapshot> {
  return invoke<unknown>("pomodoro_start", { preferences }).then(parsePomodoroSnapshot);
}

export function pausePomodoro(): Promise<PomodoroSnapshot> {
  return invoke<unknown>("pomodoro_pause").then(parsePomodoroSnapshot);
}

export function resetPomodoro(): Promise<PomodoroSnapshot> {
  return invoke<unknown>("pomodoro_reset").then(parsePomodoroSnapshot);
}

export function selectPomodoroPhase(
  phase: PomodoroPhase,
  preferences: PomodoroPreferences,
): Promise<PomodoroSnapshot> {
  return invoke<unknown>("pomodoro_select_phase", { phase, preferences }).then(parsePomodoroSnapshot);
}

export class PomodoroPayloadError extends Error {
  readonly code = "invalid_pomodoro_payload";

  constructor() {
    super("Invalid Pomodoro response");
    this.name = "PomodoroPayloadError";
  }
}

export function isPomodoroPreferences(value: unknown): value is PomodoroPreferences {
  return typeof value === "object" && value !== null
    && "focusMinutes" in value && typeof value.focusMinutes === "number"
    && Number.isInteger(value.focusMinutes) && value.focusMinutes >= 1 && value.focusMinutes <= 180
    && "breakMinutes" in value && typeof value.breakMinutes === "number"
    && Number.isInteger(value.breakMinutes) && value.breakMinutes >= 1 && value.breakMinutes <= 60;
}

export function parsePomodoroSnapshot(value: unknown): PomodoroSnapshot {
  if (typeof value !== "object" || value === null
    || !("phase" in value) || (value.phase !== "focus" && value.phase !== "break")
    || !("status" in value) || (value.status !== "idle" && value.status !== "running"
      && value.status !== "paused" && value.status !== "ready")
    || !("preferences" in value) || !isPomodoroPreferences(value.preferences)
    || !("remainingMs" in value) || typeof value.remainingMs !== "number"
    || !Number.isSafeInteger(value.remainingMs) || value.remainingMs < 0
    || !("durationMs" in value) || typeof value.durationMs !== "number"
    || !Number.isSafeInteger(value.durationMs) || value.durationMs < 60_000
    || value.durationMs > (value.phase === "focus" ? 180 : 60) * 60_000
    || value.remainingMs > value.durationMs
    || !("revision" in value) || typeof value.revision !== "number"
    || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new PomodoroPayloadError();
  }
  return {
    phase: value.phase, status: value.status, remainingMs: value.remainingMs,
    durationMs: value.durationMs, preferences: value.preferences, revision: value.revision,
  };
}

export function onPomodoroChanged(
  callback: (snapshot: PomodoroSnapshot) => void,
  onError: (error: PomodoroPayloadError) => void = (error) => console.error(error),
): Promise<UnlistenFn> {
  return listen<unknown>(POMODORO_CHANGED_EVENT, (event) => {
    let snapshot: PomodoroSnapshot;
    try {
      snapshot = parsePomodoroSnapshot(event.payload);
    } catch (error) {
      if (error instanceof PomodoroPayloadError) {
        onError(error);
        return;
      }
      throw error;
    }
    callback(snapshot);
  });
}