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
  test("adds, edits, and collapses provider cards", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture({ language: "en-US" });
    const replace = mock<ReplaceSettings>(() => undefined);

    render(
      <AiProviderList
        settings={settings}
        replace={replace}
        t={t}
        createProviderId={() => "provider-new"}
      />,
    );

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

    fireEvent.change(
      screen.getByLabelText(`${t.aiProviderLabel} · Kuro`),
      { target: { value: "Kuro dev" } },
    );
    expect(replace).toHaveBeenLastCalledWith({
      ...settings,
      providers: [
        { ...settings.providers[0], label: "Kuro dev" },
        settings.providers[1],
      ],
    });

    await user.click(
      screen.getByRole("button", { name: `${t.aiProviderCollapse} · Kuro` }),
    );
    expect(screen.queryByLabelText(`${t.aiProviderBaseUrl} · Kuro`)).toBeNull();
    expect(
      screen.getByRole("button", { name: `${t.aiProviderExpand} · Kuro` }),
    ).toBeDefined();
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

    const removeButtons = screen.getAllByRole("button", {
      name: t.aiProviderRemove,
    });
    await user.click(removeButtons[1]);
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
    await waitFor(() => expect(document.activeElement).toBe(removeButtons[1]));

    await user.click(removeButtons[1]);
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

    const single = legacySettingsFixture({ language: "en-US" });
    rerender(<AiProviderList settings={single} replace={replace} t={t} />);
    const protectedRemove = screen.getByRole("button", {
      name: t.aiProviderRemoveLast,
    });
    expect(protectedRemove).toHaveProperty("disabled", true);
    expect(protectedRemove.getAttribute("title")).toBe(t.aiProviderRemoveLast);
  });
});
