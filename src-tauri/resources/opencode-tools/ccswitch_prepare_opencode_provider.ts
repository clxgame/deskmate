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
  readonly kind: "yume.ccswitch.opencode_provider_draft";
  readonly providerName?: string;
  readonly baseUrl?: string;
  readonly modelHint?: string;
  readonly security: {
    readonly secureEntryRequired: true;
    readonly instruction: string;
  };
};

const sensitiveValuePattern =
  /\b(api[-_\s]?key|secret|token|credential|password|bearer)\b|sk-[A-Za-z0-9_-]+/i;

function safeTextOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (sensitiveValuePattern.test(trimmed)) return undefined;
  return trimmed ? trimmed : undefined;
}

function buildProviderDraft(args: DraftArgs): ProviderDraft {
  return {
    version: 1,
    kind: "yume.ccswitch.opencode_provider_draft",
    providerName: safeTextOrUndefined(args.providerName),
    baseUrl: safeTextOrUndefined(args.baseUrl),
    modelHint: safeTextOrUndefined(args.modelHint),
    security: {
      secureEntryRequired: true,
      instruction:
        "YUME must collect credentials only inside the secure setup card. Never ask for, accept, echo, or pass API keys in chat or tool arguments.",
    },
  };
}

export default {
  description:
    "Prepare a secret-free OpenCode provider draft for YUME to import through CC Switch. This tool never accepts API keys; YUME collects credentials only in its secure setup card after user confirmation.",
  args: draftArgs,
  async execute(args: DraftArgs): Promise<string> {
    return JSON.stringify(buildProviderDraft(args));
  },
};
