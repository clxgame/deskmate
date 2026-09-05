import { AiUsage } from "./AiUsage";
import { AiProviderList } from "./AiProviderList";
import { CcSwitchStatus } from "./CcSwitchStatus";
import { displayProviderLabel } from "./aiProviderModel";
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
  const activeProvider =
    settings.providers.find(
      (provider) => provider.id === controller.activeProviderId,
    ) ?? settings.providers[0];

  return (
    <>
      <h2 className="set-panel-head">{t.tabAi}</h2>
      <AiProviderList
        settings={settings}
        replace={replace}
        t={t}
        onChange={controller.clearVerificationState}
        onVerify={(providerId) => void controller.verify(providerId)}
        onDeploy={(providerId) => void controller.deployLocalAi(providerId)}
      />
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
        canDeploy={Boolean(activeProvider?.apiKey.trim())}
        t={t}
        onDeploy={() => {
          if (activeProvider) void controller.deployLocalAi(activeProvider.id);
        }}
      />
      {settings.providers.map((provider, index) => (
        <AiUsage
          key={provider.id}
          enabled={Boolean(provider.apiKey.trim())}
          providerId={provider.id}
          label={displayProviderLabel(provider, index, t)}
          index={index}
          t={t}
        />
      ))}
    </>
  );
}
