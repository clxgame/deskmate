export type CcSwitchProviderDraftFields = {
  readonly providerName?: string;
  readonly baseUrl?: string;
  readonly modelHint?: string;
};

export type CcSwitchNoticeReason =
  | "duplicate_call"
  | "invalid_envelope"
  | "invalid_field"
  | "secret_field"
  | "tool_error"
  | "unknown_field";

export type CcSwitchDraftValidationResult =
  | { readonly ok: true; readonly fields: CcSwitchProviderDraftFields }
  | { readonly ok: false; readonly reason: CcSwitchNoticeReason };

type TextParseResult =
  | { readonly ok: true; readonly value?: string }
  | { readonly ok: false; readonly reason: CcSwitchNoticeReason };

const ENVELOPE_VERSION = 1;
const ENVELOPE_KIND = "opencode_provider_draft";
const MAX_PROVIDER_NAME_LENGTH = 80;
const MAX_BASE_URL_LENGTH = 512;
const MAX_MODEL_HINT_LENGTH = 128;
const PROVIDER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/u;
const MODEL_HINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/u;
const BASE_URL_PATH_PATTERN = /^\/[A-Za-z0-9._~/-]*$/u;
const ALLOWED_ENVELOPE_KEYS = [
  "version",
  "kind",
  "providerName",
  "baseUrl",
  "modelHint",
] as const;
const SECRET_FIELD_PATTERN =
  /(api[\s_-]*key|token|secret|password|authorization|credential)/iu;
const SECRET_VALUE_PATTERNS = [
  SECRET_FIELD_PATTERN,
  /\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{16,}\b/iu,
  /\b(?:gh[pousr]|glpat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/iu,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{35}\b/u,
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{16,}={0,2}\b/iu,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
] as const;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEnvelopeOutput(output: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof output !== "string") return isPlainRecord(output) ? output : null;
  try {
    const parsed: unknown = JSON.parse(output);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function hasSecretLikeValue(value: string): boolean {
  const decoded = safeDecode(value);
  return SECRET_VALUE_PATTERNS.some(
    (pattern) => pattern.test(value) || pattern.test(decoded),
  );
}

function hasAllowedKeys(keys: readonly string[]): boolean {
  return keys.every((key) =>
    ALLOWED_ENVELOPE_KEYS.some((allowed) => allowed === key),
  );
}

function isBoundedText(value: unknown, maxLength: number): value is string | undefined {
  if (value === undefined) return true;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !CONTROL_CHARACTER_PATTERN.test(value)
  );
}

function parseBoundedPattern(
  value: unknown,
  maxLength: number,
  pattern: RegExp,
): TextParseResult {
  if (!isBoundedText(value, maxLength)) return { ok: false, reason: "invalid_field" };
  if (value === undefined) return { ok: true };
  if (hasSecretLikeValue(value)) return { ok: false, reason: "secret_field" };
  if (!pattern.test(value)) return { ok: false, reason: "invalid_field" };
  return { ok: true, value };
}

function isLoopbackHttp(url: URL): boolean {
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]")
  );
}

function parseAllowedBaseUrl(value: unknown): CcSwitchDraftValidationResult {
  if (value === undefined) return { ok: true, fields: {} };
  if (typeof value !== "string") return { ok: false, reason: "invalid_field" };
  if (value.length > MAX_BASE_URL_LENGTH || CONTROL_CHARACTER_PATTERN.test(value)) {
    return { ok: false, reason: "invalid_field" };
  }
  if (hasSecretLikeValue(value)) return { ok: false, reason: "secret_field" };
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) {
      return { ok: false, reason: "invalid_field" };
    }
    if (hasSecretLikeValue(url.pathname)) return { ok: false, reason: "secret_field" };
    if (!BASE_URL_PATH_PATTERN.test(url.pathname)) {
      return { ok: false, reason: "invalid_field" };
    }
    if (url.protocol !== "https:" && !isLoopbackHttp(url)) {
      return { ok: false, reason: "invalid_field" };
    }
    const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/u, "");
    return {
      ok: true,
      fields: { baseUrl: `${url.protocol}//${url.host.toLowerCase()}${path}` },
    };
  } catch {
    return { ok: false, reason: "invalid_field" };
  }
}

function parseDraftRecord(
  record: Readonly<Record<string, unknown>>,
): CcSwitchDraftValidationResult {
  const keys = Object.keys(record);
  if (keys.some((key) => SECRET_FIELD_PATTERN.test(key))) {
    return { ok: false, reason: "secret_field" };
  }
  if (!hasAllowedKeys(keys)) return { ok: false, reason: "unknown_field" };
  if (record.version !== ENVELOPE_VERSION || record.kind !== ENVELOPE_KIND) {
    return { ok: false, reason: "invalid_envelope" };
  }
  const providerName = parseBoundedPattern(
    record.providerName,
    MAX_PROVIDER_NAME_LENGTH,
    PROVIDER_NAME_PATTERN,
  );
  if (!providerName.ok) return providerName;
  const modelHint = parseBoundedPattern(
    record.modelHint,
    MAX_MODEL_HINT_LENGTH,
    MODEL_HINT_PATTERN,
  );
  if (!modelHint.ok) return modelHint;
  const baseUrl = parseAllowedBaseUrl(record.baseUrl);
  if (!baseUrl.ok) return baseUrl;
  return {
    ok: true,
    fields: {
      providerName: providerName.value,
      baseUrl: baseUrl.fields.baseUrl,
      modelHint: modelHint.value,
    },
  };
}

function classifyInvalidEnvelope(
  record: Readonly<Record<string, unknown>> | null,
): CcSwitchNoticeReason {
  if (!record) return "invalid_envelope";
  const keys = Object.keys(record);
  if (keys.some((key) => SECRET_FIELD_PATTERN.test(key))) return "secret_field";
  if (!hasAllowedKeys(keys)) return "unknown_field";
  if (record.version !== ENVELOPE_VERSION || record.kind !== ENVELOPE_KIND) {
    return "invalid_envelope";
  }
  return "invalid_field";
}

export function parseCcSwitchDraftOutput(
  output: unknown,
): CcSwitchDraftValidationResult {
  const record = parseEnvelopeOutput(output);
  return record ? parseDraftRecord(record) : { ok: false, reason: classifyInvalidEnvelope(record) };
}
