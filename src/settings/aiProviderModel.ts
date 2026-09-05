import type { AiProvider, ProviderModel, Settings } from "../lib/settings";

export type ConfiguredProviderModelGroup = {
  readonly providerId: string;
  readonly sidecarId: string;
  readonly label: string;
  readonly models: readonly ProviderModel[];
};

export function displayProviderLabel(provider: AiProvider): string {
  return provider.label;
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
): readonly ConfiguredProviderModelGroup[] {
  const groups: ConfiguredProviderModelGroup[] = [];
  for (const provider of providers) {
    const providerModels = models.filter(
      (model) => model.sidecarId === provider.sidecarId,
    );
    if (providerModels.length > 0) {
      groups.push({
        providerId: provider.id,
        sidecarId: provider.sidecarId,
        label: displayProviderLabel(provider),
        models: providerModels,
      });
    }
  }
  return groups;
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
