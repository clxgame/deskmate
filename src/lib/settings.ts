import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ThemeId } from "../settings/theme";

/** A scheduled task: at `time` (HH:MM, daily), auto-send `prompt` to the AI. */
export interface ScheduledTask {
  id: string;
  time: string;
  prompt: string;
  enabled: boolean;
}

export interface PetPosition {
  readonly x: number;
  readonly y: number;
}

/** Mirror of Rust `Settings` (serde camelCase). */
export interface Settings {
  // 通用
  autostart: boolean;
  language: string;
  theme: ThemeId;
  // AI
  providerId: string;
  modelId: string;
  yolo: boolean;
  baseUrl: string;
  apiKey: string;
  // 小组件
  petScale: number;
  outlineWidth: number;
  rimWidth: number;
  rimIntensity: number;
  specularIntensity: number;
  petVisible: boolean;
  alwaysOnTop: boolean;
  petPosition?: PetPosition | null;
  scheduledTasks: ScheduledTask[];
  // 快捷键
  shortcutToggleChat: string;
  shortcutTogglePet: string;
  // 账号
  personaId: string;
  mouseFollow: boolean;
  userName: string;
  // 记忆
  memoryAutoExtract: boolean;
  memoryAiUse: boolean;
  // 更新
  updateRepo: string;
}

export function getSettings(): Promise<Settings> {
  return invoke<Settings>("get_settings");
}

export function setSettings(settings: Settings): Promise<void> {
  return invoke<void>("set_settings", { settings });
}

export function getAppVersion(): Promise<string> {
  return invoke<string>("app_version");
}

export function hideSettingsWindow(): Promise<void> {
  return invoke<void>("hide_settings");
}

/** Verify the gateway API key; resolves to the model count (or null). */
export function verifyApiKey(
  baseUrl: string,
  apiKey: string,
): Promise<number | null> {
  return invoke<number | null>("verify_api_key", { baseUrl, apiKey });
}

export interface AiUsageModel {
  readonly name: string;
  readonly costCny: number;
  readonly requests: number;
}

export interface AiUsage {
  readonly remainingCny: number;
  readonly limitCny: number;
  readonly remainingPct: number;
  readonly daysUntilReset: number;
  readonly todayCostCny: number;
  readonly todayRequests: number;
  readonly topModels: readonly AiUsageModel[];
}

export function getAiUsage(baseUrl: string, apiKey: string): Promise<AiUsage> {
  return invoke<AiUsage>("fetch_ai_usage", { baseUrl, apiKey });
}

/** Fires in every window whenever settings are saved. */
export function onSettingsChanged(
  cb: (s: Settings) => void,
): Promise<UnlistenFn> {
  return listen<Settings>("deskmate://settings-changed", (e) => cb(e.payload));
}

export function onPetScalePreview(
  cb: (scale: number) => void,
): Promise<UnlistenFn> {
  return listen<number>("deskmate://pet-scale-preview", (e) => cb(e.payload));
}

export function emitPetScalePreview(scale: number): Promise<void> {
  return emit("deskmate://pet-scale-preview", scale);
}

export function previewPetScale(scale: number): Promise<void> {
  return invoke("preview_pet_scale", { scale });
}

/** Fires (from the Rust scheduler) when a scheduled task is due. */
export function onScheduledTask(
  cb: (task: ScheduledTask) => void,
): Promise<UnlistenFn> {
  return listen<ScheduledTask>("deskmate://scheduled-task", (e) =>
    cb(e.payload),
  );
}

/**
 * Fires when bundled personas/skills could not be copied into the app data
 * dir. Without this the failure only shows up as an unexplained empty persona
 * list, so the reason is surfaced to the user instead.
 */
export function onResourceError(
  cb: (reason: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("deskmate://resource-error", (e) => cb(e.payload));
}

// ---- AI provider/model listing straight from the opencode sidecar ----

export interface ProviderModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
}

export function modelsMatchVerification(
  models: ProviderModel[],
  _count: number | null,
): boolean {
  return models.some((model) => model.providerId === "yume");
}

export async function listModels(): Promise<ProviderModel[]> {
  const base = await invoke<string>("sidecar_base_url");
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const res = await fetch(`${base}/config/providers`);
      if (!res.ok) throw new Error(`providers -> ${res.status}`);
      const data = (await res.json()) as {
        providers?: {
          id: string;
          name: string;
          models?: Record<string, { id?: string; name?: string }>;
        }[];
      };
      const out: ProviderModel[] = [];
      for (const p of data.providers ?? []) {
        for (const [id, m] of Object.entries(p.models ?? {})) {
          out.push({
            providerId: p.id,
            providerName: p.name,
            modelId: id,
            modelName: m.name ?? id,
          });
        }
      }
      return out;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error(String(error));
      if (attempt < 19) {
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
    }
  }
  throw lastError ?? new Error("providers unavailable");
}
