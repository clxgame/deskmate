# P4–P6 移植到 v0.4.8：本地候选交接

日期：2026-09-24。此页记录新分支上的结果；同目录其他文档里的 v0.4.3 数据是历史施工记录，**不是**当前候选的版本或哈希。

## 基线与隔离

- 工作树：`E:/Codex/工作伙伴/deskmate-v048-port`
- 分支：`codex/yume-opencode-v048`
- 基线：远端 `origin/main` 的 `82d7c13eb79bd1194f2fe870bfc4ec604ebcd3ec`（v0.4.8）
- 从原工作树移植 P4–P6 的已跟踪改动和新增源码、测试、文档；没有覆盖、重置或清理原来的脏 `main`，也没有在正式安装身份上做升级/重装。
- `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 均保持 v0.4.8；`scripts/check-version.ps1 -TagName v0.4.8` 通过。
- 当前移植尚未提交或推送，不能把分支名误认为已发布版本。

## 最终本地包

- 路径：`src-tauri/target/release/bundle/nsis/YUME_0.4.8_x64-setup.exe`
- 交付副本：`artifacts/opencode-native/v048-package/YUME_0.4.8_x64-setup.exe`（与构建输出 SHA-256 完全相同）
- 大小：176,927,200 字节
- SHA-256：`D42962422C662A7A81C309975BDCEAAD54859A47B82D832453EC485342E0ABDB`
- Windows ProductVersion/FileVersion：均为 `0.4.8`；7-Zip NSIS 全文件校验通过（29 文件）。
- 用 `bun run tauri build -- --no-sign` 生成，Authenticode 状态为 `NotSigned`；未生成更新签名，也未改写 `latest.json`。此包只用于本地隔离验收，不是正式发布包。先前在 v0.4.3 基线上生成的候选已被此包取代，不能用于当前移植验收。

## 验证与边界

- `bun install --frozen-lockfile` 通过。最终源码的全量 `bun test`：1029 pass、8 skip（macOS 专用）、0 fail；需要允许测试启动本地子进程，受限沙箱内会报 `EPERM`，这不是断言失败。
- P5 固定版本 MCP 清单复核通过：Playwright MCP 0.0.82、Windows MCP 1.3.24 均连接；仅批准工具进入 provider 表，危险 Windows 工具缺席，子进程、provider、sidecar、临时根清理均为 true。证据：`artifacts/opencode-native/p5-2026-09-23T15-57-59-065Z-mcp-inventory/mcp-inventory.json`。
- 最终源码的 Tauri 发布编译、TypeScript 检查、QA debug 编译通过。P4 原生 sidecar 工具生命周期矩阵通过，超时、拒绝、取消、重启及进程清理均有测试结果。
- QA 专属身份 `com.deskmate.worklogqa` 的最终源码窗口已在真实 WebView2 中启动；通用设置显示 `v0.4.8`，工作台、轻聊、桌宠及工具权限页均完成截图。截图在 `artifacts/opencode-native/v048-qa/`，其中 `settings-verified.png`、`tool-permissions-verified.png`、`tool-permissions-bottom-verified.png`、`chat-verified.png`、`workbench-verified.png`、`pet-verified.png`。中文排版独立复核通过；轻聊截图里的“任务状态暂时无法读取”来自隔离 QA 状态，不能据此宣称聊天端到端功能通过。正式生产安装包未覆盖现有安装，也未安装运行。
- 工作台主题继承已实装：颜色从 YUME 原有主题变量生成，初次打开和设置里的实时切换均同步暗色、薄荷、蜜桃、薰衣草四套；模型菜单和窄窗口也在真实 WebView2 验收。九张截图与矩阵见 `.omo/evidence/workbench-theme-qa/manual-qa.md`，独立视觉复核通过；这不替代正式安装升级验收。
- `cargo check` 通过。`cargo test --lib` 仅 `worklog_tool_tests::worklog_query_tool_contract_covers_natural_recall_shape` 失败：测试要求的 `natural self-work recall` 标记在未改动的上游资源中就不存在；其余 646 pass、12 ignored。`cargo fmt --check` 的差异仅在未改动的上游 `src-tauri/src/updater.rs`。
- `bun scripts/verify-worklog.ts --case tool-contract` 两次均在清理测试临时目录时遇到 `EBUSY`，没有得到完整 PASS 回执；不能把它计为通过。两次临时目录均在确认属于测试且没有活跃 sidecar 后清理。
- 此移植不等于 P6 发布门槛全部通过：更新签名、不同版本升级/降级、剩余交互矩阵和同环境迁移性能对照仍未完成。签名密码未知，未尝试猜测或使用现有私钥。
