const draftArgs = {
  providerName: {
    type: "string",
    description: "Optional display name for the CC Switch OpenCode provider.",
    maxLength: 80,
  },
  baseUrl: {
    type: "string",
    format: "uri",
    description: "Optional OpenAI-compatible base URL to prefill in YUME's secure setup card.",
    maxLength: 240,
  },
  modelHint: {
    type: "string",
    description: "Optional model name or ID hint. YUME will still require model validation before import.",
    maxLength: 120,
  },
} as const;

type DraftArgs = {
  readonly providerName?: unknown;
  readonly baseUrl?: unknown;
  readonly modelHint?: unknown;
};

type ProviderDraft = {
  readonly version: 1;
  readonly kind: "opencode_provider_draft";
  readonly providerName?: string;
  readonly baseUrl?: string;
  readonly modelHint?: string;
};

const sensitiveValuePattern =
  /\b(api[-_\s]?key|secret|token|credential|password|bearer|authorization)\b|sk-[A-Za-z0-9_-]+/i;

const tokenShapePatterns = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bhf_[A-Za-z0-9]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
] as const;

function isSensitiveText(value: string): boolean {
  if (sensitiveValuePattern.test(value)) return true;
  return tokenShapePatterns.some((pattern) => pattern.test(value));
}

function safeTextOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function assertDraftArgsSecretFree(args: DraftArgs): void {
  for (const value of [args.providerName, args.baseUrl, args.modelHint]) {
    if (typeof value === "string" && isSensitiveText(value)) {
      throw new Error("secret-free draft refused");
    }
  }
}

function buildProviderDraft(args: DraftArgs): ProviderDraft {
  return {
    version: 1,
    kind: "opencode_provider_draft",
    providerName: safeTextOrUndefined(args.providerName),
    baseUrl: safeTextOrUndefined(args.baseUrl),
    modelHint: safeTextOrUndefined(args.modelHint),
  };
}

export default {
  description:
    "Prepare a secret-free OpenCode provider draft for YUME to import through CC Switch. This tool never accepts API keys; YUME collects credentials only in its secure setup card after user confirmation.",
  args: draftArgs,
  async execute(args: DraftArgs): Promise<string> {
    assertDraftArgsSecretFree(args);
    return JSON.stringify(buildProviderDraft(args));
  },
};
