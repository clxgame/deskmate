import type { AiProvider, Settings } from "../lib/settings";

export const kuroProviderFixture = {
  id: "provider-kuro",
  sidecarId: "yume",
  label: "Kuro",
  baseUrl: "https://ai-gateway.kurogames.com",
  apiKey: "configured-key",
} satisfies AiProvider;

export const omoKuroProviderFixture = {
  id: "provider-omo-kuro",
  sidecarId: "yume-2",
  label: "OMO Kuro",
  baseUrl: "https://omo-kuro.example.test/v1",
  apiKey: "omo-configured-key",
} satisfies AiProvider;

export function legacySettingsFixture(
  overrides: Partial<Settings> = {},
): Settings {
  return {
    autostart: false,
    language: "zh-CN",
    theme: "dark",
    providerId: "yume",
    modelId: "gpt-5.4-mini",
    yolo: false,
    baseUrl: "https://ai-gateway.kurogames.com",
    apiKey: "configured-key",
    providers: [kuroProviderFixture],
    activeProviderId: "provider-kuro",
    petScale: 1,
    outlineWidth: 0.0008,
    rimWidth: 0.1,
    rimIntensity: 0.3,
    specularIntensity: 0.05,
    petVisible: true,
    alwaysOnTop: false,
    petPosition: null,
    scheduledTasks: [],
    shortcutToggleChat: "",
    shortcutTogglePet: "",
    personaId: "xiaozhu",
    mouseFollow: false,
    userName: "",
    memoryAutoExtract: true,
    memoryAiUse: true,
    updateRepo: "owner/repo",
    ...overrides,
  };
}

export function multiProviderSettingsFixture(
  overrides: Partial<Settings> = {},
): Settings {
  return legacySettingsFixture({
    providers: [kuroProviderFixture, omoKuroProviderFixture],
    ...overrides,
  });
}
