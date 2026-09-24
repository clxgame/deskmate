/**
 * Minimal raw-CDP driver for the QA app's WebView2 (started with
 * --remote-debugging-port). No external dependencies; Bun WebSocket + fetch.
 *
 * Usage:
 *   bun scripts/workbench-qa/cdp.ts targets [port]
 *   bun scripts/workbench-qa/cdp.ts eval <targetId> <js-expression> [port]
 *   bun scripts/workbench-qa/cdp.ts shot <targetId> <out.png> [port]
 */

const CDP_PORT = Number(process.env.CDP_PORT ?? 55883);

type Target = { id: string; title: string; url: string; type: string };

async function listTargets(p: number): Promise<Target[]> {
  const res = await fetch(`http://127.0.0.1:${p}/json`);
  if (!res.ok) throw new Error(`CDP /json -> ${res.status}`);
  return (await res.json()) as Target[];
}

class Cdp {
  private ws: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private ready: Promise<void>;
  readonly events: string[] = [];
  private eventHandlers = new Map<string, (params: unknown) => void>();

  onEvent(method: string, handler: (params: unknown) => void) {
    this.eventHandlers.set(method, handler);
  }

  constructor(webSocketUrl: string) {
    this.ws = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP websocket failed")), { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: unknown;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.id === undefined) {
        if (msg.method && this.eventHandlers.has(msg.method)) {
          this.eventHandlers.get(msg.method)!(msg.params);
        }
        if (msg.method === "Runtime.consoleAPICalled" || msg.method === "Runtime.exceptionThrown" || msg.method === "Log.entryAdded") {
          this.events.push(JSON.stringify(msg.params).slice(0, 2000));
        }
        return;
      }
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message ?? "CDP error"));
      else entry.resolve(msg.result);
    });
  }

  async send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ready;
    const id = ++this.seq;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    });
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    this.ws.close();
  }
}

async function main() {
  const [, , command, ...args] = process.argv;
    if (command === "targets") {
    for (const target of await listTargets(CDP_PORT)) {
      console.log(`${target.id}\t${target.type}\t${target.title}\t${target.url}`);
    }
    return;
  }

  const [targetId, ...rest] = args;
  if (!targetId) throw new Error("targetId required");
  const targets = await listTargets(CDP_PORT);
  const target = targets.find((t) => t.id === targetId);
  if (!target) throw new Error(`target ${targetId} not found`);
  const wsUrl = (target as unknown as { webSocketDebuggerUrl: string }).webSocketDebuggerUrl;
  const cdp = new Cdp(wsUrl);
  try {
    if (command === "eval") {
      const expression = rest.join(" ");
      const result = await cdp.send<{ result?: { type?: string; value?: unknown; description?: string } }>(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
      );
      console.log(JSON.stringify(result.result?.value ?? result.result?.description ?? null));
      return;
    }
    if (command === "evalfile") {
      const file = rest[0];
      if (!file) throw new Error("js file path required");
      const expression = await Bun.file(file).text();
      const result = await cdp.send<{ result?: { type?: string; value?: unknown; description?: string } }>(
        "Runtime.evaluate",
        { expression, awaitPromise: true, returnByValue: true },
      );
      console.log(JSON.stringify(result.result?.value ?? result.result?.description ?? null));
      return;
    }
    if (command === "shot") {
      const out = rest[0];
      if (!out) throw new Error("output path required");
      await cdp.send("Page.enable");
      const shot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
      await Bun.write(out, Buffer.from(shot.data, "base64"));
      console.log(`saved ${out}`);
      return;
    }
    if (command === "console") {
      const waitMs = Number(rest[0] ?? 8000);
      await cdp.send("Runtime.enable");
      await cdp.send("Log.enable");
      await cdp.send("Page.enable");
      await cdp.send("Page.reload", { ignoreCache: true });
      await Bun.sleep(waitMs);
      for (const event of cdp.events) console.log(event);
      console.log(`-- ${cdp.events.length} console/log events captured`);
      return;
    }
    if (command === "netlog") {
      const waitMs = Number(rest[0] ?? 8000);
      const requests = new Map<string, string>();
      cdp.onEvent("Network.requestWillBeSent", (params) => {
        const p = params as { requestId?: string; request?: { url?: string } };
        if (p.requestId && p.request?.url) requests.set(p.requestId, p.request.url);
      });
      await cdp.send("Network.enable");
      await cdp.send("Page.enable");
      await cdp.send("Page.reload", { ignoreCache: true });
      await Bun.sleep(waitMs);
      const hosts = new Map<string, number>();
      for (const url of requests.values()) {
        try {
          const u = new URL(url);
          const key = `${u.protocol}//${u.host}`;
          hosts.set(key, (hosts.get(key) ?? 0) + 1);
        } catch {
          const scheme = url.split(":")[0] ?? "unknown";
          hosts.set(scheme + ":", (hosts.get(scheme + ":") ?? 0) + 1);
        }
      }
      console.log(JSON.stringify({ total: requests.size, byOrigin: Object.fromEntries(hosts) }, null, 2));
      return;
    }
    throw new Error(`unknown command: ${command}`);
  } finally {
    cdp.close();
  }
}

await main();
