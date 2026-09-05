import type { AiProvider, ProviderModel, Settings } from "../lib/settings";
import type { Dict } from "../lib/i18n";

export type ConfiguredProviderModelGroup = {
  readonly providerId: string;
  readonly sidecarId: string;
  readonly label: string;
  readonly models: readonly ProviderModel[];
};

export function displayProviderLabel(
  provider: AiProvider,
  index: number,
  t: Dict,
): string {
  const explicitLabel = provider.label.trim();
  if (explicitLabel) return explicitLabel;

  try {
    const host = new URL(provider.baseUrl).hostname;
    if (host) return host;
  } catch {}

  return t.aiProviderDefault(index + 1);
}

export function configuredProviderBySidecarId(
  providers: readonly AiProvider[],
  sidecarId: string,
): AiProvider | null {
  return providers.find((provider) => provider.sidecarId === sidecarId) ?? null;
}

export function groupModelsByConfiguredProvider(
  providers: readonly AiProvider[],
  models: readonly ProviderModel[],
  t: Dict,
): readonly ConfiguredProviderModelGroup[] {
  const groups: ConfiguredProviderModelGroup[] = [];
  for (const [index, provider] of providers.entries()) {
    const providerModels = models.filter(
      (model) => model.sidecarId === provider.sidecarId,
    );
    if (providerModels.length > 0) {
      groups.push({
        providerId: provider.id,
        sidecarId: provider.sidecarId,
        label: displayProviderLabel(provider, index, t),
        models: providerModels,
      });
    }
  }
  return groups;
}

export function frontierSidecarId(providers: readonly AiProvider[]): string {
  let frontier = 0;
  for (const provider of providers) {
    const match = /^yume(?:-(\d+))?$/.exec(provider.sidecarId);
    if (!match) continue;
    const sequence = match[1] ? Number(match[1]) : 1;
    if (Number.isSafeInteger(sequence)) frontier = Math.max(frontier, sequence);
  }
  const next = frontier + 1;
  return next === 1 ? "yume" : `yume-${next}`;
}

export function settingsWithAddedProvider(
  settings: Settings,
  providerId: string,
): Settings {
  return {
    ...settings,
    providers: [
      ...settings.providers,
      {
        id: providerId,
        sidecarId: frontierSidecarId(settings.providers),
        label: "",
        baseUrl: "",
        apiKey: "",
      },
    ],
  };
}

export function settingsWithUpdatedProvider(
  settings: Settings,
  providerId: string,
  update: Partial<Pick<AiProvider, "label" | "baseUrl" | "apiKey">>,
): Settings {
  let changed = false;
  const providers = settings.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    changed = true;
    return { ...provider, ...update };
  });
  return changed ? { ...settings, providers } : settings;
}

export function settingsWithDeletedProvider(
  settings: Settings,
  providerId: string,
): Settings {
  if (settings.providers.length <= 1) return settings;
  const removed = settings.providers.find((provider) => provider.id === providerId);
  if (!removed) return settings;

  const providers = settings.providers.filter((provider) => provider.id !== providerId);
  const selectedProviderRemoved = settings.providerId === removed.sidecarId;
  return {
    ...settings,
    providers,
    activeProviderId:
      settings.activeProviderId === providerId
        ? providers[0]?.id ?? ""
        : settings.activeProviderId,
    providerId: selectedProviderRemoved ? "" : settings.providerId,
    modelId: selectedProviderRemoved ? "" : settings.modelId,
  };
}

export function selectedModelValue(settings: Settings): string {
  return settings.providerId ? `${settings.providerId}/${settings.modelId}` : "";
}

export function settingsWithSelectedModel(
  settings: Settings,
  rawValue: string,
): Settings {
  if (!rawValue) return { ...settings, providerId: "", modelId: "" };

  const slash = rawValue.indexOf("/");
  if (slash <= 0) return settings;

  const sidecarId = rawValue.slice(0, slash);
  const provider = configuredProviderBySidecarId(settings.providers, sidecarId);
  if (provider === null) return settings;

  return {
    ...settings,
    providerId: sidecarId,
    modelId: rawValue.slice(slash + 1),
    activeProviderId: provider.id,
  };
}
