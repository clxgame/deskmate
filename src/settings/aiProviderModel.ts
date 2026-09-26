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

  const candidate = provider.baseUrl.trim();
  if (URL.canParse(candidate)) {
    const host = new URL(candidate).hostname;
    if (host) return host;
  }

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
  activeProviderId: string,
  t: Dict,
): readonly ConfiguredProviderModelGroup[] {
  const groups: ConfiguredProviderModelGroup[] = [];
  for (const [index, provider] of providers.entries()) {
    if (provider.id !== activeProviderId) continue;
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
    activeProviderId: providerId,
    providerId: "",
    modelId: "",
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
  let selectedBindingChanged = false;
  const providers = settings.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    changed = true;
    selectedBindingChanged = provider.sidecarId === settings.providerId && (
      (update.baseUrl !== undefined && update.baseUrl !== provider.baseUrl) ||
      (update.apiKey !== undefined && update.apiKey !== provider.apiKey)
    );
    return { ...provider, ...update };
  });
  return changed ? {
    ...settings,
    providers,
    providerId: selectedBindingChanged ? "" : settings.providerId,
    modelId: selectedBindingChanged ? "" : settings.modelId,
  } : settings;
}

export function settingsWithSelectedProvider(
  settings: Settings,
  providerId: string,
): Settings {
  const provider = settings.providers.find((entry) => entry.id === providerId);
  if (!provider || settings.activeProviderId === providerId) return settings;
  return {
    ...settings,
    activeProviderId: providerId,
    providerId: "",
    modelId: "",
  };
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

export function selectedModelValue(
  settings: Settings,
  models: readonly ProviderModel[],
): string {
  const activeProvider = settings.providers.find(
    (provider) => provider.id === settings.activeProviderId,
  );
  return activeProvider?.sidecarId === settings.providerId && models.some(
    (model) => model.sidecarId === settings.providerId && model.modelId === settings.modelId,
  )
    ? `${settings.providerId}/${settings.modelId}`
    : "";
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
  if (provider === null || provider.id !== settings.activeProviderId) return settings;

  return {
    ...settings,
    providerId: sidecarId,
    modelId: rawValue.slice(slash + 1),
    activeProviderId: provider.id,
  };
}
