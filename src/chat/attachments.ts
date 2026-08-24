import * as mammoth from "mammoth";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 160_000;

const TEXT_EXTENSIONS = new Set([
  "c",
  "cfg",
  "conf",
  "cpp",
  "css",
  "csv",
  "go",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mdx",
  "mjs",
  "mts",
  "py",
  "rs",
  "scss",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

const IMAGE_MIME_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ChatAttachmentKind = "image" | "text" | "audio";
export type ChatAttachmentStatus = "pending" | "ready" | "error";

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: ChatAttachmentKind;
  /** Original file kept in the composer until the user explicitly sends it. */
  file?: File;
  dataUrl?: string;
  status: ChatAttachmentStatus;
  error?: string;
  truncated?: boolean;
}

export interface OpenCodeFilePart {
  type: "file";
  mime: string;
  filename: string;
  url: string;
}

export function isNcmFile(file: File): boolean {
  return extensionOf(file.name) === "ncm";
}

export function isSupportedAttachment(file: File): boolean {
  const extension = extensionOf(file.name);
  const mime = normalizedMime(file);
  return (
    IMAGE_MIME_TYPES.has(mime) ||
    mime === "application/pdf" ||
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    TEXT_EXTENSIONS.has(extension)
  );
}

export function createPendingAttachment(file: File): ChatAttachment {
  const isImage = file.type.toLowerCase().startsWith("image/");
  return {
    id: makeId(),
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    kind: isImage ? "image" : isNcmFile(file) ? "audio" : "text",
    file,
    status: "pending",
  };
}

export function snapshotSelectedFiles(files: ArrayLike<File> | null): File[] {
  return files ? Array.from(files) : [];
}

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} 超过 20 MB 限制`);
  }

  const mime = normalizedMime(file);
  if (IMAGE_MIME_TYPES.has(mime)) {
    return {
      id: makeId(),
      name: file.name,
      mime,
      size: file.size,
      kind: "image",
      status: "ready",
      dataUrl: await readDataUrl(file),
    };
  }

  const extension = extensionOf(file.name);
  let text: string;
  if (mime === "application/pdf" || extension === "pdf") {
    text = await extractPdfText(await file.arrayBuffer());
  } else if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    text = (await mammoth.extractRawText({
      arrayBuffer: await file.arrayBuffer(),
    })).value;
  } else if (TEXT_EXTENSIONS.has(extension) || mime.startsWith("text/")) {
    text = await file.text();
  } else {
    throw new Error(`${file.name} 暂不支持读取，请选择图片、PDF、DOCX 或文本文件`);
  }

  const truncated = text.length > MAX_TEXT_CHARS;
  const bounded = truncated ? text.slice(0, MAX_TEXT_CHARS) : text;
  const suffix = truncated
    ? `\n\n[文件内容已截断，原文超过 ${MAX_TEXT_CHARS.toLocaleString()} 个字符]`
    : "";
  const normalizedText = `${bounded}${suffix}`.trim();
  return {
    id: makeId(),
    name: file.name,
    mime: "text/plain",
    size: file.size,
    kind: "text",
    status: "ready",
    dataUrl: await readDataUrl(
      new Blob([normalizedText], { type: "text/plain;charset=utf-8" }),
    ),
    truncated,
  };
}

export function toOpenCodeFilePart(
  attachment: ChatAttachment,
): OpenCodeFilePart | null {
  if (
    attachment.kind === "audio" ||
    attachment.status !== "ready" ||
    !attachment.dataUrl
  )
    return null;
  return {
    type: "file",
    mime: attachment.mime,
    filename: attachment.name,
    url: attachment.dataUrl,
  };
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function normalizedMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  switch (extensionOf(file.name)) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "text/plain";
  }
}

function makeId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readDataUrl(value: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("无法读取文件"));
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.readAsDataURL(value);
  });
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  let extractedChars = 0;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .filter(Boolean)
      .join(" ");
    pages.push(pageText);
    extractedChars += pageText.length;
    if (extractedChars >= MAX_TEXT_CHARS) break;
  }
  return pages.join("\n\n");
}
