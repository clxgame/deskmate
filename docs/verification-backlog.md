# 当前验收与待办

核对日期：2026-09-30，YUME 0.4.16 / OpenCode 1.18.21。这里集中现行命令及历史记录里尚无完成证据的事项；不是新增功能授权、发布授权或一次新的实机通过声明。各次测试的实际结果继续保存在带基线的原记录。

## 当前验证入口

仓库根目录运行：

```sh
export DEVELOPER_DIR=/Library/Developer/CommandLineTools
bun run check
```

`check` 顺序执行生产/测试类型检查、当前源码逐文件前端测试、适用平台 Rust library suite 和自有前端 build。需要定向复验时使用 `bun run typecheck`、`bun run test:frontend`、`bun run test:rust`、`bun run build`；`bun run test:frontend --list` 给出本次发现清单。裸 `bun test` 不作为全仓验证入口。HTTP fixture 需允许 loopback；不要与 suite 中的构建 fixture 同时启动第二个前端 build。

完整工作台按[当前构建入口](workbench-build.md)重建。隔离原生整改用 `bun scripts/audit-remediation/verify-native.ts`；自动处理联调用 `bun scripts/automation-qa/verify-sidecar.ts`。这两项都不等于完整 Tauri UI、Windows 或真实模型语义已验证。

模型语义脚本 `bun scripts/automation-qa/verify-semantics.ts` 需要显式配置测试服务商，只发送合成场景；正例仍需人工语义复核。发布、签名包和真实 A→B 更新按[本机发布指南](local-release-runbook.md)及[macOS runtime checks](macos-runtime-checks.md)执行。

## 2026-09-30 composer 浮层显示修复的定向验收

基线 `551d8d300c762d36a0e6304e91936c665f840676` / YUME 0.4.16，验证对象为本次未提交前端改动。共享浮层显式接入主题和字体，定位避开整个输入 footer，模型标签按内容伸缩并保留末尾识别信息；设计规则见 [DESIGN](../DESIGN.md#chat-composer-pickers)。

- Bun 1.3.14：`bun run typecheck` 退出 0；`DEVELOPER_DIR=/Library/Developer/CommandLineTools bun run test:frontend` 退出 0，155/155 个文件、1,190 pass、0 fail、0 skip、0 unfinished；`bun run build` 退出 0。初次沙箱 suite 的 loopback fixture 无法监听，已在允许本机监听的上下文完整重跑，通过数仅取重跑结果。构建保留既有大 chunk 提示。
- 浏览器合成真实 `ChatApp` 场景：两个菜单的 dark/mint/peach/lavender 外观及打开时主题变化；420×560、720×760、360px 压力宽度、420×300 高度压力及菜单打开时缩放；输入 footer 与菜单保持 8px 间距、视口边界内、DeepSeek 两种名称完整、长目录/长模型尾部可见、发送按钮不被挤出；32 模型列表内部滚动和搜索筛选、方向键/Enter/Escape 焦点返回、外部点击关闭均已检查，浏览器 error 日志为空。
- 新证据在本地忽略目录 `artifacts/composer-display-qa-2026-09-30/`：四主题截图、缩放/长名称/搜索截图、几何与主题检查 JSON，以及本次 frontend suite 回执副本。可复验入口为 `/scripts/automation-qa/chat-preview.html?composer=1`；多模型加 `&models=many`。主题切换控件只在该 QA 页面出现。
- 尚未重新构建并实测原生 Tauri 聊天窗、Windows WebView2、原生文件选择器或真实模型服务；浏览器 fixture 不关闭下表“历史与 composer”的完整原生回归余项。此次没有发布或更新已安装应用。

## 活动整改与平台门禁

| 项目 | 尚需完成 / 证据入口 |
| --- | --- |
| 原审计 UI U1/U2 | 重连、busy Stop、idle 后 scheduled、多个 text parts 和迟到响应最小反例与修复；见[施工进度](audit-remediation-progress.md) |
| 工作台 W1/W2 | 自有源码直接表达行为、固定输入统一验证、重复准备与失败恢复；普通前端绿灯不关闭此项 |
| 历史 H1/H2/H3 | 新正文投影退出、按 key 查询、变化行写入和导入时机；保留 legacy/local-only、墓碑及身份约束 |
| 综合 V1 | 完整 Tauri interactive/scheduled 入口、跨 30 秒失败、真实工具子进程取消、两平台宿主与回退演练；已有 scoped OpenCode fixture 不替代完整 UI |
| CI / Windows | Source checks 真正运行、Windows 适用 suite/中断进程树清理、branch protection required checks；静态 YAML 不能当平台执行通过 |
| 文件清理条件项 | 以[清理执行进度](repository-cleanup-progress.md)为准；未验证的外部作者资产、生成链、Windows 和 Mac 包图标不因本地源码通过而关闭 |
| Windows QA harness 旧边界 | `p5-windows-e2e.ts` 仍需给 MCP 回传 Notepad PID补新建进程/出生时间/可执行文件归属证明，并保证 setup/cleanup 首项失败不跳过其余关闭与临时根移除；本轮已改默认资源路径、平台预检与schema断言，不宣称此脚本已完整 Windows验收。工作记录 capture 新身份/PID/窗口渲染校验也需要实际 Windows 运行 |

## 从功能施工记录转移的未完成事项

| 范围 | 需要的后续验证 | 保留的原证据 |
| --- | --- | --- |
| 自动记忆/日志 | 36 条中英文真实模型语义样例：引用/自述、同义更正、去重、完成/取消、敏感负例与连续事项；确认当前日常应用完整交互。只用合成样例和隔离库，不把模拟模型联调当语义准确率 | [自动处理验收](automatic-memory-verification.md#真实模型验收与当前边界) |
| 附件原生事件/播放器 | MP4/MP3/WAV 逐项原生拖入，快速跳转的 Range 取消、播放中移除/切换、解码失败恢复；Windows WebView2。用户确认文件夹可拖入不扩大为所有媒体压力场景通过 | [原生回归](attachment-native-regression.md#2026-09-28-本机记录) |
| 历史与 composer | 当前原生小窗口/大窗口、离线、旧数据、首条消息计数、模型切换/恢复、Stop/审批完整回归；历史 Windows 证据与较新 Mac QA 不互相替代。360px CSS 压力规则没有 360px 原生截图 | [organizer 回执](archive/history/history-organizer-redesign-plan.md#8-施工记录2026-09-27)、[composer 回执](archive/chat/chat-composer-workspace-model-plan.md#10-实施与验收记录2026-09-27) |
| 设置与原生材质 | 原 P0 中剩余角色包/异常状态、跨窗口主题同步、全部页面语言组合；标题栏真实拖动、不同系统缩放。P1 材质统一/P2 原生 Vibrancy/Mica 应先核对后续样式接入，再确定尚未覆盖的范围和性能对照 | [P0/P1/P2 历史计划](archive/ui/frontend-redesign-phase-2-plan.md#后续验收边界)、[较晚原生检查](archive/ui/yume-latest-integration-review.md#后续macos-原生窗口检查) |
| 星运 | Windows 原生窗口及日期变更/恢复行为复验；已有本机持久化、四语言和四主题截图保留，不当 Windows 通过 | [首版验收](archive/horoscope/daily-horoscope-implementation-plan.md#12-首版实施验证记录2026-09-30) |
| 发布与更新 | 每次目标版本的 Mac 签名公证/下载回读/隔离 A→B、活动任务等待、取消/失败恢复；Windows 对应更新及安装图标。旧 release notes 的“尚未发布”不判断今日公开状态 | [macOS gate](macos-release.md)、[runtime checks](macos-runtime-checks.md) |

## 原生迁移能力余项

固定引擎能力矩阵仍保留：多题/多选/自定义 question 回答、真实鼠标拖放及更多 MIME、需要模型执行的 slash 命令、可核验 `/terminal` 面板、CLI/TUI 专有入口、非 Git 目录审查/撤销，以及同环境迁移前后的性能对照。不同版本升级/降级须用隔离旧/新包和数据副本验证；UI 回退不等于数据库格式降级。逐项状态见[能力矩阵](migrations/opencode-native/capabilities.md#8-p6-安装版能力终验状态2026-09-23)。

这些是 2026-09-23 记录留下的未验项，后续若已有独立证据，先对照版本、平台和场景再关闭。旧记录的“私钥密码未知 / 无签名 / sidecar 无鉴权 / 不自动重启 / 静态工作台记忆”已不是当前维护入口：当前签名能力按发布指南预检，当前上下文按[记忆契约](memory-and-worklog.md)及 D1-12 修订读取。

[早期 Agent 架构审计](archive/architecture/AGENT_HARNESS_ROADMAP_AUDIT.md)的目录/权限/停止/恢复与真实产物闭环要求，按当前 U/V 与原生能力项核对；性能改进仍需同环境前后测量。其 Desktop Context、通用触发器、可执行 Skills、多 Agent 等候选方向保留为历史建议，未因归档或移入索引转成已批准的施工待办。

兼容条件持续保留：旧格式 reader、纯旧文本、完整复合身份、local-only 回复、墓碑和不复活；不得以清理文档或完成某项门禁为由让旧二进制写新版数据库、覆盖新增数据、重放 prompt 或削弱批准边界。

## 完成回写

执行时记录当前 commit/未提交 diff、运行时、完整命令、退出码、通过/失败/skip/ignored、合成数据和证据路径；实机、模型、源码与公开资产分别记录。关闭一项需对应范围的真实新证据，不用旧测试数、截图存在或 archive 标记代替。
