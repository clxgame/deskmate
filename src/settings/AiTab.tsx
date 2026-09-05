import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  listModels,
  modelsMatchVerification,
  verifyApiKey,
  type ProviderModel,
} from "../lib/settings";
import { verifyError } from "../lib/i18n";
import { AiUsage } from "./AiUsage";
import {
  CcSwitchStatus,
  localAiDeploymentErrorCode,
  normalizeCcSwitchCapabilityStatus,
  normalizeLocalAiDeploymentReceipt,
  normalizeLocalAiDeploymentStage,
  type CcSwitchCapabilityStatus,
  type LocalAiDeploymentStatus,
} from "./CcSwitchStatus";
import { Row, Switch, type TabProps } from "./settingsPrimitives";

const LOCAL_AI_DEPLOY_PROGRESS_EVENT = "deskmate://local-ai-deploy-progress";

export function AiTab({ settings, patch, t }: TabProps) {
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [failed, setFailed] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [ccSwitchStatus, setCcSwitchStatus] =
    useState<CcSwitchCapabilityStatus>({ kind: "checking" });
  const [deployment, setDeployment] = useState<LocalAiDeploymentStatus>({
    kind: "idle",
  });
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const ccSwitchRequest = useRef(0);

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
      const count = await verifyApiKey(settings.baseUrl, settings.apiKey);
      const refreshed = await refreshModels();
      if (!modelsMatchVerification(refreshed, count)) {
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
      const count = await verifyApiKey(settings.baseUrl, settings.apiKey);
      const refreshed = await refreshModels();
      if (!modelsMatchVerification(refreshed, count)) {
        throw new Error("models_unavailable");
      }
      const available = refreshed.filter((model) => model.providerId === "yume");
      const chosen =
        available.find(
          (model) =>
            settings.providerId === "yume" && model.modelId === settings.modelId,
        ) ?? available[0];
      if (!chosen) throw new Error("models_unavailable");
      if (
        settings.providerId !== "yume" ||
        settings.modelId !== chosen.modelId
      ) {
        patch("providerId", "yume");
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

  const groups: { providerName: string; models: ProviderModel[] }[] = [];
  for (const m of models) {
    let group = groups.find((g) => g.providerName === m.providerName);
    if (!group) {
      group = { providerName: m.providerName, models: [] };
      groups.push(group);
    }
    group.models.push(m);
  }

  const current = settings.providerId
    ? `${settings.providerId}/${settings.modelId}`
    : "";

  const onPick = (raw: string) => {
    if (!raw) {
      patch("providerId", "");
      patch("modelId", "");
      return;
    }
    const slash = raw.indexOf("/");
    patch("providerId", raw.slice(0, slash));
    patch("modelId", raw.slice(slash + 1));
  };

  return (
    <>
      <h2 className="set-panel-head">{t.tabAi}</h2>
      <Row label={t.baseUrl}>
        <input
          className="set-input set-ai-base-url"
          type="text"
          value={settings.baseUrl}
          placeholder="https://ai-gateway.kurogames.com"
          aria-label={t.baseUrl}
          onChange={(e) => {
            setVerifyResult(null);
            setDeployment({ kind: "idle" });
            patch("baseUrl", e.target.value);
          }}
        />
      </Row>
      <Row label={t.apiKey}>
        <input
          className="set-input set-input-key"
          type="password"
          value={settings.apiKey}
          placeholder={t.apiKeyPlaceholder}
          aria-label={t.apiKey}
          onChange={(e) => {
            setVerifyResult(null);
            setDeployment({ kind: "idle" });
            patch("apiKey", e.target.value);
          }}
        />
        <button
          className="set-verify"
          onClick={() => void verify()}
          disabled={verifying || !settings.apiKey.trim()}
        >
          {verifying ? t.verifying : t.verify}
        </button>
      </Row>
      {verifyResult && (
        <p
          className={`set-note ${verifyResult.ok ? "set-note-ok" : "set-note-error"}`}
        >
          {verifyResult.message}
        </p>
      )}

      <Row label={t.model}>
        <select
          className="set-select"
          value={current}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="">{t.modelDefault}</option>
          {groups.map((g) => (
            <optgroup key={g.providerName} label={g.providerName}>
              {g.models.map((m) => (
                <option
                  key={`${m.providerId}/${m.modelId}`}
                  value={`${m.providerId}/${m.modelId}`}
                >
                  {m.modelName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      {failed && <p className="set-note set-note-error">{t.aiUnreachable}</p>}

      <Row label={t.yolo}>
        <Switch
          label={t.yolo}
          checked={settings.yolo}
          onChange={(v) => patch("yolo", v)}
        />
      </Row>
      <p className="set-note set-note-warn">{t.yoloWarn}</p>
      <CcSwitchStatus
        status={ccSwitchStatus}
        deployment={deployment}
        canDeploy={Boolean(settings.apiKey.trim())}
        t={t}
        onDeploy={() => void deployLocalAi()}
      />
      <AiUsage enabled={Boolean(settings.apiKey.trim())} t={t} />
    </>
  );
}
