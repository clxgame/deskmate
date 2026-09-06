import type { KeyboardEvent } from "react";
import type { Dict } from "../lib/i18n";
import type { AiProvider } from "../lib/settings";
import { displayProviderLabel } from "./aiProviderModel";

type AiProviderTabsProps = {
  readonly providers: readonly AiProvider[];
  readonly selectedId: string | undefined;
  readonly onSelect: (providerId: string) => void;
  readonly t: Dict;
};

export function AiProviderTabs({
  providers,
  selectedId,
  onSelect,
  t,
}: AiProviderTabsProps) {
  const navigateTabs = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLButtonElement)) return;
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]"),
    );
    const index = tabs.indexOf(event.target);
    const destinations: Readonly<Record<string, number>> = {
      ArrowLeft: (index - 1 + tabs.length) % tabs.length,
      ArrowRight: (index + 1) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    const nextIndex = destinations[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div
      className="set-ai-provider-tabs"
      role="tablist"
      aria-label={t.aiProviderSection}
      onKeyDown={navigateTabs}
    >
      {providers.map((provider, index) => {
        const label = displayProviderLabel(provider, index, t);
        const selected = provider.id === selectedId;
        return (
          <button
            key={provider.id}
            id={`ai-provider-tab-${provider.id}`}
            className="set-btn set-ai-provider-tab"
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`ai-provider-panel-${provider.id}`}
            tabIndex={selected ? 0 : -1}
            title={label}
            onClick={() => onSelect(provider.id)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
