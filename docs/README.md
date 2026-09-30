# YUME 文档入口

当前规则和历史证据分别维护。功能或操作入口发生变化时，更新下表对应的现行文档；阶段记录保留原基线、结果和未验边界。最近核对：2026-09-30，YUME 0.4.16 / OpenCode 1.18.21。

## 当前产品与维护契约

| 入口 | 职责 |
| --- | --- |
| [项目 README](../README.md) | 安装、功能、开发命令与用户可见行为 |
| [仓库 AI 入口](../AGENTS.md) | 本仓维护和发布约定 |
| [设计规范](../DESIGN.md) | 主题、组件与交互原则 |
| [模型连接与用量](ai-provider-support.md) | 模型发现、实际调用验证和用量来源 |
| [记忆与工作日志](memory-and-worklog.md) | 自动处理、开关、数据归属、删除及恢复 |
| [本地附件](local-resource-attachments.md) | 原生选择、图片/文件/媒体预览与资源权限 |
| [附件原生回归](attachment-native-regression.md) | 拖拽、WebKit 播放与取消请求的实机 gate |
| [统一历史契约](migrations/opencode-native/unified-history-contract.md) | 会话身份、模型偏好、空白记录、组织操作与共享入口 |
| [工作台构建](workbench-build.md) | 当前固定输入、生成物、完整重建与已知限制 |
| [维护与验收脚本](../scripts/README.md) | 构建/作者/QA/发布 CLI 的职责、输入输出、平台和退出条件 |
| [原生能力矩阵](migrations/opencode-native/capabilities.md) | 固定引擎能力与带日期的运行证据；未验证项明确保留 |
| [架构决策](migrations/opencode-native/decisions.md) | 有效决定、被替代的理由和重审条件 |
| [本机发布指南](local-release-runbook.md) | 本机保存、提交、push、签名公证、发布完整流程 |
| [macOS release gate](macos-release.md) | 分发信任、包验证和 Apple/updater 签名边界 |
| [macOS runtime checks](macos-runtime-checks.md) | 更新按钮当前规则、真实 App/硬件和 A→B 升级验收 |

## 活动工作与验收

| 入口 | 当前责任 |
| --- | --- |
| [仓库审计](../AUDIT.md) | 2026-09-30 基线 findings；历史基线不等于当前缺陷均仍存在 |
| [审计整改方案](audit-remediation-construction-plan.md) / [施工进度](audit-remediation-progress.md) | 运行、记忆库、UI、工作台和历史简化的实施依赖与真实结果 |
| [文件清理方案](repository-cleanup-plan.md) / [执行进度](repository-cleanup-progress.md) | 文件全集、用途判定、实际处理与条件项 |
| [当前验收与待办](verification-backlog.md) | 现行验证命令及从旧计划提取的未完成事项 |
| [自动处理验收记录](automatic-memory-verification.md) | 已实现行为、合成联调和未完成真实模型语义验收 |

## 历史与发行说明

[历史记录索引](archive/README.md) 保留旧设计、基线、阶段回执与独有证据。旧记录中的“当前 / 下一步 / 未发布”和凭据阻塞不作为今天的状态或操作指令；未完成事项已列入当前验收入口。

发行说明按原版本保留：[0.4.10](release-v0.4.10.md)、[0.4.11](release-v0.4.11.md)、[0.4.12](release-v0.4.12.md)、[0.4.13](release-v0.4.13.md)、[0.4.14](release-v0.4.14.md)、[0.4.15](release-v0.4.15.md)、[0.4.16](release-v0.4.16.md)、[0.4.17](release-v0.4.17.md)。其中的测试数和待发布说明对应该次准备时点；公开状态与安装资产须按发布指南重新核验。
