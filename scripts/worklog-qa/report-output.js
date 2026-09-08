export function frozenReport(messages) {
  const user = messages.findLast(message => message.role === "user");
  const text = typeof user?.content === "string" ? user.content : (user?.content ?? []).filter(part => part.type === "text").map(part => part.text).join("\n");
  const material = [...text.matchAll(/^SOURCE ([^\r\n]+)\r?\n([^\r\n]+)/gm)].map(match => {
    const snapshot = JSON.parse(match[2]);
    const key = `${snapshot.source.kind}:${snapshot.source.id}:${snapshot.source.revision}`;
    if (key !== match[1]) throw new Error("Fixture SOURCE key does not match frozen snapshot");
    return { key, snapshot };
  });
  if (material.length) {
    const weekly = /(?:REPORT_KIND|kind|report type|report kind)[^\n]{0,15}(?:weekly|custom)/i.test(text);
    const headings = weekly ? ["本周成果（按项目）", "进展", "风险", "下周计划"] : ["今日完成", "进行中", "问题/阻塞", "下一步"];
    const statuses = ["done", "in_progress", "blocked", "planned"];
    return JSON.stringify({ blocks: headings.map((heading, index) => {
      const sources = material.filter(item => (item.snapshot.entryStatus ?? "done") === statuses[index]);
      return { heading, text: sources.length ? sources.map(item => `${item.snapshot.project ? `${item.snapshot.project}：` : ""}${item.snapshot.text}`).join("\n") : "待补充", sources: sources.length ? sources.map(item => item.key) : [] };
    }) });
  }
  const mergePrefix = "Return the required JSON report: ";
  const mergeAt = text.indexOf(mergePrefix);
  if (mergeAt >= 0) {
    const parsed = JSON.parse(text.slice(mergeAt + mergePrefix.length));
    const groups = new Map();
    for (const block of parsed.blocks) {
      const group = groups.get(block.heading) ?? { heading: block.heading, text: [], sources: [] };
      group.text.push(block.text);
      group.sources.push(...block.sources);
      groups.set(block.heading, group);
    }
    return JSON.stringify({ blocks: [...groups.values()].map(group => ({ heading: group.heading, text: [...new Set(group.text)].join("\n"), sources: [...new Set(group.sources)] })) });
  }
  return null;
}
