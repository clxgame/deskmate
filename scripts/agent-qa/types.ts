export type JsonObject = { readonly [key: string]: JsonValue };
export type JsonValue = string | number | boolean | null | JsonObject | readonly JsonValue[];

export type Check = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

export type CleanupReceipt = {
  readonly processGone: boolean;
  readonly providerClosed: boolean;
  readonly sidecarClosed: boolean;
  readonly tempRootRemoved: boolean;
};

export class ContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function jsonObject(value: unknown, label: string): JsonObject {
  if (!isJsonObject(value)) throw new ContractError("INVALID_WIRE", `${label} is not an object`);
  return value;
}

export function stringField(value: JsonObject, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new ContractError("INVALID_WIRE", `${key} is not a non-empty string`);
  }
  return field;
}

export function check(name: string, passed: boolean, detail: string): Check {
  if (!passed) throw new ContractError("ASSERTION_FAILED", `${name}: ${detail}`);
  return { name, passed, detail };
}
