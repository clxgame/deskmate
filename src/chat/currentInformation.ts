const LOCAL_TIMEZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function buildCurrentInformationInstruction(
  now = new Date(),
  timeZone = LOCAL_TIMEZONE,
): string {
  const date = formatDate(now, timeZone);
  const time = formatTime(now, timeZone);
  return `当前真实本地日期: ${date}；当前本地时间: ${time}；时区: ${timeZone}。遇到当前模型、价格、版本、新闻、规则、日程、人物职位等可能变化的问题，先用 websearch 搜索，再按需要用 webfetch 读取权威原文并在回答中给出来源链接；用户直接给公开网址时优先读取该网址。区分公开 API 型号、产品名称、平台别名；查不到可靠证据时说明未找到可靠资料，工具被拒绝、不可用或网络错误时说明查询失败，不要把失败说成不存在。搜索词只包含必要的公开主题，不携带私人工作日志、记忆或整段聊天。普通问候和稳定常识不需要搜索。`;
}
