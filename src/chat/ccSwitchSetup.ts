import type { OpenCodeChronology, OpenCodeMessage, ToolPart } from "../lib/opencode";
import {
  CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
  parseCcSwitchToolResult,
  toOpenCodeToolPart,
  type CcSwitchToolResult,
  type CcSwitchToolSource,
} from "./ccSwitchSetupParser";

export {
  CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL,
  parseCcSwitchToolResult,
  toCcSwitchChatSurfaceResult,
  toOpenCodeToolPart,
  type CcSwitchChatSurfaceResult,
  type CcSwitchNoticeReason,
  type CcSwitchProviderDraft,
  type CcSwitchToolResult,
  type CcSwitchToolSource,
} from "./ccSwitchSetupParser";

export type CcSwitchToolResultTracker = {
  readonly acceptToolPart: (
    part: ToolPart,
    source?: CcSwitchToolSource,
  ) => CcSwitchToolResult;
};

type TerminalSnapshotEntry = {
  readonly sessionID: string;
  readonly result: CcSwitchToolResult;
  readonly chronology: number | null;
};

function isCompletedCcSwitchSetupCall(
  part: ToolPart,
  source: CcSwitchToolSource,
): boolean {
  return (
    source.role !== "user" &&
    part.tool === CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL &&
    part.state.status === "completed"
  );
}

function isTerminalCcSwitchSetupCall(
  part: ToolPart,
  source: CcSwitchToolSource,
): boolean {
  return (
    isCompletedCcSwitchSetupCall(part, source) ||
    (source.role !== "user" &&
      part.tool === CCSWITCH_PREPARE_OPENCODE_PROVIDER_TOOL &&
      part.state.status === "error")
  );
}

function toChronologyNumber(value: number | string | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function newestChronologyValue(time: OpenCodeChronology | undefined): number | null {
  if (!time) return null;
  const values = [
    toChronologyNumber(time.end),
    toChronologyNumber(time.completed),
    toChronologyNumber(time.updated),
    toChronologyNumber(time.created),
  ].filter((value) => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function chronologyFor(message: OpenCodeMessage, part: ToolPart): number | null {
  return (
    newestChronologyValue(part.time) ??
    toChronologyNumber(part.updatedAt) ??
    toChronologyNumber(part.createdAt) ??
    newestChronologyValue(message.time) ??
    toChronologyNumber(message.updatedAt) ??
    toChronologyNumber(message.createdAt)
  );
}

function visibleResult(result: CcSwitchToolResult): CcSwitchToolResult | null {
  return result.kind === "draft" || result.kind === "notice" ? result : null;
}

function pickTerminalSnapshotResult(
  entries: readonly TerminalSnapshotEntry[],
): CcSwitchToolResult | null {
  const chronologicalEntries = entries.filter((entry) => entry.chronology !== null);
  if (chronologicalEntries.length > 0) {
    const newest = chronologicalEntries.reduce((candidate, entry) =>
      entry.chronology !== null &&
      candidate.chronology !== null &&
      entry.chronology > candidate.chronology
        ? entry
        : candidate,
    );
    return visibleResult(newest.result);
  }
  const draftEntries = entries.filter((entry) => entry.result.kind === "draft");
  if (draftEntries.length === 1) return visibleResult(draftEntries[0].result);
  if (draftEntries.length > 1) return null;
  if (entries.some((entry) => entry.result.kind === "ignored")) return null;
  const noticeEntries = entries.filter((entry) => entry.result.kind === "notice");
  return noticeEntries.length === 1 ? visibleResult(noticeEntries[0].result) : null;
}

export function createCcSwitchToolResultTracker(): CcSwitchToolResultTracker {
  const acceptedSuccessfulCallIDs = new Set<string>();
  return {
    acceptToolPart(part, source = {}) {
      if (isCompletedCcSwitchSetupCall(part, source)) {
        if (acceptedSuccessfulCallIDs.has(part.callID)) {
          return { kind: "ignored" };
        }
      }
      const result = parseCcSwitchToolResult(part, source);
      if (isCompletedCcSwitchSetupCall(part, source) && result.kind === "draft") {
        acceptedSuccessfulCallIDs.add(part.callID);
      }
      return result;
    },
  };
}

export function recoverCcSwitchToolResultsFromMessages(
  messages: readonly OpenCodeMessage[],
  tracker: CcSwitchToolResultTracker = createCcSwitchToolResultTracker(),
): readonly CcSwitchToolResult[] {
  const results: CcSwitchToolResult[] = [];
  const terminalEntriesBySessionID = new Map<string, TerminalSnapshotEntry[]>();
  for (const message of messages) {
    if (message.role === "user") continue;
    for (const part of message.parts ?? []) {
      const toolPart = toOpenCodeToolPart(part);
      if (!toolPart) continue;
      const source = { role: message.role };
      const result = tracker.acceptToolPart(toolPart, source);
      if (isTerminalCcSwitchSetupCall(toolPart, source)) {
        const entries = terminalEntriesBySessionID.get(toolPart.sessionID) ?? [];
        entries.push({
          sessionID: toolPart.sessionID,
          result,
          chronology: chronologyFor(message, toolPart),
        });
        terminalEntriesBySessionID.set(toolPart.sessionID, entries);
        continue;
      }
      const visible = visibleResult(result);
      if (visible) results.push(visible);
    }
  }
  for (const entries of terminalEntriesBySessionID.values()) {
    const result = pickTerminalSnapshotResult(entries);
    if (result) results.push(result);
  }
  return results;
}

export function recoverCcSwitchDraftsFromMessages(
  messages: readonly OpenCodeMessage[],
  tracker: CcSwitchToolResultTracker = createCcSwitchToolResultTracker(),
): readonly CcSwitchToolResult[] {
  return recoverCcSwitchToolResultsFromMessages(messages, tracker).filter(
    (result) => result.kind === "draft",
  );
}
