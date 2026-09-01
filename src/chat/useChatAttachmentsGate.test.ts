import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { AttachmentHost } from "./attachmentApi";
import { useChatAttachments, type UseChatAttachmentsResult } from "./useChatAttachments";
import { planStageUpload } from "./useChatAttachmentsUtils";
import {
  createFakeHost,
  drive,
  file,
  rejectConvert,
  resolveConvert,
  resolveStage,
  ready,
  sizedFile,
  type FakeHost,
} from "./useChatAttachmentsHarness.test";

const MIB = 1024 * 1024;
let controller: UseChatAttachmentsResult | null = null;
let idIndex = 0;

afterEach(() => {
  controller = null;
  idIndex = 0;
  cleanup();
});

function Harness(props: {
  readonly host: AttachmentHost;
  readonly sessionId?: string;
  readonly onBackgroundError?: (message: string) => void;
}) {
  controller = useChatAttachments({
    sessionId: props.sessionId ?? "ses-1",
    personaId: "xiaozhu",
    host: props.host,
    makeLocalId: () => `gate-${idIndex += 1}`,
    onBackgroundError: props.onBackgroundError,
  });
  return null;
}

describe("useChatAttachments gate regressions", () => {
  test("accepts a 21 MiB generic-MIME NCM as application/x-ncm", async () => {
    const plan = await planStageUpload(
      sizedFile("song.ncm", 21 * MIB, "application/octet-stream"),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 0 },
    );

    expect(plan.kind).toBe("upload");
    if (plan.kind !== "upload") throw new Error("upload plan expected");
    expect(plan.request.mime).toBe("application/x-ncm");
    expect(plan.request.size).toBe(21 * MIB);
  });

  test("routes recognized generic-MIME files by safe extension", async () => {
    const uploads = await Promise.all([
      planStageUpload(file("notes.md", "# hi", "application/octet-stream"), "ses-1", { ordinaryBytes: 0, totalBytes: 0 }),
      planStageUpload(file("cover.png", "png", "application/octet-stream"), "ses-1", { ordinaryBytes: 0, totalBytes: 0 }),
      planStageUpload(file("guide.pdf", "pdf", "application/octet-stream"), "ses-1", { ordinaryBytes: 0, totalBytes: 0 }),
      planStageUpload(file("brief.docx", "docx", "application/octet-stream"), "ses-1", { ordinaryBytes: 0, totalBytes: 0 }),
    ]);

    expect(uploads.map((plan) => plan.kind)).toEqual(["upload", "upload", "upload", "upload"]);
    expect(uploads.map((plan) => (plan.kind === "upload" ? plan.request.mime : ""))).toEqual([
      "text/plain",
      "image/png",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  test("rejects unknown generic bytes and non-NCM audio extensions", async () => {
    const generic = await planStageUpload(
      file("payload.bin", "bin", "application/octet-stream"),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 0 },
    );
    const audio = await planStageUpload(
      file("song.mp3", "mp3", "application/octet-stream"),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 0 },
    );

    expect(generic.kind).toBe("reject");
    expect(audio.kind).toBe("reject");
  });

  test("rejects NCM over 64 MiB and session total overflow before reading bytes", async () => {
    const tooLarge = await planStageUpload(
      sizedFile("huge.ncm", 64 * MIB + 1, ""),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 0 },
    );
    const overflow = await planStageUpload(
      sizedFile("song.ncm", 2 * MIB, ""),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 63 * MIB },
    );

    expect(tooLarge).toEqual({ kind: "reject", message: "huge.ncm 超过 64 MB 限制" });
    expect(overflow).toEqual({ kind: "reject", message: "附件总大小超过 64 MB 限制" });
  });

  test("keeps ordinary attachment item and aggregate budgets at 20 MiB", async () => {
    const item = await planStageUpload(
      sizedFile("notes.md", 21 * MIB, "text/markdown"),
      "ses-1",
      { ordinaryBytes: 0, totalBytes: 0 },
    );
    const aggregate = await planStageUpload(
      sizedFile("extra.md", 2 * MIB, "text/markdown"),
      "ses-1",
      { ordinaryBytes: 19 * MIB, totalBytes: 19 * MIB },
    );

    expect(item).toEqual({ kind: "reject", message: "notes.md 超过 20 MB 限制" });
    expect(aggregate).toEqual({ kind: "reject", message: "普通附件总大小超过 20 MB 限制" });
  });

  test("accepts staging when retained artifact plus new file exactly reaches the session budget", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await retainConvertedArtifact(host, 63 * MIB);
    await drive(() => getController().stageFromPicker([sizedFile("tail.md", MIB, "text/markdown")]));

    await waitFor(() => expect(host.stageRequests).toHaveLength(2));
    expect(host.stageRequests[1]?.fileName).toBe("tail.md");
  });

  test("rejects staging when retained artifacts would exceed the session budget", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await retainConvertedArtifact(host, 63 * MIB);
    await drive(() => getController().stageFromPicker([sizedFile("too-much.md", MIB + 1, "text/markdown")]));

    await waitFor(() => expect(getController().items[0]).toMatchObject({
      kind: "failed",
      message: "附件总大小超过 64 MB 限制",
      phase: "staging",
    }));
    expect(host.stageRequests).toHaveLength(1);
  });

  test("cancel after conversion failure discards the retryable staged source once", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await failNcmConversion(host);
    await drive(() => getController().cancel("gate-1"));

    expect(host.discardRequests.map((request) => request.attachmentId)).toEqual(["stage-ncm"]);
  });

  test("remove after conversion failure discards the retryable staged source once", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await failNcmConversion(host);
    await drive(() => getController().remove("gate-1"));

    expect(host.discardRequests.map((request) => request.attachmentId)).toEqual(["stage-ncm"]);
  });

  test("reset from an empty initial session skips backend cleanup", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host, sessionId: "" }));

    await drive(() => getController().resetSession("ses-1"));

    expect(host.cleanupSessions).toEqual([]);
  });

  test("reset from a valid previous session only clears local attachment state", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host, sessionId: "ses-1" }));

    await drive(() => getController().resetSession("ses-2"));

    expect(host.cleanupSessions).toEqual([]);
  });

  test("explicit cleanup cleans a valid session and reports nonfatal failures", async () => {
    const cleanupRequests: string[] = [];
    const diagnostics: string[] = [];
    const failingHost: AttachmentHost = {
      invoke(command, payload) {
        if (command === "cleanup_chat_session") {
          const request = payload.request;
          if ("sessionId" in request) cleanupRequests.push(request.sessionId);
          return Promise.reject(new Error("cleanup denied"));
        }
        return createFakeHost().invoke(command, payload);
      },
    };
    render(createElement(Harness, {
      host: failingHost,
      onBackgroundError: (message) => diagnostics.push(message),
    }));

    await getController().cleanupSession("");
    await getController().cleanupSession("ses-old");

    expect(cleanupRequests).toEqual(["ses-old"]);
    expect(diagnostics).toEqual(["cleanup denied"]);
  });

  test("successful ordinary send discard removes ready sources and keeps artifacts", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(1));
    await resolveStage(host, 0, "stage-notes", "text");

    await waitFor(() => expect(getController().items[0]?.kind).toBe("ready"));
    await drive(() => getController().discardSentSources(["gate-1"]));

    expect(host.discardRequests.map((request) => request.attachmentId)).toEqual(["stage-notes"]);
    expect(getController().items).toEqual([]);
  });
});

function getController(): UseChatAttachmentsResult {
  if (controller === null) throw new Error("controller not rendered");
  return controller;
}

async function failNcmConversion(host: FakeHost): Promise<void> {
  await drive(() => getController().stageFromPicker([file("song.ncm", "ncm", "application/octet-stream")]));
  await waitFor(() => expect(host.stageRequests).toHaveLength(1));
  expect(host.stageRequests[0]?.mime).toBe("application/x-ncm");
  await resolveStage(host, 0, "stage-ncm", "audio");
  await waitFor(() => expect(getController().items[0]?.kind).toBe("awaiting-confirmation"));
  await drive(() => getController().confirm("gate-1"));
  await waitFor(() => expect(host.convertRequests).toHaveLength(1));
  await rejectConvert(host, 0, "ncmdump failed");
  await waitFor(() => expect(getController().items[0]).toMatchObject({ kind: "failed", phase: "conversion" }));
}

async function retainConvertedArtifact(host: FakeHost, size: number): Promise<void> {
  await drive(() => getController().stageFromPicker([file("song.ncm", "ncm", "application/octet-stream")]));
  await waitFor(() => expect(host.stageRequests).toHaveLength(1));
  await resolveStage(host, 0, "stage-ncm", "audio");
  await waitFor(() => expect(getController().items[0]?.kind).toBe("awaiting-confirmation"));
  await drive(() => getController().confirm("gate-1"));
  await waitFor(() => expect(host.convertRequests).toHaveLength(1));
  await resolveConvert(host, 0, { ...ready("artifact-song", "song.mp3", "audio/mpeg", "audio"), size });
  await waitFor(() => expect(getController().artifacts[0]?.artifact.size).toBe(size));
}
