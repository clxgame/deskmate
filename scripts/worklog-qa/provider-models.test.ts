import { afterAll, expect, test } from "bun:test";
import { get, request as httpRequest } from "node:http";

const child = Bun.spawn([process.execPath, "scripts/worklog-qa/provider.js"], { stdout: "pipe" });
const first = await child.stdout.getReader().read();
if (first.done) throw new Error("provider exited before receipt");
const receipt = JSON.parse(new TextDecoder().decode(first.value).trim());

type ProviderStatus = {
  readonly requests: ReadonlyArray<Record<string, unknown>>;
  readonly modelRequests: ReadonlyArray<Record<string, unknown>>;
};

function parseStatus(text: string): ProviderStatus {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || !("requests" in value) || !("modelRequests" in value)) {
    throw new Error("invalid provider status");
  }
  const { requests, modelRequests } = value;
  if (!Array.isArray(requests) || !Array.isArray(modelRequests)) {
    throw new Error("invalid provider status");
  }
  return { requests, modelRequests };
}

afterAll(() => child.kill());

test("records bounded model discovery receipt", async () => {
  const request = (url: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    get(url, (response) => { const chunks: Buffer[] = []; response.on("data", (chunk) => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })); }).on("error", reject);
  });
  const response = await request(`${receipt.baseUrl}/models`);
  expect(response.status).toBe(200);
  const status = parseStatus((await request(receipt.statusUrl)).body);
  expect(status.modelRequests).toHaveLength(1);
  expect(status.modelRequests[0]).toMatchObject({ status: 200 });
  expect(status.modelRequests[0].arrivedAt).toBeString();
  expect(status.modelRequests[0].completedAt).toBeString();
});

test("emits native workspace tool arguments without a wrapper", async () => {
  const payload = JSON.stringify({
      model: "model-a",
      stream: false,
      messages: [{ role: "user", content: "FLOW_DOCUMENT" }],
      tools: ["read", "write"].map((name) => ({
        type: "function",
        function: { name, parameters: { type: "object" } },
      })),
  });
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(`${receipt.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (result) => {
      const chunks: Buffer[] = [];
      result.on("data", (chunk) => chunks.push(chunk));
      result.on("end", () => resolve({ status: result.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(payload);
  });
  expect(response.status).toBe(200);
  const body = JSON.parse(response.body);
  const call = body.choices[0].message.tool_calls[0];
  expect(call.function.name).toBe("read");
  expect(JSON.parse(call.function.arguments)).toEqual({ filePath: "notes.txt" });
  const status = await new Promise<ProviderStatus>((resolve, reject) => {
    get(receipt.statusUrl, (result) => {
      const chunks: Buffer[] = [];
      result.on("data", (chunk) => chunks.push(chunk));
      result.on("end", () => resolve(parseStatus(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  expect(status.requests.at(-1)).toMatchObject({
    tools: ["read", "write"],
    invokedTool: "read",
    invokedInput: { filePath: "notes.txt" },
  });
});

test("emits the explicit existing-file read then edit fixture", async () => {
  const payload = JSON.stringify({
    model: "model-a",
    stream: false,
    messages: [
      { role: "user", content: "QA_READ_EDIT" },
      { role: "tool", content: "ORIGINAL_A" },
    ],
    tools: ["read", "edit"].map((name) => ({
      type: "function",
      function: { name, parameters: { type: "object" } },
    })),
  });
  const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest(`${receipt.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (result) => {
      const chunks: Buffer[] = [];
      result.on("data", (chunk) => chunks.push(chunk));
      result.on("end", () => resolve({ status: result.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(payload);
  });

  expect(response.status).toBe(200);
  const call = JSON.parse(response.body).choices[0].message.tool_calls[0];
  expect(call.function.name).toBe("edit");
  expect(JSON.parse(call.function.arguments)).toEqual({
    filePath: "same.txt",
    oldString: "ORIGINAL_A",
    newString: "UPDATED_A",
  });
});

test("malforms an explicit QA stream after one valid delta without a final frame", async () => {
  const control = JSON.stringify({ mode: "stream_malformed" });
  await new Promise<void>((resolve, reject) => {
    const request = httpRequest(receipt.controlUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(control) },
    }, (response) => {
      response.resume();
      response.on("end", resolve);
    });
    request.on("error", reject);
    request.end(control);
  });
  const payload = JSON.stringify({
    model: "model-a",
    stream: true,
    messages: [{ role: "user", content: "FLOW_STREAM_MALFORMED" }],
  });
  const result = await new Promise<{ body: string; ended: boolean; complete: boolean }>((resolve, reject) => {
    const request = httpRequest(`${receipt.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (response) => {
      const chunks: Buffer[] = [];
      let ended = false;
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => { ended = true; resolve({ body: Buffer.concat(chunks).toString("utf8"), ended, complete: response.complete }); });
      response.on("aborted", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), ended, complete: response.complete }));
      response.on("error", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), ended, complete: response.complete }));
      response.on("close", () => { if (!ended) resolve({ body: Buffer.concat(chunks).toString("utf8"), ended, complete: response.complete }); });
    });
    request.on("error", reject);
    request.end(payload);
  });
  expect(result.body).toContain('"content":"partial"');
  expect(result.body).toContain('data: {"malformed"');
  expect(result.body).not.toContain("[DONE]");
  expect(result.body).not.toContain('"finish_reason":"stop"');
  const status = await new Promise<ProviderStatus>((resolve, reject) => {
    get(receipt.statusUrl, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(parseStatus(Buffer.concat(chunks).toString("utf8"))));
    }).on("error", reject);
  });
  expect(status.requests.filter((entry: { readonly mode: string }) => entry.mode === "stream_malformed")).toHaveLength(1);
});
