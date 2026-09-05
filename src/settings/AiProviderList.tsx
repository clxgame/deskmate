import { useState } from "react";
import type { Dict } from "../lib/i18n";
import type { AiProvider, Settings } from "../lib/settings";
import {
  displayProviderLabel,
  settingsWithAddedProvider,
  settingsWithDeletedProvider,
  settingsWithUpdatedProvider,
} from "./aiProviderModel";
import type { ReplaceSettings } from "./settingsPrimitives";

type AiProviderListProps = {
  readonly settings: Settings;
  readonly replace: ReplaceSettings;
  readonly t: Dict;
  readonly createProviderId?: () => string;
  readonly onChange?: () => void;
  readonly onVerify?: (providerId: string) => void;
  readonly onDeploy?: (providerId: string) => void;
};

type ProviderField = "label" | "baseUrl" | "apiKey";

export function AiProviderList({
  settings,
  replace,
  t,
  createProviderId = () => crypto.randomUUID(),
  onChange,
  onVerify,
  onDeploy,
}: AiProviderListProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const updateProvider = (
    providerId: string,
    field: ProviderField,
    value: string,
  ) => {
    onChange?.();
    replace(settingsWithUpdatedProvider(settings, providerId, { [field]: value }));
  };

  const toggleProvider = (providerId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(providerId)) next.delete(providerId);
      else next.add(providerId);
      return next;
    });
  };

  const addProvider = () => {
    onChange?.();
    replace(settingsWithAddedProvider(settings, createProviderId()));
  };

  const confirmDelete = () => {
    if (pendingDeleteId === null) return;
    onChange?.();
    replace(settingsWithDeletedProvider(settings, pendingDeleteId));
    setPendingDeleteId(null);
  };

  return (
    <section aria-labelledby="ai-provider-section">
      <div className="set-ai-provider-title-row">
        <h3 id="ai-provider-section" className="set-section-head">
          {t.aiProviderSection}
        </h3>
        <button className="set-btn" type="button" onClick={addProvider}>
          {t.aiProviderAdd}
        </button>
      </div>
      <div className="set-ai-provider-list">
        {settings.providers.map((provider, index) => {
          const label = displayProviderLabel(provider, index, t);
          const isCollapsed = collapsed.has(provider.id);
          const removeDisabled = settings.providers.length === 1;
          return (
            <article
              key={provider.id}
              className="set-ai-provider-card"
              aria-label={label}
            >
              <div className="set-ai-provider-head">
                <span className="set-ai-provider-name">{label}</span>
                {settings.activeProviderId === provider.id && (
                  <span className="set-ai-provider-active">{t.aiProviderActive}</span>
                )}
                <div className="set-ai-provider-head-actions">
                  <button
                    className="set-btn"
                    type="button"
                    aria-label={`${isCollapsed ? t.aiProviderExpand : t.aiProviderCollapse} · ${label}`}
                    onClick={() => toggleProvider(provider.id)}
                  >
                    {isCollapsed ? t.aiProviderExpand : t.aiProviderCollapse}
                  </button>
                  <button
                    className="set-btn set-btn-danger set-ai-provider-remove"
                    type="button"
                    disabled={removeDisabled}
                    title={removeDisabled ? t.aiProviderRemoveLast : t.aiProviderRemove}
                    aria-label={
                      removeDisabled ? t.aiProviderRemoveLast : t.aiProviderRemove
                    }
                    onClick={() => setPendingDeleteId(provider.id)}
                  >
                    {t.aiProviderRemove}
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <ProviderBody
                  provider={provider}
                  label={label}
                  t={t}
                  onFieldChange={(field, value) =>
                    updateProvider(provider.id, field, value)
                  }
                  onVerify={onVerify}
                  onDeploy={onDeploy}
                />
              )}
            </article>
          );
        })}
      </div>
      {pendingDeleteId !== null && (
        <>
          <div
            className="set-confirm-backdrop"
            onClick={() => setPendingDeleteId(null)}
          />
          <div className="set-confirm" role="alertdialog" aria-modal="true">
            <p className="set-confirm-body">{t.aiProviderRemoveConfirm}</p>
            <div className="set-confirm-actions">
              <button
                className="set-btn set-btn-danger"
                type="button"
                onClick={confirmDelete}
              >
                {t.aiProviderRemove}
              </button>
              <button
                className="set-btn"
                type="button"
                onClick={() => setPendingDeleteId(null)}
              >
                {t.aiProviderRemoveCancel}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function ProviderBody({
  provider,
  label,
  t,
  onFieldChange,
  onVerify,
  onDeploy,
}: {
  readonly provider: AiProvider;
  readonly label: string;
  readonly t: Dict;
  readonly onFieldChange: (field: ProviderField, value: string) => void;
  readonly onVerify?: (providerId: string) => void;
  readonly onDeploy?: (providerId: string) => void;
}) {
  const fields: readonly {
    readonly key: ProviderField;
    readonly label: string;
    readonly type: "text" | "password";
  }[] = [
    { key: "label", label: t.aiProviderLabel, type: "text" },
    { key: "baseUrl", label: t.aiProviderBaseUrl, type: "text" },
    { key: "apiKey", label: t.aiProviderApiKey, type: "password" },
  ];
  return (
    <div className="set-ai-provider-body">
      {fields.map((field) => (
        <label className="set-ai-provider-field" key={field.key}>
          <span>{field.label}</span>
          <input
            className="set-input"
            type={field.type}
            value={provider[field.key]}
            aria-label={`${field.label} · ${label}`}
            onChange={(event) => onFieldChange(field.key, event.target.value)}
          />
        </label>
      ))}
      <div className="set-ai-provider-actions">
        <button
          className="set-btn"
          type="button"
          disabled={!onVerify || !provider.apiKey.trim()}
          onClick={() => onVerify?.(provider.id)}
        >
          {t.aiProviderVerify}
        </button>
        <button
          className="set-btn"
          type="button"
          disabled={!onDeploy || !provider.apiKey.trim()}
          title={t.aiProviderDeployHint}
          onClick={() => onDeploy?.(provider.id)}
        >
          {t.aiProviderDeploy}
        </button>
      </div>
    </div>
  );
}
