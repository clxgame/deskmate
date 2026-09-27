import { invoke } from "@tauri-apps/api/core";

export type ConversationModelSelection =
  | { readonly mode: "inherit" }
  | { readonly mode: "override"; readonly configuredProviderId: string; readonly sidecarId: string; readonly modelId: string };

export const INHERIT_MODEL: ConversationModelSelection = { mode: "inherit" };

export interface ChatModelChoice {
  readonly configuredProviderId: string;
  readonly sidecarId: string;
  readonly modelId: string;
  readonly modelName: string;
}

export interface ChatModelCatalog {
  readonly models: readonly ChatModelChoice[];
  readonly defaultModel: ChatModelChoice | null;
}

export function selectionForModel(model: ChatModelChoice): ConversationModelSelection {
  return { mode: "override", configuredProviderId: model.configuredProviderId, sidecarId: model.sidecarId, modelId: model.modelId };
}

export function sameModel(a: ChatModelChoice, b: ChatModelChoice): boolean {
  return a.configuredProviderId === b.configuredProviderId && a.sidecarId === b.sidecarId && a.modelId === b.modelId;
}

export function catalogModels(): Promise<ChatModelCatalog> {
  return invoke<ChatModelCatalog>("chat_model_catalog");
}

export function resolveConversationModel(selection: ConversationModelSelection): Promise<ChatModelChoice> {
  return invoke<ChatModelChoice>("chat_model_resolve", { selection });
}

export function getConversationModel(key: string): Promise<ConversationModelSelection> {
  return invoke<ConversationModelSelection>("history_model_selection_get", { key });
}

export function setConversationModel(key: string, selection: ConversationModelSelection): Promise<void> {
  return invoke<void>("history_model_selection_set", { key, selection });
}
