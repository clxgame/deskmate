import { AiUsage } from "./AiUsage";
import { CcSwitchStatus } from "./CcSwitchStatus";
import {
  Row,
  Switch,
  type ReplaceSettings,
  type TabProps,
} from "./settingsPrimitives";
import { useAiTabController } from "./useAiTabController";

type AiTabProps = TabProps & {
  readonly replace: ReplaceSettings;
};

export function AiTab({ settings, patch, replace, t }: AiTabProps) {
  const controller = useAiTabController({ settings, patch, replace, t });

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
            controller.clearVerificationState();
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
            controller.clearVerificationState();
            patch("apiKey", e.target.value);
          }}
        />
        <button
          className="set-verify"
          onClick={() => void controller.verify()}
          disabled={controller.verifying || !settings.apiKey.trim()}
        >
          {controller.verifying ? t.verifying : t.verify}
        </button>
      </Row>
      {controller.verifyResult && (
        <p
          className={`set-note ${controller.verifyResult.ok ? "set-note-ok" : "set-note-error"}`}
        >
          {controller.verifyResult.message}
        </p>
      )}

      <Row label={t.model}>
        <select
          className="set-select"
          value={controller.currentModelValue}
          onChange={(e) => controller.pickModel(e.target.value)}
        >
          <option value="">{t.modelDefault}</option>
          {controller.groups.map((g) => (
            <optgroup key={g.providerId} label={g.label}>
              {g.models.map((m) => (
                <option
                  key={`${m.sidecarId}/${m.modelId}`}
                  value={`${m.sidecarId}/${m.modelId}`}
                >
                  {m.modelName}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Row>
      {controller.failed && (
        <p className="set-note set-note-error">{t.aiUnreachable}</p>
      )}

      <Row label={t.yolo}>
        <Switch
          label={t.yolo}
          checked={settings.yolo}
          onChange={(v) => patch("yolo", v)}
        />
      </Row>
      <p className="set-note set-note-warn">{t.yoloWarn}</p>
      <CcSwitchStatus
        status={controller.ccSwitchStatus}
        deployment={controller.deployment}
        canDeploy={Boolean(settings.apiKey.trim())}
        t={t}
        onDeploy={() => void controller.deployLocalAi()}
      />
      <AiUsage
        enabled={Boolean(settings.apiKey.trim() && controller.activeProviderId)}
        providerId={controller.activeProviderId}
        label={controller.activeProviderLabel}
        index={0}
        t={t}
      />
    </>
  );
}
