import { describe, expect, test } from "bun:test";
import * as ts from "typescript";
import {
  formatAttachmentSize,
  prepareModelReadyAttachment,
  toOpenCodeFilePart,
  type ModelReadyAttachment,
} from "./attachments";

const PDF_FIXTURE_BASE64 = "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMTQ0XSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAvQ29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cGUgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5ndGggNDkgPj4Kc3RyZWFtCkJUIC9GMSAxMiBUZiA3MiA3MiBUZCAoUERGIHNlbWFudGljIHRleHQpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMDExNSAwMDAwMCBuIAowMDAwMDAwMjQxIDAwMDAwIG4gCjAwMDAwMDAzMTEgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDgKJSVFT0YK";
const DOCX_FIXTURE_BASE64 = "UEsDBBQAAAAIAJyTHF28WL9R6AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbHyQTU7DMBCFr+KdFyh26AIhlKQLKEtgUQ5gOZPEwp6xPNMQbo/Sli5QYf1+vqfXbJcU1QyFA2Grb02tFaCnPuDY6vf9c3Wvt12z/8rAakkRudWTSH6wlv0EybGhDLikOFBJTthQGW12/sONYDd1fWc9oQBKJWuH7ponGNwhitotAnjCFois1ePJuLJa7XKOwTsJhHbG/helOhNMgXj08BQy3ywpanuVsCp/A8651xlKCT2oN1fkxSVotf2k0tue/CEBivm/5spOGobg4ZJf23IhD8wBxxTNRUku4M9+e7y7+wYAAP//AwBQSwMEFAAAAAgAnJMcXXqYOcGrAAAAGAEAAAsAAABfcmVscy8ucmVsc4zPsQ7CIBQF0F9he5PQOhhjSrsYk66mfgCB15YIPAKo9e9dHKxxcL25OTe36Rbv2B1TthQk1LwChkGTsWGScBlOmz10bXNGp4qlkGcbM1u8C1nCXEo8CJH1jF5lThHD4t1IyauSOaVJRKWvakKxraqdSJ8GrE3WGwmpNzWw4RnxH5vG0Wo8kr55DOXHxFcD2KDShEXCg5IR5h3zxTsQbSNWF9sXAAAA//8DAFBLAwQUAAAACACckxxdrNxeuKgAAADVAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRI6xDoJAEER/5bqr5NDCGAJYaGy10MQWjxUuYXfJ7Sr49+awsHmTTCYvU+5nHMwbogSmyq6z3Bogz22grrK362m1s/u6nIqW/QuB1Mw4kBRTZXvVsXBOfA/YSMYj0IzDkyM2KhnHzk0c2zGyB5FAHQ5uk+dbh00gm5QPbj8px4SYoPXxfLgbAWxIgzcKs5Yu9Ylx4bIW8HqJbil+Gve/WH8BAAD//wMAUEsBAhQAFAAAAAgAnJMcXbxYv1HoAAAAnAEAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAACACckxxdepg5wasAAAAYAQAACwAAAAAAAAAAAAAAAAAZAQAAX3JlbHMvLnJlbHNQSwECFAAUAAAACACckxxdrNxeuKgAAADVAAAAEQAAAAAAAAAAAAAAAADtAQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAxAIAAAAA";

function bytesFromBase64(value: string): ArrayBuffer {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)).buffer;
}

describe("chat attachments", () => {
  test("prepares readable text as trimmed utf-8 data url", async () => {
    const bytes = new TextEncoder().encode("  hello staged text  ").buffer;
    const attachment = await prepareModelReadyAttachment({
      metadata: { id: "text", name: "notes.md", mime: "text/markdown", size: bytes.byteLength },
      bytes,
    });

    expect(attachment).toMatchObject({
      name: "notes.md",
      mime: "text/plain",
      size: 21,
      kind: "text",
      status: "ready",
      truncated: false,
    });
    expect(attachment.dataUrl).toBe("data:text/plain;charset=utf-8;base64,aGVsbG8gc3RhZ2VkIHRleHQ=");
  });

  test("prepares allowlisted images without rewriting bytes", async () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const attachment = await prepareModelReadyAttachment({
      metadata: { id: "png", name: "cover.png", mime: "image/png", size: pngBytes.byteLength },
      bytes: pngBytes.buffer,
    });

    expect(attachment).toMatchObject({
      name: "cover.png",
      mime: "image/png",
      size: 4,
      kind: "image",
      status: "ready",
    });
    expect(attachment.dataUrl).toBe("data:image/png;base64,iVBORw==");
  });

  test("extracts semantic text from staged PDF bytes", async () => {
    const bytes = bytesFromBase64(PDF_FIXTURE_BASE64);
    const attachment = await prepareModelReadyAttachment({
      metadata: { id: "pdf", name: "guide.pdf", mime: "application/pdf", size: bytes.byteLength },
      bytes,
    });

    expect(attachment.dataUrl).toBe("data:text/plain;charset=utf-8;base64,UERGIHNlbWFudGljIHRleHQ=");
  });

  test("extracts semantic text from staged DOCX bytes", async () => {
    const bytes = bytesFromBase64(DOCX_FIXTURE_BASE64);
    const attachment = await prepareModelReadyAttachment({
      metadata: { id: "docx", name: "brief.docx", mime: "", size: bytes.byteLength },
      bytes,
    });

    expect(attachment.dataUrl).toBe("data:text/plain;charset=utf-8;base64,RE9DWCBzZW1hbnRpYyB0ZXh0");
  });

  test("prepares staged markdown bytes for OpenCode file parts", async () => {
    const ready = await prepareModelReadyAttachment({
      metadata: {
        id: "staged-markdown",
        name: "notes.md",
        mime: "text/markdown",
        size: 11,
      },
      bytes: await new Blob(["hello world"]).arrayBuffer(),
    });

    expect(ready).toEqual({
      id: "staged-markdown",
      name: "notes.md",
      mime: "text/plain",
      size: 11,
      kind: "text",
      status: "ready",
      dataUrl: "data:text/plain;charset=utf-8;base64,aGVsbG8gd29ybGQ=",
      truncated: false,
    });
    expect(toOpenCodeFilePart(ready)).toEqual({
      type: "file",
      mime: "text/plain",
      filename: "notes.md",
      url: "data:text/plain;charset=utf-8;base64,aGVsbG8gd29ybGQ=",
    });
  });

  test("rejects unsupported staged bytes before prompt construction", async () => {
    await expect(
      prepareModelReadyAttachment({
        metadata: {
          id: "staged-audio",
          name: "song.flac",
          mime: "audio/flac",
          size: 4,
        },
        bytes: await new Blob(["flac"]).arrayBuffer(),
      }),
    ).rejects.toThrow("暂不支持读取");
  });

  test("rejects empty-MIME audio extensions before text fallback", async () => {
    const names = ["song.mp3", "song.flac", "locked.ncm"] as const;
    for (const name of names) {
      const bytes = new TextEncoder().encode("audio").buffer;
      await expect(prepareModelReadyAttachment({
        metadata: { id: `generated-${name}`, name, mime: "", size: bytes.byteLength },
        bytes,
      })).rejects.toThrow("暂不支持读取");
    }
  });

  test("exports one model-ready OpenCode adapter call signature", () => {
    const sourcePath = ts.sys.resolvePath("src/chat/attachments.ts");
    const program = ts.createProgram([sourcePath], {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      target: ts.ScriptTarget.ES2022,
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(sourcePath);
    const moduleSymbol = source ? checker.getSymbolAtLocation(source) : undefined;
    const adapter = moduleSymbol
      ? checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === "toOpenCodeFilePart")
      : undefined;
    const declaration = adapter?.declarations?.[0];
    if (!adapter || !declaration) throw new Error("OpenCode adapter declaration not found");

    const signatures = checker.getTypeOfSymbolAtLocation(adapter, declaration).getCallSignatures();
    expect(signatures).toHaveLength(1);
    const parameter = signatures[0]?.parameters[0];
    if (!parameter) throw new Error("OpenCode adapter parameter not found");
    expect(checker.typeToString(checker.getTypeOfSymbolAtLocation(parameter, declaration))).toBe(
      "ModelReadyAttachment",
    );
  });

  test("runtime-rejects untyped audio, NCM, and artifact adapter inputs", () => {
    const malformed = [
      JSON.parse('{"id":"audio","name":"song.mp3","mime":"audio/mpeg","size":5,"kind":"audio","status":"ready","dataUrl":"data:audio/mpeg;base64,YXVkaW8="}'),
      JSON.parse('{"id":"ncm","name":"locked.ncm","mime":"application/octet-stream","size":5,"kind":"audio","status":"pending"}'),
      JSON.parse('{"id":"artifact","role":"artifact","filename":"song.flac","mime":"audio/flac","dataUrl":"data:audio/flac;base64,YXVkaW8="}'),
    ];
    for (const attachment of malformed) expect(() => toOpenCodeFilePart(attachment)).toThrow("Unsupported model attachment");
  });

  test("formats attachment sizes for the compact tray", () => {
    expect(formatAttachmentSize(512)).toBe("512 B");
    expect(formatAttachmentSize(2048)).toBe("2 KB");
    expect(formatAttachmentSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  test("does not send attachments before they are ready", () => {
    const pending = JSON.parse(
      '{"id":"pending","name":"notes.md","mime":"text/plain","size":5,"kind":"text","status":"pending"}',
    );
    const ready = {
      id: "pending",
      name: "notes.md",
      mime: "text/plain",
      size: 5,
      kind: "text",
      status: "ready",
      dataUrl: "data:text/plain;base64,SGk=",
      truncated: false,
    } satisfies ModelReadyAttachment;

    expect(() => toOpenCodeFilePart(pending)).toThrow("Unsupported model attachment");
    expect(toOpenCodeFilePart(ready)).toEqual({
      type: "file",
      mime: "text/plain",
      filename: "notes.md",
      url: "data:text/plain;base64,SGk=",
    });
  });
});
