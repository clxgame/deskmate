import { CCSWITCH_TOOL_ID } from "./permissions";
import {
  expectJsonObject,
  expectNumber,
  expectString,
  HarnessError,
  isJsonObject,
  type CompletedToolEvidence,
  type JsonObject,
  type ProviderDraft,
} from "./types";

type CompletedToolExpectation = {
  readonly sessionID?: string;
  readonly draft?: ProviderDraft;
};

function parseDraft(value: unknown): ProviderDraft {
  let raw: unknown;
  try {
    raw = typeof value === "string" ? JSON.parse(value) : value;
  } catch (error) {
    throw new HarnessError("tool output was not valid JSON", "malformed_tool_output", { cause: error });
  }
  const draft = expectJsonObject(raw, "tool output", "malformed_tool_output");
  if (draft.version !== 1) throw new HarnessError("tool output version was not 1", "malformed_tool_output");
  if (draft.kind !== "opencode_provider_draft") throw new HarnessError("tool output kind was not opencode_provider_draft", "malformed_tool_output");
  return {
    version: 1,
    kind: "opencode_provider_draft",
    providerName: typeof draft.providerName === "string" ? draft.providerName : undefined,
    baseUrl: typeof draft.baseUrl === "string" ? draft.baseUrl : undefined,
    modelHint: typeof draft.modelHint === "string" ? draft.modelHint : undefined,
  };
}

function toCompletedToolEvidence(value: JsonObject): CompletedToolEvidence | undefined {
  if (value.type !== "tool" || value.tool !== CCSWITCH_TOOL_ID || !isJsonObject(value.state)) return undefined;
  if (value.state.status !== "completed") return undefined;
  return {
    sessionID: expectString(value.sessionID, "tool sessionID"),
    messageID: expectString(value.messageID, "tool messageID"),
    partID: expectString(value.id, "tool partID"),
    callID: expectString(value.callID, "tool callID"),
    tool: CCSWITCH_TOOL_ID,
    draft: parseDraft(value.state.output),
  };
}

function collectCompletedTools(value: unknown, output: CompletedToolEvidence[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCompletedTools(item, output);
    return;
  }
  if (!isJsonObject(value)) return;
  const tool = toCompletedToolEvidence(value);
  if (tool) output.push(tool);
  for (const child of Object.values(value)) collectCompletedTools(child, output);
}

function sameDraft(left: ProviderDraft, right: ProviderDraft): boolean {
  return (
    left.version === right.version &&
    left.kind === right.kind &&
    left.providerName === right.providerName &&
    left.baseUrl === right.baseUrl &&
    left.modelHint === right.modelHint
  );
}

function matchesExpectation(tool: CompletedToolEvidence, expectation: CompletedToolExpectation): boolean {
  if (expectation.sessionID !== undefined && tool.sessionID !== expectation.sessionID) return false;
  if (expectation.draft !== undefined && !sameDraft(tool.draft, expectation.draft)) return false;
  return true;
}

export function expectCompletedTool(value: unknown, label: string, expectation: CompletedToolExpectation = {}): CompletedToolEvidence {
  const matches: CompletedToolEvidence[] = [];
  collectCompletedTools(value, matches);
  const scoped = matches.filter((tool) => matchesExpectation(tool, expectation));
  if (scoped.length === 0) throw new HarnessError(`${label} did not contain a completed ${CCSWITCH_TOOL_ID} tool part`);
  if (scoped.length > 1) throw new HarnessError(`${label} contained ${scoped.length} completed ${CCSWITCH_TOOL_ID} tool parts`);
  return scoped[0];
}

export function expectSessionID(value: unknown): string {
  return expectString(expectJsonObject(value, "session").id, "session id");
}

export function assertSameCompletedTool(left: CompletedToolEvidence, right: CompletedToolEvidence): void {
  if (left.sessionID !== right.sessionID) throw new HarnessError("SSE and snapshot session IDs did not match");
  if (left.messageID !== right.messageID) throw new HarnessError("SSE and snapshot message IDs did not match");
  if (left.partID !== right.partID) throw new HarnessError("SSE and snapshot part IDs did not match");
  if (left.callID !== right.callID) throw new HarnessError("SSE and snapshot call IDs did not match");
  if (left.tool !== right.tool) throw new HarnessError("SSE and snapshot tool IDs did not match");
  if (!sameDraft(left.draft, right.draft)) throw new HarnessError("SSE and snapshot drafts did not match");
}

export function assertMockObservation(value: JsonObject): void {
  if (expectNumber(value.requestCount, "mock request count") < 2) {
    throw new HarnessError("mock OpenAI server did not observe both tool-call and tool-result turns");
  }
  if (value.sawDedicatedTool !== true) throw new HarnessError("mock OpenAI request did not expose the dedicated tool");
  if (value.sawToolResultRoundTrip !== true) throw new HarnessError("OpenCode did not send the tool result back to the model");
  if (value.dangerousToolExposureCount !== 0) throw new HarnessError("dangerous tools were exposed to the model");
}

export function assertCanaryAbsent(value: unknown, canary: string, label: string): void {
  if (JSON.stringify(value).includes(canary)) throw new HarnessError(`${label} leaked the runtime canary`);
}
