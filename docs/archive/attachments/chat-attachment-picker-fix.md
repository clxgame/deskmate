# 聊天加号原生文件选择修复

> 历史记录，归档于 2026-09-30。原文的“当前 / 现状 / 下一步”、命令、授权与发布状态均对应原记录日期和基线；不作为当前执行入口。现行规则见[文档索引](../../README.md)，仍需验证的事项见[当前验收与待办](../../verification-backlog.md)。独有设计与验收证据保留，本次未重做原验收。


日期：2026-09-27。基于 v0.4.11，本次未改版本、未发布。

## 修改

- 聊天加号从隐藏 HTML file input 改为原生 Tauri 文件选择器；与工作台共享 `file_picker::pick_files`。
- 工作台保留原有窗口权限及路径处理。聊天新增仅允许 chat 窗口调用的命令，只返回所选文件名和 base64 内容，不开放任意路径读取。
- 本机读取限制普通文件 20 MiB、NCM 64 MiB、单批总量 64 MiB；既有暂存层继续检查会话配额、格式及 NCM 本地转换。
- 文件进入既有暂存、附件预览、模型发送流程。选择器打开时禁止重复点击及发送；取消保留草稿和现有附件；上下文改变后丢弃旧选择结果。

## 验证

- `bun run typecheck`：通过。
- `bun test src/chat/chatAttachmentSend.test.tsx`：28 通过（含原生多选、请求字节、取消、失败恢复、重复点击、切换文件夹后旧结果失效）。
- `bun test src/chat/useChatAttachments.test.ts src/chat/attachmentApi.test.ts`：17 通过。
- `cargo test --lib chat_attachments::picker`：2 通过（文件内容与无路径响应、取消、目录/缺失文件/超限文件拒绝）。
- 隔离 macOS QA app 构建通过，逻辑尺寸 420×560；实际点击加号打开原生 Open 窗口，选择合成 Markdown 文件后显示“已准备”。
- 再次打开并取消：草稿与附件仍在；发送后本机合成模型请求包含 `PICKER_CHECK_20260927`，并正常收到回复。
- 截图及本机请求记录：`artifacts/chat-picker-qa/`（忽略目录）。未操作日常安装与真实模型服务；Windows 原生窗口未在本机实测。
