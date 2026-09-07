import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { dict } from "../lib/i18n";
import { multiProviderSettingsFixture } from "../testing/settingsFixtures";
import { AiProviderList } from "./AiProviderList";

mock.module("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => Promise.resolve(() => undefined) }),
}));
const { SettingsKeyboardNavigation } = await import("./SettingsKeyboardNavigation");
const t = dict("en-US");
afterEach(cleanup);

describe("provider disclosure shortcuts", () => {
  test("targets the current expanded provider for Base URL and Verify", () => {
    const onVerify = mock(() => undefined);
    render(<><AiProviderList settings={multiProviderSettingsFixture()} replace={() => undefined} onVerify={onVerify} t={t} /><SettingsKeyboardNavigation /></>);
    fireEvent.click(screen.getByRole("button", { name: "OMO Kuro" }));
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "B" });
    expect(document.activeElement).toBe(screen.getByLabelText(`${t.aiProviderBaseUrl} · OMO Kuro`));
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "V" });
    expect(onVerify).toHaveBeenCalledWith("provider-omo-kuro");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: t.aiProviderVerify }));
  });

  test("leaves focus and provider operations untouched when configuration is collapsed", () => {
    const onVerify = mock(() => undefined);
    render(<><AiProviderList settings={multiProviderSettingsFixture()} replace={() => undefined} onVerify={onVerify} t={t} /><SettingsKeyboardNavigation /></>);
    const selector = screen.getByRole("button", { name: "Kuro" });
    selector.focus();
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "B" });
    fireEvent.keyDown(document, { ctrlKey: true, shiftKey: true, key: "V" });
    expect(document.activeElement).toBe(selector);
    expect(onVerify).not.toHaveBeenCalled();
    expect(screen.queryByRole("article")).toBeNull();
  });
});
