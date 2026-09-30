import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evidenceDirectory } from "./evidence.js";
const stamp = new Date().toISOString().replaceAll(":", "-");
const evidence = process.env.YUME_WORKLOG_QA_EVIDENCE_DIR ? evidenceDirectory()
  : resolve(import.meta.dir, "../../artifacts/worklog-qa", `provider-${stamp}`);
await mkdir(evidence, { recursive: true });
const child = spawn(process.execPath, [resolve(import.meta.dir, "provider.js")], {
  env: { ...process.env, YUME_WORKLOG_QA_EVIDENCE_DIR: evidence },
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let receipt;
let checks = 0;
const check = (condition, message) => { if (!condition) throw new Error(message); checks++; };
const hasExited = () => child.exitCode !== null || child.signalCode !== null;
async function waitForExit(timeoutMs) {
  if (hasExited()) return;
  await new Promise((resolveExit, rejectExit) => {
    const exit = () => { clearTimeout(timeout); resolveExit(); };
    const timeout = setTimeout(() => {
      child.off("exit", exit);
      rejectExit(new Error("Owned provider shutdown timed out"));
    }, timeoutMs);
    child.once("exit", exit);
  });
}
try {
  receipt = await new Promise((resolveReady, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Provider readiness timed out")), 10000);
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Provider exited ${code}`)); });
    child.stdout.on("data", chunk => {
      output += chunk.toString();
      if (output.includes("\n")) { clearTimeout(timeout); resolveReady(JSON.parse(output.split("\n")[0])); }
    });
  });
  const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const models = await (await fetch(`${receipt.baseUrl}/models`)).json();
  check(models.data[0].id === "model-a", "Synthetic catalog missing");
  check((await post(receipt.controlUrl, { nextTool: { name: "bash", input: {} } })).status === 400, "Forbidden tool accepted");
  await post(receipt.controlUrl, { nextTool: { name: "worklog_record", input: { text: "合成事项" } } });
  const plain = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], tools: [], stream: false })).json();
  check(plain.choices[0].finish_reason === "stop", "Absent tool was invoked");
  const tool = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], tools: [{ function: { name: "worklog_record" } }], stream: false })).json();
  check(tool.choices[0].message.tool_calls[0].function.name === "worklog_record", "Offered worklog tool missing");
  const status = await (await fetch(receipt.statusUrl)).json();
  check(status.pendingTool === null, "One-shot tool was retained");
  await post(receipt.controlUrl, { mode: "unauthorized" });
  check((await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: false })).status === 401, "Authentication failure fixture missing");
  await post(receipt.controlUrl, { mode: "error" });
  check((await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: false })).status === 503, "Transient failure fixture missing");
  await post(receipt.controlUrl, { mode: "success", report: "# 合成回读" });
  const stream = await (await post(`${receipt.baseUrl}/chat/completions`, { messages: [], stream: true })).text();
  check(stream.includes("[DONE]") && stream.includes("合成回读"), "SSE output incomplete");
} finally {
  let shutdownError;
  if (!hasExited() && child.pid !== undefined) {
    child.kill();
    try { await waitForExit(5000); } catch {
      if (!hasExited()) child.kill("SIGKILL");
      try { await waitForExit(5000); } catch (error) { shutdownError = String(error); }
    }
  }
  let portClosed = true;
  if (receipt) { try { await fetch(receipt.statusUrl, { signal: AbortSignal.timeout(1000) }); portClosed = false; } catch { /* A closed owned fixture port must reject the connection. */ } }
  await writeFile(resolve(evidence, "provider-selftest.json"), JSON.stringify({ checks, pid: child.pid, exited: hasExited(), portClosed, appLaunched: false, shutdownError }, null, 2));
  if (shutdownError) throw new Error(shutdownError);
  if (!portClosed) throw new Error("Owned fixture port remains open");
}
console.log(`${checks} fixture assertions passed; owned provider stopped; no desktop app launched.`);
console.log(`evidence=${evidence}`);
