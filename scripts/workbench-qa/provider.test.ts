import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixtureCall(baseUrl: string, body: object) {
  const response = await new Promise<{ readonly status: number; readonly body: string }>((resolve, reject) => {
    const outbound = request(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () => resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      incoming.on("error", reject);
    });
    outbound.on("error", reject);
    outbound.end(JSON.stringify(body));
  });
  expect(response.status).toBe(200);
  return response.body
    .split("\n")
    .filter((line) => line.startsWith("data: {") )
    .map((line) => JSON.parse(line.slice(6)));
}

test("Given the question tool is exposed, when the P6 fixture is prompted, then it emits one native question call", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "yume-p6-question-provider-"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "provider.ts"), runDir], {
    env: { ...process.env, YUME_QA_PROVIDER_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    const started = await child.stdout.getReader().read();
    expect(started.done).toBe(false);
    const receipt = await Bun.file(join(runDir, "provider-receipt.json")).json();
    const events = await fixtureCall(receipt.baseUrl, {
      messages: [{ role: "user", content: "P6_QUESTION" }],
      tools: [{ type: "function", function: { name: "question" } }],
    });
    const call = events[0]?.choices?.[0]?.delta?.tool_calls?.[0];
    expect(call?.function?.name).toBe("question");
    const args = JSON.parse(call.function.arguments);
    expect(args.questions).toHaveLength(1);
    expect(args.questions[0].options).toHaveLength(2);
  } finally {
    child.kill();
    await child.exited;
    await rm(runDir, { recursive: true, force: true });
  }
});

test("Given native editing is exposed, when the P6 fixture requests a QA file, then it emits a scoped edit", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "yume-p6-edit-provider-"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "provider.ts"), runDir], {
    env: { ...process.env, YUME_QA_PROVIDER_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await child.stdout.getReader().read();
    const receipt = await Bun.file(join(runDir, "provider-receipt.json")).json();
    const file = "C:\\qa\\p6-edit.txt";
    const events = await fixtureCall(receipt.baseUrl, {
      messages: [{ role: "user", content: `P6_EDIT_REVERT file=${encodeURIComponent(file)}` }],
      tools: [{ type: "function", function: { name: "edit" } }],
    });
    const call = events[0]?.choices?.[0]?.delta?.tool_calls?.[0];
    expect(call?.function?.name).toBe("edit");
    expect(JSON.parse(call.function.arguments)).toEqual({
      filePath: file,
      oldString: "P6_EDIT_AFTER",
      newString: "P6_EDIT_SECOND",
    });
  } finally {
    child.kill();
    await child.exited;
    await rm(runDir, { recursive: true, force: true });
  }
});

test("Given task is exposed, when the P6 fixture is prompted, then it emits a read-only child task", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "yume-p6-task-provider-"));
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "provider.ts"), runDir], {
    env: { ...process.env, YUME_QA_PROVIDER_PORT: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  try {
    await child.stdout.getReader().read();
    const receipt = await Bun.file(join(runDir, "provider-receipt.json")).json();
    const events = await fixtureCall(receipt.baseUrl, {
      messages: [{ role: "user", content: "P6_TASK" }],
      tools: [{ type: "function", function: { name: "task" } }],
    });
    const call = events[0]?.choices?.[0]?.delta?.tool_calls?.[0];
    expect(call?.function?.name).toBe("task");
    expect(JSON.parse(call.function.arguments)).toMatchObject({ subagent_type: "explore" });
    const childEvents = await fixtureCall(receipt.baseUrl, {
      messages: [{ role: "user", content: "P6_TASK_CHILD Reply with the fixture completion marker." }],
    });
    expect(childEvents[0]?.choices?.[0]?.delta?.content).toBe("WORKBENCH_QA_CHILD_DONE");
  } finally {
    child.kill();
    await child.exited;
    await rm(runDir, { recursive: true, force: true });
  }
});
