import { useState, type KeyboardEvent } from "react";
import type { Dict } from "../lib/i18n";
import type { AiProvider } from "../lib/settings";
import { AppIcon } from "../ui/AppIcon";
import { displayProviderLabel } from "./aiProviderModel";

type AiProviderTabsProps = {
  readonly providers: readonly AiProvider[];
  readonly selectedId: string | undefined;
  readonly expanded: boolean;
  readonly onSelect: (providerId: string) => void;
  readonly busyFor: (providerId: string) => boolean;
  readonly t: Dict;
};

export function AiProviderTabs({
  providers,
  selectedId,
  expanded,
  onSelect,
  busyFor,
  t,
}: AiProviderTabsProps) {
  const [focusedId, setFocusedId] = useState(selectedId);
  const focusId = providers.some((provider) => provider.id === focusedId)
    ? focusedId
    : selectedId;
  const navigateProviders = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
    );
    const index = buttons.indexOf(event.target);
    const destinations: Readonly<Record<string, number>> = {
      ArrowLeft: (index - 1 + buttons.length) % buttons.length,
      ArrowRight: (index + 1) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    const nextIndex = destinations[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };

  return (
    <div
      className="set-ai-provider-tabs"
      role="group"
      aria-label={t.aiProviderSection}
      onKeyDown={navigateProviders}
    >
      {providers.map((provider, index) => {
        const label = displayProviderLabel(provider, index, t);
        const open = expanded && provider.id === selectedId;
        const busy = busyFor(provider.id);
        const busyId = `ai-provider-busy-${provider.id}`;
        return (
          <button
            key={provider.id}
            id={`ai-provider-disclosure-${provider.id}`}
            className="set-btn set-ai-provider-tab"
            type="button"
            aria-label={label}
            aria-expanded={open}
            aria-controls={`ai-provider-panel-${provider.id}`}
            aria-describedby={busy ? busyId : undefined}
            tabIndex={provider.id === focusId ? 0 : -1}
            title={label}
            onFocus={() => setFocusedId(provider.id)}
            onClick={() => {
              setFocusedId(provider.id);
              onSelect(provider.id);
            }}
          >
            <span className="set-ai-provider-tab-label">{label}</span>
            {busy && (
              <span id={busyId} className="set-ai-provider-busy" role="status" aria-label={t.aiProviderBusy} />
            )}
            <AppIcon name="caretDown" size={16} />
          </button>
        );
      })}
    </div>
  );
}
