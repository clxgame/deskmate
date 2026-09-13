import { afterEach, expect, jest, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { measureWeekWheel } from "../../testing/weekWheelGeometry";
import { WeekPicker } from "./WeekPicker";
import { WeekWheel } from "./WeekWheel";
import { worklogLabels } from "./worklogLabels";
import { weekForDate, weeksForYear, type WorklogWeek } from "./worklogWeek";

const selected = weekForDate("2026-09-12");
const weeks = weeksForYear(2026);
const labels = worklogLabels("zh-CN");
afterEach(() => { cleanup(); jest.useRealTimers(); });

function wheel() {
  jest.useFakeTimers();
  const change = mock<(week: WorklogWeek) => void>();
  const finish = mock<() => void>();
  const result = render(<WeekWheel weeks={weeks} selected={selected} today="2026-09-12"
    current={selected} labels={labels} onChange={change} onFinish={finish} />);
  return { ...result, list: measureWeekWheel(screen.getByRole("listbox")), change, finish };
}
function advance() { act(() => { jest.advanceTimersByTime(200); }); }
function scroll(list: HTMLElement, index: number) {
  fireEvent.wheel(list);
  list.scrollTop = index * 36;
  fireEvent.scroll(list);
}

test("does not commit initial positioning or selecting the same week", () => {
  const { list, change } = wheel();
  expect(document.activeElement).toBe(list);
  fireEvent.click(within(list).getByRole("option", { selected: true }));
  advance();
  expect(change).toHaveBeenCalledTimes(0);
});

test("commits only the final centred week after continuous scrolling", () => {
  const { list, change } = wheel();
  scroll(list, 35); scroll(list, 37); scroll(list, 38);
  expect(change).toHaveBeenCalledTimes(0);
  advance();
  expect(change).toHaveBeenCalledTimes(1);
  expect(change.mock.calls[0]?.[0].number).toBe(39);
});

test("deduplicates native scrollend and the timeout fallback", () => {
  const { list, change } = wheel();
  scroll(list, 35);
  fireEvent(list, new Event("scrollend"));
  advance();
  fireEvent(list, new Event("scrollend"));
  expect(change).toHaveBeenCalledTimes(1);
});

test("waits for alignment before publishing a scroll result", () => {
  const { list, change } = wheel();
  fireEvent.wheel(list); list.scrollTop = 35 * 36 + 8; fireEvent.scroll(list);
  fireEvent(list, new Event("scrollend"));
  expect(change).toHaveBeenCalledTimes(0);
  expect(list.scrollTop).toBe(35 * 36);
  fireEvent(list, new Event("scrollend"));
  expect(change.mock.calls[0]?.[0].number).toBe(36);
});

test("a stale scrollend cannot complete a keyboard seek at its old position", () => {
  const { list, change } = wheel();
  list.scrollTo = () => {};
  fireEvent.keyDown(list, { key: "Home" });
  fireEvent(list, new Event("scrollend"));
  list.scrollTop = 0;
  fireEvent.scroll(list);
  fireEvent(list, new Event("scrollend"));
  expect(change.mock.calls[0]?.[0].number).toBe(1);
});

test("keeps the actual current week distinct when a past week is selected", () => {
  const { list, change } = wheel();
  fireEvent.click(within(list).getByRole("option", { name: "第36周（8.31-9.6）" }));
  advance();
  expect(within(list).getByRole("option", { selected: true }).getAttribute("data-period")).toBe("past");
  expect(list.querySelectorAll('[aria-current="date"]')).toHaveLength(1);
  expect(list.querySelector('[aria-current="date"]')?.textContent).toContain("第37周");
  expect(change.mock.calls[0]?.[0].number).toBe(36);
});

test("cancels pending selection on unmount", () => {
  const { list, change, unmount } = wheel();
  scroll(list, 35); unmount(); advance();
  expect(change).toHaveBeenCalledTimes(0);
});

test("external selection supersedes a pending older candidate", () => {
  const { list, change, finish, rerender } = wheel();
  scroll(list, 35);
  rerender(<WeekWheel weeks={weeks} selected={weekForDate("2026-10-01")} today="2026-09-12"
    current={selected} labels={labels} onChange={change} onFinish={finish} />);
  advance();
  expect(change).toHaveBeenCalledTimes(0);
  expect(list.scrollTop).toBe(39 * 36);
});

test("an unchanged-size observer notification does not cancel a keyboard selection", () => {
  const NativeObserver = ResizeObserver;
  let notify = () => {};
  globalThis.ResizeObserver = class extends NativeObserver {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      notify = () => callback([], this);
    }
  };
  try {
    const { list, change } = wheel();
    act(notify);
    fireEvent.keyDown(list, { key: "Home" });
    act(notify);
    advance();
    expect(change.mock.calls[0]?.[0].number).toBe(1);
  } finally { globalThis.ResizeObserver = NativeObserver; }
});

test("clamps keyboard navigation at year boundaries and Enter commits then finishes", () => {
  const { list, change, finish } = wheel();
  fireEvent.keyDown(list, { key: "Home" }); fireEvent.keyDown(list, { key: "ArrowUp" });
  expect(within(list).getByRole("option", { selected: true }).textContent).toContain("第1周");
  fireEvent.keyDown(list, { key: "End" }); fireEvent.keyDown(list, { key: "ArrowDown" });
  expect(change).toHaveBeenCalledTimes(0);
  fireEvent.keyDown(list, { key: "Enter" });
  expect(change.mock.calls[0]?.[0].number).toBe(53);
  expect(finish).toHaveBeenCalledTimes(1);
});

function PickerFixture({ date = "2026-09-12" }: { readonly date?: string }) {
  const [value, setValue] = useState(date);
  return <><WeekPicker date={value} today="2026-09-12" labels={labels} onChange={(week) => setValue(week.start)} />
    <button type="button">Outside</button></>;
}

test("Escape discards pending movement and reopening centres the committed week", () => {
  jest.useFakeTimers();
  render(<PickerFixture />);
  const trigger = screen.getByText("2026 · 第37周（9.7-9.13）");
  fireEvent.click(trigger);
  scroll(measureWeekWheel(screen.getByRole("listbox")), 35);
  fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
  advance();
  expect(screen.queryByRole("listbox")).toBe(null);
  expect(document.activeElement).toBe(trigger);
  expect(trigger.textContent).toContain("第37周");
  fireEvent.click(trigger);
  expect(screen.getByRole("option", { selected: true }).textContent).toContain("第37周");
});

test("outside dismissal cancels pending movement without restoring trigger focus", () => {
  jest.useFakeTimers(); render(<PickerFixture />);
  const trigger = screen.getByText("2026 · 第37周（9.7-9.13）");
  fireEvent.click(trigger); scroll(measureWeekWheel(screen.getByRole("listbox")), 35);
  const outside = screen.getByRole("button", { name: "Outside" });
  fireEvent.pointerDown(outside);
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.click(outside); outside.focus(); advance();
  expect(document.activeElement).toBe(outside);
  expect(screen.queryByRole("listbox")).toBe(null);
  expect(trigger.textContent).toContain("第37周");
});

test("year navigation keeps the week number and clamps week 53 to 52", () => {
  render(<PickerFixture date="2027-01-01" />);
  fireEvent.click(screen.getByText("2026 · 第53周（12.28-1.3）"));
  fireEvent.click(screen.getByRole("button", { name: "下一年" }));
  expect(screen.getByText("2027 · 第52周（12.27-1.2）")).toBeTruthy();
  expect(screen.getByRole("listbox")).toBeTruthy();
});

for (const language of ["zh-CN", "en-US", "ja-JP", "ko-KR"]) {
  test(`renders labelled options with one tab stop in ${language}`, () => {
    const localized = worklogLabels(language);
    render(<WeekWheel weeks={weeks} selected={selected} today="2026-09-12" current={selected}
      labels={localized} onChange={() => {}} onFinish={() => {}} />);
    const list = screen.getByRole("listbox", { name: localized.weekPicker });
    expect(list.tabIndex).toBe(0);
    expect(list.querySelectorAll('[tabindex="0"]')).toHaveLength(0);
    expect(within(list).getAllByRole("option")).toHaveLength(53);
    expect(list.querySelector('[aria-current="date"]')?.textContent).toContain(localized.currentWeekMark);
  });
}
