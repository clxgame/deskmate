import type { OpenCodeChronology, ToolPart } from "../lib/opencode";
import {
  parseCcSwitchDraftOutput,
  type CcSwitchNoticeReason,
  type CcSwitchProviderDraftFields,
} from "./ccSwitchSetupValidation";

export const CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL =
  "ccswitch_prepare_opencode_provider";

export type CcSwitchCredentialMode = "manual" | "saved-settings";

export type CcSwitchProviderDraft = CcSwitchProviderDraftFields & {
  readonly callID: string;
  readonly credentialMode: CcSwitchCredentialMode;
};

export type { CcSwitchNoticeReason };

export type CcSwitchToolResult =
  | { readonly kind: "draft"; readonly draft: CcSwitchProviderDraft }
  | { readonly kind: "notice"; readonly reason: CcSwitchNoticeReason }
  | { readonly kind: "ordinary_tool"; readonly label: string }
  | { readonly kind: "ignored" };

export type CcSwitchChatSurfaceResult =
  | { readonly kind: "draft_ready" }
  | { readonly kind: "notice"; readonly reason: CcSwitchNoticeReason }
  | { readonly kind: "activity"; readonly label: string }
  | { readonly kind: "ignored" };

export type CcSwitchToolSource = {
  readonly role?: string;
};

function assertNever(value: never): never {
  throw new Error(`Unexpected CC Switch result: ${JSON.stringify(value)}`);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toChronology(value: unknown): OpenCodeChronology | undefined {
  if (!isPlainRecord(value)) return undefined;
  return {
    created:
      typeof value.created === "number" || typeof value.created === "string"
        ? value.created
        : undefined,
    updated:
      typeof value.updated === "number" || typeof value.updated === "string"
        ? value.updated
        : undefined,
    completed:
      typeof value.completed === "number" || typeof value.completed === "string"
        ? value.completed
        : undefined,
    end:
      typeof value.end === "number" || typeof value.end === "string"
        ? value.end
        : undefined,
  };
}

function getToolActivityLabel(part: ToolPart): string {
  return part.state.title ?? part.tool;
}

export function toCcSwitchChatSurfaceResult(
  result: CcSwitchToolResult,
): CcSwitchChatSurfaceResult {
  switch (result.kind) {
    case "draft":
      return { kind: "draft_ready" };
    case "notice":
      return result;
    case "ordinary_tool":
      return { kind: "activity", label: result.label };
    case "ignored":
      return result;
    default:
      return assertNever(result);
  }
}

export function toOpenCodeToolPart(part: unknown): ToolPart | null {
  if (!isPlainRecord(part) || !isPlainRecord(part.state)) return null;
  if (
    typeof part.id !== "string" ||
    typeof part.messageID !== "string" ||
    typeof part.sessionID !== "string" ||
    part.type !== "tool" ||
    typeof part.callID !== "string" ||
    typeof part.tool !== "string" ||
    typeof part.state.status !== "string"
  ) {
    return null;
  }
  const metadata = isPlainRecord(part.state.metadata) ? part.state.metadata : undefined;
  const title = typeof part.state.title === "string" ? part.state.title : undefined;
  const input = part.state.input;
  const base = {
    id: part.id,
    messageID: part.messageID,
    sessionID: part.sessionID,
    type: "tool" as const,
    callID: part.callID,
    tool: part.tool,
    time: toChronology(part.time),
    createdAt: typeof part.createdAt === "string" ? part.createdAt : undefined,
    updatedAt: typeof part.updatedAt === "string" ? part.updatedAt : undefined,
  };
  switch (part.state.status) {
    case "pending":
      return { ...base, state: { status: "pending", title, input, metadata } };
    case "running":
      return { ...base, state: { status: "running", title, input, metadata } };
    case "completed":
      return {
        ...base,
        state: { status: "completed", title, input, metadata, output: part.state.output },
      };
    case "error": {
      const error = isPlainRecord(part.state.error)
        ? {
            name:
              typeof part.state.error.name === "string"
                ? part.state.error.name
                : undefined,
            message:
              typeof part.state.error.message === "string"
                ? part.state.error.message
                : undefined,
          }
        : undefined;
      return {
        ...base,
        state: { status: "error", title, input, metadata, error, output: part.state.output },
      };
    }
    default:
      return null;
  }
}

export function parseCcSwitchToolResult(
  part: ToolPart,
  source: CcSwitchToolSource = {},
): CcSwitchToolResult {
  if (source.role === "user") return { kind: "ignored" };
  if (part.tool !== CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL) {
    return { kind: "ordinary_tool", label: getToolActivityLabel(part) };
  }
  if (part.state.status === "error") return { kind: "notice", reason: "tool_error" };
  if (part.state.status !== "completed") {
    return { kind: "ordinary_tool", label: getToolActivityLabel(part) };
  }
  const draft = parseCcSwitchDraftOutput(part.state.output);
  if (!draft.ok) return { kind: "notice", reason: draft.reason };
  return {
    kind: "draft",
    draft: { callID: part.callID, credentialMode: "manual", ...draft.fields },
  };
}
