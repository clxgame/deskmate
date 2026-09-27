import { useEffect, useState } from "react";
import type { Dict } from "../lib/i18n";
import { memoryAutomationStatus, retryMemoryAutomation, type AutomationStatus } from "../lib/memory";

/** Visible only in management screens, never below messages. */
export function AutomaticProcessingStatus({ t }: { t: Dict }) {
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    let active = true;
    const refresh = () => { void memoryAutomationStatus().then((next) => { if (active) setStatus(next ?? null); }).catch(() => { if (active) setStatus(null); }); };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function retry() {
    setRetrying(true);
    try { await retryMemoryAutomation(); setStatus(await memoryAutomationStatus()); }
    catch { /* Keep the failure visible; no false success message. */ }
    finally { setRetrying(false); }
  }
  if (!status || (!status.pending && !status.failed)) return null;
  return <div className="set-note" role="status">
    {status.pending > 0 && <p>{t.automaticProcessingPending}</p>}
    {status.failed > 0 && <p>{t.automaticProcessingFailed} <button className="set-btn" type="button" disabled={retrying} onClick={() => { void retry(); }}>{t.automaticProcessingRetry}</button></p>}
  </div>;
}
