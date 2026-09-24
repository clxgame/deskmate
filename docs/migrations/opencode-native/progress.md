# OpenCode 原生路线施工进度

任务来源：`E:/Codex/工作伙伴/Yume-OpenCode-原生路线-施工Prompt.md`（2026-09-22 原生工作台路线）
施工 Agent：Sisyphus（Kimi K3），单模型顺序执行
开始时间：2026-09-22

## 当前阶段：P0 ✅ → P1 ✅ → P2 ✅ → P3 ✅ → P4 ✅ → P5 ✅ → P6 进行中

### P4 进展（2026-09-23）

- [x] 轻聊、Agent 与原生工作台取消均改为“请求中 → 原生状态确认 → 才宣告停止”；失败/未知不再先置空闲，工作台 abort 经宿主门控。
- [x] 轻聊提交响应丢失后按稳定 message ID 查原生记录；确认已提交则继续，记录不可读则显示待确认且绝不自动重发。
- [x] 工作台输入所有权改为单会话 6 秒租约，路由切换精确释放，2 秒心跳；WebView 崩溃后租约自动失效，轻聊恢复前先查 `/session/status`，不可读则继续锁定。
- [x] 宿主监督外部强杀 sidecar：真实 QA 中 PID 1700764 → 1701776，原端口/鉴权恢复、33 个 session ID 全保留、provider prompt 计数 0→0；退出清理顺序同步修正。
- [x] 原生 session 元数据索引：稳定 ID、persona、workspace、source、created/updated；真实 QA 重复登记仍 1 条，不复制消息正文。
- [x] 真实二进制生命周期套件：长命令、子进程、超时、失败、拒绝、取消、立即复用、孤儿状态与全清理退出码 0；双 workspace 合同套件退出码 0。
- [x] 共享服务并发矩阵：A 长工具、B 正常聊天、C 真实后台报表同时 busy；只停止 A 后进程树消失且无迟到写，B 正常完成、C 报表持久化成功，全清理通过。
- [x] 五类取消统一矩阵：长命令、受控子进程、等待审批、工具失败、网络失联均记录 session/call/permission ID、abort、状态、PID、迟到副作用与最终原生状态；确认取消同时清除残留 permission/question。
- [x] 合成迁移与分离回退演练：二次迁移 4→4，墓碑不复活，重复 message/part 折叠，旧文本不伪造 part；旧 UI 写入不改变 2 条原生索引；数据库仅在隔离副本只读探测，源库前后 SHA-256 相同。
- [x] 最新 QA 二进制真实 WebView2 表面：轻聊窗口可调用 `chat_abort_session`，设置窗口被标签门控拒绝；应用、sidecar、provider 与三个端口最终全部清理。
- [x] P4 门槛通过：`bun test` 1002/0（8 个 macOS 专用跳过）；`cargo test --lib` 651/1 既存失败/13 忽略；typecheck、cargo check、工作台构建与 QA 桌面构建通过。

### P5 进展（2026-09-23）

- [x] 浏览器候选固定为 `microsoft/playwright-mcp@0.0.82`（commit `f1257a5a…53862`，Apache-2.0）；最小工具白名单与逐调用 `ask` 审批已实测。
- [x] 浏览器完整矩阵：隔离 Edge profile 打开本地页，DOM/服务双向回读唯一标识；拒绝、元素不存在、真实超时、中途停止均有原生 session/call/permission ID 与清理证据。
- [x] 初选 `CursorTouch/Windows-MCP@0.8.5` 在当前 Windows/Tauri 运行形态中被否决：输入报告完成但文件无变化，截图 COM access denied，目标窗口不可可靠枚举；保留失败证据，不进入产品。
- [x] 替代候选固定为 `sbroenne/mcp-windows@1.3.24`（commit `b90485c…c6d0`，MIT）；发布 ZIP 与 57.1 MiB 单文件 exe 均固定 SHA-256，危险工具从模型工具表缺席。
- [x] Windows 五场景矩阵：真实记事本输入、Ctrl+S 保存、文件回读、窗口截图；拒绝无启动、窗口消失结构化错误、只读保存不改原文件、停止后无输入；全场景进程/端口/临时目录清理闭环。
- [x] Windows MCP 改为随包资源，不依赖 Python/`uvx`；构建准备脚本校验发布归档与 exe 双 SHA-256，产品配置只暴露 10 个明确批准工具并保持 `"*":"deny"`。
- [x] 打包桌面表面：设置开关与固定命令、原生 MCP 审批/结果、拒绝/错误、running tool 取消结算、桌宠审批时唤醒与终态归眠、点击打开聊天、报表零工具污染；证据见 `p5-desktop-2026-09-23/desktop-host-e2e.json`。
- [x] 当前全量基线：Bun 1003/0（8 个 macOS 跳过）；Rust 655/1 既存 marker 失败/13 忽略；typecheck、cargo fmt/check 与 diff check 通过；React Doctor 仅余 2 项既有复杂度提示。
- [x] 受控真实模型浏览器选择：用户指定的 Kuro 网关 `gpt-6-luna` 自行选择 Playwright 工具，隔离本地表单提交并由 DOM/服务双向读回；密钥未写入证据。
- [x] 受控真实模型 Windows 终验：用户解锁后，模型自行选择并完成 7 个原生工具调用，保存的文件与 UI 回读均精确匹配唯一标识，窗口截图已目视核对；7 次精确审批、零拒绝，所有受控进程与临时根清理全绿。P5 门槛通过，进入 P6。

### P6 进展（2026-09-23；未通过发布门槛）

- [x] 修正生产与 QA 的 `beforeBuildCommand`：每次 Tauri 打包都先重建固定提交的工作台，再准备 sidecar 与前端，避免复用旧的忽略目录资源。
- [x] 生产身份 0.4.3 与隔离 QA 身份均生成 Windows NSIS **未签名**本地候选；版本检查通过；安装包 SHA-256、Bun lockfile、工作台/WASM、sidecar 与第三方声明指纹已记在 `verification.md` P6。
- [x] QA 专属 NSIS 已在工作区安装并从安装目录启动：工作台、轻聊、设置界面完整，受管 sidecar 自报 1.18.21；工作台鉴权健康检查 200，79 个资源请求零外网，两份独立视觉检查通过。
- [x] QA 同版本重装、QA 专属静默卸装再安装均成功；三个 QA 数据文件哈希前后相同，正式 YUME 0.4.8 安装登记保持原样。隔离候选现保留在 `artifacts/opencode-native/p6-qa-install/current/`。
- [x] 安装版原生提问选择/重开/忽略、中文文件名拖放发送、一次性编辑审批、Git 审查和消息撤销磁盘回读、`explore` 子任务血缘/结果均已逐项跑通；内置 `/new` 打开空草稿。两个独立截图审查通过，长 URL 编码 QA 路径影响可读性但无遮挡。
- [ ] 正式签名与 `latest.json`：现有 Tauri 私钥文件存在，但用户不知道密码；未读取/使用私钥，不猜测，不输出伪签名。正式发布链未运行。
- [ ] 不同版本之间升级/降级；提问多题/自定义答复、真实鼠标拖放、需模型执行的 slash 命令、`/terminal` 面板、CLI/TUI 专有入口、非 Git 目录审查/撤销；同环境迁移前后性能对照。未满足这些门槛之前不退役旧代码，不宣称 P6 或整体项目完成。

### P3 结果（§8 — 共享会话、陪伴上下文与扩展生态）

- [x] 3.1 轻聊→工作台会话接续（同一 session；打开本身不发消息/不复制历史/不另建会话）— verification.md P3-1
- [x] 3.2 工作台新建会话 → 轻聊可见同一任务状态 + 正确人设 — verification.md P3-2
- [x] 3.3 输入所有权：工作台拥有期间轻聊输入/审批断开，隐藏后恢复（按会话粒度）— verification.md P3-4；retry/question/cancel 全调用点审计与工作台崩溃恢复移交 P4（见交接 Prompt §5.2）
- [x] 3.4 工作台关闭时出现待审批 → 重开定位原请求只处理一次（拒绝也正确）— verification.md P3-5（permission 腿）；question 腿移交 P4
- [x] 3.5 上下文作用域：缺 sessionID 跳过；报表会话运行时实测零人设注入 — verification.md P3-3；角色切换/子任务/压缩/utility 细分矩阵移交 P4
- [x] 3.6 ~~移除轻聊旧注入~~ → **决策修订为保留**（D1-12：插件拿不到本轮用户文本，逐回合关键词记忆是产品契约；指纹去重保证全局一份）
- [x] 3.7 插件/MCP/技能按固定版本真实能力启用 — 插件（yume-context，P1–P3 已证）；技能（yume-qa-skill 经 /skill 列出）；MCP（P3-7 E2E：默认拒绝下工具不进入模型工具表 → 精确 ID + ask 后可见且审批真实生效，verification.md P3-6/P3-7，decisions.md D3-13）；配置损坏诊断移交交接 Prompt §10
- [ ] 3.8 验收场景：§8.1–8.3 ✅（P3-1/2/4/5）；§8.4 部分（报表隔离运行时实测 ✅；两角色×两目录并发矩阵移交 P4）；§8.5 部分（MCP/技能可用 ✅；配置损坏可诊断移交 P4/交接文档）

### P3.7 MCP 权限修复（2026-09-23，本阶段最后改动单元）

- 根因：OpenCode 在 `LLMRequestPrep.resolveTools()` 按权限过滤工具；Yume 基线 `"*":"deny"` 把已连接的 MCP 工具在进 provider 请求前隐藏（MCP 握手/tools-list 均正常）。
- 修复模式（D3-13）：保持 `"*":"deny"`；为明确批准的 MCP 工具按其规范化生成 ID 加 `"ask"`；配置在 spawn 前烘焙进 `OPENCODE_CONFIG_CONTENT`（per-directory 配置 run-once 缓存，运行时 PATCH 不可靠）。
- 实现：`settings.rs` 新增 `mcp_tool_permission_id()`（精确镜像上游 sanitize，**连字符保留**）与 `sidecar_permission_policy_with_approved_mcp_tools()`（生产调用点传空列表、行为不变）；TS 镜像 `scripts/ccswitch-harness/mcp-permissions.ts`；QA fixture `scripts/agent-qa/fixtures/mcp-echo-server.ts`（批准 + 未批准双工具对照）。
- 教训记录：计划阶段曾误判上游 sanitize 会替换连字符；上游 `catalog.ts:117` 正则 `[^a-zA-Z0-9_-]` **保留**连字符。QA 配置键定为下划线形式 `yume_qa_mcp`，与运行时观察 ID `yume_qa_mcp_yume_qa_echo` 一致；两侧镜像各有一条"保留连字符"回归测试。
- E2E：`scripts/agent-qa/verify-mcp-permission.ts`（`bun run verify:mcp-permission`），证据 `artifacts/opencode-native/p3-mcp-2026-09-22_17-53-08/mcp-tool-exposure.json`：control 双 false / fix 仅批准工具可见 / 审批往返拿到 `YUME_MCP_ECHO:` 真实输出 / 清理全绿。
- 后续（P5）：Playwright MCP / Windows-MCP 接入必须复用同一模式，不得另造放行机制。

## 当前阶段：P0 ✅ → P1 ✅ → P2 ✅（P3 进行中）

### P2（2026-09-22，证据见 verification.md P2-1…P2-12）

- 工作台窗口改为**代码创建**（`workbench::create_window`）：导航白名单（仅 tauri/asset/customprotocol + tauri.localhost/ipc/asset/127.0.0.1/localhost）+ CloseRequested→hide（关闭即隐藏、重开恢复）；从 tauri.conf.json/qa conf 移除配置声明，三配置文件天然一致；CDP 远程调试经 `YUME_CDP_PORT` 门控（生产不开）
- 桌面平台适配补全：文件/目录选择、保存、打开/显示路径、附件读取（64MB 上限）七个桥命令，全部窗口标签校验 + 路径校验
- 验收场景全过：关闭重开恢复 ✅、导航门控拦截外网 ✅、外链走系统浏览器且 file:// 被拒 ✅、图片粘贴（中文文件名 → image_url part）✅、中文/空格路径读回 ✅、取消选择器不崩 ✅、文件不存在明确错误 ✅、终端全链路（CSP 修复 wasm-unsafe-eval 后画布挂载，终端内写文件回读成功）✅
- 修复两个真问题：①ghostty-vt.wasm 未打包（prepare-workbench.ts 暂存）；②CSP 缺 wasm-unsafe-eval 拦 WebAssembly 编译
- 设置统一（§7.6）：`sync_workbench_default_model` 模型写回（D1-11）；上游声明 `THIRD_PARTY_NOTICES.md`（§7.7）已建并加入 resources
- 测试纪律：cargo test 638/1 既存失败、bun test 996/0、typecheck 双配置无错、cargo check 干净
- 剩余：设置写回的运行时实测（P2-11，需设置页真实选型后验证）、选择器正向用例（原生对话框选中文件，需 OS 级驱动）

### 下一步（P3 — 共享会话、陪伴上下文与扩展生态）

1. 轻聊→工作台会话接续（同一 session，不重复发送）
2. 上下文作用域硬化（角色切换/子任务/压缩/断线恢复各自规则）+ 报表注入隔离的运行时实测
3. 插件/MCP/技能按固定版本真实能力启用；权限审批唯一入口（工作台）+ 关闭时提醒
4. 移除轻聊旧 system 参数注入链路（插件指纹去重已保证不重复）

### P0（2026-09-22 完成，判定通过）

- 版本链可追溯：npm 1.18.21 ↔ tag v1.18.21 ↔ commit `826d9ad46a22bef0294998e08daa3c4904fea28f` ↔ 二进制 SHA-256 `EA4F…AF18`
- 源码表 17 行全核实；能力矩阵 25 项逐项落档；数据归属/回退边界明确；六份记录齐全
- ⚠️ 施工期间发现本地基线落后远端（origin/main 已到 v0.4.8，超前 11 提交）；按纪律不 pull/merge，验证仍以本地 0.4.3 基线运行（构建回执含全量源哈希）

### P1（2026-09-22，四验收场景全过）

- 上游构建：`bun --cwd packages/app build` 成功；工作台入口为上游树内**纯新增**三文件（workbench/index.html、entry.tsx、vite.workbench.config.ts），`scripts/prepare-workbench.ts` 复制到 `public/workbench/`（gitignore）
- 宿主桥：`workbench.rs`（标签校验三命令）+ `capabilities/workbench.json`（core:default）+ tauri.conf.json 工作台窗口 + CSP（ws://127.0.0.1:*、font-src、worker-src）
- 隔离 QA 验证（com.deskmate.worklogqa 身份 + 合成 provider + CDP 驱动）：
  - 正常：合成请求经原生审批（允许一次）→ 完整文本与工具过程 ✅
  - 上下文：yume-context 插件经 `experimental.chat.system.transform` 注入恰好一份人设（工作台）；轻聊旧链路指纹去重 ✅
  - 停止：原生停止 → 工具进程与其子进程均退出、计数文件停长 ✅
  - 故障：明确"无法连接/自动重试"状态，无隐式备用服务，无无限转圈 ✅（中途发送有约 20s 静默期，记为上游 UX 候选补丁）
  - 离线：39 请求零外网 ✅；PTY/WebSocket 连通 ✅；鉴权三通道（HTTP+SSE 带头、PTY 票据）✅；同一受管服务（树内仅 1 yume.exe + 1 opencode.exe）✅
- 鉴权批次：`OPENCODE_SERVER_PASSWORD` 每次启动随机生成；Rust（opencode.rs/settlement/model_client/tool_permissions）+ TS（opencode.ts 的 fetch-SSE 重写）全客户端带头；`bun test` 996 全过、`cargo test --lib` 仅 1 项既存失败（与本次无关）、typecheck 双配置无错
- `--pure` 已移除（经核实其唯一语义为禁用插件加载；隔离由私有 HOME 承担），插件经 `OPENCODE_CONFIG_CONTENT.plugin` 精确声明 file:// 路径

### P1 已记录限制（不隐瞒，均排入后续阶段）

1. 轻聊旧 system 参数注入仍在（插件指纹去重保证不重复）；旧链路退役在 P3
2. 工作台侧记忆为锚点级静态摘要；逐回合关键词检索在 P3 评估 `experimental.chat.messages.transform`
3. 标题生成等 utility 请求也被注入（P3 作用域细化）
4. 报表注入隔离为代码路径验证（reports::SYSTEM 前缀标记），运行时实测列入 P3 场景 4
5. 外部强杀 sidecar 后宿主不自动重启（supervision 只管宿主自有 run）；恢复=重启应用（P4 完善）
6. 中途发送失败约 20s 静默期（上游候选补丁：submit 即时反馈）

## 本次负责的文件

- 施工记录：`docs/migrations/opencode-native/`（全部六份）
- 上游叠加文件（克隆树内纯新增）：`opencode-v1.18.21/packages/app/workbench/*`、`packages/app/vite.workbench.config.ts`
- Yume 新增：`src-tauri/src/workbench.rs`、`src-tauri/src/yume_context.rs`、`src-tauri/src/yume-context-plugin.ts`、`src-tauri/capabilities/workbench.json`、`scripts/prepare-workbench.ts`、`scripts/workbench-qa/`（provider.ts、cdp.ts、start-provider.ps1）
- Yume 修改：`src-tauri/src/lib.rs`（mod 注册、命令注册、Sidecar password 字段与鉴权 helper、spawn 去 --pure + 插件部署 + 鉴权 env）、`src-tauri/tauri.conf.json`（workbench 窗口、CSP）、`scripts/worklog-qa/tauri.qa.conf.json`（workbench 窗口、CSP、删过期版本写死）、`scripts/worklog-qa/desktop.ps1`（Source-Hashes 覆盖 workbench-qa）、`src/lib/opencode.ts`（鉴权 + fetch SSE）、`src/lib/settings.ts`（鉴权头）、`src/lib/opencode.test.ts` 与 `src/chat/chatFixedReply.test.tsx`、`chatPetActivity.test.tsx`、`ccSwitchSetupChatHarness.test.ts`（SSE 基建同步）、`src-tauri/src/agent/opencode.rs`+`opencode_settlement.rs`+`start_context.rs`、`worklog/model_client.rs`+`runner_runtime.rs`、`tool_permissions/runtime.rs`（仅加 Authorization 头）、4 个测试文件的 ModelEndpoint/AgentEndpoint 字段补齐、`.gitignore`（public/workbench、artifacts）、`package.json`（prepare:workbench）
- 并行任务文件的触点声明：agent/opencode*.rs、run_commands.rs（未改）、tool_permissions/runtime.rs 均为**仅加头/仅加字段**的最小接触，未动其逻辑

## 并行施工观察（不得触碰）

- agent tool hang 修复任务的最后活动为 2026-09-22 11:28（.tmp/final-*.log）；其未提交修改仍在工作树（git status 44 项 = 其 35 + 本任务 9 项新增）
- 本机同时运行着生产 YUME（AppData\Local\YUME）与官方 OpenCode Desktop（8 进程）——均未触碰

## QA 运行手册（本次实测流程，可复用）

```powershell
# 准备（改动 workbench 入口后重跑）
bun run prepare:workbench            # 构建上游工作台包到 public/workbench/
# 合成 provider（独立进程，先看回执拿端口）
bun scripts/workbench-qa/provider.ts artifacts/opencode-native/<run-id>
# QA 构建/启动（隔离身份 com.deskmate.worklogqa）
bun scripts/worklog-qa/run.js preflight
bun scripts/worklog-qa/run.js build
bun scripts/worklog-qa/run.js launch -FixtureBaseUrl http://127.0.0.1:<PORT>/v1
# CDP 驱动（CDP 端口 55883）
bun scripts/workbench-qa/cdp.ts targets
bun scripts/workbench-qa/cdp.ts eval <targetId> "<js>"
bun scripts/workbench-qa/cdp.ts shot <targetId> <out.png>
bun scripts/workbench-qa/cdp.ts console <targetId> <waitMs>
bun scripts/workbench-qa/cdp.ts netlog <targetId> <waitMs>
# 结束
bun scripts/worklog-qa/run.js stop   # 保留数据供回读
bun scripts/worklog-qa/run.js purge  # 证据留档后清数据根
```

注意：该 QA 设置 UI 的 Base URL 不含 `/v1`（目录校验自拼 `/v1/models`）；provider 需同时服务 /models 与 /v1/models、/chat/completions 与 /v1/chat/completions。模型默认经 `PATCH /global/config {"model":"yume-2/model-a"}` 设置。

## 阻塞

当前无 P5 阻塞。P6 的正式签名缺少私钥密码（用户表示不知道），本地未签名候选与隔离 QA 已完成本轮打包及扩展验收，但不能发布；跨版本升级、能力矩阵余项与性能对照仍未验完。未对外发布、未替换生产数据、未退役旧代码。
