# 桌面附件拖拽与媒体预览回归

## 修复边界

配置文件创建的聊天 `WebviewWindow` 在当前锁定的 Tauri runtime-wry 2.11.4 中，将原生拖拽转换为 `WindowEvent::DragDrop`。此前监听 `WebviewEvent` 收不到该事件；原生处理器又已接管拖拽，DOM `drop` 不能兜底。入口改为窗口事件后，仍沿用原有资源登记、会话隔离和预览流程。

媒体读取继续运行在后台阻塞线程；只有 `chat-resource` 的响应投递切回主线程，与 WebKit 的请求取消串行执行。发布配置使用 `panic = "unwind"`：当前 Wry 0.55.1 通过 `objc2::exception::catch` 防护已取消的 `WKURLSchemeTask`，而 objc2 0.6.4 明确不支持在 `panic=abort` 下捕获该异常。不能仅通过开发版或 HTTP Range 单元测试判断此问题已消失。

## 自动化检查

```sh
bun test src/chat/dragDropConfig.test.ts src/chat/localResources.test.ts src/chat/useLocalResources.test.tsx src/chat/LocalResourceTray.test.tsx src/chat/MediaPreview.test.tsx src/chat/nativeResourceFlow.test.tsx
DEVELOPER_DIR=/Library/Developer/CommandLineTools cargo test --locked --manifest-path src-tauri/Cargo.toml --lib chat_attachments::resources
bun run typecheck
bun run build
```

前端测试注入的 `chat-resources-dropped` 事件只能验证事件到达后的行为，不能替代下面的原生拖拽验收。Rust 预览测试同样不会运行 WebKit 的请求取消流程。

## 原生发布模式检查

使用独立 QA 应用标识及 `worklog-qa` feature 构建 release 包；不要覆盖正式应用或复用其数据、凭据。至少准备约 22 MB、可解码的 MP4，MP3、WAV 和含测试文本的文件夹。

1. 从 Finder 或仅提供合成文件的独立原生拖拽窗口，将各类文件及文件夹拖入聊天正文和输入区域。确认卡片出现；文件夹应显示内容入口，而非 `Audio 0 B`。不能用直接发送前端自定义事件代替这一步。
2. 用加号添加同一个 MP4，播放至结束，再前后跳转并恢复播放。重复快速拖动进度条，以覆盖 Range 请求取消及重新读取。
3. 播放中移除测试附件、切换会话，再次添加并播放。应用应继续响应，不产生新的崩溃报告。
4. 分别播放 MP3、WAV，检查暂停及进度控制。无法解码的文件应保留附件并提示预览不可用，不能退出应用。
5. 核对 QA 资源库和界面，仅凭系统拖拽源返回“复制成功”不足以判定附件已经进入聊天。

## 2026-09-28 本机记录

- 用户随后实机确认“文件夹可以拖拽”，文件夹拖入验收通过。这一确认不扩大为 MP4、MP3、WAV 逐项拖入或快速跳转压力测试已通过。
- 前端附件相关 50 项、Rust 资源相关 11 项测试通过；应用与测试 TypeScript 检查、前端构建、macOS release QA 构建通过。
- QA 标识：`com.deskmate.unifiedhistoryqa.resourcefix20260928`。没有修改或安装正式 `/Applications/YUME.app`。
- 合成 MP4：22,617,549 字节，H.264，640×360，30 秒。通过原生加号选择器添加后，完整播放、再次播放、回退及前进 15 秒正常；检查时未新增 YUME 崩溃报告。
- 用户解锁后重新启动 QA 应用，再次通过原生选择器同时加入 MP4、MP3、WAV。视频完整播放至 30 秒；MP3 完整播放至 10 秒，WAV 完整播放至 8 秒；原生播放器均恢复为播放按钮。检查崩溃目录仍仅有修复前的 `yume-2026-09-28-153628.ips`。
- MP3 是合成静音样本，已用 macOS `afconvert` 验证能解码为 460,800 帧、44,100 Hz、双声道 PCM。样本保留在 `/private/tmp/yume-attachment-qa-20260928/fixtures/`；诊断包位于 `src-tauri/target/release/bundle/macos/YUME Attachment QA.app`。
- 自动化阶段未能确认原生外部拖拽。完整 Finder 状态读取被自动审批拦截，原因是可能包含测试目录以外的私人文件夹名称。改用仅提供合成文件的独立 AppKit 拖拽源（同时提供文件 URL 和 `NSFilenamesPboardType`），系统返回复制操作，但 QA 标题、附件卡片和资源库未确认新附件，不能将拖拽源返回值当成成功。文件夹最终以用户手动验收结果为准。
- 桌面工具对视频进度条拖动报 `windowNotFoundAtPosition`。普通点击有时成功，但跨窗口落点仍不可靠；已请用户在 QA 窗口手动核验。快速拖动进度条、播放中移除仍未完成原生验收；完整播放和跳转按钮验证不等价于取消请求压力测试。
- QA 包在窗口标题显示原生拖拽阶段和文件数量（仅 `worklog-qa` feature，不显示文件路径）。曾临时取消聊天窗口置顶以排除自动化定位干扰，未改变仓库的正式窗口配置。最终 QA 构建已恢复正式聊天窗口的尺寸、位置、置顶、任务栏、缩放、可见性和焦点属性；release 构建在 18:23 左右成功完成，用时 6 分 17 秒。
- 最终包构建后尝试退出旧 QA 进程再启动时，桌面工具再次明确报告 Mac 已锁定，无法自动解锁。该次自动化重启未确认执行；用户随后确认了文件夹拖入。剩余验收为媒体文件逐项拖入、快速跳转及播放中移除；继续时退出旧 QA、打开上述最终包，点击桌宠进入会话，无须重复构建。构建日志：`/private/tmp/yume-attachment-qa-20260928/final-window-build.log`。
