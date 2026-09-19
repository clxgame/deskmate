import { ContractError, jsonObject, type JsonObject } from "./types";
import { request as httpRequest } from "node:http";

export type Client = {
  readonly baseUrl: string;
  readonly directory: string;
};

type Request = {
  readonly method?: "GET" | "POST";
  readonly body?: JsonObject;
  readonly timeoutMs?: number;
};

type DiscoveryOptions = {
  readonly deadlineMs?: number;
  readonly attemptMs?: number;
};

export type ToolDiscovery = {
  readonly ids: readonly string[];
  readonly attempts: number;
};

export async function request(client: Client, path: string, input: Request = {}): Promise<unknown> {
  const method = input.method ?? "GET";
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  let response: Response | undefined;
  while (response === undefined && Date.now() < deadline) {
    try {
      response = await fetch(`${client.baseUrl}${path}`, {
        method,
        headers: { "Content-Type": "application/json", "x-opencode-directory": client.directory },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (method !== "GET") throw new ContractError("CONNECTION_FAILURE", `${method} ${path}: ${error.message}`);
      await Bun.sleep(100);
    }
  }
  if (response === undefined) throw new ContractError("TIMEOUT", `${path} did not return a response`);
  if (!response.ok) throw new ContractError("HTTP_FAILURE", `${path} -> ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  return response.json();
}

function toolProbe(client: Client, timeoutMs: number, attempt: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const probe = httpRequest(`${client.baseUrl}/experimental/tool/ids`, {
      method: "GET",
      headers: { "x-opencode-directory": client.directory },
    }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (part: Buffer) => parts.push(part));
      response.once("end", () => {
        const body = Buffer.concat(parts).toString("utf8");
        if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
          finish(() => reject(new ContractError("HTTP_FAILURE", `/experimental/tool/ids -> ${response.statusCode ?? 0} ${body}`)));
          return;
        }
        try {
          const parsed: unknown = JSON.parse(body);
          finish(() => resolve(parsed));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          finish(() => reject(new ContractError("INVALID_DISCOVERY_JSON", message)));
        }
      });
    });
    const timer = setTimeout(() => {
      finish(() => reject(new ContractError("PROBE_TIMEOUT", `tool discovery probe ${attempt} exceeded ${timeoutMs}ms`)));
      probe.destroy();
    }, timeoutMs);
    probe.once("error", (error) => finish(() => reject(error)));
    probe.end();
  });
}

export async function discoverTools(
  client: Client,
  options: DiscoveryOptions = {},
): Promise<ToolDiscovery> {
  const deadline = Date.now() + (options.deadlineMs ?? 90_000);
  const attemptMs = options.attemptMs ?? 5_000;
  let attempts = 0;
  let lastError = "no response";
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const duration = Math.min(attemptMs, Math.max(1, deadline - Date.now()));
      const value = await toolProbe(client, duration, attempts);
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return { ids: value, attempts };
      }
      throw new ContractError("INVALID_DISCOVERY_SCHEMA", "tool IDs were not a string array");
    } catch (error) {
      if (!(error instanceof ContractError) || error.code !== "PROBE_TIMEOUT") throw error;
      lastError = error.message;
    }
    console.log(`stage=tool-discovery-retry attempt=${attempts} reason=${lastError}`);
    await Bun.sleep(Math.min(25, Math.max(0, deadline - Date.now())));
  }
  throw new ContractError("TIMEOUT", `tool discovery did not become ready after ${attempts} attempts: ${lastError}`);
}

export async function createSession(client: Client, title: string, permission: readonly JsonObject[]): Promise<string> {
  const session = jsonObject(await request(client, "/session", { method: "POST", body: { title, permission } }), "session");
  const id = session.id;
  if (typeof id !== "string") throw new ContractError("INVALID_WIRE", "session id missing");
  return id;
}

export async function prompt(client: Client, sessionId: string, messageId: string, text: string): Promise<void> {
  await request(client, `/session/${sessionId}/prompt_async`, {
    method: "POST",
    body: { messageID: messageId, model: { providerID: "yume", modelID: "model-a" }, parts: [{ type: "text", text }] },
  });
}

export async function messages(client: Client, sessionId: string, limit?: number): Promise<readonly JsonObject[]> {
  const query = limit === undefined ? "" : `?limit=${limit}`;
  const value = await request(client, `/session/${sessionId}/message${query}`);
  if (!Array.isArray(value)) throw new ContractError("INVALID_WIRE", "messages is not an array");
  return value.map((item) => jsonObject(item, "message envelope"));
}

export async function waitForTerminal(client: Client, sessionId: string, parentId: string): Promise<JsonObject> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await messages(client, sessionId);
    const match = snapshot.find((item) => {
      const info = item.info;
      return typeof info === "object" && info !== null && !Array.isArray(info)
        && info.parentID === parentId && typeof info.time === "object" && info.time !== null
        && "completed" in info.time;
    });
    if (match !== undefined) return match;
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", `session ${sessionId} did not complete`);
}

export async function waitForPermission(client: Client, sessionId: string): Promise<JsonObject> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await request(client, "/permission");
    if (Array.isArray(value)) {
      const match = value.map((item) => jsonObject(item, "permission")).find((item) => item.sessionID === sessionId);
      if (match !== undefined) return match;
    }
    await Bun.sleep(100);
  }
  throw new ContractError("TIMEOUT", `permission for ${sessionId} did not appear`);
}

export async function waitForPermissionEvent(client: Client, sessionId: string): Promise<JsonObject> {
  const response = await fetch(`${client.baseUrl}/event`, {
    headers: { "x-opencode-directory": client.directory }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || response.body === null) throw new ContractError("EVENT_FAILURE", `event stream -> ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const next = await reader.read();
    if (next.done) throw new ContractError("EVENT_CLOSED", "event stream closed before permission");
    buffer += decoder.decode(next.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (data === undefined) continue;
      const event = jsonObject(JSON.parse(data), "event");
      if (event.type !== "permission.asked") continue;
      const properties = jsonObject(event.properties, "event properties");
      if (properties.sessionID === sessionId) { await reader.cancel(); return properties; }
    }
  }
}

export async function replyPermission(client: Client, permissionId: string, reply: "once" | "reject"): Promise<void> {
  await request(client, `/permission/${permissionId}/reply`, { method: "POST", body: { reply } });
}
