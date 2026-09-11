import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { usePetInteraction } from "./usePetInteraction";
import { setGifHitPolygon } from "./gifGeometry";
import { originalTauriWindow, restoreTauriModuleFixture } from "../testing/tauriModuleFixture";

let pressed = false;
const invoke = mock(async (command: string) => command === "pet_primary_button_down" ? pressed : undefined);
const drag = mock(() => Promise.resolve());
const held = mock((_value: boolean) => {});
const activate = mock(() => {});
const lock = mock((_value: boolean) => {});
beforeEach(() => {
  pressed = false; held.mockClear(); activate.mockClear(); invoke.mockClear(); drag.mockClear(); lock.mockClear();
  mock.module("@tauri-apps/api/core", () => ({ invoke }));
  mock.module("@tauri-apps/api/window", () => ({ ...originalTauriWindow, getCurrentWindow: () => ({ startDragging: drag }) }));
});
afterEach(() => { cleanup(); restoreTauriModuleFixture(); mock.module("@tauri-apps/api/window", () => originalTauriWindow); });
function Surface({ active = true, gif = true, identity = "a" }) {
  const root = useRef<HTMLDivElement>(null);
  const interaction = usePetInteraction({ root, active, gif, identity, onHeldChange: held, onInteract: activate }, lock);
  return <div ref={root}><button type="button" onKeyDown={interaction.onKeyDown} onMouseDown={interaction.onMouseDown} onMouseMove={interaction.onMouseMove} onMouseUp={interaction.onMouseUp} onContextMenu={(event) => { if (interaction.hit(event)) { const release = interaction.hold(); void Promise.resolve().then(release); } }}>
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

test("hover and transparent clicks never report wake but body press reports held until release", () => {
  // Given the real interaction hook over a polygon body.
  const view = render(<Surface />); const button = view.getByRole("button"); held.mockClear();
  // When hover and transparent clicks precede a body click.
  fireEvent.mouseMove(button, body); fireEvent.mouseDown(button, blank); fireEvent.mouseUp(button, blank);
  expect(held).toHaveBeenCalledTimes(0); expect(activate).toHaveBeenCalledTimes(0);
  fireEvent.mouseDown(button, body); fireEvent.mouseUp(button, body);
  // Then wake suspension accompanies the original single chat operation.
  expect(held.mock.calls).toEqual([[true], [false]]);
  expect(invoke.mock.calls.filter(([command]) => command === "toggle_chat")).toHaveLength(1);
});
test("keyboard activation wakes and performs the original operation", () => {
  // Given a keyboard focused interaction surface.
  const view = render(<Surface />);
  // When Enter activates it.
  fireEvent.keyDown(view.getByRole("button"), { key: "Enter" });
  // Then the same activation both wakes and opens chat.
  expect(activate).toHaveBeenCalledTimes(1); expect(invoke).toHaveBeenCalledWith("toggle_chat");
});

test("menu holds report suspension and blur releases it", () => {
  // Given an active surface with a context menu.
  const view = render(<Surface />); const button = view.getByRole("button"); held.mockClear();
  // When the menu is held then the window loses focus.
  fireEvent.contextMenu(button, body); window.dispatchEvent(new Event("blur"));
  // Then sleep receives a balanced hold lifecycle.
  expect(held.mock.calls).toEqual([[true], [false]]);
});
test("pointer cancellation releases a held body without executing a click", () => {
  // Given a held body press.
  const view = render(<Surface />); const button = view.getByRole("button"); held.mockClear(); fireEvent.mouseDown(button, body);
  // When the pointer is cancelled before release.
  window.dispatchEvent(new Event("pointercancel")); fireEvent.mouseUp(button, body);
  // Then hold is cleared and no chat action runs.
  expect(held.mock.calls).toEqual([[true], [false]]); expect(invoke).not.toHaveBeenCalled();
});
