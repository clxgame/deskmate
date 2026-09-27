import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MediaPreview } from "./MediaPreview";

afterEach(cleanup);

describe("MediaPreview", () => {
  test("audio and video expose native playback controls without autoplay or eager file loading", () => {
    const { getByLabelText } = render(<>
      <MediaPreview src="chat-resource://localhost/audio-id" name="recording.flac" mime="audio/flac" lang="en-US" />
      <MediaPreview src="chat-resource://localhost/video-id" name="clip.mp4" mime="video/mp4" lang="en-US" />
    </>);
    const audio = getByLabelText("Preview recording.flac");
    const video = getByLabelText("Preview clip.mp4");
    expect(audio.tagName).toBe("AUDIO");
    expect(video.tagName).toBe("VIDEO");
    for (const media of [audio, video]) {
      expect(media.hasAttribute("controls")).toBe(true);
      expect(media.getAttribute("preload")).toBe("metadata");
      expect(media.hasAttribute("autoplay")).toBe(false);
    }
    expect(video.hasAttribute("playsinline")).toBe(true);
  });

  test("a decode failure explains preview availability and does not disable the player", () => {
    const { getByLabelText, getByRole } = render(
      <MediaPreview src="chat-resource://localhost/video-id" name="clip.mkv" mime="video/x-matroska" lang="en-US" />,
    );
    const video = getByLabelText("Preview clip.mkv");
    fireEvent.error(video);
    expect(getByRole("status").textContent).toContain("may have moved or cannot be read");
    expect(getByRole("status").textContent).toContain("may not support this encoding");
    expect(video.getAttribute("aria-describedby")).toBe(getByRole("status").id);
    expect(video.hasAttribute("controls")).toBe(true);
  });

  test("loading a new source clears the previous preview error", () => {
    const { getByLabelText, getByRole, queryByRole, rerender } = render(
      <MediaPreview src="chat-resource://localhost/broken" name="recording" mime="audio/ogg" lang="en-US" />,
    );
    fireEvent.error(getByLabelText("Preview recording"));
    expect(getByRole("status")).toBeDefined();
    rerender(<MediaPreview src="chat-resource://localhost/working" name="recording" mime="audio/ogg" lang="en-US" />);
    expect(queryByRole("status")).toBeNull();
    expect(getByLabelText("Preview recording").getAttribute("src")).toBe("chat-resource://localhost/working");
  });
});
