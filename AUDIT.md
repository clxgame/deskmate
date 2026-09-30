# Repository Audit

审计日期：2026-09-30（Asia/Shanghai）\
对象：[clxgame/deskmate](https://github.com/clxgame/deskmate)，本地工作树 `/Users/xiao/my-project/deskmate`\
基线：`482b52952ecab5297dda410d5c14ac6c019ab003`，应用版本 `0.4.16`。

本轮只读审计并生成本文件。审计开始前已有角色资源及 archive 素材删除，未恢复、提交或改写这些改动。判断针对本地代码和实际调用链，不假定本地工作树与 GitHub 最新状态完全相同。没有修改生产代码、依赖、数据格式、公开接口或发布配置，也没有发布。

覆盖范围：桌面启动与 sidecar、轻聊/Agent/原生工作台、统一历史、设置与角色、附件、记忆和自动工作日志、报告调度、依赖、构建与发布、测试结构，以及现有设计/迁移/验收文档。采用调用追踪、引用搜索、三个并行专项审计和本机验证；没有读取用户实际聊天数据库、服务商凭据或向真实模型发送请求。代码风险与本轮实际复现分别标明；未进行 Windows 实机、完整工作台重建、签名安装包或性能基准验收。

## 1. Executive Summary

**总体判断：主架构仍然匹配产品，不建议重写；当前实现尚未达到最小必要复杂度。** 最明显的额外成本集中在迁移残留、状态投影更新以及工作台构建，而非整个 Rust/React 分层。

- **Core System**：桌面陪伴入口 + 一个受管 OpenCode 执行引擎 + 会话/目录身份 + 宿主权限与生命周期 + 可恢复的本地产品数据。桌宠不是另一个 Agent 引擎；工作台也不是第二个引擎。
- **最大 complexity source**：原生会话已经成为消息事实来源，但旧历史投影、catalog 导入、运行记录和多个 UI 投影仍共同参与正常执行，迁移职责没有完全退出日常路径。
- **最大维护风险**：增加一项功能后，同时补 UI、旧投影、原生目录、权限和恢复；测试入口又不能稳定区分当前代码、旧源码副本及共享 mock 的影响。错误容易被补丁掩盖或直到发布才被发现。
- **最值得做**：建立可信基线；删除对自有工作台入口的字符串补丁；统一 RunRecord 的提交顺序；将旧历史写入从原生任务控制路径移出；简化记忆库初始化与迁移恢复。
- **不要动**：受管单引擎、复合身份、停止确认、权限与凭据边界、旧数据读取、记忆/日志独立存储、报告修订与幂等、角色渲染兼容、Apple 签名与 updater 签名的真实边界。

没有证据支持“删掉大多数 hooks/services/repositories”或“换框架就会更简单”。本轮也没有发现足以建议删除的 npm dependency。

## 2. System Model

### Product / Runtime / Domain

产品已经从单纯桌宠扩展为桌面陪伴与工作助手：轻聊、选定目录的受管任务、完整 OpenCode 工作台、可管理的记忆、工作日志和报告。角色渲染是交互表面；模型推理及工具执行交给 OpenCode；宿主拥有桌面窗口、目录/会话归属、批准、产品数据和恢复策略。

```text
pet.html            chat.html                   settings.html
PetApp              ChatApp                     SettingsApp
  |                 | 轻聊 / workspace task     | provider / preferences
  +-----------------+---------------------------+
                    | Tauri IPC / 本地鉴权 HTTP
                    v
              Rust desktop host
              ├─ Settings / OS keyring / windows / packs
              ├─ Agent RunRecord / ownership / permission / recovery
              ├─ history catalog + legacy/local-only reader
              ├─ memory automation + worklog/report scheduling
              └─ 单个受管 OpenCode sidecar
                         ^              |
                         |              ├─ 原生 session / message / part / tool
              workbench/index.html      └─ configured AI provider / approved tools
              固定上游 UI + YUME Platform bridge
```

原生入口从 [main.rs](/Users/xiao/my-project/deskmate/src-tauri/src/main.rs:3) 进入 `yume_lib::run`；[lib.rs](/Users/xiao/my-project/deskmate/src-tauri/src/lib.rs:1475) 注册 IPC、状态、桥接和后台 worker，启动并监督 sidecar。Vite 构建三个自有页面；工作台由 Rust 动态创建并加载本地构建资源。

### 核心用户行为与 Data Flow

| 用户行为 | 实际链路 | 事实与响应 |
| --- | --- | --- |
| 普通聊天 | ChatApp → 校验复合会话/模型选择 → `promptAsync` → sidecar → directory SSE → UI pacing | 原生正文由 OpenCode 保存；确定性本地回复单独标记 `localOnly`，不伪造原生模型消息 |
| 在目录完成工作 | `useAgentRun` → `agent_run_start` → 目录/模型/续聊校验 → RunRecord → 原生 session/prompt → collector → 权限与终态 | Rust 拥有执行生命周期，UI 读投影；当前额外写旧历史文本，见 F01 |
| 转到完整工作台 | `openInWorkbench` → scoped handoff → Platform bootstrap → 固定上游 UI → 同一 sidecar | 租约限制同会话输入归属；隐藏/路由切换释放；取消需确认原生状态 |
| 查看/整理历史 | organizer → `history_catalog_*` → catalog 元数据 + 原生读取或旧文本回退 → UI | pin/title/archive/model preference 是 YUME 元数据；原生正文不应成为 catalog 的第二份正文 |
| 自动记忆/日志 | 新可信用户回合登记 → 持久队列 → 内部无工具提取 → 分支校验 → memory/worklog 各自提交 | 两库独立回执、epoch 与幂等键，部分成功可恢复；报告/内部子会话排除 |
| 生成报告 | 显式工具/UI/调度 → worklog 业务日期与素材选择 → 独立模型会话 → 报告候选/修订 → 回执 | 手动编辑优先，删除来源标记报告依赖；不会因删除聊天一并删除日志 |
| 文件/媒体附件 | typed API → native staging 或 opaque local-resource ID → 预览/转换 → prompt 引用 | 本地缓存与路径权限归宿主；NCM 转换等不等于模型能够理解任意媒体 |
| 更新 | 设置检查 → 下载/签名验证 → 等待任务 → 原生安装/恢复 → 重启确认 | 发布侧另有 Apple 签名公证、Actions updater 签名和下载回读 |

### State Ownership

| Fact | 权威 owner | 派生/缓存 | 判断 |
| --- | --- | --- | --- |
| 原生 session、message、part、tool 状态 | OpenCode API/数据库 | React 展示、collector snapshot | 正确边界；需要可恢复地刷新 |
| 宿主运行归属、run outcome、submission/recovery 信息 | Rust AgentRunState + RunStore | `useAgentRun`、catalog Agent details | 有真实职责；RAM/磁盘提交顺序有问题，见 F09 |
| 同会话工作台输入归属 | Rust WorkbenchOwnership 租约 | 页面心跳/UI lock | Essential，不是应该删除的重复 busy flag |
| 历史组织信息、会话模型选择 | `history-catalog.sqlite` | organizer/当前条目 | 正确 owner；读取/更新方式过重，见 F03 |
| 旧文本、产品本地回复 | `history.json` | legacy reader / linked local message | 旧数据和本地回复必须保留；持续复制新 Agent 原生文本有额外成本 |
| 旧 native session index | 历史 JSON 导入输入 | Catalog | 保留 reader；生产 writer 已退役，见 F08 |
| 设置正式值 | Rust SettingsState；磁盘 settings.json（不存 key） | SettingsApp 草稿、其他窗口快照、sidecar 配置 | 草稿与正式值不同不是问题；整对象写回与不同错误语义值得收窄 |
| 服务商 key | OS keyring | 受限运行时配置/鉴权 | 不应为了统一数据模型搬回 settings.json |
| 记忆 | memory SQLite 仓储 | 每请求有界相关上下文 | 真实产品数据；不能和原生聊天正文合并 |
| 工作条目、报告、修订、调度 | worklog SQLite 仓储 | UI / 报告输入 / 关联记忆 | 独立事实；不是 memory 的重复流水 |
| 桌宠活动、计时、窗口位置 | 请求作用域活动投影 / Rust timer / native geometry | 动画与显示倒计时 | 渲染状态与执行状态需要区分 |

多个 UI 快照本身正常。真正的 multiple-source-of-truth 风险是：投影写失败改变原生任务成败、RAM 更新失败后仍领先磁盘、丢失事件后没有重读事实，以及构建后的程序与编辑器中的自有入口逻辑不一致。

### External Systems / Persistence

依赖 AI providers、固定 OpenCode 引擎及其自有持久化、OS keyring/窗口/进程、可选 MCP 服务、ncmdump、GitHub Actions/Release 和 Apple 签名公证。YUME 自有持久化主要为 settings、RunStore JSON、catalog SQLite、legacy/local-only history JSON、memory SQLite、worklog SQLite、角色包与附件缓存。

## 3. Core System

“保留 20%”应理解为保留最小产品闭环，不是承诺删除 80% 代码后现有全部功能还能存在。

| 类别 | 最小核心 | 原因 |
| --- | --- | --- |
| Core Domain | 会话/目录身份、执行归属、批准与终态、角色选择 | 没有这些，产品无法可靠地聊天或完成本机工作 |
| Core Runtime | Tauri host、一个受管 sidecar、Agent lifecycle/collector/supervision | 避免自己再造规划器、工具引擎和第二个 Agent runtime |
| Core Data Model | Native identity、RunRecord、catalog 产品元数据、最少设置 | 分开原生执行事实与宿主产品事实 |
| Core UI | 桌宠入口、轻聊/composer、原生工作台、必要设置/审批 | 两种交互深度对应同一个引擎 |
| Core Infrastructure | 本地鉴权、scoped IPC、进程恢复、打包签名与 updater | 桌面分发及本地执行的必要成本 |

其余分类不是删除授权：

- **Supporting**：provider discovery/usage、附件预览/转换、pack 导入、历史 organizer、导出、测试 fixture、发布工具。
- **Optional 产品能力**：自动记忆/自动日志、报告调度、番茄钟、星运、更多渲染类型与角色包。它们已有真实用户能力，不能按“非最小核心”判为 dead code。
- **Legacy**：旧聊天文本、旧 native index reader、已发布 pack schema、settings/keyring 迁移。按安装与数据兼容契约保留 reader。
- **Generated**：dist、public/workbench、平台二进制、Cargo target、output/QA 证据。应排除源码审计统计及测试发现，不应把它们当重构目标。
- **Suspected Redundant / 已证实残留**：F08 中的无读 refs、旧前端 wrappers、旧 index writer；F05 的自有源码字符串改写层。范围必须精确到符号或分支。

## 4. Complexity Map

采样计数：`src` 342 个 TS/TSX/CSS 文件，`src-tauri/src` 297 个 Rust/TS 文件，`scripts` 86 个 TS/TSX/Rust 文件；按命名及 testing 目录约 250 个测试文件。生产/支持文件中仍含 Rust 内嵌测试，不能把这些 LOC 全算作产品复杂度。

前端相对模块 import 近似图：ChatApp fan-out 44、PetApp 19、SettingsApp 16；i18n fan-in 38、settings 16。这只用于定位检查，不用于推断 dead code 或裁定抽象错误。

| Hotspot | Essential Complexity（保留） | Accidental Complexity（优先处理） |
| --- | --- | --- |
| ChatApp，约 2,070 行、44 个内部依赖 | 两入口、切换 generation、流式显示、批准、附件、local reply | 原生状态更新契约分散，send 与 cancel 混用，写而不读的迁移 refs；见 F04/F08 |
| Agent + history | 取消确认、权限 provenance、持久恢复、旧数据墓碑 | 原生 task 依赖旧投影，RAM/磁盘错误路径分歧；见 F01/F09 |
| Catalog | 复合 key、删除/归档/model selection | 普通读触发全量导入、扫 run 文件和整表重写；见 F03 |
| settings.rs，约 3,929 行 | 多 provider、keyring、目录验证、设置迁移、native apply | 文件约从 2,440 行开始是内嵌测试；长度不能直接证明需要拆分。正式值/草稿/sidecar 副作用协议需明确 |
| Memory / automation | 敏感过滤、出处、忘记屏障、两分支独立提交 | 打开的 WAL 库主文件备份/回拷、未来版本接受、初始化竞争；见 F02 |
| Workbench pipeline | 固定上游 UI、Platform bridge、terminal WASM、主题继承 | 自有入口再被字符串改写、隐式外部 clone、旧 overlay 阻止再次准备；见 F05/F06 |
| Tests / CI / docs | 原生窗口、模型、签名需独立验收 | 默认发现旧源码副本、模块污染、陈旧文案断言、发布才跑有限回归；见 F07 |
| Packs / renderers / geometry | GLB、VRM/GIF/rig 差异、透明命中、多屏/缩放 | 有些资产存在性判定过宽；需要负例，不宜用统一 renderer framework 掩盖差异 |

这是一个边界复杂、核心引擎选择较克制的系统。主要问题是额外路径留在运行链上，不是“文件多所以架构坏”。

## 5. Root Causes

```text
RC01 — 迁移兼容没有收缩为只读边界
  ├─ F01 新原生任务仍依赖旧文本投影
  ├─ F03 日常读取仍重复导入全部来源
  └─ F08 退役 writer/wrappers/refs 继续存在

RC02 — 投影与正式事实的提交/刷新协议不统一
  ├─ F04 SSE、catalog capability、Agent hook 各自更新部分状态
  └─ F09 RAM 先变，持久化失败后产生两种 run 事实

RC03 — 手工恢复层叠加在已有事务保证上
  └─ F02 文件级 backup/restore 引入 WAL 一致性风险，测试未覆盖该分支

RC04 — 迁移补丁被固化为构建架构
  ├─ F05 自有源码需要构建期改写才正确
  └─ F06 固定输入只在 CI 外部约定，本地准备不验证

RC05 — 验收与产品契约没有成为可重复的日常入口
  └─ F07 测试发现/隔离/平台范围、文案断言与文档漂移
```

历史文档能解释现状：P0/P4/P5 分阶段保留旧入口、临时 build 适配和多路径上下文，有合理的迁移理由。问题是新功能继续沿这些路径增长，而退役条件、事实提交顺序和统一验证没有同步完成。这里的“AI code smell”是失去职责的补丁和过期理由，不能依据注释风格推定作者或生成方式。

## 6. Findings

### F01 — 派生的旧历史文本仍能阻止原生任务完成

Severity: **High**\
Confidence: **High**\
Category: **Architecture / State**

**Location / Evidence**

- [collector.rs:227](/Users/xiao/my-project/deskmate/src-tauri/src/agent/collector.rs:227) 对原生消息调用 `save_agent_snapshot`；273–279 行每秒执行 collector。
- [archive.rs:50](/Users/xiao/my-project/deskmate/src-tauri/src/history/archive.rs:50) 把原生 user/assistant text parts 合并到旧 `history.json`。
- [collector.rs:100](/Users/xiao/my-project/deskmate/src-tauri/src/agent/collector.rs:100) 归档失败跳过后面的 reconcile/权限处理。
- [supervision.rs:117](/Users/xiao/my-project/deskmate/src-tauri/src/agent/supervision.rs:117) 对 `history_storage_failed` 只有 30 秒宽限，随后 settle/finish；[commands.rs:160](/Users/xiao/my-project/deskmate/src-tauri/src/history/commands.rs:160) 已能直接加载原生正文。

**Problem**：可重建的文本兼容投影成为执行控制的前置条件。`history.json` 写入失败足以影响健康的原生任务，而不只是历史展示。静态调用链明确；本轮未注入磁盘故障复现。

**Why It Matters**：多一份正文、多一套 merge/dedupe、多一个必须成功的存储，也多一条不可直观解释的停止路径。

**Recommendation**：先移除 archive 写入对权限同步与原生终态确认的门控；让投影失败成为独立产品错误。再停止为新 native Agent 会话持续复制正文，展示走 catalog/native reader。保留旧文本、墓碑、linked local-only 回复和已有 fallback。

**Risk**：Medium。旧 Agent 历史仍由 `useAgentHistoryView` 读取，不能整模块删除。

**Validation**：投影不可写时任务/批准/完成仍正确；验证 native/legacy 历史、续聊、跨目录相同 ID、删除不复活、本地回复和重启恢复。

### F02 — 记忆库额外恢复路径未保证 WAL 一致性，首次初始化已有竞争

Severity: **High**\
Confidence: **High**\
Category: **Complexity / State**

**Location / Evidence**

- [storage.rs:151](/Users/xiao/my-project/deskmate/src-tauri/src/memory/storage.rs:151) 中 `current >= SCHEMA_VERSION` 直接成功，未来 schema 也被接受。
- 157–175 行用 `fs::copy` 备份打开中的数据库主文件，备份失败被忽略；迁移失败后仍在打开的连接上覆盖主文件。连接启用 WAL（238 行）；各迁移已经有 IMMEDIATE transaction（193–210 行）。
- [storage.rs:409](/Users/xiao/my-project/deskmate/src-tauri/src/memory/storage.rs:409) 的“恢复备份”测试两次设 `user_version=0`，无法进入 `current > 0` 的备份分支。
- 本轮脱离沙箱的 Rust suite 复现并发首次启动失败；子进程日志明确为 `PRAGMA journal_mode = WAL: database is locked`，发生在 migration write lock 之前。不能说它没有 busy timeout：rusqlite 的连接默认 timeout 已存在。

**Problem**：文件恢复不等于 SQLite 一致快照，额外 fallback 反而扩大故障空间；配置 WAL 的竞争又不在当前迁移事务保护内。

**Why It Matters**：记忆属于用户持久数据。错误恢复、未来版本误开和初始化失败会使可选功能失效，并增加升级诊断成本。已复现的是初始化竞争；数据损坏风险属于代码分析，没有在真实数据上验证。

**Recommendation**：拒绝未来 schema；把全部待应用迁移置于同一事务，在写锁内读取版本，优先删除打开中数据库的文件回拷。现状已有逐步骤事务，建议是在此基础上减少跨步骤恢复路径。若保留升级备份要求，用 SQLite 一致快照或关闭连接后的明确协议。对初始 WAL 转换采用有界 BUSY 处理，不添加无界重试。

**Risk**：Medium。需要合成升级与并发样本，不能在用户库上试验。

**Validation**：schema 0/1/2/未来版、未 checkpoint 的 WAL、迁移中失败、并发首次启动、重开和 integrity_check。验证真实 `current > 0` 分支；保持忘记屏障和跨进程写入语义。

### F03 — Catalog 用 SQLite 保存整体 JSON 快照，普通读也触发全量写入

Severity: **Medium**\
Confidence: **High**\
Category: **Complexity**

**Location / Evidence**

- [catalog.rs:85](/Users/xiao/my-project/deskmate/src-tauri/src/history/catalog.rs:85) 的 `get(key)` 执行 `all()` 后线性查找。
- 89–109 行的 `update` 读取全部 metadata、执行 `DELETE FROM entries`、重新插入全部 rows，即使 edit 没有改变内容。
- [commands.rs:101](/Users/xiao/my-project/deskmate/src-tauri/src/history/commands.rs:101) 的 initialize 克隆历史/index 并扫描全部 RunStore；列表和内容读取分别在 117、150 行重复调用。
- native load 在 164–172 行继续 discovery update、多次 get 和 all_records；[catalog_import.rs:4](/Users/xiao/my-project/deskmate/src-tauri/src/history/catalog_import.rs:4) 的导入仍进入整表 update。

**Problem**：读操作隐含迁移、磁盘扫描和写锁，成本随会话/run 历史增长。

**Why It Matters**：多一批重建和同步路径，正常“打开一条历史”的副作用难以理解。O(N) 扫描和整表重写已经由代码确认；本轮没有测量真实用户延迟，不能宣称已存在某个毫秒级性能瓶颈。

**Recommendation**：先直接按 key 查询、跳过无变化写入；再让旧来源导入只发生于初始化/明确来源变化。变更仅更新相关 row，保留既有 SQLite 和数据形态，不另建通用 repository 框架。

**Risk**：Medium，pin/title/archive/tombstone/model selection 必须保留。

**Validation**：合成千行 catalog，比较单条打开的 SQL 写入和 RunStore 扫描次数；验证分页、迁移幂等、失败发现与组织信息保持。先测量再做缓存。

### F04 — UI 投影缺少一致的原生状态校准，发送能力被用作取消能力

Severity: **High**\
Confidence: **High**（调用链）；用户场景仍需 fixture 验收\
Category: **State / Complexity**

**Location / Evidence**

- [opencode.ts:335](/Users/xiao/my-project/deskmate/src/lib/opencode.ts:335) 的 SSE 重连只重开 `/event`，不通知恢复、不补读消息/状态；[ChatApp.tsx:973](/Users/xiao/my-project/deskmate/src/chat/ChatApp.tsx:973) 依赖 idle/error 收尾。对比 [nativeHistoryEvents.ts:64](/Users/xiao/my-project/deskmate/src/lib/nativeHistoryEvents.ts:64)，另一条 SSE 连接成功会刷新目录。
- [catalog_model.rs:190](/Users/xiao/my-project/deskmate/src-tauri/src/history/catalog_model.rs:190) 的运行中 native entry 返回 `send:false`；[ChatApp.tsx:373](/Users/xiao/my-project/deskmate/src/chat/ChatApp.tsx:373) 由此派生 readOnlyHistory，1487 行拒绝 abort，1887 行隐藏 composer/Stop。目录刷新可把自己正在执行的轻聊条目更新为该状态。
- [useAgentRun.ts:58](/Users/xiao/my-project/deskmate/src/chat/useAgentRun.ts:58) 首读空闲后没有订阅或轮询；宿主稍后启动 scheduled run 时，UI 不一定发现。已有历史恢复测试以 local projection idle 为前提，不能证明 Stop/批准也已同步。

**Problem**：UI 持有多个各自不完整的生命周期视图。断线期间的完成可能丢失；“不能发下一条”又被解释为“不能停止当前条”。

**Why It Matters**：修复通常演变成新增 timer/ref/兜底分支，重复维护原生已经拥有的事实。

**Recommendation**：复用现有 scoped snapshot/status API，在 SSE 重新连接、宿主 run 变化和 ownership 转移等事实边界校准一次；保持稳定消息 ID，绝不自动重发 prompt。分别计算 send、approve、cancel，取消继续经过宿主确认。先处理这些协议，不先抽一个新的全局状态框架或把 ChatApp 按文件长度拆散。

**Risk**：Medium，需防陈旧异步结果、重复完成和不同 session 串用。

**Validation**：断线期间完成后重连、自己的 busy 会话收到 catalog 变更、空闲 UI 后 scheduled run 启动；核对最终正文、Stop、批准、唯一完成事件与跨目录身份。没有本轮端到端复现，建议先用这些最小反例确认。

### F05 — 本仓库拥有的工作台入口仍需字符串补丁才能成为实际程序

Severity: **Medium**\
Confidence: **High**\
Category: **Architecture / Complexity**

**Location / Evidence**

- [prepare-workbench.ts:30](/Users/xiao/my-project/deskmate/scripts/prepare-workbench.ts:30) 把本仓库 tracked overlay 复制到上游 clone；51–64 行再生成 Vite config 注入 transform。
- [workbench-routing.ts:2](/Users/xiao/my-project/deskmate/scripts/workbench-routing.ts:2) 对自有入口精确替换路由、ownership、abort directory、history registration 等。
- 自有 [entry.tsx:168](/Users/xiao/my-project/deskmate/scripts/workbench-overlay/workbench/entry.tsx:168) 中 abort 不传 directory，262–265 行仍是旧路由；交付行为来自 transform 之后。
- [workbench-ownership.test.ts:9](/Users/xiao/my-project/deskmate/scripts/workbench-ownership.test.ts:9) 也读文本、改写、按标记切片，再 transpile 执行。

**Problem**：保护上游代码的迁移补丁，实际用来改写自己能够直接编辑的入口。

**Why It Matters**：格式和变量名变化能破坏构建；编辑器/typecheck 看到的不是交付程序；同一行为分散在两份源代码与测试切片规则中。

**Recommendation**：把已存在的正确路由和身份逻辑直接放进自有 overlay，通过显式 alias 引用 `session-route`；删除 transform 和专为它生成的 config 分支。保留对真实上游 API 的 Platform 适配及固定版本边界。

**Risk**：Medium；不得退回裸 session ID。

**Validation**：routing/ownership 测试改为验证实际入口行为；完整工作台构建，两个项目切换、handoff、abort、history 注册、隐藏再显示。用现有功能验收，不新增业务。

### F06 — 工作台准备依赖仓库外的隐式且未验证输入

Severity: **Medium**\
Confidence: **High**\
Category: **Other / Complexity**

**Location / Evidence**

- [prepare-workbench.ts:20](/Users/xiao/my-project/deskmate/scripts/prepare-workbench.ts:20) 接受环境路径或 sibling clone，26 行只验证 package.json 存在，没有验证 commit/版本/lock。
- 34–36 行遇到已复制且不同的自有 overlay 即报错；编辑 overlay 后不能直接重复准备同一 clone。
- [tauri.conf.json:7](/Users/xiao/my-project/deskmate/src-tauri/tauri.conf.json:7) 的 dev hook 只准备 sidecar；工作台产物被 gitignore，[workbench.rs:167](/Users/xiao/my-project/deskmate/src-tauri/src/workbench.rs:167) 总是加载它；README 的标准开发步骤没有准备工作台。
- CI 在 [release.yml:56](/Users/xiao/my-project/deskmate/.github/workflows/release.yml:56) 和 123 行各自 checkout 固定上游 commit，本地没有同等执行保证。

**Problem**：普通开发依赖之前机器留下的资源；“固定源码”在脚本中只是说明文字。当前本机有旧工作台产物，但默认 sibling source 不存在。

**Why It Matters**：前端构建通过不能证明工作台来自匹配引擎版本，新的 checkout 也不能按 README 重现完整产品。

**Recommendation**：一个明确、可重复的准备入口，校验实际源码 fingerprint；只管理自己拥有的 overlay staging；文档说明 dev/build 的工作台前置条件。不新增构建框架，不静默下载 latest。

**Risk**：Low–Medium。与 F05 共用构建 cleanup，但可分别提交。

**Validation**：新 checkout、错误 ref、修改 overlay 后再次准备、生成完整 bundle 并打开工作台。本轮未重建上游或运行 GUI，结论来自明确代码链路。

### F07 — 回归入口与产品契约漂移，尚不能作为清理基线

Severity: **High**（维护风险）\
Confidence: **High**\
Category: **Other / Complexity**

**Location / Evidence**

- [package.json](/Users/xiao/my-project/deskmate/package.json:12) 的 test 是裸 `bun test`；bunfig 只配置 DOM preload。`output/` 虽被 Git 忽略，默认测试发现仍进入旧 release source 和上游 source。本轮实际日志出现 `output/releases/.../qa-a-source/...`、`output/build-0.4.9/opencode-sparse/...`。
- Bun 无 `./` 的位置参数是匹配 pattern；连 `src/chat/...test.tsx` 也能匹配 output 下同名副本。真正单文件验证使用绝对路径。
- `mock.module` 全局替换 Tauri/其他模块；本轮真正独立进程的 chatMemory/opencode.directory 通过，组合模式出现失败；内建 `--isolate` 实验仍有模块初始化错误，不能当成现成修复。
- [release.yml:71](/Users/xiao/my-project/deskmate/.github/workflows/release.yml:71)、138–149 行只在 tag 发布运行有限测试；其余 workflow 为手动触发，无普通 push/PR 全套 gate。
- [README.md:156](/Users/xiao/my-project/deskmate/README.md:156) 仍描述手动记忆按钮及不自动保存；实际新安装 defaults 开启自动提取/归档（settings.rs:316）。D1-12 的旧动态输入限制也已被新增 bridge 改变。工作日志文案断言在独立进程及 Rust suite 中仍失败。

**Problem**：测试环境、当前产品语义、历史文档与运行命令没有一致版本。默认失败混合当前缺陷、隔离问题、旧源码及平台 fixture，不能直接解释。

**Why It Matters**：清理的核心证明是“少掉一层后行为没变”。没有可信 baseline，团队要靠逐次解释失败，或降低检查强度继续发布。

**Recommendation**：限定当前源码发现范围；对受污染模块使用独立进程或真正验证过的 fixture 隔离方式；按目标平台处理 Windows path tests；把文案字面断言改为仍有产品意义的行为契约，而不是为了绿灯删除失败测试。复用现有命令设置 push/PR gate。更新 README 的现行契约，历史决策补 superseded 条目，保留历史证据。

**Risk**：Low–Medium，测试必须保留批准、删除、来源幂等及恢复等实际保护，不能统一 skip。

**Validation**：干净 checkout 与包含 output 的维护者 checkout 执行相同测试集合；独立与组合结果有可解释差异；Mac/Windows 分别通过适用测试；push/PR 可阻断真实回归。实际本轮结果见第 12 节。

### F08 — 少量迁移 writer、前端 wrappers 和 write-only refs 已无生产职责

Severity: **Low**\
Confidence: **High**\
Category: **Dead Code**

**Location / Evidence**

- [ChatApp.tsx:237](/Users/xiao/my-project/deskmate/src/chat/ChatApp.tsx:237) 的 `nativePersistedRef` 及 425 行的 `createdRef`：所有后续出现均为赋值，没有读值或控制流用途。
- [history.ts:33](/Users/xiao/my-project/deskmate/src/lib/history.ts:33) 的 HistorySummary/historyList/historySave/historyDelete 无生产消费者；`historyLoad` 有 `useAgentHistoryView` 真实调用。
- [native_index.rs:95](/Users/xiao/my-project/deskmate/src-tauri/src/history/native_index.rs:95) 的 crate-private `upsert` 及其 persist/replace，仅由该模块测试和 migration_rollback_tests 使用；当前生产注册写 catalog，旧 index 只加载导入。

**Problem**：已经退役的职责仍看起来像当前可用写路径，读者需要额外证明它们不生效。

**Why It Matters**：收益小但确定；减少误用和未来补丁继续接到旧路径的可能。

**Recommendation**：先删两个 refs 与赋值；删除明确无消费者的前端内部 wrappers/type。旧 index writer 可以在测试改用固定旧格式 fixture 后删除。保留 reader/types、historyLoad 和 Rust 公开 IPC，不能由 wrapper 不用推出 backend 命令可删。

**Risk**：Low。测试依赖替换必须同 commit。

**Validation**：生产及测试 typecheck、历史迁移/回退/本地回复回归，重新检查动态入口和 Tauri command 注册范围。

### F09 — RunRecord 持久化失败时，RAM 已提交未落盘的新事实

Severity: **High**\
Confidence: **High**\
Category: **State**

**Location / Evidence**

- [lifecycle.rs:93](/Users/xiao/my-project/deskmate/src-tauri/src/agent/lifecycle.rs:93) 的 begin 正确先写 store，再修改 active。
- 同文件 109–117 行的 bind_session、233–245 行的 update_active 却先修改 active 再写 store。
- [lifecycle_finish.rs:61](/Users/xiao/my-project/deskmate/src-tauri/src/agent/lifecycle_finish.rs:61) 的 finish 修改终态/输入后写盘；失败时把已经修改的 record 放回 active，而非恢复原值。
- 现有生命周期 persistence-failure 测试主要覆盖 begin；不证明 bind/update/finish 的失败提交一致性。

**Problem**：返回错误后，实时 `read()` 与重读 RunStore/重启恢复能得到不同 run 状态。静态提交顺序已确认，本轮未做故障注入。

**Why It Matters**：需要更多“到底已完成还是待确认”的补偿逻辑；catalog、审批与恢复可能根据不同事实采取动作。

**Recommendation**：直接采用同一简单顺序：clone next record → persist next → assign next。保留操作锁/登记约束，不新增状态 service 或跨系统分布式事务。

**Risk**：Low–Medium，外部 session 登记仍需现有幂等与恢复语义。

**Validation**：成功 begin 后令 store 写入失败，分别调用 bind、confirm_submission、request_finish、finish；确认 RAM 和磁盘都保持最后成功状态，恢复存储后可以重试。

### 暂不进入自动清理的观察

这些是验证边界，不是额外架构改造清单。

| 观察 | Evidence / Confidence | Risk / 后续验证 |
| --- | --- | --- |
| macOS 强制 process-tree 隔离 fallback 缺口 | supervision.rs:181、214–223，非 Windows 返回 `agent_process_isolation_unavailable`；代码证据 High，场景未复现 | 原生 settle 失败后的 pending/取消体验需隔离实机验证。不能通过删除监督层解决 |
| 一个 message 的多个 text parts 展示身份不一致 | commands.rs:165–167 按 part 输出；ChatApp:1554 优先 messageId、:540 按 message 更新；Agent helper 优先 partId | 合成两个 text parts 验证 live/reopen 一致；无需因此整体重写消息模型 |
| GLB pack 缺必要模型也可能被认为 ready | prepare-personas.ts:47–53/128–135、pack-figure2d.ts:13–15、pack-personas.ts:89–92、packs/figure2d.rs:56–64；静态 High | metadata-only/缺模型负例与已发布合法旧包验证后，在现有 GLB 分支收紧；没有删除角色或新建泛型 validator 的理由 |

## 7. Deletion Candidates

只有 **High confidence** 项可进入删除准备；“可进入”仍是后续人工确认后的 cleanup，本轮未删除。

| Candidate | Evidence | Confidence | Risk | Validation |
| --- | --- | --- | --- | --- |
| 两个 write-only refs 及赋值 | F08；无读取/副作用 | High | Low | typecheck + reset/resume/local reply tests |
| HistorySummary、historyList/historySave/historyDelete 前端内部 exports | F08；非包公开 API、无 production caller；dynamic/framework/IPC 区别已核对 | High | Low | typecheck + unified/legacy history；保留 backend IPC/historyLoad |
| 旧 native index writer/persist/replace | F08；仅测试调用，生产注册已走 catalog | High | Low | 固定 fixture 导入/回退；保留旧 index reader |
| 自有入口的 routing 文本 transform 和专用 generated config | F05；能直接编辑原源码 | High | Medium | 必须先把交付行为写回入口，完整 workbench 验收后删除 |
| 运行中 WAL 数据库的文件回拷 fallback | F02；已有事务边界，现有测试未触达 backup 分支 | High（风险/冗余路径证据） | Medium | 事务失败、旧版升级/WAL/并发反例通过后删除；不是今天直接移除备份政策 |
| 整个 legacy history 模块、两条上下文注入、某个 renderer、独立 CLI | 都有真实 caller/兼容/作者入口，或尚无等价证据 | Low（可删除性） | High | **不建议删除** |

没有把“rg 没搜到 import”单独作为删除证据。角色资源通过 runtime discovery、Tauri resources、pack manifest 使用；devtools 是动态导入；authoring/QA CLI 本身就是入口。

## 8. Simplification Candidates

### 8.1 自有工作台源码（F05）

```text
Current: owned entry → 精确文本替换 → generated Vite config → Vite
Proposed: owned entry（真实行为）+ 显式 shared-module alias → Vite
```

替换层和专用 config 没有保护不能编辑的上游文件，只增加第二份行为定义。保留 Platform bridge。

### 8.2 新原生 Agent 历史（F01）

```text
Current: native snapshot → 必须写 legacy JSON → reconcile/permissions → UI
Proposed: native snapshot → reconcile/permissions → UI
          legacy/local-only reader 独立保留
```

旧文本复制不应决定原生运行能否继续。先解耦失败，再收窄持续写入。

### 8.3 Catalog 内容读取（F03）

```text
Current: load → 全量来源导入/JSON scan → 整表重写 → all-row get → native read
Proposed: 来源变动时 import → load → SELECT key → native read
```

重复迁移和整表重建没有为单条读取提供额外语义；保留身份、组织信息和墓碑。

### 8.4 RunRecord 更新（F09）

```text
Current: mutate active → persist → failure 时保留已经变更的 active
Proposed: clone next → persist next → assign next
```

减少错误后的补偿状态，不增加抽象。

### 8.5 记忆库初始化（F02）

```text
Current: open/WAL → 主文件 copy → 分步 migration → live-file restore fallback
Proposed: 明确的 open/WAL 协议 → 版本校验 + transaction → success/error
```

如升级备份确有产品要求，作为一致快照保留，不能伪装为事务回滚。

## 9. KEEP AS-IS

- **单个受管 OpenCode 引擎**：不用自造 planner/tool registry/event runtime，也不直接写原生数据库。
- **完整复合身份与 generation guard**：directory/session/sidecar 共同校验、异步结果过期丢弃、permission provenance 防串用。删 guard 的风险大于代码节省。
- **权限分层、停止确认、workbench 租约**：隔离界面输入与工具授权是两种职责，不能仅因多层就合成 allow-all。目录策略也不能宣称是 OS sandbox。
- **MemoryRepository / WorklogRepository / CollectorActions / RunnerEnvironment**：承担事务、出处、幂等、故障/竞态测试边界，有真实价值；单实现不等于多余。
- **记忆与工作日志两库及自动分支 epoch/回执**：没有跨库原子提交就需要部分成功恢复。两者不宜合成一个“通用知识仓储”。
- **legacy reader、墓碑、local-only 回复及 pack schema 兼容**：仍服务已经安装的数据和真实产品行为。
- **附件 typed boundary、opaque ID 与 operation token**：拦截 wire 格式、原生路径和过期操作，不是无意义 wrapper。两种附件路径仍承担不同能力。
- **渲染器差异及几何/透明命中**：GLB/GIF/rig、native scale 与 multi-display 的复杂度有真实平台来源；没有性能证据，不新增统一 renderer hierarchy。
- **两条上下文注入暂保留**：新 bridge 已可读最新用户正文，旧 D1-12 理由需更新，但 frontend 路径还包含语言、称呼、实时信息和工作日志政策。先做等价校验，不能直接删。
- **成熟依赖**：three/three-vrm 处理模型，mammoth/pdfjs 延迟处理文档，react-markdown/remark-gfm/remend 处理流式 Markdown，opencode-ai 是构建期二进制输入。devtools 经 DEV 分支动态导入，production exclusion 测试有价值。没有证据支持自行重写这些库。
- **分阶段发布 gate**：Apple 签名公证、portable dependency 验证、Actions updater 签名、公开下载/feed 回读具有不同权限与信任边界，不压缩成“CI 绿了就发布”。本轮不调用发布流程。

## 10. Top 5 Highest-Leverage Changes

排序按 `Impact × Confidence ÷ Risk`。Impact/Risk 为 1–5 的相对审计估计，Confidence High=1、Medium=0.6；不是测量所得的经济回报。Phase 0 的 baseline 优先于任何 cleanup。

| Rank | Change | Findings / root cause | Impact | Confidence | Risk | Score |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1 | 固定当前源码测试范围、验证隔离方案、处理真正失败，形成日常 gate | F07 / RC05 | 5 | 1 | 2 | 2.50 |
| 2 | 删除对自有 workbench entry 的文本改写，源码直接表达交付行为 | F05，顺带收窄 F06 / RC04 | 4 | 1 | 2 | 2.00 |
| 3 | RunRecord 全部采用 persist-before-assign 的提交顺序 | F09 / RC02 | 4 | 1 | 2 | 2.00 |
| 4 | 将旧历史投影写失败从原生任务控制路径移出 | F01 / RC01 | 5 | 1 | 3 | 1.67 |
| 5 | 简化并明确记忆库初始化/升级协议，移除不一致文件恢复 | F02 / RC03 | 5 | 1 | 3 | 1.67 |

F04 的重连/取消能力校准必须先做小反例验证，随后优先处理，估计 4×1÷3=1.33。F03 有确定额外工作量，但没有真实延迟基准，估计 3×1÷3=1.00；先做按 key 查询/no-op 检查，避免过早加入 cache。F08 可夹在独立的小型删除 commit 中，但不应以节省几十行替代上述根因工作。

## 11. Target Architecture

**No major restructuring recommended.** 保留现有顶层产品模块、Tauri/React/OpenCode/SQLite，收窄职责即可。

```text
轻聊 / Agent UI / 工作台
          |
现有 scoped native APIs + host permission/lifecycle
          |
单个 OpenCode ───── 原生消息/工具/执行事实

YUME 仅持有自己独有的事实
  ├─ RunRecord：持久化成功后发布 RAM/UI 状态
  ├─ Catalog：组织元数据/模型选择，按 key 读写
  ├─ Settings + keyring
  ├─ Local-only replies + read-only legacy import
  └─ Memory / Worklog：各自事务、来源与幂等
```

工作台构建：一个经过校验的固定源码输入 + 直接可读的自有 overlay + 原有 Vite；不再需要为自有逻辑准备源码改写器。

这不是要移除所有投影或缓存。UI 可以持有视图，catalog 可以保存产品元数据；要求是它们的提交/刷新规则明确，不能变成原生正文或执行结果的第二个权威。

## 12. Cleanup Roadmap

### Phase 0 — Baseline

先建立清理前可重复的证据，不把已知红灯当作通过，也不归咎全部失败于产品。

| 本轮检查 | 实际结果 / 边界 |
| --- | --- |
| Typecheck | 生产和测试两份 TypeScript 配置通过，使用现有 TypeScript via Node |
| Frontend build | `BUN_BE_BUN=1 .../opencode run build` 通过；有既存大 chunk 提示；不等于完整上游工作台重新构建 |
| Rust library suite（脱离沙箱、本地 HTTP fixture 可绑定） | **764 pass / 8 fail / 11 ignored**。6 项 Windows path fixtures 在 Mac 失败；1 项并发首次 memory open 失败于 WAL 锁；1 项 worklog tool 文案 marker 断言失败。keyring fixture 在该上下文通过 |
| 默认 Bun suite | 发现 output 旧源码/上游测试，主动终止，**无有效当前源码全套结论**；初次沙箱运行另有 loopback 拒绝及 fixture 等待 |
| 当前 153 个文件的绝对路径 + Bun `--isolate` 实验 | **1114 pass / 68 fail / 1 skip**，没有 output 副本；存在模块初始化错误，不能作为已解决 mock 污染的方案 |
| 真正单文件独立进程抽查 | chatMemory **8/8**、opencode.directory **4/4**；AiProviderList **2 pass/1 fail**、WorklogReceipt **8 pass/1 fail**，后两者不是只在组合时失败 |
| 当前源码逐文件独立进程全套 | **151/153 个文件返回成功**；逐进程累计 **1180 pass / 2 fail / 1 skip**。失败为 AiProviderList 与 WorklogReceipt 各 1 项；仅选当前 src/scripts 和根 Vite 配置，不使用 substring filter。built-in persona boundary 3/3 通过 |
| Lint | package scripts 没有 lint gate；未安装 lint 工具或临时引入规则，不能报告 lint 通过 |
| Native Windows / full workbench / real provider / release | 本轮未执行；旧验收文档不作为本轮通过证据 |

独立前端失败的具体差异：AiProviderList 对完整对象的断言不接受新 provider 多出的 `manualModelIds: ""`；WorklogReceipt 仍要求提示词包含已移除按钮的固定文案。它们需依据现行产品契约修正，而不是据此断言应用按钮或 provider 切换已失效。Rust worklog marker 失败也属于提示词契约漂移；并发 WAL open 失败则已有实际存储错误证据。各类失败应分别处理。

验证使用仓库已有 OpenCode binary 内置 Bun 1.3.14（`BUN_BE_BUN=1`）、本机 Node 与离线 Cargo。始终指定 `DEVELOPER_DIR=/Library/Developer/CommandLineTools`，未修改系统 Xcode 选择/许可。Rust target 和主要诊断日志在 `/private/tmp/yume-deep-audit-*`；Vite/已有测试产生的是 ignored 构建产物。本轮未加入依赖。

后续 baseline commit：限定测试发现；修复平台 fixture 和仍有效的失败契约；选择已证明的 module isolation；对 F01/F02/F04/F09 的错误路径加入必要反例。测试源码文本不是完整行为证明，不能用增加 marker 断言替代真实链路。

### Phase 1 — Safe Deletion

1. 单独 commit 删除 write-only refs、无 caller 的前端内部 wrappers/type。
2. 单独 commit 把旧 index migration 测试改为固定 fixture，再删退役 writer，保留 reader。

验证：typecheck、聊天/历史/迁移测试。Rollback：revert 对应 commit；不改数据、不触发重新迁移。

### Phase 2 — Consolidation

1. 自有 workbench entry 直接包含现有行为，删除 transform/config 分支；另一个 commit 明确固定输入与可重复 staging。
2. RunRecord 统一提交顺序，保留现有 API 和锁；故障注入同 commit。

验证：完整工作台及 scoped handoff/abort，RunStore 写失败的 RAM/磁盘一致性。Rollback：各自 revert；不升级 OpenCode。

### Phase 3 — Simplification

1. 先解除 archive 对 collector reconcile/permissions 的门控，再独立停止新原生会话的持续文本投影。
2. 记忆初始化/迁移移除不一致 fallback，并验证旧数据、WAL 和并发启动。
3. UI 在明确原生变化边界校准状态，拆开 send/cancel/approve 判断；不用增加全局 manager。

验证：真实副作用的合成失败场景、旧文本与 local reply、停止/恢复及忘记屏障。Rollback：每一步独立 revert；旧数据保持不变，不清库、不重放 prompt。

### Phase 4 — Architecture Cleanup

只在计数/反例证明收益后，将 catalog full import/full rewrite 从读路径移出；按 key 查询及 changed-row 写入先行。其余目录拆分、统一 renderer、SDK 全量替换、通用数据库/事件框架都不在建议范围。

验证：千行合成 catalog 的扫描/SQL 次数、组织信息/模型选择/墓碑保持、native 与 legacy 读取。Rollback：不改变数据格式时可独立 revert；任何以后新增 migration 必须另行设计回退边界。

每项应独立 commit、独立测试、可 rollback，不混新功能。本轮到 AUDIT.md 为止；进入 cleanup/refactor 需要人工确认。

## 13. 最终必须回答

1. **真正的核心是什么？** 桌面陪伴与工作入口、一个受管 OpenCode 引擎、复合会话身份、宿主权限/生命周期和可信本地产品数据。
2. **最大 complexity tax 来自哪里？** 迁移兼容仍参与新原生运行和普通历史读取，多份投影与多条补偿路径需要同时维护。
3. **哪些是 Essential？** 本机工具批准、目录/session scope、取消确认、崩溃恢复、旧数据兼容、记忆/日志删除与幂等、不同渲染平台、签名公证。
4. **哪些是 Accidental？** 自有源码字符串补丁、反复全量导入/整表改写、旧投影门控、失败后 RAM/磁盘分歧、运行中数据库主文件恢复、失去职责的 writer/refs，以及不受控测试发现。
5. **最应该删除什么？** 可以先删两个 write-only refs、无 caller 的内部 wrappers 和退役 index writer；最高杠杆删除是先保留等价行为再移除自有源码 transform 和新原生正文持续投影。
6. **哪些 abstraction 最值得消失？** 对自有 entry 的 transform/generated-config 链，以及把一致性事务包装成文件 copy/restore 的恢复层；不是实际承担领域事务的 Repository。
7. **是否存在多个 Source of Truth？** 已确认 RunRecord RAM/磁盘提交失败后出现事实分歧，UI 部分事实也不能统一刷新。原生文本投影更准确是额外执行失败依赖；当前 catalog reader 仍优先读取原生正文，未证明它把旧投影当作竞争的正文权威。设置草稿、展示缓存、独立 memory/worklog 本身不是同一事实的重复 owner。
8. **当前 architecture 是否仍匹配产品？** 主边界匹配；迁移期中间层没有完全退役。无需重写或大规模重组。
9. **最高 ROI 修改有哪些？** 可信日常测试入口、自有 workbench 源码直接化、RunRecord 提交顺序、旧投影与原生任务解耦、记忆初始化/迁移简化。F04 紧随其后。
10. **什么都不改，最大的长期风险是什么？** 每次增量能力都会增加更多同步与恢复分支，而团队无法用稳定回归证明所有路径一致；最终表现为无法停止/恢复的任务、升级数据风险及维护者依赖机器历史状态才能构建发布。
