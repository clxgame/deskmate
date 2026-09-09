import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { usePetInteraction } from "./usePetInteraction";
import { setGifHitPolygon } from "./gifGeometry";
import { originalTauriWindow, restoreTauriModuleFixture } from "../testing/tauriModuleFixture";

let pressed = false;
const invoke = mock(async (command: string) => command === "pet_primary_button_down" ? pressed : undefined);
const drag = mock(() => Promise.resolve());
const lock = mock((_value: boolean) => {});
beforeEach(() => {
  pressed = false; invoke.mockClear(); drag.mockClear(); lock.mockClear();
  mock.module("@tauri-apps/api/core", () => ({ invoke }));
  mock.module("@tauri-apps/api/window", () => ({ ...originalTauriWindow, getCurrentWindow: () => ({ startDragging: drag }) }));
});
afterEach(() => { cleanup(); restoreTauriModuleFixture(); mock.module("@tauri-apps/api/window", () => originalTauriWindow); });
function Surface({ active = true, gif = true, identity = "a" }) {
  const root = useRef<HTMLDivElement>(null);
  const interaction = usePetInteraction({ root, active, gif, identity }, lock);
  return <div ref={root}><button type="button" onMouseDown={interaction.onMouseDown} onMouseMove={interaction.onMouseMove} onMouseUp={interaction.onMouseUp} onContextMenu={(event) => { if (interaction.hit(event)) { const release = interaction.hold(); void Promise.resolve().then(release); } }}>
    <img alt="pet" className="gif-pet-image" ref={(element) => { if (element) { element.getBoundingClientRect = () => new DOMRect(0, 0, 240, 240); setGifHitPolygon(element, [[60,60],[180,60],[180,180],[60,180]]); } }} />
  </button></div>;
}
const body = { button: 0, clientX: 120, clientY: 120, screenX: 120, screenY: 120 };
const blank = { button: 0, clientX: 220, clientY: 220, screenX: 220, screenY: 220 };
test("blank down/up never opens chat; body down plus body up does", async () => {
  const view = render(<Surface />); const button = view.getByRole("button");
  fireEvent.mouseDown(button, blank); fireEvent.mouseUp(button, blank);
  expect(invoke.mock.calls.filter(([command]) => command === "toggle_chat").length).toBe(0);
  fireEvent.mouseDown(button, body); fireEvent.mouseUp(button, blank);
  expect(invoke.mock.calls.filter(([command]) => command === "toggle_chat").length).toBe(0);
  fireEvent.mouseDown(button, body); fireEvent.mouseUp(button, body);
  expect(invoke).toHaveBeenCalledWith("toggle_chat");
});
test("drag begins outside silhouette after a valid down and releases without DOM mouseup", async () => {
  const view = render(<Surface />); const button = view.getByRole("button");
  fireEvent.mouseDown(button, body); fireEvent.mouseMove(button, blank);
  expect(drag).toHaveBeenCalledTimes(1);
  await act(async () => {});
  expect(lock.mock.calls.at(-1)).toEqual([false]);
  fireEvent.mouseUp(button, body);
  expect(invoke.mock.calls.filter(([command]) => command === "toggle_chat").length).toBe(0);
});
test("blur, cancel, hidden state and identity switch reset a pending click", () => {
  const view = render(<Surface />); const button = view.getByRole("button");
  for (const type of ["blur", "pointercancel"]) {
    fireEvent.mouseDown(button, body); window.dispatchEvent(new Event(type)); fireEvent.mouseUp(button, body);
  }
  fireEvent.mouseDown(button, body); view.rerender(<Surface active={false} />); fireEvent.mouseUp(button, body);
  view.rerender(<Surface />); fireEvent.mouseDown(button, body); view.rerender(<Surface identity="b" />); fireEvent.mouseUp(button, body);
  expect(invoke.mock.calls.filter(([command]) => command === "toggle_chat").length).toBe(0);
  expect(lock.mock.calls.at(-1)).toEqual([false]);
});
test("GLB retains rectangular interaction and menu releases its hold", async () => {
  const view = render(<Surface gif={false} />); const button = view.getByRole("button");
  fireEvent.mouseDown(button, blank); fireEvent.mouseUp(button, blank);
  expect(invoke).toHaveBeenCalledTimes(1);
  fireEvent.contextMenu(button, blank);
  expect(lock.mock.calls.at(-1)).toEqual([true]);
  await act(async () => {});
  expect(lock.mock.calls.at(-1)).toEqual([false]);
});


test("native drag dispatch completion retains lock until the physical button is released", async () => {
  pressed = true;
  const view = render(<Surface />); const button = view.getByRole("button");
  fireEvent.mouseDown(button, body); fireEvent.mouseMove(button, blank);
  await act(async () => {});
  expect(lock.mock.calls.at(-1)).toEqual([true]);
  pressed = false;
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 55)); });
  expect(lock.mock.calls.at(-1)).toEqual([false]);
});
test("subthreshold movement remains a click and unmount clears an active hold", async () => {
  const view = render(<Surface />); const button = view.getByRole("button");
  fireEvent.mouseDown(button, body); fireEvent.mouseMove(button, { ...body, screenX: 124 });
  expect(drag).toHaveBeenCalledTimes(0);
  fireEvent.mouseUp(button, body);
  expect(invoke).toHaveBeenCalledWith("toggle_chat");
  pressed = true;
  fireEvent.mouseDown(button, body); fireEvent.mouseMove(button, blank);
  await act(async () => {});
  view.unmount();
  expect(lock.mock.calls.at(-1)).toEqual([false]);
});
