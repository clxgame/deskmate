import { describe, expect, test } from "bun:test";
import type { ProviderModel } from "../lib/settings";
import {
  kuroProviderFixture,
  multiProviderSettingsFixture,
  omoKuroProviderFixture,
} from "../testing/settingsFixtures";
import {
  configuredProviderBySidecarId,
  displayProviderLabel,
  groupModelsByConfiguredProvider,
  selectedModelValue,
  settingsWithSelectedModel,
} from "./aiProviderModel";

const modelCatalog: readonly ProviderModel[] = [
  {
    sidecarId: "yume",
    providerName: "Sidecar YUME",
    modelId: "gpt-5.4-mini",
    modelName: "GPT 5.4 Mini",
  },
  {
    sidecarId: "yume-2",
    providerName: "Untrusted catalog label",
    modelId: "claude-sonnet-4.5",
    modelName: "Claude Sonnet 4.5",
  },
  {
    sidecarId: "unknown-sidecar",
    providerName: "Unknown",
    modelId: "orphan-model",
    modelName: "Orphan Model",
  },
];

describe("ai provider model helpers", () => {
  test("displays the configured provider label when rendering model groups", () => {
    expect(displayProviderLabel(omoKuroProviderFixture)).toBe("OMO Kuro");
  });

  test("finds configured providers by sidecar id instead of display name", () => {
    const providers = [kuroProviderFixture, omoKuroProviderFixture];

    expect(configuredProviderBySidecarId(providers, "yume-2")).toEqual(
      omoKuroProviderFixture,
    );
    expect(
      configuredProviderBySidecarId(providers, "Untrusted catalog label"),
    ).toBeNull();
  });

  test("groups models by configured provider sidecar id and omits unknown sidecars", () => {
    const groups = groupModelsByConfiguredProvider(
      [kuroProviderFixture, omoKuroProviderFixture],
      modelCatalog,
    );

    expect(groups).toEqual([
      {
        providerId: "provider-kuro",
        sidecarId: "yume",
        label: "Kuro",
        models: [modelCatalog[0]],
      },
      {
        providerId: "provider-omo-kuro",
        sidecarId: "yume-2",
        label: "OMO Kuro",
        models: [modelCatalog[1]],
      },
    ]);
  });

  test("formats the selected sidecar model value from legacy routing fields", () => {
    expect(
      selectedModelValue(
        multiProviderSettingsFixture({
          providerId: "yume-2",
          modelId: "claude-sonnet-4.5",
        }),
      ),
    ).toBe("yume-2/claude-sonnet-4.5");
    expect(selectedModelValue(multiProviderSettingsFixture({ providerId: "" }))).toBe(
      "",
    );
  });

  test("builds one settings object for yume-2 model selection and leaves unknown sidecars unchanged", () => {
    const settings = multiProviderSettingsFixture({
      activeProviderId: "provider-kuro",
      providerId: "yume",
      modelId: "gpt-5.4-mini",
    });

    const selected = settingsWithSelectedModel(
      settings,
      "yume-2/claude-sonnet-4.5",
    );
    expect(selected.providerId).toBe("yume-2");
    expect(selected.modelId).toBe("claude-sonnet-4.5");
    expect(selected.activeProviderId).toBe("provider-omo-kuro");

    const blank = settingsWithSelectedModel(selected, "");
    expect(blank.providerId).toBe("");
    expect(blank.modelId).toBe("");
    expect(blank.activeProviderId).toBe("provider-omo-kuro");

    expect(settingsWithSelectedModel(settings, "unknown/model-x")).toBe(settings);
  });
});
