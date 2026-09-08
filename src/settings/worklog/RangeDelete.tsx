import { useState } from "react";
import { deleteEntry, type Entry } from "../../lib/worklog";
import { DeleteConfirmation, WorklogFeedback } from "./WorklogFeedback";
import { useWorklogAction } from "./useWorklogAction";
import type { WorklogLabels } from "./worklogLabels";

export function RangeDelete({ entries, labels, onChanged, onClose }: {
  readonly entries: readonly Entry[]; readonly labels: WorklogLabels;
  readonly onChanged: () => void; readonly onClose: () => void;
}) {
  const [remaining, setRemaining] = useState(() => entries.map((entry) => ({ entry, requestId: crypto.randomUUID() })));
  const [linked, setLinked] = useState(false);
  const [started, setStarted] = useState(false);
  const action = useWorklogAction(labels);
  async function remove() {
    setStarted(true);
    const succeeded = await action.run("range", async () => {
      for (const item of remaining) {
        await deleteEntry({ requestId: item.requestId, id: item.entry.id, expectedRevision: item.entry.revision, deleteLinkedReports: linked });
        setRemaining((items) => items.filter((value) => value.entry.id !== item.entry.id));
      }
    });
    onChanged();
    if (succeeded) onClose();
  }
  return <div className="worklog-detail">
    <p className="worklog-meta">{remaining.length} · {labels.entries}</p>
    <WorklogFeedback error={action.error} notice={action.notice} />
    <DeleteConfirmation labels={labels} busy={action.busy} linked={linked} onLinkedChange={started ? undefined : setLinked} onCancel={onClose} onConfirm={() => { void remove(); }} />
  </div>;
}
