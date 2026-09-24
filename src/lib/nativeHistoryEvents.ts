import { getBaseUrl, sidecarAuthHeaders } from "./opencode";

type Connection = { readonly base: string; readonly headers: Readonly<Record<string, string>> };
type Bootstrap = () => Promise<Connection>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isNativeHistoryEvent(value: unknown): boolean {
  if (!record(value) || typeof value.directory !== "string" || !record(value.payload)) return false;
  switch (value.payload.type) {
    case "session.created":
    case "session.updated":
    case "session.deleted":
    case "session.status":
      return true;
    default:
      return false;
  }
}

async function connection(): Promise<Connection> {
  const [base, headers] = await Promise.all([getBaseUrl(), sidecarAuthHeaders()]);
  return { base, headers };
}

export function subscribeNativeHistoryEvents(onChanged: () => void, bootstrap: Bootstrap = connection): () => void {
  const controller = new AbortController();
  let closed = false;
  let retryDelay = 500;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let pending: ReturnType<typeof setTimeout> | undefined;
  const queue = () => {
    if (closed) return;
    if (pending !== undefined) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = undefined;
      if (!closed) onChanged();
    }, 150);
  };
  const parseFrame = (frame: string) => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    let parsed: unknown;
    try { parsed = JSON.parse(data); }
    catch (error: unknown) {
      if (error instanceof SyntaxError) return;
      throw error;
    }
    if (isNativeHistoryEvent(parsed)) queue();
  };
  const run = async () => {
    try {
      const { base, headers } = await bootstrap();
      if (closed) return;
      const response = await fetch(`${base}/global/event`, {
        headers: { ...headers, Accept: "text/event-stream" }, signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
      } else {
        retryDelay = 500;
        queue();
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        try {
          let buffer = "";
          while (!closed) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += value;
            let boundary = /\r?\n\r?\n/.exec(buffer);
            while (boundary) {
              parseFrame(buffer.slice(0, boundary.index));
              buffer = buffer.slice(boundary.index + boundary[0].length);
              boundary = /\r?\n\r?\n/.exec(buffer);
            }
          }
        } finally { reader.releaseLock(); }
      }
    } catch (error: unknown) {
      if (closed || controller.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
    if (!closed) {
      retry = setTimeout(() => { retry = undefined; void run(); }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    }
  };
  void run();
  return () => {
    closed = true;
    controller.abort();
    if (retry !== undefined) clearTimeout(retry);
    if (pending !== undefined) clearTimeout(pending);
  };
}

