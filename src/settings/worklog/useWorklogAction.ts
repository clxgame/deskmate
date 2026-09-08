import { useRef, useState } from "react";
import { asWorklogError } from "../../lib/worklog";
import type { WorklogLabels } from "./worklogLabels";

export function useWorklogAction(labels: WorklogLabels) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = useRef(new Map<string, string>());
  const active = useRef(false);
  async function run(key: string, action: (requestId: string) => Promise<string | void>): Promise<boolean> {
    if (active.current) return false;
    active.current = true; setBusy(true); setError(null); setNotice(null);
    const requestId = pending.current.get(key) ?? crypto.randomUUID();
    pending.current.set(key, requestId);
    try {
      const result = await action(requestId);
      pending.current.delete(key); setNotice(result ?? labels.saved); return true;
    } catch (failure) {
      const code = failure instanceof Error ? failure.name : asWorklogError(failure).code;
      setError(code === "CONFLICT" ? labels.conflict : labels.failed); return false;
    } finally { active.current = false; setBusy(false); }
  }
  return { busy, error, notice, run };
}
