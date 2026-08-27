import { useEffect, useState } from "react";
import { getAiUsage, type AiUsage as AiUsageData } from "../lib/settings";
import type { Dict } from "../lib/i18n";
import "./ai-usage.css";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const CNY_UNIT_DIVISOR = 10000;

type AiUsageView =
  | { readonly kind: "loading" }
  | { readonly kind: "missing-key" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "ready"; readonly usage: AiUsageData };

interface AiUsageProps {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly t: Dict;
}

function formatYuan(amount: number, digits: number): string {
  return `¥${(amount / CNY_UNIT_DIVISOR).toFixed(digits)}`;
}

export function AiUsage({ baseUrl, apiKey, t }: AiUsageProps) {
  const [view, setView] = useState<AiUsageView>({ kind: "loading" });
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => {
    let active = true;
    const key = apiKey.trim();
    if (!key) {
      setView({ kind: "missing-key" });
      return;
    }

    const load = async (): Promise<void> => {
      setView({ kind: "loading" });
      try {
        const usage = await getAiUsage(baseUrl, key);
        if (active) setView({ kind: "ready", usage });
      } catch {
        if (active) setView({ kind: "unavailable" });
      }
    };

    void load();
    const refreshTimer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
    };
  }, [apiKey, baseUrl, refreshVersion]);

  const isLoading = view.kind === "loading";
  return (
    <section className="set-ai-usage" aria-labelledby="ai-usage-title">
      <div className="set-ai-usage-head">
        <h3 id="ai-usage-title" className="set-section-head">
          ai-usage
        </h3>
        <button
          className="set-ai-usage-refresh"
          type="button"
          onClick={() => setRefreshVersion((version) => version + 1)}
          disabled={isLoading || view.kind === "missing-key"}
        >
          {t.aiUsageRefresh}
        </button>
      </div>

      {view.kind === "ready" ? (
        <UsageSummary usage={view.usage} t={t} />
      ) : (
        <p className="set-ai-usage-status" role="status">
          {view.kind === "loading"
            ? t.aiUsageLoading
            : view.kind === "missing-key"
              ? t.aiUsageMissingKey
              : t.aiUsageUnavailable}
        </p>
      )}
    </section>
  );
}

function UsageSummary({ usage, t }: { readonly usage: AiUsageData; readonly t: Dict }) {
  const progressTone =
    usage.remainingPct <= 10
      ? "danger"
      : usage.remainingPct <= 25
        ? "warning"
        : "success";
  const resetLabel =
    usage.daysUntilReset <= 1
      ? t.aiUsageResetTomorrow
      : t.aiUsageResetInDays(usage.daysUntilReset);

  return (
    <div className="set-ai-usage-card">
      <div className="set-ai-usage-row">
        <span>{t.aiUsageWeeklyRemaining}</span>
        <strong>
          {formatYuan(usage.remainingCny, 0)} / {formatYuan(usage.limitCny, 0)}
        </strong>
      </div>
      <div
        className="set-ai-usage-progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={usage.remainingPct}
        aria-label={t.aiUsageWeeklyRemaining}
      >
        <span
          className={`set-ai-usage-progress-fill set-ai-usage-progress-${progressTone}`}
          style={{ width: `${usage.remainingPct}%` }}
        />
      </div>
      <div className="set-ai-usage-row set-ai-usage-meta">
        <span>{usage.remainingPct}%</span>
        <span>{resetLabel}</span>
      </div>
      <div className="set-ai-usage-row set-ai-usage-today">
        <span>{t.aiUsageTodayUsed}</span>
        <strong>
          {formatYuan(usage.todayCostCny, 2)} · {t.aiUsageRequests(usage.todayRequests)}
        </strong>
      </div>
      {usage.topModels.length > 0 && (
        <div className="set-ai-usage-models">
          <span className="set-ai-usage-models-title">{t.aiUsageTop}</span>
          {usage.topModels.map((model) => (
            <div className="set-ai-usage-row set-ai-usage-model" key={model.name}>
              <span title={model.name}>{model.name}</span>
              <span>
                {formatYuan(model.costCny, 2)} · {t.aiUsageRequests(model.requests)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
