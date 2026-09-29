import { afterEach, expect, jest, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { generateDailyHoroscope } from "../../lib/horoscope/generator";
import { localDateKey } from "../../lib/horoscope/date";
import { ZODIAC_SIGNS } from "../../lib/horoscope/zodiac";
import { legacySettingsFixture } from "../../testing/settingsFixtures";
import { HoroscopeWidget } from "./HoroscopeWidget";
import { horoscopeLabels } from "./horoscopeLabels";

afterEach(cleanup);

function Harness({ initialSign, language = "zh-CN" }: { readonly initialSign?: unknown; readonly language?: string }) {
  const [settings, setSettings] = useState(legacySettingsFixture({
    language,
    horoscopeSign: initialSign as ReturnType<typeof legacySettingsFixture>["horoscopeSign"],
  }));
  return <HoroscopeWidget settings={settings}
    patch={(key, value) => setSettings((current) => ({ ...current, [key]: value }))} />;
}

test("shows the fixed daily leader by default and browses all twelve signs without changing the preference", () => {
  const labels = horoscopeLabels("zh-CN");
  const topSign = generateDailyHoroscope(localDateKey(new Date())).topSign;
  render(<Harness />);
  expect(screen.getByRole("article", { name: labels.zodiac[topSign] })).toBeTruthy();
  const selector = screen.getByRole("combobox", { name: labels.mySign }) as HTMLSelectElement;
  expect(selector.value).toBe("");
  const signs = screen.getByRole("heading", { name: labels.allSigns }).parentElement as HTMLElement;
  for (const sign of ZODIAC_SIGNS) {
    fireEvent.click(within(signs).getByRole("button", { name: new RegExp(labels.zodiac[sign]) }));
    expect(screen.getByRole("article", { name: labels.zodiac[sign] })).toBeTruthy();
    expect(selector.value).toBe("");
  }
  fireEvent.click(within(screen.getByRole("group", { name: labels.featureTitle }))
    .getByRole("button", { name: new RegExp(labels.topToday) }));
  expect(screen.getByRole("article", { name: labels.zodiac[topSign] })).toBeTruthy();
});

test("setting and clearing my sign only changes the shortcut and saved selection", () => {
  const labels = horoscopeLabels("en-US");
  render(<Harness language="en-US" />);
  const selector = screen.getByRole("combobox", { name: labels.mySign }) as HTMLSelectElement;
  fireEvent.change(selector, { target: { value: "aries" } });
  expect(selector.value).toBe("aries");
  fireEvent.click(screen.getByRole("button", { name: `${labels.myFortune} · ${labels.zodiac.aries}` }));
  expect(screen.getByRole("article", { name: labels.zodiac.aries })).toBeTruthy();
  fireEvent.change(selector, { target: { value: "" } });
  expect(selector.value).toBe("");
  expect(screen.queryByRole("button", { name: `${labels.myFortune} · ${labels.zodiac.aries}` })).toBeNull();
});

test("ignores an invalid loaded sign and provides localized star names", () => {
  const labels = horoscopeLabels("ja-JP");
  render(<Harness language="ja-JP" initialSign="unknown" />);
  expect((screen.getByRole("combobox", { name: labels.mySign }) as HTMLSelectElement).value).toBe("");
  expect(screen.getByRole("img", { name: /総合、5つ星中[1-5]つ/ })).toBeTruthy();
  expect(screen.getByRole("heading", { name: labels.allSigns })).toBeTruthy();
});

test("keeps a manually viewed sign while replacing its fortune at local midnight", () => {
  jest.useFakeTimers({ now: new Date(2026, 8, 30, 23, 59) });
  try {
    const labels = horoscopeLabels("en-US");
    render(<Harness language="en-US" />);
    const all = screen.getByRole("heading", { name: labels.allSigns }).parentElement as HTMLElement;
    fireEvent.click(within(all).getByRole("button", { name: /Aries/ }));
    expect(screen.getByRole("article", { name: "Aries" })).toBeTruthy();
    act(() => jest.advanceTimersByTime(60_000));
    expect(screen.getByRole("article", { name: "Aries" })).toBeTruthy();
    expect(document.querySelector(".set-horoscope time")?.getAttribute("datetime")).toBe("2026-10-01");
    const expected = generateDailyHoroscope("2026-10-01").fortunes.find((fortune) => fortune.sign === "aries")!;
    expect(within(screen.getByRole("article", { name: "Aries" }))
      .getByRole("img", { name: labels.starRating(labels.overall, expected.displayStars) })).toBeTruthy();
  } finally {
    cleanup();
    jest.useRealTimers();
  }
});
