import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { dict } from "../lib/i18n";
import { multiProviderSettingsFixture } from "../testing/settingsFixtures";
import { AiProviderList } from "./AiProviderList";

const t = dict("en-US");
afterEach(cleanup);

describe("provider disclosure", () => {
  test("hides API fields and linked regions when settings first open", () => {
    // Given an existing configured provider collection.
    const replace = mock(() => undefined);
    render(<AiProviderList settings={multiProviderSettingsFixture()} replace={replace} t={t} />);
    // When its disclosure group first renders.
    const selectors = within(screen.getByRole("group", { name: t.aiProviderSection })).getAllByRole("button");
    // Then provider configuration is absent from the interactive surface.
    expect(selectors).toHaveLength(2);
    expect(selectors.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(screen.queryByRole("article")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  test("preserves edited credentials when the selected provider collapses and reopens", async () => {
    const user = userEvent.setup();
    function ProviderSettings() {
      const [settings, setSettings] = useState(multiProviderSettingsFixture());
      return <AiProviderList settings={settings} replace={setSettings} t={t} />;
    }
    render(<ProviderSettings />);
    const selector = screen.getByRole("button", { name: "Kuro" });
    await user.click(selector);
    fireEvent.change(screen.getByLabelText(`${t.aiProviderApiKey} · Kuro`), {
      target: { value: "synthetic-edited-draft" },
    });
    // When the same provider is collapsed then reopened.
    await user.click(selector);
    expect(screen.queryByLabelText(`${t.aiProviderApiKey} · Kuro`)).toBeNull();
    await user.click(selector);
    // Then the parent-owned edit survives while routing is untouched.
    expect(screen.getByLabelText(`${t.aiProviderApiKey} · Kuro`)).toHaveProperty("value", "synthetic-edited-draft");
    expect(screen.getByRole("region", { name: "Kuro" }).getAttribute("aria-labelledby")).toBe(selector.id);
  });

  test("keeps an operation accessible while its provider is collapsed", async () => {
    const user = userEvent.setup();
    const settings = multiProviderSettingsFixture();
    const replace = mock(() => undefined);
    const onVerify = mock(() => undefined);
    const { rerender } = render(<AiProviderList settings={settings} replace={replace} t={t} onVerify={onVerify} />);
    const selector = screen.getByRole("button", { name: "Kuro" });
    await user.click(selector);
    await user.click(screen.getByRole("button", { name: t.aiProviderVerify }));
    rerender(<AiProviderList settings={settings} replace={replace} t={t} onVerify={onVerify} verifyingProviderId="provider-kuro" operationBusy />);
    // When a busy provider is collapsed.
    await user.click(selector);
    // Then it remains operable, with status but no API fields.
    expect(selector).toHaveProperty("disabled", false);
    expect(within(selector).getByRole("status")).toBeDefined();
    expect(screen.queryByRole("article")).toBeNull();
    expect(onVerify).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
    rerender(<AiProviderList settings={settings} replace={replace} t={t} verifyResultFor={() => ({ ok: true, message: "Verification complete" })} />);
    expect(screen.queryByRole("article")).toBeNull();
    await user.click(selector);
    expect(screen.getByText("Verification complete")).toBeDefined();
  });
});
