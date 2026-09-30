# YUME v0.4.13

## 更新内容

- 待发送附件移至输入框上方的不透明区域；GIF、PNG、JPEG 和 WebP 显示缩略图，保留移除操作与 GIF 动画。普通文件继续显示名称、大小和状态。
- AI 提供商设置支持填写逗号分隔的模型 ID，并逐个执行实际调用验证（最多 12 个；验证请求可能产生少量费用）。模型目录会与端点、密钥及手动模型列表绑定。
- 扩展 AI 用量统计：OpenRouter 显示当前 Key 限额与当日费用；其他提供商显示 YUME 本地记录的当日令牌和请求数。DeepSeek 与 Kuro 的账户用量查询失败时回退为本地用量，并明确标识来源。

## 安装

- macOS Apple Silicon：下载 `.dmg` 或 `.app.zip`；安装包经过 Developer ID 签名和 Apple 公证。
- Windows x64：下载 `YUME_0.4.13_x64-setup.exe`。
- 已安装支持自动更新的版本可在设置中检查更新。

`SHA256SUMS-macos.txt` 提供 macOS 下载文件校验值。

## 本地验证记录

- `bun run typecheck`、`bun run build` 通过；相关聊天附件与 AI 设置/用量前端测试 70 项通过。
- AI 用量 Rust 单元测试 14 项，手动模型 ID、模型目录绑定及 API 前缀识别测试 7 项通过。
- 全量 Rust 测试有 694 项通过、49 项失败及 11 项忽略。本机沙箱拒绝多项 HTTP 测试绑定回环端口，系统钥匙串测试未获授权；另有一个现存 worklog 工具标记断言失败。未将全量 Rust 测试描述为通过。
- 附件缩略图小窗口验收记录见 `docs/archive/attachments/chat-attachment-preview.md`。
