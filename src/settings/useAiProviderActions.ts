import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import type { Dict } from "../lib/i18n";
import { verifyError } from "../lib/i18n";
import {
  modelsMatchVerification,
  verifyApiKey,
  type ProviderModel,
  type Settings,
} from "../lib/settings";
import {
  localAiDeploymentErrorCode,
  normalizeLocalAiDeploymentReceipt,
  normalizeLocalAiDeploymentStage,
  type LocalAiDeploymentStatus,
} from "./CcSwitchStatus";
import type { PersistSettings } from "./settingsPrimitives";

const LOCAL_AI_DEPLOY_PROGRESS_EVENT = "deskmate://local-ai-deploy-progress";

export type ProviderVerifyResult = {
  readonly ok: boolean;
  readonly message: string;
};

type ProviderActionsInput = {
  readonly settings: Settings;
  readonly persist: PersistSettings;
  readonly refreshModels: () => Promise<ProviderModel[]>;
  readonly refreshCcSwitchStatus: () => Promise<void>;
  readonly t: Dict;
};

function safeVerifyMessage(t: Dict, error: Error | string): string {
  const code = error instanceof Error ? error.message : error;
  if (
    [
      "empty_key",
      "bad_url",
      "unauthorized",
      "not_found",
      "no_models",
      "models_unavailable",
    ].includes(code) ||
    code.startsWith("status:") ||
    code.startsWith("network:")
  ) {
    return verifyError(t, code);
  }
  return t.aiUnreachable;
}

function deploymentErrorMessage(t: Dict, error: Error | string): string {
  const code = localAiDeploymentErrorCode(error);
  if (
    [
      "empty_key",
      "bad_url",
      "unauthorized",
      "not_found",
      "no_models",
      "invalid_response",
      "models_unavailable",
    ].includes(code)
  ) {
    return verifyError(t, code);
  }
  return t.localAiDeployError(code);
}

export function useAiProviderActions({
  settings,
  persist,
  refreshModels,
  refreshCcSwitchStatus,
  t,
}: ProviderActionsInput) {
  const [verifyingProviderId, setVerifyingProviderId] = useState<string | null>(
    null,
  );
  const [verifyResults, setVerifyResults] = useState<
    Readonly<Record<string, ProviderVerifyResult>>
  >({});
  const [deployments, setDeployments] = useState<
    Readonly<Record<string, LocalAiDeploymentStatus>>
  >({});
  const deployingProviderId = useRef<string | null>(null);
  const operationRequest = useRef(0);

  const beginOperation = () => {
    operationRequest.current += 1;
    return operationRequest.current;
  };
  const isCurrentOperation = (requestId: number) =>
    operationRequest.current === requestId;

  const setProviderDeployment = (
    providerId: string,
    deployment: LocalAiDeploymentStatus,
  ) => {
    setDeployments((current) => ({ ...current, [providerId]: deployment }));
  };

  useEffect(() => {
    let closed = false;
    let dispose: (() => void) | undefined;
    void listen<unknown>(LOCAL_AI_DEPLOY_PROGRESS_EVENT, (event) => {
      const providerId = deployingProviderId.current;
      const stage = normalizeLocalAiDeploymentStage(event.payload);
      if (!closed && providerId && stage) {
        setProviderDeployment(providerId, { kind: "working", stage });
      }
    }).then((unlisten) => {
      if (closed) unlisten();
      else dispose = unlisten;
    });
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);

  const verifyProvider = async (providerId: string) => {
    const requestId = beginOperation();
    setVerifyingProviderId(providerId);
    setVerifyResults((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    try {
      const provider = settings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("provider_missing");
      await persist(settings);
      if (!isCurrentOperation(requestId)) return;
      const count = await verifyApiKey(
        provider.id,
        provider.baseUrl,
        provider.apiKey,
      );
      if (!isCurrentOperation(requestId)) return;
      const refreshed = await refreshModels();
      if (!isCurrentOperation(requestId)) return;
      if (!modelsMatchVerification(refreshed, provider.sidecarId, count)) {
        throw new Error("models_unavailable");
      }
      setVerifyResults((current) => ({
        ...current,
        [providerId]: { ok: true, message: t.verifyOk(count) },
      }));
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : String(error);
      if (isCurrentOperation(requestId)) {
        setVerifyResults((current) => ({
          ...current,
          [providerId]: {
            ok: false,
            message: safeVerifyMessage(t, normalizedError),
          },
        }));
      }
    } finally {
      if (isCurrentOperation(requestId)) setVerifyingProviderId(null);
    }
  };

  const deployProvider = async (providerId: string) => {
    const requestId = beginOperation();
    deployingProviderId.current = providerId;
    setProviderDeployment(providerId, { kind: "working", stage: "verifyingApi" });
    try {
      const provider = settings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("provider_missing");
      await persist(settings);
      if (!isCurrentOperation(requestId)) return;
      const count = await verifyApiKey(
        provider.id,
        provider.baseUrl,
        provider.apiKey,
      );
      if (!isCurrentOperation(requestId)) return;
      const refreshed = await refreshModels();
      if (!isCurrentOperation(requestId)) return;
      if (!modelsMatchVerification(refreshed, provider.sidecarId, count)) {
        throw new Error("models_unavailable");
      }
      const available = refreshed.filter(
        (model) => model.sidecarId === provider.sidecarId,
      );
      const chosen =
        available.find(
          (model) =>
            settings.providerId === provider.sidecarId &&
            model.modelId === settings.modelId,
        ) ?? available[0];
      if (!chosen) throw new Error("models_unavailable");
      await persist({
        ...settings,
        activeProviderId: provider.id,
        providerId: provider.sidecarId,
        modelId: chosen.modelId,
      });
      if (!isCurrentOperation(requestId)) return;
      setProviderDeployment(providerId, {
        kind: "working",
        stage: "installingOpenCode",
      });
      const raw = await invoke<unknown>("deploy_local_ai_stack", {
        request: { modelId: chosen.modelId },
      });
      if (!isCurrentOperation(requestId)) return;
      const receipt = normalizeLocalAiDeploymentReceipt(raw);
      if (!receipt) throw new Error("local_ai_deploy_invalid_result");
      setProviderDeployment(providerId, {
        kind: "success",
        ccSwitchVersion: receipt.ccSwitchVersion,
        openCodeVersion: receipt.openCodeVersion,
        modelCount: receipt.modelCount,
        ccSwitchSyncRequired: receipt.ccSwitchSyncRequired,
        ccSwitchRunning: receipt.ccSwitchRunning,
      });
      await refreshCcSwitchStatus();
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : localAiDeploymentErrorCode(error);
      if (isCurrentOperation(requestId)) {
        setProviderDeployment(providerId, {
          kind: "error",
          message: deploymentErrorMessage(t, normalizedError),
        });
      }
    } finally {
      if (isCurrentOperation(requestId)) {
        deployingProviderId.current = null;
      }
    }
  };

  const clearOperationState = () => {
    operationRequest.current += 1;
    deployingProviderId.current = null;
    setVerifyingProviderId(null);
    setVerifyResults({});
    setDeployments({});
  };

  return {
    clearOperationState,
    deploymentFor: (providerId: string): LocalAiDeploymentStatus =>
      deployments[providerId] ?? { kind: "idle" },
    deployProvider,
    operationBusy:
      verifyingProviderId !== null ||
      Object.values(deployments).some((deployment) => deployment.kind === "working"),
    verifyProvider,
    verifyResultFor: (providerId: string): ProviderVerifyResult | null =>
      verifyResults[providerId] ?? null,
    verifyingProviderId,
  };
}
