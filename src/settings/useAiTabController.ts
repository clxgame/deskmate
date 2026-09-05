import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  listModels,
  modelsMatchVerification,
  verifyApiKey,
  type ProviderModel,
  type Settings,
} from "../lib/settings";
import { verifyError, type Dict } from "../lib/i18n";
import {
  groupModelsByConfiguredProvider,
  selectedModelValue,
  settingsWithSelectedModel,
} from "./aiProviderModel";
import {
  localAiDeploymentErrorCode,
  normalizeCcSwitchCapabilityStatus,
  normalizeLocalAiDeploymentReceipt,
  normalizeLocalAiDeploymentStage,
  type CcSwitchCapabilityStatus,
  type LocalAiDeploymentStatus,
} from "./CcSwitchStatus";
import type { Patch, ReplaceSettings } from "./settingsPrimitives";

const LOCAL_AI_DEPLOY_PROGRESS_EVENT = "deskmate://local-ai-deploy-progress";

type VerifyResult = {
  readonly ok: boolean;
  readonly message: string;
};

type AiTabControllerInput = {
  readonly settings: Settings;
  readonly patch: Patch;
  readonly replace: ReplaceSettings;
  readonly t: Dict;
};

export function useAiTabController({
  settings,
  patch,
  replace,
  t,
}: AiTabControllerInput) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [failed, setFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [ccSwitchStatus, setCcSwitchStatus] =
    useState<CcSwitchCapabilityStatus>({ kind: "checking" });
  const [deployment, setDeployment] = useState<LocalAiDeploymentStatus>({
    kind: "idle",
  });
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const ccSwitchRequest = useRef(0);

  const activeProvider =
    settings.providers.find((provider) => provider.id === settings.activeProviderId) ??
    settings.providers[0] ??
    null;
  const activeProviderId = activeProvider?.id ?? settings.activeProviderId;
  const activeProviderSidecarId = activeProvider?.sidecarId ?? settings.providerId;
  const activeProviderLabel = activeProvider?.label ?? t.aiProviderActive;

  const refreshCcSwitchStatus = useCallback(async () => {
    const requestId = ccSwitchRequest.current + 1;
    ccSwitchRequest.current = requestId;
    setCcSwitchStatus({ kind: "checking" });
    try {
      const status = await invoke<unknown>("ccswitch_capability_status");
      if (ccSwitchRequest.current === requestId) {
        setCcSwitchStatus(normalizeCcSwitchCapabilityStatus(status));
      }
    } catch {
      if (ccSwitchRequest.current === requestId) {
        setCcSwitchStatus({ kind: "unavailable", reason: "missing-handler" });
      }
    }
  }, []);

  const refreshModels = useCallback(async () => {
    try {
      const list = await listModels();
      setModels(list);
      setFailed(false);
      return list;
    } catch (error) {
      console.error(error instanceof Error ? error : new Error(String(error)));
      setFailed(true);
      throw error;
    }
  }, []);

  useEffect(() => {
    let closed = false;
    void (async () => {
      try {
        const list = await refreshModels();
        if (!closed) setModels(list);
      } catch (error) {
        console.error(error instanceof Error ? error : new Error(String(error)));
        if (!closed) setFailed(true);
      }
    })();
    return () => {
      closed = true;
    };
  }, [refreshModels]);

  useEffect(() => {
    void refreshCcSwitchStatus();
    return () => {
      ccSwitchRequest.current += 1;
    };
  }, [refreshCcSwitchStatus]);

  useEffect(() => {
    let closed = false;
    let dispose: (() => void) | undefined;
    void listen<unknown>(LOCAL_AI_DEPLOY_PROGRESS_EVENT, (event) => {
      const stage = normalizeLocalAiDeploymentStage(event.payload);
      if (!closed && stage) setDeployment({ kind: "working", stage });
    }).then((unlisten) => {
      if (closed) unlisten();
      else dispose = unlisten;
    });
    return () => {
      closed = true;
      dispose?.();
    };
  }, []);

  const verify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const count = await verifyApiKey(
        activeProviderId,
        settings.baseUrl,
        settings.apiKey,
      );
      const refreshed = await refreshModels();
      if (!modelsMatchVerification(refreshed, activeProviderSidecarId, count)) {
        throw new Error("models_unavailable");
      }
      setVerifyResult({ ok: true, message: t.verifyOk(count) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVerifyResult({ ok: false, message: verifyError(t, message) });
    } finally {
      setVerifying(false);
    }
  };

  const deployLocalAi = async () => {
    setDeployment({ kind: "working", stage: "verifyingApi" });
    setVerifyResult(null);
    try {
      const count = await verifyApiKey(
        activeProviderId,
        settings.baseUrl,
        settings.apiKey,
      );
      const refreshed = await refreshModels();
      if (!modelsMatchVerification(refreshed, activeProviderSidecarId, count)) {
        throw new Error("models_unavailable");
      }
      const available = refreshed.filter(
        (model) => model.sidecarId === activeProviderSidecarId,
      );
      const chosen =
        available.find(
          (model) =>
            settings.providerId === activeProviderSidecarId &&
            model.modelId === settings.modelId,
        ) ?? available[0];
      if (!chosen) throw new Error("models_unavailable");
      if (
        settings.providerId !== activeProviderSidecarId ||
        settings.modelId !== chosen.modelId
      ) {
        patch("providerId", activeProviderSidecarId);
        patch("modelId", chosen.modelId);
      }
      setDeployment({ kind: "working", stage: "installingOpenCode" });
      const raw = await invoke<unknown>("deploy_local_ai_stack", {
        request: { modelId: chosen.modelId },
      });
      const receipt = normalizeLocalAiDeploymentReceipt(raw);
      if (!receipt) throw new Error("local_ai_deploy_invalid_result");
      setDeployment({
        kind: "success",
        ccSwitchVersion: receipt.ccSwitchVersion,
        openCodeVersion: receipt.openCodeVersion,
        modelCount: receipt.modelCount,
        ccSwitchSyncRequired: receipt.ccSwitchSyncRequired,
        ccSwitchRunning: receipt.ccSwitchRunning,
      });
      await refreshCcSwitchStatus();
    } catch (error) {
      const code = localAiDeploymentErrorCode(error);
      const message = [
        "empty_key",
        "bad_url",
        "unauthorized",
        "not_found",
        "no_models",
        "invalid_response",
        "models_unavailable",
      ].includes(code)
        ? verifyError(t, code)
        : t.localAiDeployError(code);
      setDeployment({ kind: "error", message });
    }
  };

  const pickModel = (raw: string) => {
    const next = settingsWithSelectedModel(settings, raw);
    if (next !== settings) replace(next);
  };

  const clearVerificationState = () => {
    setVerifyResult(null);
    setDeployment({ kind: "idle" });
  };

  return {
    activeProviderId,
    activeProviderLabel,
    ccSwitchStatus,
    currentModelValue: selectedModelValue(settings),
    deployment,
    failed,
    groups: groupModelsByConfiguredProvider(settings.providers, models),
    pickModel,
    clearVerificationState,
    deployLocalAi,
    verify,
    verifying,
    verifyResult,
  };
}
