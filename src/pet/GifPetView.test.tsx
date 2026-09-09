import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { GifPetView } from "./GifPetView";
import { type LoadedGifPersona } from "./gifAssets";
import { parseFigure2dConfig } from "./figure2d";
import config from "../../public/personas/xiaoxiongchong/figure2d.json";

afterEach(cleanup);
const fixture = (prefix: string): LoadedGifPersona => ({ config: parseFigure2dConfig({ schemaVersion: 1, canvas: config.canvas, feedback: config.feedback, leaving: config.leaving, thinkingEscalationMs: 8000, animations: Object.fromEntries(Object.entries(config.animations).map(([state, action]) => [state, { file: action.file, scale: 1, offsetY: 0 }])) }), urls: {
  idle: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/idle.gif`, thinking: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/thinking.gif`, working: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/working.gif`,
  talking: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/talking.gif`, success: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/success.gif`, error: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/error.gif`, leaving: `data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7#${prefix}/leaving.gif`,
} });
const ignoreError = () => {};

test("renders native GIF and computes departure from displayed width", async () => {
  const load = async () => fixture("a");
  const view = render(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => {});
  view.rerender(<GifPetView personaId="a" state="leaving" width={160} leaving onError={ignoreError} load={load} />);
  const image = view.container.querySelector("img");
  expect(view.container.querySelector("canvas")).toBeNull();
  expect(image?.getAttribute("src")).toBe(fixture("a").urls.leaving);
  expect(image?.style.transform).toBe("translateX(-80px)");
  expect(image?.style.opacity).toBe("0");
  expect(image?.style.transition).toContain("910ms");
  view.rerender(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  expect(image?.style.opacity).toBe("1");
  expect(image?.style.transform).toBe("translateX(0px)");
});

test("clears the previous ready persona and rejects a stale load", async () => {
  const pending = new Map<string, (value: LoadedGifPersona) => void>();
  const load = (id: string) => new Promise<LoadedGifPersona>((resolve) => pending.set(id, resolve));
  const view = render(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => pending.get("a")?.(fixture("a")));
  view.rerender(<GifPetView personaId="b" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  expect(view.container.querySelectorAll("img").length).toBe(0);
  view.rerender(<GifPetView personaId="c" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => pending.get("c")?.(fixture("c")));
  await act(async () => pending.get("b")?.(fixture("b")));
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe(fixture("c").urls.idle);
});

test("reports a failed resource and aborts pending loads on unmount", async () => {
  const errors: (string | null)[] = [];
  let signal: AbortSignal | undefined;
  const load = async (_id: string, incoming: AbortSignal) => { signal = incoming; throw new Error("missing animation"); };
  const view = render(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={(message) => errors.push(message)} load={load} />);
  await act(async () => {});
  expect(errors).toContain("missing animation");
  view.unmount();
  expect(signal?.aborted).toBe(true);
});





test("v2 render adds calibrated X to departure and registers the matching silhouette", async () => {
  const base = fixture("v2");
  const animations = Object.fromEntries(Object.entries(base.config.animations).map(([state, action]) => [state, { ...action, scale: 0.5, offsetX: 24, offsetY: 48, hitPolygon: [[60,60],[180,60],[180,180],[60,180]] }]));
  const data = { ...base, config: parseFigure2dConfig({ schemaVersion: 2, canvas: base.config.canvas, animations, feedback: base.config.feedback, leaving: base.config.leaving, thinkingSelection: "random" }) };
  const load = async () => data;
  const view = render(<GifPetView personaId="v2" state="idle" width={160} leaving={false} load={load} onError={ignoreError} />);
  await act(async () => {});
  const image = view.container.querySelector("img");
  expect(image?.style.left).toBe("56px");
  expect(image?.style.width).toBe("80px");
  expect(image?.style.bottom).toBe("32px");
  view.rerender(<GifPetView personaId="v2" state="leaving" width={160} leaving load={load} onError={ignoreError} />);
  expect(image?.style.left).toBe("56px");
  expect(image?.style.transform).toBe("translateX(-40px)");
  expect(image?.getAttribute("data-hit-disabled")).toBe("true");
});
