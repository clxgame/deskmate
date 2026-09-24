# 数据归属、迁移与回退边界

记录时间：2026-09-22 · 阶段：P0
原则：每种事实一个权威来源（审计 K3）；结构/统计核查，不输出私人内容；生产数据迁移、破坏性操作未获授权。

## 1. 数据归属矩阵

| 数据 | 位置 | 权威 owner | 形态与语义 |
| --- | --- | --- | --- |
| 原生会话/消息/part/工具结果 | `opencode-home/xdg-data/opencode/opencode.db`（SQLite+WAL，实测 9.2MB+4.2MB） | OpenCode sidecar（1.18.21） | 完整执行事实；YUME 只读引用，不另存正文 |
| 原生日志 | `opencode-home/xdg-data/opencode/log/` | OpenCode | sidecar 运行日志 |
| 原生工具大输出 | `opencode-home/xdg-data/opencode/tool-output/` | OpenCode | 工具输出溢出存储 |
| 原生克隆缓存 | `opencode-home/xdg-data/opencode/repos/` | OpenCode | 仓库缓存 |
| 原生全局配置 | `opencode-home/xdg-config/opencode/opencode.jsonc`（50B，仅 $schema） | YUME 宿主管理（用户当前无实质配置） | 配置加载顺序：config.json→opencode.json→opencode.jsonc→项目级 .opencode/opencode.json[c]（sidecar.log 实证） |
| 项目级配置 | `<工作目录>/.opencode/opencode.json[c]`；内置工具装于 `workspace/.opencode/tools` | YUME（workspace 为 sidecar 固定 cwd） | 更换工作目录影响工具加载（审计 [E9][E19]） |
| 旧聊天历史 | `<appData>/history.json`（99,949B） | YUME `history.rs` | 文本投影 JSON 数组；现有 `origin_run_id`、`deleted` 墓碑、renderer/agent 所有权区分；agent-owned 拒绝编辑、删除走墓碑（清空 title/messages + deleted=true）；archive 按 message/part ID 幂等 upsert；recovery 可经 RunRecord 关联从受管服务懒加载 |
| 运行元数据 | `<appData>/agent-runs/<run_id>.json` | YUME `agent/record_store.rs` | RunRecord：run_id/session_id?/workspace_path/起止/outcome/pending/message-part-call 关联/initial_input；临时文件+rename 原子写；**是元数据，不是消息真相** |
| 用户记忆 | `<appData>/deskmate-memory.db`（114,688B+shm/wal） | YUME `memory/` | 硬删除语义（内容+出处+索引移除、WAL flush，仅留无内容审计记录）；每请求最多 8 条/1200 字符 |
| 工作日志/报表 | `<appData>/yume-worklog.db`（4,096B+494,432B WAL） | YUME `worklog/` | 条目/报表/版本/调度；删除会话不删报表；手工编辑保护 |
| YUME 设置 | `<appData>/settings.json`（1,775B） | YUME `settings.rs` | 含 tool_permissions 模式与 agent_permission_approvals（workspace+permission+pattern 记忆批准） |
| sidecar 日志 | `<appData>/sidecar.log` | YUME 宿主 | 当前含"server is unsecured"警告 |
| 角色资产 | `personas/`（25 内置）、`packs/`（3 导入包）、`skills/`（xiaozhu 三代） | YUME `packs/` | asset protocol 作用域仅限 `$APPDATA/packs/**/*` |
| 模型目录缓存 | `model-catalogs/` | YUME | 缓存，可重建 |
| ccswitch 恢复 | `ccswitch-recovery/` | YUME | 待该业务 owner 进一步说明 |
| worklog IPC | `worklog-ipc/`（含 per-run UUID 目录） | YUME worklog | 报表运行 IPC |
| 定时任务工作区 | `scheduled-agent-workspace/` | YUME 宿主 | sidecar 内独立 project instance（sidecar.log 实证） |
| 交互工作区 | `workspace/` | YUME 宿主（cwd），OpenCode 读写 | 含 `.opencode/tools`、`.codegraph`、`.omo` |

`<appData>` = `%APPDATA%\com.deskmate.desktop`（Windows 实测根）。

## 2. 删除与保留语义（迁移必须保持）

| 语义 | 现状 | 迁移约束 |
| --- | --- | --- |
| 普通会话删除 | 物理移除（renderer-owned） | 原生历史优先后，旧文本删除语义不回归 |
| agent 会话删除 | 墓碑（deleted=true，清空 title/messages） | P4 迁移幂等，墓碑不复活 |
| 记忆遗忘 | 硬删除 + WAL flush + 无内容审计记录 | 不进入任何原生/派生存储 |
| 报表删除 | 条目标记依赖报表并可级联；已导出文件与日志不抹除 | 保持 |
| 原生 opencode.db | OpenCode 自有生命周期 | **YUME 不直接写**；旧二进制不得写新版格式库（P4 回退边界） |

## 3. 迁移边界（P4 预研，P0 仅记录）

- **UI 入口回退与数据库降级分开设计**（施工 Prompt §9.3）。
- 旧会话恢复：原生历史仍在 → 恢复关联；只剩纯文本 → 展示为旧版文本记录，不伪造工具内容。
- 迁移幂等：以原生 message/part ID 与 origin_run_id 为键；重复迁移不增条目。
- 非模型产生的 YUME 本地提示保留在 YUME 产品数据中，不伪装成原生模型消息。
- 回退禁止：用旧备份覆盖当前数据导致新增原生会话丢失。
- 真实用户数据迁移预演只能用受控副本或合成样本；本阶段未做任何迁移，仅结构核查。

## 4. 并行施工边界

- `.tmp/`、`src-tauri/src/agent/**` 的未提交修改、`scripts/agent-qa/*`、`src/chat/useAgentRun*` 属并行 agent-hang 任务，本任务只读引用其状态，不修改、不重置、不 stash。
- 本任务写入范围：`docs/migrations/opencode-native/`（P0 阶段唯一写入面）。

## 5. 凭证边界

- 受管 OpenCode 服务当前**无鉴权**运行（`OPENCODE_SERVER_PASSWORD is not set`）。
- 目标态（§3.3）：凭证由宿主管理，经受限桥接完成连接初始化；不进 URL/日志/截图/localStorage；HTTP、事件流、WebSocket 三通道分别证明认证可用。
- 本机 `opencode-home` 配置目录当前无凭证文件（OPENCODE_AUTH_CONTENT 由宿主按需注入环境，不落盘——待 P1 核实注入路径与生命周期）。

## 6. P4 已落地的数据边界与回退策略（2026-09-23）

- 新增 `<appData>/native-session-index.json`，仅含稳定 session 关联元数据，不含消息正文、tool part 或工具输出；原生事实仍只在 OpenCode 数据库。
- 索引按 session ID 幂等 upsert。单元测试与真实 QA 均证明重复登记不增加条目，`createdAt` 保持、`updatedAt` 前移。
- 旧 `history.json` 的纯文本会话仍按原结构读取，不合成 tool part；agent-owned 删除墓碑逻辑未改变，现有重复 message/part 去重与墓碑测试继续覆盖。
- UI 入口回退：关闭/隐藏工作台后轻聊继续使用原 session；原生索引与 OpenCode 数据均保留，不重放对话。此操作不等于数据库降级。
- 数据库降级：禁止旧 OpenCode 二进制直接写当前数据库。升级若引入不兼容格式，只允许对隔离副本执行经验证的导出/恢复；无法无损转换时明确标记“不支持原地降级”，保留当前数据库只读副本与新版入口。
- 合成数据回退演练已完成，未读取或改写生产数据。样本同时包含完整 native session、纯文本旧 session、已删除 agent-owned session、新 native session、重复 message/part 与两个中断写残留；二次迁移条目数 4→4，墓碑未复活，旧文本未出现伪造 message/part ID，重复原生文本按 message/part ID 折叠。
- UI 入口回退演练：模拟旧 UI 仅写 `history.json` 的本地提示后，`native-session-index.json` 字节保持不变，新增原生 workbench 记录仍在，未进行对话重放。旧 UI 不理解的完整工具事实继续由原生工作台读取，不降格复制进文本投影。
- 数据库降级演练：创建合成新版 SQLite，复制到隔离目录后仅以 `SQLITE_OPEN_READ_ONLY` 探测；当前源库前后 SHA-256 均为 `7eb722579852f2b4d21ed5c9b8652d10fff778646ad4238aa9bbab443fce4627`。这证明回退流程不会让旧二进制写当前库；不代表任意未来格式可无损降级，无法验证转换时必须保留新版入口与只读副本。
- 证据：`artifacts/opencode-native/p4-2026-09-23T04-44-46-036-data-rollback/data-rollback.json`；回归测试：`history::history_tests::migration_rollback_tests::synthetic_migration_and_separate_rollback_rehearsal_is_idempotent`。

## 7. P6 隔离 QA 安装/卸装回退演练（2026-09-23）

- 测试对象仅为 `com.deskmate.worklogqa`、NSIS `YUME Worklog QA_0.4.3_x64-setup.exe`，安装目录经绝对路径核验限定在工作区 `artifacts/opencode-native/p6-qa-install/current/`；生产 `YUME` v0.4.8 的注册表项和目录未改。
- 首次安装后从**安装目录**启动，工作台、轻聊、设置真实渲染，受管 sidecar 自报 1.18.21。关闭 QA 进程后做同版本重装；再调用 QA 目录内 `uninstall.exe /S`，确认仅 QA 二进制目录与 QA 注册表项消失；最后同包重新安装，候选仍留在上述路径。
- 三个 QA 数据文件始终保留且哈希不变：`history.json` = `9586DA51DAB1088D3586F46C556BCE84F02AC7063A388ABD45A9212A11A791AD`；`native-session-index.json` = `97D01B2B0B5CC4D0D3AD782F3F76A969DD98E1D6A218B27663D2EC87690C1A1B`；`settings.json` = `A1819540791D1DA84ACEC1BC616163FF526F9D3D5C474758BD0478E5AB0A8E7D`。只做文件哈希核对，未输出数据内容。
- 关闭测试版应用使用精确 PID、安装路径和启动时间核对；强制停主进程后其两个 QA 路径下子进程未自动退出，随后按实际父子链与安装路径精确清理。该操作不等同用户正常退出，不据此判产品退出失败；卸装前确认 QA 进程全无。未按通用进程名批量结束，也未接触生产进程。
- 这是安装/同版修复/卸装入口的演练，**不是**不同版本升级，也不是数据库格式降级。仍需使用独立旧版与新版 QA 包、隔离数据副本执行跨版本恢复；D4-5 的“旧 sidecar 不直接写当前库”继续生效。正式签名/manifest 缺失时不执行真实自动更新路径。
