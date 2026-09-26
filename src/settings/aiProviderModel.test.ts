import { describe, expect, test } from "bun:test";
import { dict } from "../lib/i18n";
import type { ProviderModel } from "../lib/settings";
import {
  kuroProviderFixture,
  multiProviderSettingsFixture,
  omoKuroProviderFixture,
} from "../testing/settingsFixtures";
import {
  configuredProviderBySidecarId,
  displayProviderLabel,
  frontierSidecarId,
  groupModelsByConfiguredProvider,
  selectedModelValue,
  settingsWithAddedProvider,
  settingsWithDeletedProvider,
  settingsWithSelectedModel,
  settingsWithSelectedProvider,
  settingsWithUpdatedProvider,
} from "./aiProviderModel";

const t = dict("en-US");

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
  test("displays explicit label, URL host, then localized provider number", () => {
    expect(displayProviderLabel(omoKuroProviderFixture, 1, t)).toBe("OMO Kuro");
    expect(
      displayProviderLabel(
        { ...omoKuroProviderFixture, label: "" },
        1,
        t,
      ),
    ).toBe("omo-kuro.example.test");
    expect(
      displayProviderLabel(
        { ...omoKuroProviderFixture, label: "", baseUrl: "not a url" },
        1,
        t,
      ),
    ).toBe("Provider 2");
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

  test("shows only the active provider's verified models", () => {
    const groups = groupModelsByConfiguredProvider(
      [kuroProviderFixture, omoKuroProviderFixture],
      modelCatalog,
      "provider-omo-kuro",
      t,
    );

    expect(groups).toEqual([
      {
        providerId: "provider-omo-kuro",
        sidecarId: "yume-2",
        label: "OMO Kuro",
        models: [modelCatalog[1]],
      },
    ]);
    expect(groupModelsByConfiguredProvider(
      [kuroProviderFixture, omoKuroProviderFixture],
      modelCatalog,
      "provider-kuro",
      t,
    )[0]?.models).toEqual([modelCatalog[0]]);
  });

  test("allocates frontier sidecar ids with the backend sequence", () => {
    expect(frontierSidecarId([])).toBe("yume");
    expect(frontierSidecarId([kuroProviderFixture])).toBe("yume-2");
    expect(
      frontierSidecarId([
        kuroProviderFixture,
        { ...omoKuroProviderFixture, sidecarId: "yume-3" },
      ]),
    ).toBe("yume-4");
  });

  test("adds and edits providers without mutating existing provider objects", () => {
    const settings = multiProviderSettingsFixture();
    const added = settingsWithAddedProvider(settings, "provider-new");
    expect(added.providers).toHaveLength(3);
    expect(added.providers[2]).toEqual({
      id: "provider-new",
      sidecarId: "yume-3",
      label: "",
      baseUrl: "",
      apiKey: "",
    });
    expect(added.activeProviderId).toBe("provider-new");
    expect(added.providerId).toBe("");
    expect(added.modelId).toBe("");
    expect(settings.providers).toHaveLength(2);

    const edited = settingsWithUpdatedProvider(added, "provider-new", {
      label: "Frontier",
      baseUrl: "https://frontier.example.test/v1",
      apiKey: "frontier-key",
    });
    expect(edited.providers[2]).toEqual({
      id: "provider-new",
      sidecarId: "yume-3",
      label: "Frontier",
      baseUrl: "https://frontier.example.test/v1",
      apiKey: "frontier-key",
    });
    expect(edited.providers[0]).toBe(settings.providers[0]);
  });

  test("formats the selected sidecar model value from legacy routing fields", () => {
    expect(
      selectedModelValue(
        multiProviderSettingsFixture({
          providerId: "yume-2",
          modelId: "claude-sonnet-4.5",
          activeProviderId: "provider-omo-kuro",
        }),
        modelCatalog,
      ),
    ).toBe("yume-2/claude-sonnet-4.5");
    expect(selectedModelValue(multiProviderSettingsFixture({ providerId: "" }), modelCatalog)).toBe(
      "",
    );
    expect(selectedModelValue(multiProviderSettingsFixture({
      providerId: "yume-2",
      modelId: "claude-sonnet-4.5",
    }), modelCatalog)).toBe("");
    expect(selectedModelValue(multiProviderSettingsFixture({
      providerId: "yume-2",
      modelId: "claude-sonnet-4.5",
      activeProviderId: "provider-omo-kuro",
    }), [])).toBe("");
  });

  test("switches provider and clears the old model before selecting from its verified catalog", () => {
    const settings = multiProviderSettingsFixture({
      activeProviderId: "provider-kuro",
      providerId: "yume",
      modelId: "gpt-5.4-mini",
    });

    expect(settingsWithSelectedModel(settings, "yume-2/claude-sonnet-4.5")).toBe(settings);
    const switched = settingsWithSelectedProvider(settings, "provider-omo-kuro");
    expect(switched.activeProviderId).toBe("provider-omo-kuro");
    expect(switched.providerId).toBe("");
    expect(switched.modelId).toBe("");
    expect(settingsWithSelectedProvider(switched, "provider-omo-kuro")).toBe(switched);
    expect(settingsWithSelectedProvider(settings, "missing")).toBe(settings);

    const selected = settingsWithSelectedModel(
      switched,
      "yume-2/claude-sonnet-4.5",
    );
    expect(selected.providerId).toBe("yume-2");
    expect(selected.modelId).toBe("claude-sonnet-4.5");
    expect(selected.activeProviderId).toBe("provider-omo-kuro");

    const blank = settingsWithSelectedModel(selected, "");
    expect(blank.providerId).toBe("");
    expect(blank.modelId).toBe("");
    expect(blank.activeProviderId).toBe("provider-omo-kuro");

    expect(settingsWithSelectedModel(switched, "unknown/model-x")).toBe(switched);
  });

  test("editing the active provider's API binding clears its previously selected model", () => {
    const settings = multiProviderSettingsFixture();
    const renamed = settingsWithUpdatedProvider(settings, "provider-kuro", { label: "Office" });
    expect(renamed.providerId).toBe("yume");
    expect(renamed.modelId).toBe("gpt-5.4-mini");

    const changed = settingsWithUpdatedProvider(settings, "provider-kuro", {
      baseUrl: "https://api.deepseek.com",
    });
    expect(changed.providerId).toBe("");
    expect(changed.modelId).toBe("");
  });

  test("deletes with confirmation semantics while preserving the last provider", () => {
    const settings = multiProviderSettingsFixture({
      activeProviderId: "provider-omo-kuro",
      providerId: "yume-2",
      modelId: "claude-sonnet-4.5",
    });

    const deleted = settingsWithDeletedProvider(settings, "provider-omo-kuro");
    expect(deleted.providers).toEqual([kuroProviderFixture]);
    expect(deleted.providerId).toBe("");
    expect(deleted.modelId).toBe("");
    expect(deleted.activeProviderId).toBe("provider-kuro");
    expect(settingsWithDeletedProvider(deleted, "provider-kuro")).toBe(deleted);
  });
});
