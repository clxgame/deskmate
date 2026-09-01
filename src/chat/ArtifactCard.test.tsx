import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dict } from "../lib/i18n";
import type { GeneratedArtifact } from "./attachmentState";
import { ArtifactCard, type ArtifactCardState } from "./ArtifactCard";

const labels = dict("en-US");

const mp3Artifact: GeneratedArtifact = {
  id: "artifact-mp3",
  sourceId: "att-ncm",
  name: "song.mp3",
  mime: "audio/mpeg",
  size: 4_096,
  previewDataUrl: "data:audio/mpeg;base64,AAAA",
};

const flacArtifact: GeneratedArtifact = {
  id: "artifact-flac",
  sourceId: "att-flac",
  name: "song.flac",
  mime: "audio/flac",
  size: 8_192,
  previewDataUrl: "data:audio/flac;base64,AAAA",
};

type ReadyArtifactState = Extract<ArtifactCardState, { readonly kind: "artifact-ready" }>;

function readyArtifact(artifact: GeneratedArtifact): ReadyArtifactState {
  return {
    kind: "artifact-ready",
    localId: artifact.sourceId,
    operationToken: 4,
    artifact,
    exportState: { kind: "idle" },
  };
}

function exportedArtifact(): ReadyArtifactState {
  return {
    ...readyArtifact(mp3Artifact),
    exportState: { kind: "exported", destinationName: "song (1).mp3" },
  };
}

function failedExport(): ArtifactCardState {
  return {
    kind: "failed",
    localId: mp3Artifact.sourceId,
    operationToken: 5,
    phase: "export",
    artifact: mp3Artifact,
    message: "Downloads is unavailable",
  };
}

afterEach(cleanup);

describe("ArtifactCard", () => {
  test("renders MP3 and FLAC artifact rows with audio controls and explicit download buttons", () => {
    const onDownload = mock(() => undefined);
    const onRetry = mock(() => undefined);

    render(
      <>
        <ArtifactCard t={labels} state={readyArtifact(mp3Artifact)} onDownload={onDownload} onRetry={onRetry} />
        <ArtifactCard t={labels} state={readyArtifact(flacArtifact)} onDownload={onDownload} onRetry={onRetry} />
      </>,
    );

    expect(screen.getByRole("article", { name: labels.chatArtifactCardLabel("song.mp3") })).toBeDefined();
    expect(screen.getByRole("article", { name: labels.chatArtifactCardLabel("song.flac") })).toBeDefined();
    expect(screen.getByLabelText(labels.chatArtifactAudioPreview("song.mp3"))).toBeDefined();
    expect(screen.getByLabelText(labels.chatArtifactAudioPreview("song.flac"))).toBeDefined();
    expect(screen.getAllByRole("button", { name: labels.chatArtifactDownload })).toHaveLength(2);
    expect(onDownload).toHaveBeenCalledTimes(0);
    expect(onRetry).toHaveBeenCalledTimes(0);
  });

  test("announces save success politely and export failure assertively", () => {
    render(
      <>
        <ArtifactCard t={labels} state={exportedArtifact()} onDownload={() => undefined} onRetry={() => undefined} />
        <ArtifactCard t={labels} state={failedExport()} onDownload={() => undefined} onRetry={() => undefined} />
      </>,
    );

    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain(labels.chatArtifactSaved("song (1).mp3"));

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(labels.chatArtifactSaveFailed("Downloads is unavailable"));
    expect(screen.getByRole("button", { name: labels.chatArtifactRetryDownload })).toBeDefined();
  });

  test("keyboard tab reaches Download and Retry with visible focus styles", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ArtifactCard t={labels} state={readyArtifact(mp3Artifact)} onDownload={() => undefined} onRetry={() => undefined} />
        <ArtifactCard t={labels} state={failedExport()} onDownload={() => undefined} onRetry={() => undefined} />
      </>,
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: labels.chatArtifactDownload }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: labels.chatArtifactRetryDownload }),
    );

    const css = await Bun.file(new URL("./chat.css", import.meta.url)).text();
    expect(css).toContain(".chat-artifact-download:focus-visible");
    expect(css).toContain(".chat-artifact-retry:focus-visible");
    expect(css).toContain("var(--shadow-focus)");
  });

  test("calls export only after a user activates Download or Retry", async () => {
    const user = userEvent.setup();
    const onDownload = mock(() => undefined);
    const onRetry = mock(() => undefined);

    render(
      <>
        <ArtifactCard t={labels} state={readyArtifact(mp3Artifact)} onDownload={onDownload} onRetry={onRetry} />
        <ArtifactCard t={labels} state={failedExport()} onDownload={onDownload} onRetry={onRetry} />
      </>,
    );

    expect(onDownload).toHaveBeenCalledTimes(0);
    expect(onRetry).toHaveBeenCalledTimes(0);

    await user.click(screen.getByRole("button", { name: labels.chatArtifactDownload }));
    expect(onDownload).toHaveBeenCalledWith("artifact-mp3");

    await user.click(screen.getByRole("button", { name: labels.chatArtifactRetryDownload }));
    expect(onRetry).toHaveBeenCalledWith("artifact-mp3");
  });
});
