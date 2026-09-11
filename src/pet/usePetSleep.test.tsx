import { afterEach, beforeEach, expect, test } from "bun:test";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { usePetActivityState } from "./useGifState";
import { usePetSleep } from "./usePetSleep";
import { manualClock } from "./petSleepTestClock";
import type { SleepClock } from "./petSleep";

beforeEach(() => { restoreTauriModuleFixture(); mockIPC(() => undefined, { shouldMockEvents: true }); });
afterEach(async () => { cleanup(); await act(async () => {}); clearMocks(); });
function Harness({ clock, visible = true, identity = "a" }: { readonly clock: SleepClock; readonly visible?: boolean; readonly identity?: string }) {
  const activity = usePetActivityState(visible, undefined, identity, undefined, clock);
  const sleep = usePetSleep({ ...activity, visible, identity, ready: true }, clock);
  return <button onClick={sleep.interact} type="button">{sleep.state}/{activity.display}</button>;
}
const start = { type: "start", sessionId: "s", requestId: "r", eventId: "1" } as const;
test("StrictMode schedules one deadline, wakes on click and cleans up on unmount", () => {
  // Given a strict-mounted ready pet.
  const time = manualClock(); const view = render(<StrictMode><Harness clock={time.clock} /></StrictMode>);
  expect(time.pending()).toBe(1); act(() => time.advance(60000)); expect(view.container.textContent).toBe("sleep/idle");
  // When its existing click action runs.
  fireEvent.click(view.getByRole("button"));
  // Then sleep ends and exactly one new deadline is cleaned up on unmount.
  expect(view.container.textContent).toBe("awake/idle"); expect(time.pending()).toBe(1); view.unmount(); expect(time.pending()).toBe(0);
});
test("request start wakes, idle mood stays busy, and feedback finishes before countdown", async () => {
  // Given a sleeping pet listening to real scoped activity events.
  const time = manualClock(); const view = render(<Harness clock={time.clock} />); await act(async () => {}); act(() => time.advance(60000));
  // When a request progresses through idle visual and success feedback.
  await act(async () => { await emit("deskmate://pet-activity", start); }); expect(view.container.textContent).toBe("awake/thinking");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, type: "mood", mood: "idle", eventId: "2" }); });
  act(() => time.advance(90000)); expect(view.container.textContent).toBe("awake/idle");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, type: "success", eventId: "3" }); });
  act(() => time.advance(1399)); expect(view.container.textContent).toBe("awake/success"); act(() => time.advance(1));
  act(() => time.advance(59999)); expect(view.container.textContent).toBe("awake/idle"); act(() => time.advance(1));
  // Then it sleeps only a full minute after feedback ended.
  expect(view.container.textContent).toBe("sleep/idle");
});
test("stale and duplicate request events do not wake a sleeping pet", async () => {
  // Given a request that was accepted then cancelled.
  const time = manualClock(); const view = render(<Harness clock={time.clock} />); await act(async () => {});
  await act(async () => { await emit("deskmate://pet-activity", start); await emit("deskmate://pet-activity", { ...start, type: "cancel", eventId: "2" }); });
  act(() => time.advance(60000)); expect(view.container.textContent).toBe("sleep/idle");
  // When duplicate start and stale terminal/mood notifications arrive.
  await act(async () => {
    await emit("deskmate://pet-activity", { ...start, eventId: "replay" });
    await emit("deskmate://pet-activity", { ...start, type: "success", eventId: "late" });
    await emit("deskmate://pet-activity", { ...start, requestId: "old", type: "mood", mood: "thinking", eventId: "old" });
  });
  // Then no new deadline or wake occurs.
  expect(view.container.textContent).toBe("sleep/idle"); expect(time.pending()).toBe(0);
});
test("hide and persona revision reset sleep while preserving real busy work", async () => {
  // Given an active request.
  const time = manualClock(); const view = render(<Harness clock={time.clock} />); await act(async () => {});
  await act(async () => { await emit("deskmate://pet-activity", start); });
  // When hidden, restored and reloaded under a new identity.
  view.rerender(<Harness clock={time.clock} visible={false} />); act(() => time.advance(60000));
  view.rerender(<Harness clock={time.clock} identity="a-revision2" />); act(() => time.advance(60000));
  // Then an active request remains busy rather than accruing idle time.
  expect(view.container.textContent).toBe("awake/working");
});
