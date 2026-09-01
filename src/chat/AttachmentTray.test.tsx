import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { dict } from "../lib/i18n";
import { beginStagingAttachment, reduceAttachmentState, type AttachmentLifecycleState } from "./attachmentState";
import { AttachmentTray } from "./AttachmentTray";

const labels = dict("en-US");

function ncmConfirmation(): AttachmentLifecycleState {
  return reduceAttachmentState(
    beginStagingAttachment({
      localId: "local-ncm",
      name: "album.ncm",
      mime: "application/x-ncm",
      size: 12_345,
      sourceKind: "ncm",
    }),
    {
      type: "stageSucceeded",
      operationToken: 1,
      source: {
        id: "att-ncm",
        name: "album.ncm",
        mime: "application/x-ncm",
        size: 12_345,
        kind: "ncm",
      },
    },
  );
}

function readyMarkdown(): AttachmentLifecycleState {
  return reduceAttachmentState(
    beginStagingAttachment({
      localId: "local-md",
      name: "notes.md",
      mime: "text/markdown",
      size: 512,
      sourceKind: "ordinary",
    }),
    {
      type: "stageSucceeded",
      operationToken: 1,
      source: {
        id: "att-md",
        name: "notes.md",
        mime: "text/markdown",
        size: 512,
        kind: "ordinary",
      },
    },
  );
}

function failedConversion(): AttachmentLifecycleState {
  return reduceAttachmentState(
    reduceAttachmentState(
      reduceAttachmentState(
        beginStagingAttachment({
          localId: "local-failed-ncm",
          name: "broken.ncm",
          mime: "application/x-ncm",
          size: 4_096,
          sourceKind: "ncm",
        }),
        {
          type: "stageSucceeded",
          operationToken: 1,
          source: {
            id: "att-failed-ncm",
            name: "broken.ncm",
            mime: "application/x-ncm",
            size: 4_096,
            kind: "ncm",
          },
        },
      ),
      { type: "confirm" },
    ),
    { type: "conversionFailed", operationToken: 2, message: "ncmdump failed" },
  );
}

afterEach(cleanup);

describe("AttachmentTray", () => {
  test("renders staging, ready, failure, and NCM confirmation states accessibly", () => {
    const onConfirm = mock(() => undefined);
    const onCancel = mock(() => undefined);
    const onRemove = mock(() => undefined);
    const onRetry = mock(() => undefined);

    render(
      <AttachmentTray
        t={labels}
        items={[
          beginStagingAttachment({
            localId: "local-uploading",
            name: "uploading.flac",
            mime: "audio/flac",
            size: 2_048,
            sourceKind: "ordinary",
          }),
          readyMarkdown(),
          ncmConfirmation(),
          failedConversion(),
        ]}
        onCancel={onCancel}
        onConfirm={onConfirm}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("region", { name: labels.chatAttachmentTrayLabel })).toBeDefined();
    expect(screen.getByText(labels.chatAttachmentStaging)).toBeDefined();
    expect(screen.getAllByText(labels.chatAttachmentReady)).toHaveLength(2);
    expect(screen.getByText(labels.chatAttachmentFailed)).toBeDefined();

    const dialog = screen.getByRole("alertdialog", {
      name: labels.chatAttachmentNcmTitle,
    });
    expect(within(dialog).getByText(labels.chatAttachmentNcmDescription("album.ncm"))).toBeDefined();
    expect(within(dialog).getByRole("button", { name: labels.chatAttachmentConvertNcm })).toBeDefined();
    expect(within(dialog).getByRole("button", { name: labels.chatAttachmentCancelNcm })).toBeDefined();
    expect(screen.getByRole("button", { name: labels.chatAttachmentRetry("broken.ncm") })).toBeDefined();
    expect(screen.getByRole("button", { name: `${labels.chatAttachmentRemove} notes.md` })).toBeDefined();
  });

  test("keyboard tab reaches Convert, Cancel, Retry, and remove with visible focus styles", async () => {
    const user = userEvent.setup();
    render(
      <AttachmentTray
        t={labels}
        items={[ncmConfirmation(), failedConversion(), readyMarkdown()]}
        onCancel={() => undefined}
        onConfirm={() => undefined}
        onRemove={() => undefined}
        onRetry={() => undefined}
      />,
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: `${labels.chatAttachmentRemove} album.ncm` }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: labels.chatAttachmentConvertNcm }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: labels.chatAttachmentCancelNcm }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: labels.chatAttachmentRetry("broken.ncm") }),
    );

    const css = await Bun.file(new URL("./chat.css", import.meta.url)).text();
    expect(css).toContain(".chat-attachment-action:focus-visible");
    expect(css).toContain("var(--shadow-focus)");
  });

  test("invokes only the explicit action selected by the user", async () => {
    const user = userEvent.setup();
    const onConfirm = mock(() => undefined);
    const onCancel = mock(() => undefined);
    const onRetry = mock(() => undefined);
    const onRemove = mock(() => undefined);

    render(
      <AttachmentTray
        t={labels}
        items={[ncmConfirmation(), failedConversion()]}
        onCancel={onCancel}
        onConfirm={onConfirm}
        onRemove={onRemove}
        onRetry={onRetry}
      />,
    );

    expect(onConfirm).toHaveBeenCalledTimes(0);
    await user.click(screen.getByRole("button", { name: labels.chatAttachmentConvertNcm }));
    expect(onConfirm).toHaveBeenCalledWith("local-ncm");
    expect(onCancel).toHaveBeenCalledTimes(0);

    await user.click(screen.getByRole("button", { name: labels.chatAttachmentRetry("broken.ncm") }));
    expect(onRetry).toHaveBeenCalledWith("local-failed-ncm");
    expect(onRemove).toHaveBeenCalledTimes(0);
  });
});
