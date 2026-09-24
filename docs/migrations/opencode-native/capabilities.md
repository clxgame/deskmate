# 原生能力矩阵（OpenCode v1.18.21 @ 826d9ad4）

记录时间：2026-09-22 · 阶段：P0
证据基准：anomalyco/opencode 提交 `826d9ad46a22bef0294998e08daa3c4904fea28f`（tag v1.18.21）源码静态核实 + 官方文档。**"支持"均指该版本原生 Web 应用（packages/app）存在对应 UI/调用路径；不代表已在 Yume 包装层内实测通过**——实测是 P1–P6 的事。逐项运行验证前，本矩阵的任何一行都不构成"已可用"声明。

## 1. 工作台能力矩阵（施工 Prompt §5.6 枚举项）

| 能力 | 原生支持（v1.18.21 app） | 证据（固定提交路径） | Yume 目标入口 | 测试方式（阶段） |
| --- | --- | --- | --- | --- |
| 会话创建 | ✅ | packages/app/src/components/prompt-input/submit.ts L390–420；pages/home/home-sessions.tsx | 工作台；轻聊发起共享 | 合成请求建会话，双入口同 session（P1/P3） |
| 会话切换/列表/搜索 | ✅ | pages/layout.tsx；global-sync/session-load.ts；home-sessions-controller.tsx L60–85；command-palette.ts L135–160 | 工作台 | 多会话切换 UI 证据（P2） |
| 会话恢复/重连续接 | ✅ | global-sync/session-load.ts；server-sdk.tsx L260–315（事件流断线重连） | 工作台；宿主协调 | 关窗重开回到原会话；服务重启恢复（P2/P4） |
| 完整消息与工具输出渲染 | ✅ | pages/session/timeline/message-timeline.tsx（L90–105 工具 part 分组，L974–1035 展开渲染）；@opencode-ai/session-ui/message-part | 工作台（完整事实）；轻聊（摘要投影） | 合成工具调用全流程渲染核对（P1） |
| 错误显示 | ✅ | message-timeline.tsx L1205–1225 错误行；context/notification.tsx；server-session-v2-reducer.ts | 工作台 + 桌宠提醒 | 服务不可用/凭证失效场景（P1 故障场景） |
| 停止/abort | ✅（调真实服务端 abort，非仅客户端取消） | prompt-input-v2.tsx L390–415 onStop；submit.ts；utils/server-compat.ts L185–205 `session.abort` | 工作台停止按钮；轻聊状态 | **P1 门槛**：工具定时写文件+受控子进程，点停止后两者退出、文件停长 |
| 审批（once/always/reject） | ✅ | context/permission.tsx L240–290；pages/session/composer/session-permission-dock.tsx L1–70 | **工作台唯一应答入口**；桌宠/轻聊仅提醒跳转 | P3 场景 3：关窗产生审批→提醒→重开定位同一请求只处理一次 |
| 提问交互（question elicitation） | ✅（多题、单/多选、自定义文本、分页、reply/reject） | session-question-dock.tsx（L220–265 调 sdk api.question.reply/reject） | 工作台唯一应答入口 | 同审批场景（P3） |
| 附件：文件选择 | ✅ | prompt-input/attachments.ts L1–90；platform.tsx `openAttachmentPickerDialog` | 工作台经平台适配层实现 | 中文/空格/长路径文件上传（P2） |
| 附件：拖拽 | ✅ | attachments.ts L150–215 全局 drag/drop | 工作台 | 同上（P2） |
| 附件：图片粘贴 | ✅（含 `platform.readClipboardImage()` 桌面回退） | attachments.ts L90–125；platform.tsx L105–120 | 工作台 | 粘贴图片发送（P2） |
| Slash 命令 | ✅（command/MCP/skill 三类来源） | prompt-input/slash-popover.tsx L1–35；dialog-command-palette-v2.tsx | 工作台 | 命令执行（P2） |
| 子任务/子会话 | ✅（task 工具 part 识别、父子会话血缘、todo dock） | message-timeline.tsx L90–105；session-lineage.ts；global-sync/event-reducer.ts；session-todo-dock.tsx；prompt-input-v2.tsx L265–300 非主 agent 选择 | 工作台 | 含子任务的合成任务（P3） |
| 差异/diff 审阅 | ✅（标准与 v2 review 视图、会话 diff store） | pages/session/review-tab.tsx；v2/review-panel-v2.tsx；v2/session-file-browser-tab.tsx；context/directory-sync.ts L1–160 | 工作台 | 编辑类任务 diff 展示（P2） |
| 撤销/revert | ✅（会话/文件变更 revert，非通用编辑撤销栈） | session-revert-dock.tsx；pages/session.tsx L1810–1870 | 工作台 | revert 后文件状态核对（P2/P4） |
| PTY 终端 | ✅ **但走 WebSocket**（HTTP+SSE 不够） | components/terminal.tsx（L610–705 WS）；context/terminal.tsx L235–330；utils/terminal-websocket-url.ts | 工作台 | Tauri WebView 内 WS 连接实测（P1 传输验证） |
| 模型选择 | ✅ | dialog-select-model.tsx；dialog-manage-models.tsx；dialog-connect-provider.tsx；settings-providers.tsx | 工作台设置 + Yume 设置页（§3.4 共用生效来源） | 双入口有效值一致性（P2 任务 6） |
| 配置编辑 | ✅ 结构化设置（常规/外观/终端/快捷键/provider/模型/服务器），**非通用 opencode.json 编辑器**；服务端 config service 可写回 | dialog-settings.tsx；settings-*.tsx；packages/opencode/src/config/config.ts L624–660 | 工作台 + Yume 设置 | 配置来源/优先级/有效值记录核对（P2） |
| 插件 | ⚠️ 仅状态展示，**无安装/编辑 UI** | status-popover-body.tsx L285–330, L485–510 | 配置层启用（opencode.json `plugin` 字段）；UI 只读 | 测试插件加载生效与失败诊断（P3 场景 5） |
| MCP | ✅ 状态/启停/认证（connected/failed/needs_auth/needs_client_registration/disabled）；无任意 JSON 编辑 | dialog-select-mcp.tsx L1–75；context/mcp.ts；status-popover-body.tsx L395–470 | 工作台 | 测试 MCP 安装/运行/配置损坏诊断（P3 场景 5） |
| 技能/自定义 agent | ⚠️ 可选择使用（agent 提及、skill slash 项），**无定义编写/管理 UI** | prompt-input-v2.tsx L265–300；prompt-input.tsx L570–690；slash-popover.tsx L1–35 | 配置层启用（`skills`/`agent` 字段 + 目录约定） | 测试技能加载与作用域（P3 场景 4–5） |

## 2. 配置面（该版本 opencode.json schema 实有字段）

证据：packages/core/src/v1/config/config.ts L32–190（ConfigV1.Info）。支持：`plugin`、`mcp`、`agent`、`permission`（细则在 core/src/v1/config/permission.ts）、`provider`、`instructions[]`（合并去重）、`command`、`skills`（额外技能目录）、`model`、`small_model`、`default_agent`、`subagent_depth`、`server`、`shell`、`formatter`、`lsp`、`attachment`、`tools`（按工具启停）、`compaction`、`experimental`。

加载来源（packages/opencode/src/config/config.ts L239–275）：全局 config.json→opencode.json→opencode.jsonc、实例/项目配置、`OPENCODE_CONFIG`、`OPENCODE_CONFIG_DIR`、**`OPENCODE_CONFIG_CONTENT`**（Yume 宿主现用的注入点）、项目自动发现的 agents/commands/plugins/skills。

**对 Yume 的含义**：当前宿主经 `OPENCODE_CONFIG_CONTENT` 注入 + 全局空 opencode.jsonc + `--pure` 的组合是可控基线；恢复插件/MCP/技能时按上述真实字段逐项启用并记录有效值（§3.4），不得 allow-all。

## 3. 传输与鉴权（P1 三通道验证前提）

| 通道 | 机制 | 证据 | P1 验证点 |
| --- | --- | --- | --- |
| HTTP API | REST | server/routes/instance/httpapi/api.ts L48–85 | WebView fetch 连通 + 鉴权头 |
| 事件流 | HTTP SSE `/event`（text/event-stream） | groups/event.ts L7–28；server-sdk.tsx L260–290 | EventSource/bridge 连通 + 断线重连 |
| PTY 终端 | **WebSocket**（PTY connect token/query 携带凭证） | components/terminal.tsx L610–705；utils/terminal-websocket-url.ts L1–40 | WS 连通 + 鉴权；若裁剪终端需明确记录 |
| 鉴权 | 服务端读 `OPENCODE_SERVER_PASSWORD`(+USERNAME)，Basic auth；app 从 `ServerConnection` 存取凭证并发 Basic 头；**app 自身不读环境变量** | server/auth.ts L7–45；app/utils/server.ts L1–60；server-health.ts L72–110 | 宿主生成密码→注入 ServerConnection 或 platform.fetch 注入头；三通道分别证明；凭证不进 URL/日志/localStorage（§3.3） |

**现状缺口**：受管 sidecar 当前无鉴权运行（baseline.md §4）。启用密码是 P1 前置改动之一。

## 4. `opencode serve` 与 app 的适配结论

- `serve` 与 `web` 共用同一 `Server.listen` 与 `OpenCodeHttpApi`（serve.ts L6–20；web.ts L31–45），`web` 仅多开浏览器。**app 不需要 `opencode web`**。
- 根 API 含 config/file/instance/mcp/project/pty/question/permission/provider/session/sync/tui/workspace/event 全部分组（api.ts L54–85）——当前 sidecar 形态 `--pure serve --port N --hostname 127.0.0.1` 在 API 面上兼容。
- 目录路由：workspace/location 中间件（api.ts L28–32）+ app 经 SDK 传目录上下文（server-sdk.tsx L336–369）；Yume 现有客户端用 `directory=` query 参数，P1 需核实 app 实际用 header（`x-opencode-directory`）还是 query，并保证与多 project instance（workspace / scheduled-agent-workspace）语义一致。
- `--pure` 的真实影响范围（LSP/formatter 禁用已实证；对插件/MCP/技能加载的影响）需在 P1/P3 实测记录。

## 5. CLI/TUI 独有能力与原生访问入口

TUI 实现在独立包 `@opencode-ai/tui`（本仓库无 packages/tui 目录）；CLI 入口 packages/opencode/src/cli/cmd/tui.ts、packages/cli/src/tui.ts。以下为 app 无等价 UI 的能力，**按施工 Prompt §5.5 不得默认为已继承或删出目标**：

| CLI/TUI 能力 | 证据（固定提交） | Yume 原生访问入口方案 | 界面范围说明 |
| --- | --- | --- | --- |
| `opencode run` 非交互执行（--format json 事件流、--command、--continue/--session、--attach、CLI 直选模型、显式账号密码） | cli/cmd/run.ts L120–215 | 宿主已有等价物：轻聊/agent_run_start + worklog runner 即"非交互执行"；不引入 CLI 调用 | 属宿主/轻聊范围，非工作台 UI |
| `run --attach` 直连运行中服务 | run.ts L125–210 | 工作台经 ServerConnection 连接受管服务已覆盖该语义 | 工作台范围 |
| `opencode serve` 进程生命周期 | cli/cmd/serve.ts L1–22 | 宿主 lib.rs `spawn_sidecar`/`restart_sidecar` 已拥有 | 宿主范围 |
| `opencode web` 启动并开浏览器 | cli/cmd/web.ts L30–80 | 不使用（§3.1 禁止以另启完整程序为正式方案） | — |
| CLI account/provider 交互式认证命令 | cli/cmd/account.ts、cmd/providers.ts、effect/prompt.ts | 工作台自带 provider 连接对话框（dialog-connect-provider.tsx）+ Yume 设置页 | 工作台/设置范围 |
| TUI 自动批准旗标 `--auto`/`--yolo`/`--dangerously-skip-permissions` | tui.ts L104–125 | **不提供**。Yume 授权走统一权限链（decisions.md D0-5）；yolo 语义与产品安全边界冲突 | 明确不支持，非缺陷 |
| TUI `--mini`/`--no-replay`/`--replay-limit`/`--fork`/`--agent`/`--prompt` 启动旗标 | tui.ts L72–143 | 会话参数由工作台/轻聊的正常会话 API 覆盖（--fork 语义可用 session fork API 时再评估） | 工作台范围 |
| TUI 主题/键位等终端专有交互 | @opencode-ai/tui 包 | 不适用（桌面 WebView 有自己的外观体系，后续定制阶段再议） | 明确不支持 |

## 6. 矩阵使用纪律

- 每行"测试方式"列即该能力的验收锚点；P1–P6 完成时在对应阶段证据文件回写实际结果与证据路径。
- 状态 ⚠️ 行（插件管理、技能管理）是**原生应用的功能边界**，不是 Yume 缺陷；目标入口落在配置层而非 UI 层。
- CLI/TUI 独有能力已逐项给出入口或明确的"不支持"理由；不允许把未实现能力笼统标"不支持"通过验收（§11.2）。

## 7. P3 实测回写（2026-09-23）

以下为 §1 表中"测试方式（P3）"锚点的实际运行结论，证据全文在 verification.md P3-1…P3-7：

| 能力行 | P3 实测结论 | 证据 |
| --- | --- | --- |
| 插件 | ✅ 配置层启用生效：`yume-context` 插件经 `OPENCODE_CONFIG_CONTENT.plugin` 加载，`experimental.chat.system.transform` 每次模型请求恰好注入一份 Yume 上下文；缺 sessionID/报表会话跳过有运行时证据 | verification.md P1-6/P1-17/P3-3 |
| 技能 | ✅ 配置层启用生效：`skills: { paths: [...] }`（对象形式，非字符串数组）注册后 `/skill` 列出测试技能 `yume-qa-skill` | verification.md P3-6 |
| MCP | ✅ 连接/握手/tools-list/调用全通；**工具可见性受权限链控制**：基线 `"*":"deny"` 下工具不进模型工具表（control 实测），精确 ID + `ask` 后仅批准工具可见且审批真实生效（fix 实测）；MCP 配置须在 spawn 前烘焙（run-once 缓存） | verification.md P3-7、decisions.md D3-13 |
| 审批 | ✅ 关闭/重开定位同一 permission request、只处理一次、拒绝不产生替代请求；question 腿的同等矩阵移交 P4 | verification.md P3-5 |
| 子任务/子会话 | ⏳ 未单独验收（P3 范围未触发子任务场景；移交 P4 生命周期矩阵） | — |

未改写的行维持"原生支持"静态结论，其实测状态以 verification.md 对应阶段记录为准。

## 8. P6 安装版能力终验状态（2026-09-23）

本表区分“固定提交里有实现”和“本次安装版实际跑通”；静态 ✅ 不自动升级为 P6 通过。`verification.md` P1–P5 的既有真实二进制证据仍有效，但与 P6 安装版的范围分别标明。

| 能力组 | 已有运行证据 | P6 安装版结论 / 剩余动作 |
| --- | --- | --- |
| session 创建/切换/恢复、完整消息/part/工具、错误、停止 | P1/P2/P3/P4 的真实 Tauri/sidecar/CDP 场景；P6 安装版三窗口和受管服务连通 | 安装版入口与渲染 ✅；P6 尚未在安装版逐项重放复杂会话和停止矩阵，不把截图等同语义验收 |
| 审批与提问 | P3 审批关窗重开、P4 待审批/提问清理、P5 原生 MCP 精确审批；P6 安装版合成 provider 触发原生 `question` | 单题选择并提交、同一问题关窗重开、忽略后无替代请求均 ✅；多题/多选/自定义回复仍 ⏳（`verification.md` P6-9） |
| 附件：选择、粘贴、拖拽 | P2 原生选择器与图片粘贴后请求含 image_url；P6 安装版合成文件拖放 | 中文和空格文件名的 `text/plain` 文件拖放→芯片→发送→原生 file part/准确内容→终态 ✅；真实鼠标拖放及更多 MIME 仍 ⏳（`verification.md` P6-12） |
| slash 命令、子任务/子会话、diff/撤销 | `/model` 打开模型选择、`/new` 打开空草稿；P6 `explore` 子会话有真实 parentID、完成 part 与父会话结果；Git QA 目录编辑审查显示前后行，消息撤销后磁盘哈希恢复 | 上述已测项 ✅；`/terminal` 菜单点击尚无可核验终端面板、需模型执行的 slash 命令和非 Git 目录的审查/撤销仍 ⏳（`verification.md` P6-10/11/13） |
| PTY | P1 WS+票据传输、P2 真实终端写文件回读；P6 包含 ghostty-vt.wasm | 既有真实 WebView 证据 ✅；安装版此轮只核对 WASM 打包/工作台加载，未重放终端写入 |
| 模型/配置、插件、MCP、技能 | P2 模型写回、P3 插件/MCP/技能、P5 固定浏览器/Windows MCP 与真实模型调用 | 已验证的入口分别为设置页/工作台/受管配置层；插件与技能编写 UI 不属该版本能力，不能误写为安装版已测 |
| CLI/TUI 独有项 | §5 的逐项入口/范围判定；本轮 sidecar `--version` 1.18.21 | `opencode run` 的非交互语义由宿主 Agent/worklog 覆盖但不等于 CLI 每个 flag；`--attach` 由工作台受管连接覆盖；`serve` 由宿主拥有；TUI 专有交互与危险自动批准不作为桌面 UI 支持。具体 CLI flag 兼容性仍未逐项运行 ⏳ |

P6 总判定：矩阵尚未完成，不以“原生源码存在”或笼统“不支持”通过。未证项在下一轮隔离安装版运行后逐格回写，旧代码退役因此保持冻结。
