import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { useDailyHoroscope } from "./useDailyHoroscope";

let hidden = false;
let originalHidden: PropertyDescriptor | undefined;

function atLocal(year: number, month: number, day: number, hour = 12, minute = 0) {
  return new Date(year, month - 1, day, hour, minute);
}

beforeEach(() => {
  jest.useFakeTimers({ now: atLocal(2026, 9, 30, 23, 59) });
  hidden = false;
  originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
});

test("updates at local midnight and leaves a same-day result untouched", () => {
  const view = renderHook(useDailyHoroscope);
  const first = view.result.current;
  expect(first.date).toBe("2026-09-30");

  act(() => {
    window.dispatchEvent(new Event("focus"));
    jest.advanceTimersByTime(59_999);
  });
  expect(view.result.current).toBe(first);

  act(() => jest.advanceTimersByTime(1));
  expect(view.result.current.date).toBe("2026-10-01");
  expect(view.result.current).not.toBe(first);
});

test("pauses while hidden and reads the current day after a multi-day sleep", () => {
  const view = renderHook(useDailyHoroscope);
  hidden = true;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(jest.getTimerCount()).toBe(0);

  jest.setSystemTime(atLocal(2026, 10, 4));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(view.result.current.date).toBe("2026-09-30");

  hidden = false;
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  expect(view.result.current.date).toBe("2026-10-04");
  expect(jest.getTimerCount()).toBe(2);
});

test("handles forward and backward system date changes on resume events", () => {
  const view = renderHook(useDailyHoroscope);
  const first = view.result.current;

  jest.setSystemTime(atLocal(2026, 10, 3));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(view.result.current.date).toBe("2026-10-03");

  jest.setSystemTime(atLocal(2026, 9, 29));
  act(() => window.dispatchEvent(new Event("pageshow")));
  expect(view.result.current.date).toBe("2026-09-29");

  jest.setSystemTime(atLocal(2026, 9, 30));
  act(() => window.dispatchEvent(new Event("focus")));
  expect(view.result.current).toEqual(first);
});

test("detects a system date change within the 60-second visible check", () => {
  let currentTime = atLocal(2026, 9, 30);
  const view = renderHook(() => useDailyHoroscope(() => currentTime));
  currentTime = atLocal(2026, 10, 2);
  act(() => jest.advanceTimersByTime(59_999));
  expect(view.result.current.date).toBe("2026-09-30");
  act(() => jest.advanceTimersByTime(1));
  expect(view.result.current.date).toBe("2026-10-02");
});

test("reschedules midnight when the clock changes within the same date", () => {
  let currentTime = atLocal(2026, 9, 30);
  const view = renderHook(() => useDailyHoroscope(() => currentTime));
  currentTime = atLocal(2026, 9, 30, 23, 59);
  act(() => window.dispatchEvent(new Event("focus")));
  expect(view.result.current.date).toBe("2026-09-30");
  currentTime = atLocal(2026, 10, 1);
  act(() => jest.advanceTimersByTime(60_000));
  expect(view.result.current.date).toBe("2026-10-01");
});

test("cleans up timers and listeners, then starts fresh after remount", () => {
  const first = renderHook(useDailyHoroscope, { wrapper: StrictMode });
  expect(jest.getTimerCount()).toBe(2);
  first.unmount();
  expect(jest.getTimerCount()).toBe(0);

  jest.setSystemTime(atLocal(2026, 10, 1));
  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(jest.getTimerCount()).toBe(0);

  const reopened = renderHook(useDailyHoroscope);
  expect(reopened.result.current.date).toBe("2026-10-01");
  expect(jest.getTimerCount()).toBe(2);
});
