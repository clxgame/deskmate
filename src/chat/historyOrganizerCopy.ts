const english = {
  title: "Conversations", close: "Close history", refresh: "Refresh", retry: "Retry", newChat: "New chat",
  archiveNote: "Archiving organizes this list. It does not change the workbench sidebar.",
  search: "Search titles and projects", searchNote: "Search titles and project names. Message content is not searched.",
  active: "Active", pinned: "Pinned", archived: "Archived", project: "Project", allProjects: "All projects",
  source: "Source", allSources: "All sources", light_chat: "Light chat", workbench: "Workbench", legacy: "Legacy",
  from: "From date", to: "To date", clear: "Clear filters", loading: "Loading conversations…",
  empty: "No conversations here yet", noResults: "No matching conversations", offlineEmpty: "History is unavailable. Retry when the connection returns.",
  offline: "Connection unavailable. Cached history is still searchable.", stale: "Cached · refresh needed", unavailable: "Unavailable",
  legacy_text_only: "Legacy text only", archivedReason: "Archived · read only", active_task: "Running task · read only",
  runtime_unknown: "Task status unknown · read only", workbench_owned: "Workbench · read only in light chat", agent_owned: "Agent task · read only",
  readOnly: "Read only", deleted: "Deleted", open: "Open", actions: "Actions for", rename: "Rename", titleLabel: "Conversation title",
  save: "Save title", cancel: "Cancel", pin: "Pin", unpin: "Unpin", archive: "Archive", restore: "Restore", delete: "Delete",
  deleteTitle: "Delete conversation?", deleteNote: "This permanently deletes this conversation. It cannot be undone. Archive it to keep it for later.",
  memoryAmbiguous: "Conversation deleted. Other conversations share its old memory identifier, so the memories were kept.",
  memoryCleanupFailed: "Conversation deleted. Related memories could not be safely removed and were kept.",
  deleteMemories: "Also delete memories that came only from this conversation",
  deleteConfirm: "Delete permanently", previous: "Previous", next: "Next", page: "Page", of: "of", conversations: "conversations",
  failed: "Could not update history. Please retry.", activeError: "Stop the running task before deleting this conversation.",
  loadFailed: "Could not load history. Cached rows remain visible.", openFailed: "Could not open this conversation. Please retry.",
  invalidDates: "The end date must be on or after the start date.", localRecord: "Local text record",
  filters: "Filters", onlyPinned: "Pinned only", clearCondition: "Remove", clearQuery: "Clear search and filters",
  pinnedGroup: "Pinned", today: "Today", yesterday: "Yesterday", earlier: "Earlier",
  previewLoading: "Loading preview…", previewEmpty: "No preview yet", previewUnavailable: "Preview unavailable", localReply: "Local reply",
  details: "Details", more: "More actions", projectPath: "Full project path", sourceDetail: "Source", updatedDetail: "Updated",
} as const;
export type HistoryCopy = { readonly [Key in keyof typeof english]: string };
const chinese: HistoryCopy = {
  title: "会话历史", close: "关闭历史", refresh: "刷新", retry: "重试", newChat: "新会话",
  archiveNote: "归档仅整理此处的记录，不影响工作台侧栏。",
  search: "搜索标题和项目", searchNote: "搜索标题和项目名称，不搜索消息正文。",
  active: "会话", pinned: "已置顶", archived: "已归档", project: "项目", allProjects: "全部项目",
  source: "来源", allSources: "全部来源", light_chat: "轻聊天", workbench: "工作台", legacy: "旧版记录",
  from: "开始日期", to: "结束日期", clear: "清除筛选", loading: "正在加载会话…",
  empty: "这里还没有会话", noResults: "没有匹配的会话", offlineEmpty: "暂时无法获取历史，请在连接恢复后重试。",
  offline: "连接暂不可用，仍可搜索已缓存的历史。", stale: "已缓存 · 需要刷新", unavailable: "暂不可用",
  legacy_text_only: "旧版纯文本", archivedReason: "已归档 · 只读", active_task: "任务运行中 · 只读",
  runtime_unknown: "任务状态未知 · 只读", workbench_owned: "工作台会话 · 轻聊天只读", agent_owned: "智能体任务 · 只读",
  readOnly: "只读", deleted: "已删除", open: "打开", actions: "会话操作", rename: "重命名", titleLabel: "会话标题",
  save: "保存标题", cancel: "取消", pin: "置顶", unpin: "取消置顶", archive: "归档", restore: "恢复", delete: "删除",
  deleteTitle: "删除这段会话？", deleteNote: "会话将被永久删除，无法撤销。若希望保留以便日后查看，请使用归档。",
  memoryAmbiguous: "会话已删除。其他会话使用相同的旧版记忆标识，相关记忆已保留。",
  memoryCleanupFailed: "会话已删除，相关记忆无法安全清理，已保留。",
  deleteMemories: "同时删除仅由此对话产生的记忆",
  deleteConfirm: "永久删除", previous: "上一页", next: "下一页", page: "第", of: "/", conversations: "段会话",
  failed: "更新历史失败，请重试。", activeError: "请先停止正在运行的任务，再删除这段历史。",
  loadFailed: "历史加载失败，已缓存的记录仍会保留。", openFailed: "打开会话失败，请重试。",
  invalidDates: "结束日期不能早于开始日期。", localRecord: "本地文本记录",
  filters: "筛选", onlyPinned: "只看置顶", clearCondition: "移除", clearQuery: "清除搜索和筛选",
  pinnedGroup: "置顶", today: "今天", yesterday: "昨天", earlier: "更早",
  previewLoading: "正在加载内容…", previewEmpty: "暂无可预览内容", previewUnavailable: "内容暂不可用", localReply: "本地回复",
  details: "详情", more: "更多操作", projectPath: "完整项目路径", sourceDetail: "来源", updatedDetail: "更新时间",
};
export function historyCopy(language: string): HistoryCopy {
  return language.startsWith("zh") ? chinese : english;
}
export function readOnlyLabel(reason: string | null, copy: HistoryCopy): string {
  const labels: Readonly<Record<string, string>> = {
    legacy_text_only: copy.legacy_text_only, archived: copy.archivedReason, active_task: copy.active_task,
    runtime_unknown: copy.runtime_unknown, workbench_owned: copy.workbench_owned, agent_owned: copy.agent_owned,
    native_unavailable: copy.unavailable, deleted: copy.deleted,
  };
  return reason ? (labels[reason] ?? copy.readOnly) : copy.readOnly;
}



