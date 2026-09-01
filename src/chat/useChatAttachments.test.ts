import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { AttachmentHost } from "./attachmentApi";
import { useChatAttachments, type UseChatAttachmentsResult } from "./useChatAttachments";
import {
  createFakeHost,
  drive,
  file,
  ready,
  rejectExport,
  rejectStage,
  resolveConvert,
  resolveExport,
  resolveStage,
  type FakeHost,
} from "./useChatAttachmentsHarness.test";

const PDF_FIXTURE_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDkgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MiBUZCAoUERGIHNlbWFudGljIHRleHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDgKJSVFT0YK";
const DOCX_FIXTURE_BASE64 = "UEsDBBQAAAAIAJyTHF28WL9R6AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbHyQTU7DMBCFr+KdFyh26AIhlKQLKEtgUQ5gOZPEwp6xPNMQbo/Sli5QYf1+vqfXbJcU1QyFA2Grb02tFaCnPuDY6vf9c3Wvt12z/8rAakkRudWTSH6wlv0EybGhDLikOFBJTthQGW12/sONYDd1fWc9oQBKJWuH7ponGNwhitotAnjCFois1ePJuLJa7XKOwTsJhHbG/helOhNMgXj08BQy3ywpanuVsCp/A8651xlKCT2oN1fkxSVotf2k0tue/CEBivm/5spOGobg4ZJf23IhD8wBxxTNRUku4M9+e7y7+wYAAP//AwBQSwMEFAAAAAgAnJMcXXqYOcGrAAAAGAEAAAsAAABfcmVscy8ucmVsc4zPsQ7CIBQF0F9he5PQOhhjSrsYk66mfgCB15YIPAKo9e9dHKxxcL25OTe36Rbv2B1TthQk1LwChkGTsWGScBlOmz10bXNGp4qlkGcbM1u8C1nCXEo8CJH1jF5lThHD4t1IyauSOaVJRKWvakKxraqdSJ8GrE3WGwmpNzWw4RnxH5vG0Wo8kr55DOXHxFcD2KDShEXCg5IR5h3zxTsQbSNWF9sXAAAA//8DAFBLAwQUAAAACACckxxdrNxeuKgAAADVAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRI6xDoJAEER/5bqr5NDCGAJYaGy10MQWjxUuYXfJ7Sr49+awsHmTTCYvU+5nHMwbogSmyq6z3Bogz22grrK362m1s/u6nIqW/QuB1Mw4kBRTZXvVsXBOfA/YSMYj0IzDkyM2KhnHzk0c2zGyB5FAHQ5uk+dbh00gm5QPbj8px4SYoPXxfLgbAWxIgzcKs5Yu9Ylx4bIW8HqJbil+Gve/WH8BAAD//wMAUEsBAhQAFAAAAAgAnJMcXbxYv1HoAAAAnAEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACACckxxdepg5wasAAAAYAQAACwAAAAAAAAAAAAAAAAAZAQAAX3JlbHMvLnJlbHNQSwECFAAUAAAACACckxxdrNxeuKgAAADVAAAAEQAAAAAAAAAAAAAAAADtAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAxAIAAAAA";

let controller: UseChatAttachmentsResult | null = null;
let idIndex = 0;

afterEach(() => {
  controller = null;
  idIndex = 0;
  cleanup();
});

function Harness(props: { readonly host: AttachmentHost; readonly onArtifact?: (state: unknown) => void }) {
  controller = useChatAttachments({
    sessionId: "ses-1",
    personaId: "xiaozhu",
    host: props.host,
    makeLocalId: () => `local-${idIndex += 1}`,
    onArtifact: props.onArtifact,
  });
  return null;
}

describe("useChatAttachments staged controller", () => {
  test("stages picker drop and paste files through one backend path", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await drive(() => getController().stageFromDrop({ dataTransfer: { files: [file("image.png", "png", "image/png")] } }));
    await drive(() => getController().stageFromPaste({ clipboardData: { files: [file("song.ncm", "ncm", "")] } }));
    await waitFor(() => expect(host.stageRequests).toHaveLength(3));
    await resolveStage(host, 0, "stage-md", "text");
    await resolveStage(host, 1, "stage-png", "image");
    await resolveStage(host, 2, "stage-ncm", "audio");

    await waitFor(() => expect(getController().items.map((item) => item.kind)).toEqual([
      "ready",
      "ready",
      "awaiting-confirmation",
    ]));
    expect(host.stageRequests.map((request) => request.sessionId)).toEqual(["ses-1", "ses-1", "ses-1"]);
  });

  test("does not retain the browser File after a stage completes", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(1));
    await resolveStage(host, 0, "stage-md", "text");

    await waitFor(() => expect(getController().items[0]?.kind).toBe("ready"));
    expect("file" in getController().items[0]).toBe(false);
  });

  test("prepares only ready ordinary attachments while NCM stays local", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown"), file("song.ncm", "ncm", "")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(2));
    await resolveStage(host, 0, "stage-md", "text");
    await resolveStage(host, 1, "stage-ncm", "audio");
    host.readResponses.set("stage-md", ready("stage-md", "notes.md", "text/plain", "text"));
    await waitFor(() => expect(getController().items.map((item) => item.kind)).toEqual(["ready", "awaiting-confirmation"]));

    const prepared = await getController().prepareModelAttachments("请总结");

    expect(prepared.shouldSendToModel).toBe(true);
    expect(prepared.fileParts.map((part) => part.filename)).toEqual(["notes.md"]);
    expect(host.readRequests.map((request) => request.attachmentId)).toEqual(["stage-md"]);
  });

  test("does not send a local NCM-only composer to the model", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("song.ncm", "ncm", "")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(1));
    await resolveStage(host, 0, "stage-ncm", "audio");

    const prepared = await getController().prepareModelAttachments("");

    expect(prepared).toMatchObject({ fileParts: [], fallbackPrompt: null, shouldSendToModel: false });
    expect(host.readRequests).toHaveLength(0);
  });

  test("prepares staged PDF and DOCX bytes as semantic model text", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([
      binaryFile("guide.pdf", PDF_FIXTURE_BASE64, "application/octet-stream"),
      binaryFile("brief.docx", DOCX_FIXTURE_BASE64, "application/octet-stream"),
    ]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(2));
    await resolveStage(host, 0, "stage-pdf", "text");
    await resolveStage(host, 1, "stage-docx", "text");
    host.readResponses.set("stage-pdf", readyFromBase64("stage-pdf", "guide.pdf", "application/pdf", PDF_FIXTURE_BASE64));
    host.readResponses.set("stage-docx", readyFromBase64(
      "stage-docx",
      "brief.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      DOCX_FIXTURE_BASE64,
    ));
    await waitFor(() => expect(getController().items.map((item) => item.kind)).toEqual(["ready", "ready"]));

    const prepared = await getController().prepareModelAttachments("请总结");

    expect(prepared.fileParts.map((part) => [part.filename, part.mime, dataUrlText(part.url)])).toEqual([
      ["guide.pdf", "text/plain", "PDF semantic text"],
      ["brief.docx", "text/plain", "DOCX semantic text"],
    ]);
  });

  test("converts once for a double confirm and emits a local artifact", async () => {
    const host = createFakeHost();
    const artifacts: unknown[] = [];
    render(createElement(Harness, { host, onArtifact: (artifact) => artifacts.push(artifact) }));

    await stageNcm(host);
    await drive(() => getController().confirm("local-1"));
    await drive(() => getController().confirm("local-1"));
    await waitFor(() => expect(host.convertRequests).toHaveLength(1));
    await resolveConvert(host, 0, ready("artifact-mp3", "song.mp3", "audio/mpeg", "audio"));

    await waitFor(() => expect(getController().items).toHaveLength(0));
    expect(getController().artifacts[0]?.artifact.name).toBe("song.mp3");
    expect(artifacts).toHaveLength(1);
  });

  test("discards staged backend records on cancel and remove", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await stageNcm(host);
    await drive(() => getController().cancel("local-1"));
    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(2));
    await resolveStage(host, 1, "stage-md", "text");
    await waitFor(() => expect(getController().items[1]?.kind).toBe("ready"));
    await drive(() => getController().remove("local-2"));

    expect(host.discardRequests.map((request) => request.attachmentId)).toEqual(["stage-ncm", "stage-md"]);
  });

  test("drops and discards a late converted artifact after cancellation", async () => {
    const host = createFakeHost();
    const artifacts: unknown[] = [];
    render(createElement(Harness, { host, onArtifact: (artifact) => artifacts.push(artifact) }));

    await stageNcm(host);
    await drive(() => getController().confirm("local-1"));
    await waitFor(() => expect(host.convertRequests).toHaveLength(1));
    await drive(() => getController().cancel("local-1"));
    await resolveConvert(host, 0, ready("artifact-mp3", "song.mp3", "audio/mpeg", "audio"));

    await waitFor(() => expect(host.discardRequests.map((request) => request.attachmentId)).toContain("artifact-mp3"));
    expect(getController().artifacts).toHaveLength(0);
    expect(artifacts).toHaveLength(0);
  });

  test("retries a failed export without overwriting the artifact", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await convertNcm(host);
    await drive(() => getController().download("artifact-mp3"));
    await waitFor(() => expect(host.exportRequests).toHaveLength(1));
    await rejectExport(host, 0, "disk full");
    await waitFor(() => expect(getController().artifacts[0]?.kind).toBe("failed"));
    await drive(() => getController().retryDownload("artifact-mp3"));
    await waitFor(() => expect(host.exportRequests).toHaveLength(2));
    await resolveExport(host, 1, "song (1).mp3");

    await waitFor(() => expect(getController().artifacts[0]).toMatchObject({
      kind: "artifact-ready",
      exportState: { kind: "exported", destinationName: "song (1).mp3" },
    }));
  });

  test("invalidates pending async work when the session resets", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(1));
    await drive(() => getController().resetSession("ses-2"));
    await resolveStage(host, 0, "stage-md", "text");

    await waitFor(() => expect(host.discardRequests[0]?.attachmentId).toBe("stage-md"));
    expect(host.cleanupSessions).toEqual([]);
    expect(getController().items[0]?.kind).toBe("cancelled");
  });

  test("captures failed stage evidence and retries with the retained byte snapshot", async () => {
    const host = createFakeHost();
    render(createElement(Harness, { host }));

    await drive(() => getController().stageFromPicker([file("notes.md", "# hi", "text/markdown")]));
    await waitFor(() => expect(host.stageRequests).toHaveLength(1));
    await rejectStage(host, 0, "io failed");
    await waitFor(() => expect(getController().items[0]).toMatchObject({ kind: "failed", phase: "staging" }));
    await drive(() => getController().retry("local-1"));
    await waitFor(() => expect(host.stageRequests).toHaveLength(2));
    expect(host.stageRequests[1]?.bytes).toEqual(host.stageRequests[0]?.bytes);
    await resolveStage(host, 1, "stage-md", "text");

    await waitFor(() => expect(getController().items[0]?.kind).toBe("ready"));
  });
});

function getController(): UseChatAttachmentsResult {
  if (controller === null) throw new Error("controller not rendered");
  return controller;
}

function binaryFile(name: string, base64: string, type: string): File {
  return new File([bytesFromBase64(base64).buffer], name, { type });
}

function readyFromBase64(
  id: string,
  fileName: string,
  mime: Parameters<typeof ready>[2],
  base64: string,
) {
  return { ...ready(id, fileName, mime, "text"), dataUrl: `data:${mime};base64,${base64}` };
}

function bytesFromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array<ArrayBuffer>(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function dataUrlText(dataUrl: string): string {
  const encoded = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return new TextDecoder().decode(bytesFromBase64(encoded));
}

async function stageNcm(host: FakeHost): Promise<void> {
  await drive(() => getController().stageFromPicker([file("song.ncm", "ncm", "")]));
  await waitFor(() => expect(host.stageRequests).toHaveLength(1));
  await resolveStage(host, 0, "stage-ncm", "audio");
  await waitFor(() => expect(getController().items[0]?.kind).toBe("awaiting-confirmation"));
}

async function convertNcm(host: FakeHost): Promise<void> {
  await stageNcm(host);
  await drive(() => getController().confirm("local-1"));
  await waitFor(() => expect(host.convertRequests).toHaveLength(1));
  await resolveConvert(host, 0, ready("artifact-mp3", "song.mp3", "audio/mpeg", "audio"));
  await waitFor(() => expect(getController().artifacts).toHaveLength(1));
}
