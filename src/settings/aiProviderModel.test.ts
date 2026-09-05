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

  test("groups models by configured provider sidecar id and omits unknown sidecars", () => {
    const groups = groupModelsByConfiguredProvider(
      [kuroProviderFixture, omoKuroProviderFixture],
      modelCatalog,
      t,
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
