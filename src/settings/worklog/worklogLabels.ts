const en = {
  featureTitle: "Work journal", dayBoundaryHint: "Workdays start at 03:00 local time. Earlier entries default to the previous day; you can choose another date.",
  entries: "Entries", daily: "Daily reports", weekly: "Weekly reports", schedules: "Schedules",
  from: "From", to: "To", project: "Project", allProjects: "All projects", add: "Add entry",
  back: "Back", save: "Save", cancel: "Cancel", edit: "Edit", remove: "Delete", confirm: "Confirm deletion",
  loading: "Loading…", empty: "No work records in this range.", retry: "Retry", refresh: "Refresh",
  content: "Content", date: "Date", title: "Title", status: "Status", done: "Completed", progress: "In progress", blocked: "Blocked", planned: "Planned",
  saved: "Saved", failed: "Could not complete this action. Please retry.", conflict: "This item changed in another window. Your draft is kept. Reload the latest version before saving again.",
  reload: "Reload latest", version: "Version", current: "Current", candidate: "Candidate", apply: "Use this version", stale: "Sources changed. Review this report before use.",
  sources: "Sources", missing: "Missing dates", copy: "Copy", copied: "Copied", exportMd: "Export Markdown", exportTxt: "Text (.txt)", exported: "Saved to Downloads:",
  deleteQuestion: "Delete the selected records? This cannot be undone.", linked: "Linked reports", keepReports: "Keep reports and mark them outdated", deleteReports: "Delete linked reports too",
  clearRange: "Delete filtered entries", generate: "Generate report", queued: "Generation queued. Check runs for the result.",
  addSchedule: "Add schedule", name: "Name", time: "Time", weekday: "Weekday", timezone: "Time zone", next: "Next run", runs: "Recent runs", pause: "Pause", resume: "Enable", enabled: "Enabled", paused: "Paused",
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday", sunday: "Sunday",
  noRuns: "No runs yet.", noSources: "No sources", working: "Working…", dailyImport: "Archive complete daily report", sourceDate: "Source date", pending: "Queued", running: "Running", succeeded: "Completed", runFailed: "Failed", cancelled: "Cancelled", skipped: "Skipped", pausedHint: "Schedules run while the app is open; the latest missed period is caught up after restart.",
} as const;
export type WorklogLabels = { readonly [K in keyof typeof en]: string };
const zh: WorklogLabels = {
  featureTitle: "工作日志", dayBoundaryHint: "工作日按本地时间 03:00 划分，此前的记录默认归入前一天，可手动选择日期。",
  entries: "事项", daily: "日报", weekly: "周报", schedules: "报告任务", from: "开始日期", to: "结束日期", project: "项目", allProjects: "全部项目", add: "添加事项",
  back: "返回", save: "保存", cancel: "取消", edit: "编辑", remove: "删除", confirm: "确认删除", loading: "正在加载…", empty: "这个范围内还没有工作记录。", retry: "重试", refresh: "刷新",
  content: "内容", date: "日期", title: "标题", status: "状态", done: "已完成", progress: "进行中", blocked: "受阻", planned: "计划中", saved: "已保存", failed: "操作失败，请重试。", conflict: "其他窗口已修改此项。草稿已保留，请重新加载最新版本后再保存。",
  reload: "加载最新版本", version: "版本", current: "当前版本", candidate: "候选版本", apply: "采用此版本", stale: "来源已改变，请核对这份报告。", sources: "来源", missing: "缺失日期", copy: "复制", copied: "已复制", exportMd: "导出 Markdown", exportTxt: "文本（TXT）", exported: "已保存到下载文件夹：",
  deleteQuestion: "删除所选记录？此操作无法撤销。", linked: "关联报告", keepReports: "保留报告并标记来源已变更", deleteReports: "同时删除关联报告", clearRange: "删除筛选事项", generate: "生成报告", queued: "已加入生成队列，请在运行记录中查看结果。",
  addSchedule: "添加任务", name: "名称", time: "时间", weekday: "星期", timezone: "时区", next: "下次运行", runs: "最近运行", pause: "暂停", resume: "启用", enabled: "已启用", paused: "已暂停",
  monday: "周一", tuesday: "周二", wednesday: "周三", thursday: "周四", friday: "周五", saturday: "周六", sunday: "周日",
  noRuns: "暂无运行记录。", noSources: "无来源", working: "处理中…", dailyImport: "归档完整日报", sourceDate: "来源日期", pending: "等待运行", running: "运行中", succeeded: "已完成", runFailed: "失败", cancelled: "已取消", skipped: "已跳过", pausedHint: "应用开启时执行；重启后补执行最近一次错过的周期。",
};
const ja: WorklogLabels = {
  featureTitle: "作業記録", dayBoundaryHint: "作業日は現地時刻の 03:00 に切り替わります。それ以前の記録は前日扱いです。日付は変更できます。",
  entries: "作業記録", daily: "日報", weekly: "週報", schedules: "レポート予定", from: "開始日", to: "終了日", project: "プロジェクト", allProjects: "すべて", add: "記録を追加",
  back: "戻る", save: "保存", cancel: "キャンセル", edit: "編集", remove: "削除", confirm: "削除を確定", loading: "読み込み中…", empty: "この期間の作業記録はありません。", retry: "再試行", refresh: "更新",
  content: "内容", date: "日付", title: "タイトル", status: "状態", done: "完了", progress: "進行中", blocked: "保留", planned: "予定", saved: "保存しました", failed: "操作できませんでした。再試行してください。", conflict: "別の画面で更新されました。下書きは保持されています。最新版を読み込んでください。",
  reload: "最新版を読み込む", version: "バージョン", current: "現在", candidate: "候補", apply: "この版を採用", stale: "参照元が変更されています。内容を確認してください。", sources: "参照元", missing: "未記録の日付", copy: "コピー", copied: "コピーしました", exportMd: "Markdown を保存", exportTxt: "テキスト（TXT）", exported: "ダウンロードに保存：",
  deleteQuestion: "選択した記録を削除しますか？元に戻せません。", linked: "関連レポート", keepReports: "レポートを保持し、更新が必要と表示", deleteReports: "関連レポートも削除", clearRange: "絞り込んだ記録を削除", generate: "レポートを生成", queued: "生成を予約しました。実行履歴で結果を確認できます。",
  addSchedule: "予定を追加", name: "名前", time: "時刻", weekday: "曜日", timezone: "タイムゾーン", next: "次回実行", runs: "実行履歴", pause: "一時停止", resume: "有効にする", enabled: "有効", paused: "一時停止中",
  monday: "月曜", tuesday: "火曜", wednesday: "水曜", thursday: "木曜", friday: "金曜", saturday: "土曜", sunday: "日曜",
  noRuns: "実行履歴はありません。", noSources: "参照元なし", working: "処理中…", dailyImport: "完成した日報を保存", sourceDate: "参照日", pending: "待機中", running: "実行中", succeeded: "完了", runFailed: "失敗", cancelled: "取消済み", skipped: "スキップ", pausedHint: "アプリの起動中に実行し、再起動後に直近の未実行分を補完します。",
};
const ko: WorklogLabels = {
  featureTitle: "업무 기록", dayBoundaryHint: "업무일은 현지 시각 03:00에 바뀝니다. 이전 기록은 전날로 저장되며 날짜를 직접 선택할 수 있습니다.",
  entries: "작업 기록", daily: "일일 보고", weekly: "주간 보고", schedules: "보고 일정", from: "시작일", to: "종료일", project: "프로젝트", allProjects: "전체 프로젝트", add: "기록 추가",
  back: "뒤로", save: "저장", cancel: "취소", edit: "편집", remove: "삭제", confirm: "삭제 확인", loading: "불러오는 중…", empty: "이 기간의 작업 기록이 없습니다.", retry: "다시 시도", refresh: "새로 고침",
  content: "내용", date: "날짜", title: "제목", status: "상태", done: "완료", progress: "진행 중", blocked: "보류", planned: "예정", saved: "저장됨", failed: "작업을 완료하지 못했습니다. 다시 시도해 주세요.", conflict: "다른 창에서 변경되었습니다. 초안은 유지됩니다. 최신 버전을 불러온 후 저장해 주세요.",
  reload: "최신 버전 불러오기", version: "버전", current: "현재", candidate: "후보", apply: "이 버전 사용", stale: "출처가 변경되었습니다. 보고서를 검토해 주세요.", sources: "출처", missing: "누락된 날짜", copy: "복사", copied: "복사됨", exportMd: "Markdown 내보내기", exportTxt: "텍스트 (TXT)", exported: "다운로드에 저장됨:",
  deleteQuestion: "선택한 기록을 삭제할까요? 되돌릴 수 없습니다.", linked: "연결된 보고서", keepReports: "보고서를 유지하고 변경 표시", deleteReports: "연결된 보고서도 삭제", clearRange: "필터링된 기록 삭제", generate: "보고서 생성", queued: "생성이 대기 중입니다. 실행 기록에서 결과를 확인하세요.",
  addSchedule: "일정 추가", name: "이름", time: "시간", weekday: "요일", timezone: "시간대", next: "다음 실행", runs: "최근 실행", pause: "일시 정지", resume: "활성화", enabled: "활성화됨", paused: "일시 정지됨",
  monday: "월요일", tuesday: "화요일", wednesday: "수요일", thursday: "목요일", friday: "금요일", saturday: "토요일", sunday: "일요일",
  noRuns: "실행 기록이 없습니다.", noSources: "출처 없음", working: "처리 중…", dailyImport: "완성된 일일 보고 저장", sourceDate: "출처 날짜", pending: "대기 중", running: "실행 중", succeeded: "완료", runFailed: "실패", cancelled: "취소됨", skipped: "건너뜀", pausedHint: "앱 실행 중에 작업합니다. 다시 시작하면 최근 누락된 기간을 처리합니다.",
};
export function worklogLabels(language: string): WorklogLabels {
  switch (language) { case "zh-CN": return zh; case "ja-JP": return ja; case "ko-KR": return ko; default: return en; }
}
