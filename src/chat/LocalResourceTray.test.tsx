import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as tauriCore from "@tauri-apps/api/core";
import * as tauriEvent from "@tauri-apps/api/event";
import { restoreTauriModuleFixture } from "../testing/tauriModuleFixture";
import { LocalResourceTray } from "./LocalResourceTray";
import type { LocalResource } from "./localResources";

const folder: LocalResource = {
  id: "folder-id", name: "Audio", kind: "directory", mime: "application/x-directory", size: null, previewUrl: null,
};
const video: LocalResource = {
  id: "video-id", name: "clip.mp4", kind: "video", mime: "video/mp4", size: 2048,
  previewUrl: "chat-resource://localhost/video-id",
};

let internals: PropertyDescriptor | undefined;
const calls: Array<{ command: string; args: unknown }> = [];
let result: unknown;
let failure: Error | null;
let previousCore = { ...tauriCore };
let previousEvent = { ...tauriEvent };

beforeEach(() => {
  previousCore = { ...tauriCore };
  previousEvent = { ...tauriEvent };
  restoreTauriModuleFixture();
  internals = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
  calls.length = 0;
  result = { relativePath: "", entries: [{ name: "song.mp3", kind: "file", size: 1024 }], truncated: false };
  failure = null;
  Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {
    invoke: (command: string, args: unknown) => {
      calls.push({ command, args });
      return failure ? Promise.reject(failure) : Promise.resolve(result);
    },
  } });
});

afterEach(() => {
  cleanup();
  if (internals) Object.defineProperty(window, "__TAURI_INTERNALS__", internals);
  else Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  mock.module("@tauri-apps/api/core", () => previousCore);
  mock.module("@tauri-apps/api/event", () => previousEvent);
});

describe("LocalResourceTray", () => {
  test("folder preview is lazy and reuses its bounded listing when reopened", async () => {
    const { getByRole, getByText, queryByText } = render(<LocalResourceTray resources={[folder]} lang="en-US" />);
    expect(calls).toHaveLength(0);
    expect(queryByText("0 B")).toBeNull();
    fireEvent.click(getByRole("button", { name: "Show contents Audio" }));
    await waitFor(() => expect(getByText("song.mp3")).toBeDefined());
    expect(calls).toEqual([{ command: "list_chat_resource_directory", args: { resourceId: "folder-id" } }]);
    fireEvent.click(getByRole("button", { name: "Hide contents Audio" }));
    expect(queryByText("song.mp3")).toBeNull();
    fireEvent.click(getByRole("button", { name: "Show contents Audio" }));
    expect(getByText("song.mp3")).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  test("directory errors hide backend paths and can be retried", async () => {
    failure = new Error("Permission denied /Users/private/media/Audio");
    const { getByRole, getByText, container } = render(<LocalResourceTray resources={[folder]} lang="en-US" />);
    fireEvent.click(getByRole("button", { name: "Show contents Audio" }));
    await waitFor(() => expect(getByRole("button", { name: "Retry" })).toBeDefined());
    expect(container.textContent).not.toContain("/Users/");
    expect(getByRole("status").textContent).toContain("This folder cannot be read");
    failure = null;
    fireEvent.click(getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(getByText("song.mp3")).toBeDefined());
    expect(calls).toHaveLength(2);
  });

  test("large directories render only a bounded preview and say it is incomplete", async () => {
    result = { relativePath: "", entries: Array.from({ length: 105 }, (_, index) => ({
      name: `file-${index}.txt`, kind: "file", size: 10,
    })) };
    const { getByRole, getByText, queryByText } = render(<LocalResourceTray resources={[folder]} lang="en-US" />);
    fireEvent.click(getByRole("button", { name: "Show contents Audio" }));
    await waitFor(() => expect(getByText("Showing some items")).toBeDefined());
    expect(getByRole("list").children.length).toBe(100);
    expect(queryByText("file-100.txt")).toBeNull();
  });

  test("sent resources keep media playback without composer removal actions", () => {
    const { getByLabelText, queryByRole } = render(<LocalResourceTray resources={[video]} lang="en-US" />);
    expect(getByLabelText("Preview clip.mp4").tagName).toBe("VIDEO");
    expect(queryByRole("button", { name: "Remove clip.mp4" })).toBeNull();
  });

  test("media errors preserve the attachment and its independent removal action", () => {
    const onRemove = mock(() => undefined);
    const { getByLabelText, getByRole } = render(
      <LocalResourceTray resources={[video]} onRemove={onRemove} lang="en-US" />,
    );
    fireEvent.error(getByLabelText("Preview clip.mp4"));
    expect(onRemove).not.toHaveBeenCalled();
    expect(getByRole("article", { name: "clip.mp4" })).toBeDefined();
    fireEvent.click(getByRole("button", { name: "Remove clip.mp4" }));
    expect(onRemove).toHaveBeenCalledWith("video-id");
  });

  test("image resources retain their details when the thumbnail cannot be decoded", () => {
    const image: LocalResource = {
      id: "image-id", name: "photo.png", kind: "file", mime: "image/png", size: 1024,
      previewUrl: "chat-resource://localhost/image-id",
    };
    const onRemove = mock(() => undefined);
    const { getByRole, queryByRole } = render(<LocalResourceTray resources={[image]} onRemove={onRemove} lang="en-US" />);
    fireEvent.error(getByRole("img", { name: "photo.png" }));
    expect(queryByRole("img", { name: "photo.png" })).toBeNull();
    expect(getByRole("status").textContent).toContain("image preview is unavailable");
    expect(getByRole("article", { name: "photo.png" })).toBeDefined();
    expect(getByRole("button", { name: "Remove photo.png" })).toBeDefined();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
