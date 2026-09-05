import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  listModels,
  type ProviderModel,
  type Settings,
} from "../lib/settings";
import type { Dict } from "../lib/i18n";
import {
  groupModelsByConfiguredProvider,
  selectedModelValue,
  settingsWithSelectedModel,
} from "./aiProviderModel";
import {
  normalizeCcSwitchCapabilityStatus,
  type CcSwitchCapabilityStatus,
} from "./CcSwitchStatus";
import type { PersistSettings, ReplaceSettings } from "./settingsPrimitives";
import { useAiProviderActions } from "./useAiProviderActions";

type AiTabControllerInput = {
  readonly settings: Settings;
  readonly replace: ReplaceSettings;
  readonly persist: PersistSettings;
  readonly t: Dict;
};

export function useAiTabController({
  settings,
  replace,
  persist,
  t,
}: AiTabControllerInput) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [failed, setFailed] = useState(false);
  const [ccSwitchStatus, setCcSwitchStatus] =
    useState<CcSwitchCapabilityStatus>({ kind: "checking" });
  const ccSwitchRequest = useRef(0);

  const activeProvider =
    settings.providers.find((provider) => provider.id === settings.activeProviderId) ??
    settings.providers[0] ??
    null;
  const activeProviderId = activeProvider?.id ?? settings.activeProviderId;

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

  const actions = useAiProviderActions({
    settings,
    persist,
    refreshModels,
    refreshCcSwitchStatus,
    t,
  });

  const pickModel = (raw: string) => {
    const next = settingsWithSelectedModel(settings, raw);
    if (next !== settings) replace(next);
  };

  const clearVerificationState = () => {
    actions.clearOperationState();
  };

  return {
    activeProviderId,
    ccSwitchStatus,
    currentModelValue: selectedModelValue(settings),
    failed,
    groups: groupModelsByConfiguredProvider(settings.providers, models, t),
    pickModel,
    clearVerificationState,
    ...actions,
  };
}
