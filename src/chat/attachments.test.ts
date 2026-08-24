import { describe, expect, test } from "bun:test";
import {
  createPendingAttachment,
  formatAttachmentSize,
  isNcmFile,
  isSupportedAttachment,
  snapshotSelectedFiles,
  toOpenCodeFilePart,
} from "./attachments";

describe("chat attachments", () => {
  test("accepts images and readable document formats", () => {
    expect(isSupportedAttachment(new File(["png"], "cover.png", { type: "image/png" }))).toBe(
      true,
    );
    expect(isSupportedAttachment(new File(["text"], "notes.md", { type: "text/markdown" }))).toBe(
      true,
    );
    expect(
      isSupportedAttachment(
        new File(["doc"], "brief.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      ),
    ).toBe(true);
  });

  test("keeps ncm recognition separate from ordinary readable files", () => {
    expect(isNcmFile(new File(["ncm"], "music.NCM"))).toBe(true);
    expect(isNcmFile(new File(["txt"], "music.txt"))).toBe(false);
  });

  test("formats attachment sizes for the compact tray", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2 KB");
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  test("does not send attachments before they are ready", () => {
    const pending = {
      id: "pending",
      name: "notes.md",
      mime: "text/plain",
      size: 5,
      kind: "text" as const,
      status: "pending" as const,
    };
    expect(toOpenCodeFilePart(pending)).toBeNull();
    expect(
      toOpenCodeFilePart({
        ...pending,
        status: "ready",
        dataUrl: "data:text/plain;base64,SGk=",
      }),
    ).toEqual({
      type: "file",
      mime: "text/plain",
      filename: "notes.md",
      url: "data:text/plain;base64,SGk=",
    });
  });

  test("keeps a selected file pending until the send action prepares it", () => {
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    const pending = createPendingAttachment(file);

    expect(pending.status).toBe("pending");
    expect(pending.file).toBe(file);
    expect(toOpenCodeFilePart(pending)).toBeNull();
  });

  test("snapshots the file picker list before the input is cleared", () => {
    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    const liveList: { 0: File; length: number } = { 0: file, length: 1 };
    const snapshot = snapshotSelectedFiles(liveList);

    liveList.length = 0;

    expect(snapshot).toEqual([file]);
  });
});
