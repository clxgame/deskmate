export type JsonObject = Record<string, unknown>;

export type Snapshot = {
  readonly exit: string | undefined;
  readonly output: string;
};

export type HttpResult = {
  readonly code: number | null;
  readonly stdout: string;
};

export type RequestJsonInput = {
  readonly baseUrl: string;
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: JsonObject;
  readonly timeoutSeconds?: number;
  readonly runner?: (url: string, timeoutSeconds: number) => Promise<HttpResult>;
};

export type ProviderDraft = {
  readonly version: 1;
  readonly kind: "opencode_provider_draft";
  readonly providerName?: string;
  readonly baseUrl?: string;
  readonly modelHint?: string;
};

export type CompletedToolEvidence = {
  readonly sessionID: string;
  readonly messageID: string;
  readonly partID: string;
  readonly callID: string;
  readonly tool: string;
  readonly draft: ProviderDraft;
};

export type CleanupEvidence = {
  readonly tempRootRemoved: boolean;
  readonly opencodePortClosed: boolean;
  readonly mockPortClosed: boolean;
  readonly opencodeProcessGone: boolean;
};

export type FullEvidence = {
  readonly transcript: string;
  readonly health: JsonObject;
  readonly config: JsonObject;
  readonly toolIds: readonly string[];
  readonly session: CompletedToolEvidence;
  readonly sse: CompletedToolEvidence;
  readonly snapshot: CompletedToolEvidence;
  readonly mock: JsonObject;
  readonly cleanup: CleanupEvidence;
};

export type HarnessErrorCode =
  | "canary_leak"
  | "cleanup_probe_failed"
  | "malformed_tool_output"
  | "scenario_startup_failed"
  | "verification_failed";

export class HarnessError extends Error {
  readonly name = "HarnessError";
  readonly code: HarnessErrorCode;

  constructor(message: string, code: HarnessErrorCode = "verification_failed", options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectJsonObject(value: unknown, label: string, code: HarnessErrorCode = "verification_failed"): JsonObject {
  if (isJsonObject(value)) return value;
  throw new HarnessError(`${label} is not an object`, code);
}

export function expectString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new HarnessError(`${label} is not a non-empty string`);
}

export function expectNumber(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new HarnessError(`${label} is not a finite number`);
}
