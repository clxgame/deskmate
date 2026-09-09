import { afterEach, beforeEach, expect, test } from "bun:test";
import { StrictMode, Suspense, startTransition } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { emit } from "@tauri-apps/api/event";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { useGifState } from "./useGifState";
import { defaultGifTiming, type GifPlayback } from "./gifState";

const playback = { successMs: 1400, errorMs: 1440, thinkingSelection: "random" } as const;
beforeEach(() => { restoreTauriModuleFixture(); mockIPC(() => undefined, { shouldMockEvents: true }); });
afterEach(async () => { cleanup(); await act(async () => {}); clearMocks(); });
function Harness({ identity = "a", policy = playback, random }: { readonly identity?: string; readonly policy?: GifPlayback; readonly random: () => number }) {
  return <output>{useGifState(true, policy, identity, random)}</output>;
}
const start = { type: "start", sessionId: "s", requestId: "r", eventId: "1" } as const;
test("StrictMode and batched duplicate events consume one sample", async () => {
  // Given the real event subscription under StrictMode.
  let calls = 0;
  const view = render(<StrictMode><Harness random={() => { calls++; return 0.9; }} /></StrictMode>);
  await act(async () => {});
  // When the same accepted event is replayed in one batch.
  await act(async () => { await emit("deskmate://pet-activity", start); await emit("deskmate://pet-activity", start); });
  // Then the selected result remains stable and sampling occurs once.
  expect(view.container.textContent).toBe("working");
  expect(calls).toBe(1);
});
test("persona and policy changes reinitialize active thinking once", async () => {
  // Given an active random thinking episode.
  let calls = 0;
  const random = () => (++calls === 1 ? 0.9 : 0.1);
  const view = render(<StrictMode><Harness random={random} /></StrictMode>);
  await act(async () => {});
  await act(async () => { await emit("deskmate://pet-activity", start); });
  // When identity changes and a semantic-equivalent config rerenders.
  view.rerender(<StrictMode><Harness identity="b" random={random} /></StrictMode>);
  view.rerender(<StrictMode><Harness identity="b" policy={{ ...playback }} random={random} /></StrictMode>);
  // Then exactly one new choice is made.
  expect(view.container.textContent).toBe("thinking");
  expect(calls).toBe(2);
  view.rerender(<StrictMode><Harness identity="b" policy={defaultGifTiming} random={random} /></StrictMode>);
  expect(calls).toBe(2);
});

test("records deterministic real hook episode, cancellation and reinitialization trace", async () => {
  // Given a mounted real activity consumer with controlled random values.
  let calls = 0;
  const random = () => (++calls % 2 === 1 ? 0.1 : 0.9);
  const view = render(<StrictMode><Harness random={random} /></StrictMode>);
  await act(async () => {});
  const trace: { readonly step: string; readonly display: string | null; readonly samples: number }[] = [];
  const record = (step: string) => trace.push({ step, display: view.container.textContent, samples: calls });
  // When the same request leaves thinking, returns, cancels, then a new request changes persona/policy.
  await act(async () => { await emit("deskmate://pet-activity", start); }); record("start");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, type: "mood", mood: "working", eventId: "2" }); }); record("explicit working");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, type: "mood", mood: "thinking", eventId: "3" }); }); record("return thinking");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, type: "cancel", eventId: "4" }); }); record("cancel");
  await act(async () => { await emit("deskmate://pet-activity", { ...start, requestId: "next", eventId: "5" }); }); record("new request");
  view.rerender(<StrictMode><Harness identity="b" random={random} /></StrictMode>); record("persona b");
  view.rerender(<StrictMode><Harness identity="b" policy={defaultGifTiming} random={random} /></StrictMode>); record("legacy policy");
  view.rerender(<StrictMode><Harness identity="b" random={random} /></StrictMode>); record("random policy");
  // Then observable state and exact sampling counts match the episode contract.
  expect(trace.map(({ display, samples }) => [display, samples])).toEqual([
    ["thinking", 1], ["working", 1], ["working", 2], ["idle", 2],
    ["thinking", 3], ["working", 4], ["thinking", 4], ["thinking", 5],
  ]);
});

test("uncommitted suspended render cannot change event selection inputs", async () => {
  // Given a committed thinking selector and an update that suspends before commit.
  const pending = new Promise<void>(() => {});
  function ConcurrentHarness({ suspended = false }: { readonly suspended?: boolean }) {
    const display = useGifState(true, playback, "a", () => suspended ? 0.9 : 0.1);
    if (suspended) throw pending;
    return <output>{display}</output>;
  }
  const view = render(<Suspense fallback="pending"><ConcurrentHarness /></Suspense>);
  await act(async () => {});
  await act(async () => { startTransition(() => view.rerender(<Suspense fallback="pending"><ConcurrentHarness suspended /></Suspense>)); });
  // When an event arrives while the speculative update remains suspended.
  await act(async () => { await emit("deskmate://pet-activity", start); });
  // Then it uses the last committed selector, never the suspended render inputs.
  expect(view.container.querySelector("output")?.textContent).toBe("thinking");
});
