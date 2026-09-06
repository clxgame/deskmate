import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { dict } from "../lib/i18n";
import {
  legacySettingsFixture,
  multiProviderSettingsFixture,
} from "../testing/settingsFixtures";
import { AiProviderList } from "./AiProviderList";
import type { ReplaceSettings } from "./settingsPrimitives";

const t = dict("en-US");

afterEach(cleanup);

describe("AI provider list", () => {
  test("adds a selected tab and preserves edits when switching providers", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture({ language: "en-US" });
    const replace = mock<ReplaceSettings>(() => undefined);

    function ProviderSettings() {
      const [current, setCurrent] = useState(settings);
      return (
        <AiProviderList
          settings={current}
          replace={(next) => {
            replace(next);
            setCurrent(next);
          }}
          t={t}
          createProviderId={() => "provider-new"}
        />
      );
    }

    render(<ProviderSettings />);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getAllByRole("article")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: t.aiProviderAdd }));
    expect(replace).toHaveBeenLastCalledWith({
      ...settings,
      providers: [
        ...settings.providers,
        {
          id: "provider-new",
          sidecarId: "yume-3",
          label: "",
          baseUrl: "",
          apiKey: "",
        },
      ],
    });
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: "Provider 3" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(`${t.aiProviderApiKey} · Provider 3`), {
      target: { value: "new-provider-draft" },
    });

    await user.click(screen.getByRole("tab", { name: "Kuro" }));
    fireEvent.change(
      screen.getByLabelText(`${t.aiProviderLabel} · Kuro`),
      { target: { value: "Kuro dev" } },
    );
    expect(screen.getByRole("tab", { name: "Kuro dev" })).toBeDefined();
    await user.click(screen.getByRole("tab", { name: "Provider 3" }));
    expect(screen.getByLabelText(`${t.aiProviderApiKey} · Provider 3`)).toHaveProperty("value", "new-provider-draft");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(replace.mock.calls.at(-1)?.[0].activeProviderId).toBe(settings.activeProviderId);
  });

  test("navigates provider tabs by keyboard without changing the active model route", async () => {
    const user = userEvent.setup();
    const replace = mock<ReplaceSettings>(() => undefined);
    render(<AiProviderList settings={multiProviderSettingsFixture()} replace={replace} t={t} />);
    const first = screen.getByRole("tab", { name: "Kuro" });
    const second = screen.getByRole("tab", { name: "OMO Kuro" });
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(second);
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(second.id);
    expect(screen.getByLabelText(`${t.aiProviderBaseUrl} · OMO Kuro`)).toBeDefined();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(second);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(first);
    await user.keyboard("{ArrowLeft}");
    expect(document.activeElement).toBe(second);
    expect(replace).not.toHaveBeenCalled();
  });

  test("requires confirmation to delete and protects the last provider", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture({
      language: "en-US",
      activeProviderId: "provider-omo-kuro",
      providerId: "yume-2",
      modelId: "claude-sonnet-4.5",
    });
    const replace = mock<ReplaceSettings>(() => undefined);
    const { rerender } = render(
      <AiProviderList settings={settings} replace={replace} t={t} />,
    );

    const removeButton = screen.getByRole("button", {
      name: t.aiProviderRemove,
    });
    await user.click(removeButton);
    const dialog = screen.getByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveProperty("open", true));
    const confirmRemove = within(dialog).getByRole("button", {
      name: t.aiProviderRemove,
    });
    const cancelRemove = within(dialog).getByRole("button", {
      name: t.aiProviderRemoveCancel,
    });
    expect(document.activeElement).toBe(cancelRemove);
    await user.tab();
    expect(document.activeElement).toBe(confirmRemove);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancelRemove);

    rerender(
      <AiProviderList
        settings={settings}
        replace={replace}
        t={t}
        operationBusy
      />,
    );
    expect(confirmRemove).toHaveProperty("disabled", true);
    await user.click(confirmRemove);
    expect(replace).not.toHaveBeenCalled();
    rerender(<AiProviderList settings={settings} replace={replace} t={t} />);
    await user.click(cancelRemove);
    expect(replace).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(removeButton));

    await user.click(removeButton);
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: t.aiProviderRemove,
      }),
    );
    expect(replace).toHaveBeenCalledWith({
      ...settings,
      providers: [settings.providers[0]],
      activeProviderId: "provider-kuro",
      providerId: "",
      modelId: "",
    });

    const remaining = replace.mock.calls.at(-1)?.[0];
    if (!remaining) throw new Error("Expected settings after provider removal");
    rerender(<AiProviderList settings={remaining} replace={replace} t={t} />);
    expect(screen.getByRole("tab", { name: "Kuro" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("article")).toHaveLength(1);

    const single = legacySettingsFixture({ language: "en-US" });
    rerender(<AiProviderList settings={single} replace={replace} t={t} />);
    const protectedRemove = screen.getByRole("button", {
      name: t.aiProviderRemoveLast,
    });
    expect(protectedRemove).toHaveProperty("disabled", true);
    expect(protectedRemove.getAttribute("title")).toBe(t.aiProviderRemoveLast);
  });
});
