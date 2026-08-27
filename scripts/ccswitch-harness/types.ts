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
  readonly timeoutSeconds?: number;
  readonly runner?: (url: string, timeoutSeconds: number) => Promise<HttpResult>;
};

export type DiscoveryEvidence = readonly [
  transcript: string,
  config: JsonObject,
  toolIds: readonly string[],
];

export class HarnessError extends Error {
  readonly name = "HarnessError";
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function expectJsonObject(value: unknown, label: string): JsonObject {
  if (isJsonObject(value)) return value;
  throw new HarnessError(`${label} is not an object`);
}
