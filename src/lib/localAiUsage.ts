import { invoke } from "@tauri-apps/api/core";

type Value = Record<string, unknown>;

function object(value: unknown): Value | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Value
    : null;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function completedUsageObservation(info: unknown): {
  messageId: string;
  sidecarId: string;
  modelId: string;
  createdAtMs: number;
  tokens: number;
} | null {
  const message = object(info);
  const time = object(message?.time);
  const usage = object(message?.tokens);
  const cache = object(usage?.cache);
  if (message?.role !== "assistant" || !time || time.completed == null || !usage ||
      typeof message.id !== "string" || typeof message.providerID !== "string" ||
      typeof message.modelID !== "string" || typeof time.created !== "number") return null;
  return {
    messageId: message.id,
    sidecarId: message.providerID,
    modelId: message.modelID,
    createdAtMs: time.created,
    tokens: tokenCount(usage.input) + tokenCount(usage.output) + tokenCount(usage.reasoning)
      + tokenCount(cache?.read) + tokenCount(cache?.write),
  };
}

export async function recordCompletedAiUsage(info: unknown): Promise<void> {
  const observation = completedUsageObservation(info);
  if (!observation) return;
  await invoke("record_ai_usage", { observation });
}
