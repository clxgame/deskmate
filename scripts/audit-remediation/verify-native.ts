import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { startRuntime } from "../agent-qa/runtime";

// Explicit local binary; never selects a cached binary for another platform.
const binary = resolve(process.env.YUME_QA_OPENCODE_BINARY ?? "src-tauri/resources/opencode/opencode");
const output = resolve("output/audit-remediation/self-acceptance");
await mkdir(output, { recursive: true });
const runtime = await startRuntime({ binary, includeTrusted: false, continueLoopOnDeny: true });
let sidecarLog = "";
runtime.child.stdout.on("data", chunk => { sidecarLog += chunk; });
runtime.child.stderr.on("data", chunk => { sidecarLog += chunk; });
let code = 1;
try {
  const child = Bun.spawn([
    "cargo", "test", "--offline", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--lib",
    "agent::tool_lifecycle_live_tests::live_audit_remediation", "--", "--ignored", "--nocapture",
  ], {
    env: { ...process.env, YUME_AGENT_TEST_BASE: runtime.baseUrl, YUME_AGENT_TEST_WORKSPACE: runtime.workspaceA },
    stdout: "pipe", stderr: "pipe",
  });
  const timeout = setTimeout(() => child.kill(), 180_000);
  let stdout: string, stderr: string;
  try { [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); }
  finally { clearTimeout(timeout); }
  await writeFile(resolve(output, "native.log"), stdout + stderr);
  console.log(stdout, stderr);
  const acceptedInputs = runtime.provider.requests.filter(request => {
    const messages = request.messages;
    return Array.isArray(messages) && !messages.some(message => typeof message === "object" && message !== null && "role" in message && message.role === "tool");
  });
  const recoveryRequests = acceptedInputs.filter(request => JSON.stringify(request.messages).includes("QA_RECOVERY"));
  // Cancellation can reach OpenCode before its streaming request reaches the provider.
  await writeFile(resolve(output, "native-provider.json"), JSON.stringify({ requests: runtime.provider.requests.length, initialRequests: acceptedInputs.length, recoveryInitialRequests: recoveryRequests.length }, null, 2));
  if (code === 0 && (recoveryRequests.length !== 1 || acceptedInputs.length < 3 || acceptedInputs.length > 4)) throw new Error("Provider request ownership or recovery replay check failed");
} finally {
  await writeFile(resolve(output, "native-sidecar.log"), sidecarLog);
  const cleanup = await runtime.close();
  await writeFile(resolve(output, "native-cleanup.json"), JSON.stringify(cleanup, null, 2));
  if (Object.values(cleanup).some(value => value !== true)) throw new Error("Native QA cleanup incomplete");
}
process.exitCode = code;
