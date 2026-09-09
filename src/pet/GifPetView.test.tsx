import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { GifPetView } from "./GifPetView";
import { type LoadedGifPersona } from "./gifAssets";
import { parseFigure2dConfig } from "./figure2d";
import config from "../../public/personas/xiaoxiongchong/figure2d.json";

afterEach(cleanup);
const fixture = (prefix: string): LoadedGifPersona => ({ config: parseFigure2dConfig(config), urls: {
  idle: `${prefix}/idle.gif`, thinking: `${prefix}/thinking.gif`, working: `${prefix}/working.gif`,
  talking: `${prefix}/talking.gif`, success: `${prefix}/success.gif`, error: `${prefix}/error.gif`, leaving: `${prefix}/leaving.gif`,
} });
const ignoreError = () => {};

test("renders native GIF and computes departure from displayed width", async () => {
  const load = async () => fixture("a");
  const view = render(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => {});
  view.rerender(<GifPetView personaId="a" state="leaving" width={160} leaving onError={ignoreError} load={load} />);
  const image = view.container.querySelector("img");
  expect(view.container.querySelector("canvas")).toBeNull();
  expect(image?.getAttribute("src")).toBe("a/leaving.gif");
  expect(image?.style.transform).toBe("translateX(-80px)");
  expect(image?.style.opacity).toBe("0");
  expect(image?.style.transition).toContain("910ms");
  view.rerender(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  expect(image?.style.opacity).toBe("1");
  expect(image?.style.transform).toBe("translateX(0px)");
});

test("retains the previous ready persona and rejects a stale load", async () => {
  const pending = new Map<string, (value: LoadedGifPersona) => void>();
  const load = (id: string) => new Promise<LoadedGifPersona>((resolve) => pending.set(id, resolve));
  const view = render(<GifPetView personaId="a" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => pending.get("a")?.(fixture("a")));
  view.rerender(<GifPetView personaId="b" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("a/idle.gif");
  view.rerender(<GifPetView personaId="c" state="idle" width={160} leaving={false} onError={ignoreError} load={load} />);
  await act(async () => pending.get("c")?.(fixture("c")));
  await act(async () => pending.get("b")?.(fixture("b")));
  expect(view.container.querySelector("img")?.getAttribute("src")).toBe("c/idle.gif");
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
