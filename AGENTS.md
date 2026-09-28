# YUME 仓库 AI 工作入口

## 保存、提交、push、发布新版本

用户要求“全部保存提交 push，发布新版本”或同义操作时，先读并执行
[本机发布指南](docs/local-release-runbook.md)。它是这台维护者 Mac 的发布操作入口；
[macOS release gate](docs/macos-release.md) 补充打包要求。

- 本机已有 Developer ID 签名身份与 `yume-notary` 公证 profile。先按指南在可访问钥匙串的执行上下文中预检；沙箱中的“0 identities”或 GitHub token invalid 不能证明配置缺失。
- 使用 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`。不为发布修改全局 Xcode 选择或接受全局许可证。
- 默认走“GitHub Actions 候选包 → 本机 Apple 签名、公证 → Actions updater 签名 → 验证 → 公开 Release”。Tauri updater 私钥在 Actions secrets，无需本地查找或导出。
- 用户已明确要求提交、推送、发布时，沿用这次任务的授权继续完成。仅分析、写文档或修改代码不自动触发发布；工具明确要求额外授权时，说明具体操作及原因。
- 长任务记录版本、commit、workflow run ID、本地输出路径、公证 submission ID 和已完成阶段，恢复时从记录继续，避免重复构建、提交公证或上传。
- 不将密钥、密码、token、未签名候选包、缓存或日志提交/上传为 Release 资产；不修改已经公开的版本来修复新问题。
- “CI 成功”“上传完成”都不等于“发布完成”。按指南核验公开状态、下载资产、更新清单和实际测试结果后再报告。

已验证的机器配置集中维护在发布指南。配置改变时更新该指南，避免在多份文档中复制凭据位置或历史版本号。
