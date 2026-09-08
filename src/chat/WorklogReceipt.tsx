import type { ChatWorklogOperation } from "./useWorklogChat";
import { openWorklog } from "./worklogActions";
import "./WorklogReceipt.css";

const COPY = {
  "zh-CN": { save: "保存到工作日志", schedule: "安排周五 17:00 周报", view: "查看工作日志", undo: "撤销", refresh: "查询结果", pending: "正在确认保存结果，尚未确认成功", deleted: "已删除", saved: "已保存到工作日志", report: "已归档报告", scheduled: "已安排周报", queued: "报告任务已创建", failed: "操作未完成", noMaterial: "暂无素材，请先补充工作记录", succeeded: "报告已归档", running: "报告生成中", retry: "等待重试" },
  "en-US": { save: "Save to work journal", schedule: "Schedule Friday 17:00 report", view: "Open work journal", undo: "Undo", refresh: "Check result", pending: "Checking the save; success is not confirmed", deleted: "Deleted", saved: "Work entry saved", report: "Report archived", scheduled: "Weekly report scheduled", queued: "Report job created", failed: "Operation incomplete", noMaterial: "No source material; add work entries", succeeded: "Report archived", running: "Generating report", retry: "Waiting to retry" },
  "ja-JP": { save: "作業記録に保存", schedule: "金曜17時の週報を設定", view: "作業記録を開く", undo: "元に戻す", refresh: "結果を確認", pending: "保存結果を確認中・成功は未確認", deleted: "削除済み", saved: "作業記録を保存しました", report: "レポートを保存しました", scheduled: "週報を設定しました", queued: "レポート作成を予約しました", failed: "操作未完了", noMaterial: "素材がありません。作業記録を追加してください", succeeded: "レポート保存済み", running: "レポート作成中", retry: "再試行待ち" },
  "ko-KR": { save: "업무 기록에 저장", schedule: "금요일 17시 주간 보고 예약", view: "업무 기록 열기", undo: "실행 취소", refresh: "결과 확인", pending: "저장 확인 중 · 성공 미확인", deleted: "삭제됨", saved: "업무 기록 저장됨", report: "보고서 보관됨", scheduled: "주간 보고 예약됨", queued: "보고서 작업 생성됨", failed: "작업 미완료", noMaterial: "자료가 없습니다. 업무 기록을 추가하세요", succeeded: "보고서 보관됨", running: "보고서 생성 중", retry: "재시도 대기 중" },
} as const;

export function worklogChatCopy(language: string) { return language === "en-US" || language === "ja-JP" || language === "ko-KR" ? COPY[language] : COPY["zh-CN"]; }

export function WorklogReceipt({ operation, language, onUndo, onRefresh }: {
  readonly operation: ChatWorklogOperation; readonly language: string;
  readonly onUndo: (operation: ChatWorklogOperation) => Promise<void>;
  readonly onRefresh: (operation: ChatWorklogOperation) => Promise<void>;
}) {
  const t = worklogChatCopy(language);
  const receipt = operation.receipt;
  let label: string = t.pending;
  if (receipt?.status === "deleted") label = t.deleted;
  else if (receipt) label = receipt.entityKind === "entry" ? t.saved : receipt.entityKind === "schedule" ? t.scheduled : receipt.entityKind === "run" ? t.queued : t.report;
  if (operation.run) {
    const state = operation.run.state;
    label = state === "succeeded" ? t.succeeded : state === "no_material" ? t.noMaterial : state === "running" ? t.running : state === "retry_wait" ? t.retry : state === "failed" || state === "cancelled" ? t.failed : t.queued;
  }
  if (operation.error) label = `${t.failed} (${operation.error})`;
  const next = operation.schedule?.nextDueAt;
  const nextLabel = next ? new Intl.DateTimeFormat(language, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZoneName: "longOffset" }).format(new Date(next)) : null;
  return <div className="chat-memory-receipt chat-worklog-receipt" role="status" aria-live="polite">
    <span className="chat-memory-receipt-text">{label}{receipt?.businessDate ? ` · ${receipt.businessDate}` : ""}{nextLabel ? ` · ${nextLabel}` : ""}</span>
    <button type="button" className="chat-memory-undo" onClick={() => void openWorklog(operation.run?.resultReportId && receipt ? { ...receipt, entityKind: "report", entityId: operation.run.resultReportId } : receipt ?? undefined)}>{t.view}</button>
    {operation.undoable && receipt?.status === "committed" && receipt.entityKind === "entry" && <button type="button" className="chat-memory-undo" onClick={() => void onUndo(operation)}>{t.undo}</button>}
    {(!receipt || operation.error) && <button type="button" className="chat-memory-undo" onClick={() => void onRefresh(operation)}>{t.refresh}</button>}
  </div>;
}
