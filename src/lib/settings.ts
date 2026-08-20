import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** A scheduled task: at `time` (HH:MM, daily), auto-send `prompt` to the AI. */
export interface ScheduledTask {
  id: string;
  time: string;
  prompt: string;
  enabled: boolean;
}

/** Mirror of Rust `Settings` (serde camelCase). */
export interface Settings {
  // 通用
  autostart: boolean;
  language: string;
  // AI
  providerId: string;
  modelId: string;
  yolo: boolean;
  baseUrl: string;
  apiKey: string;
  // 小组件
  petScale: number;
  petVisible: boolean;
  alwaysOnTop: boolean;
  scheduledTasks: ScheduledTask[];
  // 快捷键
  shortcutToggleChat: string;
  shortcutTogglePet: string;
  // 账号
  personaId: string;
  userName: string;
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

/** Fires in every window whenever settings are saved. */
export function onSettingsChanged(
  cb: (s: Settings) => void,
): Promise<UnlistenFn> {
  return listen<Settings>("deskmate://settings-changed", (e) => cb(e.payload));
}

/** Fires (from the Rust scheduler) when a scheduled task is due. */
export function onScheduledTask(
  cb: (task: ScheduledTask) => void,
): Promise<UnlistenFn> {
  return listen<ScheduledTask>("deskmate://scheduled-task", (e) =>
    cb(e.payload),
  );
}

// ---- AI provider/model listing straight from the opencode sidecar ----

export interface ProviderModel {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
}

export async function listModels(): Promise<ProviderModel[]> {
  const base = await invoke<string>("sidecar_base_url");
  const res = await fetch(`${base}/config/providers`);
  if (!res.ok) throw new Error(`providers -> ${res.status}`);
  const data = (await res.json()) as {
    providers: {
      id: string;
      name: string;
      models: Record<string, { id?: string; name?: string }>;
    }[];
  };
  const out: ProviderModel[] = [];
  for (const p of data.providers) {
    for (const [id, m] of Object.entries(p.models)) {
      out.push({
        providerId: p.id,
        providerName: p.name,
        modelId: id,
        modelName: m.name ?? id,
      });
    }
  }
  return out;
}
