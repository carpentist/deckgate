# Deckgate — 阶段一：技术验证与架构设计

> 状态：已基于本机真实运行验证。未实测的项目均在文中显式标注。
> 验证日期：2026-10-28
> 目标版本：Claude Code 2.1.126（Windows 原生安装版）
>
> 后续变更（0.1.2）：新增默认关闭的“全部自动授权”高风险开关，启用需原生警告确认；不写入 `.claude` 权限规则，但会对普通工具权限请求直接放行。默认行为仍是不自动批准。完整现状以 `README.md` 为准。

---

## 0. 结论摘要

可行性结论：**成立**。Claude Code 的 Hooks 能提供可靠的事件流，配合 `session_id` 可以实现多会话监控；Windows 通知、托盘、进程探测均有成熟方案。

同时确认了 4 个必须围绕设计的硬限制：

1. **Hooks 在会话启动时快照**。应用安装 Hooks 之前已经运行的会话不会产生事件，必须引导用户重启会话，或依赖会话元数据文件做降级展示。
2. **无法可靠识别“原终端窗口/标签页”**。实测 `claude.exe` 的父进程是 `explorer.exe`，父进程链不能用于定位 Windows Terminal 标签页。产品不提供“切换到原终端”，只提供“复制会话 ID / 打开工作目录 / 请回到原终端处理”。
3. **`Stop` ≠ 进程退出，`SessionEnd` ≠ 失败**。必须用独立的状态机区分“回合结束”“会话结束”“进程死亡”。
4. **正常完成 60 秒后也会收到“等待输入”通知**（`notification_type: idle_prompt`）。若直接映射为 `WAITING_INPUT` 会产生误报，状态机必须按前序事件区分。

另一个重要收益：`~/.claude/sessions/<pid>.json` 在本机实时维护 `pid/sessionId/cwd/status(waiting|busy|idle)/waitingFor`，可作为 Hooks 的补充信号（非官方内部格式，需按版本降级）。实测它能直接反映 `waitingFor: "approve WebSearch"`。

**需求变更（2026-10-28，已确认）**：在“只监控提醒”之外，增加一个**默认关闭**的“应用内授权”开关。开启后，用户可以在监控窗口中对权限请求点击“允许/拒绝”；关闭、应用离线或超时未操作时，完全回退到原终端提示。

该能力的核心机制已实测：阻塞式 `PermissionRequest` Hook 返回 `allow` 可让工具继续执行，返回 `deny` 可阻止执行；Hook 不返回决策（exit 0）时原终端提示照常出现。详见 2.2、6.3。应用内授权不是自动批准，仍需用户逐次点击，但应用因此成为可选审批入口，安全边界见 6.3 与风险 R16–R21。

---

## 1. 验证环境与方法

| 项 | 实测值 |
|---|---|
| OS | Windows 11 x64 |
| Shell | Git Bash（命令中显式使用 Windows 路径） |
| Node / npm | v22.21.0 / 10.9.4 |
| Claude Code | 2.1.126，`C:\Users\<user>\.local\bin\claude.exe`（原生单文件二进制） |
| 模型 | Claude Code CLI（模型与网关按本机配置） |
| 会话元数据 | `C:\Users\<user>\.claude\sessions\<pid>.json` |
| npm registry | 可达；electron 45.1.0 / electron-builder 26.18.0 / react 19.3.1 / vite 8.3.5 / tailwindcss 4.3.3 / zustand 5.0.16 / drizzle-orm 0.45.4 / better-sqlite3 13.0.3 / vitest 5.0.5 / electron-vite 6.0.0（均为 MIT 或 Apache-2.0/ISC 宽松许可） |

验证方法：

- 官方文档站点 `code.claude.com` 被当前网络策略拦截（WebFetch 与 curl 均失败），因此结合 **WebSearch 文档摘要 + CLI 二进制字符串 + 本机真实运行** 三方交叉验证。
- 在隔离目录 `%TEMP%\ccw-hook-probe` 配置项目级 Hooks，未改动任何全局 Hooks；用 `claude -p` 和 `winpty` 驱动的真实交互式会话采集 stdin JSON。
- 在隔离目录 `%TEMP%\ccw-hook-approve` 验证同步 `PermissionRequest` Hook 返回 allow/deny 的实际效果。
- 每个结论以“实测”或“文档/未实测”标注。

---

## 2. 实测结果

### 2.1 事件载荷（全部为真实捕获）

所有事件共有字段：

```
session_id, transcript_path, cwd, hook_event_name
```

| 事件 | 实测附加字段 | 备注 |
|---|---|---|
| `SessionStart` | `source` | `startup` / `resume` 实测；交互式还带 `model`，`-p` 模式无 `model` |
| `UserPromptSubmit` | `permission_mode`, `prompt` | `prompt` 可能含敏感内容，默认不落库 |
| `PreToolUse` | `permission_mode`, `tool_name`, `tool_input`, `tool_use_id` | Windows 下工具名为 `PowerShell`（不是 `Bash`） |
| `PermissionRequest` | `permission_mode`, `tool_name`, `tool_input`, `permission_suggestions?` | **无 `tool_use_id`**；`permission_suggestions` 在 AskUserQuestion 场景缺失 |
| `PostToolUse` | `permission_mode`, `tool_name`, `tool_input`, `tool_response{stdout,stderr,interrupted,isImage}`, `tool_use_id`, `duration_ms` | `tool_response` 含工具输出，可能含密钥，默认不落库 |
| `PostToolUseFailure` | `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`, `error`, `is_interrupt`, `duration_ms` | `error` 实测为 `"Exit code 1"` |
| `Notification` | `message`, `notification_type` | 实测 `permission_prompt` 与 `idle_prompt`；**无 `permission_mode`** |
| `Stop` | `permission_mode`, `stop_hook_active`, `last_assistant_message` | 仅代表当前回合结束 |
| `SessionEnd` | `reason` | 实测 `-p` 正常退出为 `other` |
| `StopFailure` | 文档：`error`, `error_details`, `last_assistant_message` | **未实测**（需要 API 级失败） |
| `SubagentStart` / `SubagentStop` / `TaskCompleted` | 未采集 | 可选，不影响 MVP |
| `PreCompact` / `FileChanged` / `PermissionDenied` | 二进制中存在 | 暂不使用 |

实测样例（PermissionRequest）：

```json
{
  "session_id": "c0b55326-35b1-4753-b74a-8a99d0c97c82",
  "cwd": "C:\\Users\\<user>\\AppData\\Local\\Temp\\ccw-hook-probe",
  "hook_event_name": "PermissionRequest",
  "permission_mode": "default",
  "tool_name": "PowerShell",
  "tool_input": { "command": "cmd /c exit 1", "description": "Run cmd /c exit 1 exactly as requested" },
  "permission_suggestions": [
    { "type": "addRules", "rules": [{ "toolName": "PowerShell", "ruleContent": "cmd /c exit 1" }], "behavior": "allow", "destination": "localSettings" }
  ]
}
```

实测样例（需要用户选择的场景）：

```json
[
  { "hook_event_name": "PreToolUse", "tool_name": "AskUserQuestion", "tool_use_id": "call_00_..." },
  { "hook_event_name": "PermissionRequest", "tool_name": "AskUserQuestion", "tool_input": { "questions": [ ... ] } },
  { "hook_event_name": "Notification", "notification_type": "permission_prompt", "message": "Claude Code needs your attention" }
]
```

### 2.2 关键行为验证

| # | 结论 | 证据 |
|---|---|---|
| 1 | 同一目录的两个会话可用 `session_id` 区分 | 同一 cwd 下同时存在 `119092.json` / `76396.json`，sessionId 不同 |
| 2 | `-p` 模式遇到需审批命令会直接拒绝，**不触发** `PermissionRequest` | 两次实测：无 PermissionRequest，仅 PreToolUse + Stop |
| 3 | 交互式会话会触发 `PermissionRequest` + `Notification(permission_prompt)` | winpty 实测捕获完整载荷 |
| 4 | `AskUserQuestion` 也走 `PermissionRequest`，且通知文案为 "needs your attention" | winpty 实测；必须按 `tool_name` 区分“权限”与“回答” |
| 5 | 正常回合结束 60 秒后触发 `Notification(idle_prompt)`（"Claude is waiting for your input"） | winpty 实测，Stop 后约 60s |
| 6 | `resume` 复用原 `session_id`，`SessionStart.source="resume"` | 实测 |
| 7 | Hooks 在会话启动时快照，后加的 Hooks 对已运行会话无效 | 本会话 119092 启动后安装探针，未产生任何探针事件 |
| 8 | 支持异步 Hook：`"async": true` + `"asyncTimeout": 5`，不阻塞 Claude | 实测 async PreToolUse 仍能送达；语义按官方文档 |
| 9 | Windows 工具名是 `PowerShell` | 实测；matcher 不能硬编码 `Bash`，建议省略 matcher |
| 10 | 会话元数据文件实时更新 `status=busy/idle/waiting` 与 `waitingFor` | 1s 采样：started idle → busy → idle；等待审批时为 waiting + "approve WebSearch" |
| 11 | 进程被强制结束时元数据文件会残留（stale） | 119840.json 残留，但 PID 已不存在 |
| 12 | `claude.exe` 父进程为 `explorer.exe`，无法据此识别终端 | PowerShell 进程链实测 |
| 13 | 阻塞式 `PermissionRequest` Hook 返回 `allow` 可放行工具 | 隔离探针：Hook 等待 4s 后返回 allow，命令被实际执行（出现 `PostToolUseFailure: Exit code 1`） |
| 14 | 返回 `deny` 可阻止工具执行 | 隔离探针：无 `PostToolUseFailure`，`Stop.last_assistant_message` 显示 "blocked by a hook" |
| 15 | Hook 不返回决策（exit 0）时原终端权限提示正常出现 | 首次探针实测：Hook 仅记录并 exit 0，随后在 TUI 中手动回车完成授权 |
| 16 | 应用内授权的决策输出格式 | `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow\|deny","updatedInput"?:...,"message"?:...}}}` |
| 17 | `AskUserQuestion` 同样会被 PermissionRequest 门控命中 | 因此授权开关必须对 `AskUserQuestion` 直接回退终端，不能返回 allow/deny |
| 18 | 异步 `SessionEnd` 在 `-p` 快速退出时会丢失 | 阶段二实测：async SessionEnd 未送达，会话停在 COMPLETED；改为同步 + 2s 超时 |

### 2.3 会话元数据文件（非官方，需容错）

路径：`%USERPROFILE%\.claude\sessions\<pid>.json`

实测字段（2.1.126）：

```json
{
  "pid": 73448,
  "sessionId": "a78215c0-...",
  "cwd": "C:\\Users\\<user>\\AppData\\Local\\Temp\\ccw-hook-probe",
  "startedAt": 1793172138679,
  "procStart": "639287978349617700",
  "version": "2.1.126",
  "peerProtocol": 1,
  "kind": "interactive",
  "entrypoint": "cli",
  "status": "idle",
  "updatedAt": 1793172143412
}
```

注意：

- `procStart` 并非每次出现，字段集合不稳定；`status` 枚举目前观察到 `busy | idle | waiting`，`waitingFor` 为自由文本。
- 优雅退出时会删除文件；崩溃/强杀时残留，必须用 PID 存活校验兜底。
- **绝不允许删除用户目录下的这些文件**，只读。

---

## 3. 总体架构

```text
┌──────────────────────── Claude Code CLI（多个终端会话）────────────────────────┐
│ 监控事件（async）：SessionStart / UserPromptSubmit / PreToolUse /             │
│   Notification / PostToolUseFailure / Stop(StopFailure) / SessionEnd ...      │
│ 授权请求（sync）：PermissionRequest（仅门控 Hook，观察或按用户点击决策）      │
└───────────────┬────────────────────────────────────────────┬──────────────────┘
                │ 异步事件                                    │ 同步授权请求
                ▼                                            ▼
      hook-relay（快速写管道/spool）                 hook-gate（阻塞等待用户）
                │                                    ├─ 开关关闭/离线/超时 → exit 0
                │                                    ├─ 用户点允许 → allow + updatedInput
                │                                    └─ 用户点拒绝 → deny + message
                ▼                                            ▼
┌───────────────────────── Electron 主进程 ────────────────────────────────────┐
│ HookIngest ──► HookEventParser ──► SessionRegistry ──► SessionStateMachine  │
│        ▲                                  ▲                  │               │
│ SessionFileWatcher ───────────────────────┤                  ▼               │
│ ProcessMonitor ───────────────────────────┘          ApprovalCoordinator      │
│                                                             │                 │
│ SessionRegistry ──► NotificationService（Toast + 声音 + 去重）│                 │
│ SessionRegistry ──► SessionStore（内存 → 阶段五 SQLite）      │                 │
│ TrayManager（显示/隐藏/待处理数/声音开关/退出）               │                 │
└───────────────────────────────┬──────────────────────────────┼────────────────┘
                                │ 受控 IPC（白名单 + zod 校验） │ 授权按钮/结果
┌───────────────────────────────▼──────────────────────────────▼────────────────┐
│ preload（contextBridge，仅暴露受限 API）                                       │
├───────────────────────────────────────────────────────────────────────────────┤
│ React 渲染进程：会话列表 / 详情 / 设置 / 待授权卡片                            │
└───────────────────────────────────────────────────────────────────────────────┘
```

原则：

- 事件身份只认 `session_id`；`cwd`、进程名、窗口标题都只用于展示/辅助，不用于会话身份合并。
- Hooks 是权威事件源；会话文件与进程探测是**补充信号**，冲突时降级为 `UNKNOWN/DISCONNECTED` 并说明原因。
- 监控 Hooks 一律异步、只读、失败即 exit 0，不参与任何权限决策。
- `hook-gate` 是唯一的同步/决策 Hook：默认关闭；只有用户在应用中显式点击才输出 allow/deny；异常、超时、应用离线、参数不完整一律 exit 0，回退原终端。
- `AskUserQuestion` 永远不会被 gate 自动决策（它不是允许/拒绝问题），始终回退终端。

---

## 4. 模块职责

| 模块 | 位置 | 职责 | 明确不做 |
|---|---|---|---|
| AppLifecycle | `src/main/index.ts` | 单实例锁、窗口、生命周期、模块装配 | 业务状态推导 |
| HookInstaller | `src/main/hooks/installer.ts` | 合并/备份/恢复全局 Hooks，dry-run，幂等 | 覆盖用户已有 Hooks |
| HookRelay | `src/hooks-relay/`（独立小入口） | 监控事件 stdin → 管道/spool，永不阻塞，永不输出决策 | 解析语义、修改权限 |
| HookGate | `src/hooks-gate/`（独立小入口） | 同步处理 `PermissionRequest`；请求应用决策，超时/离线 exit 0 | 自动决策、处理 `AskUserQuestion` |
| HookIngest | `src/main/hooks/ingest.ts` | 管道服务、spool 回放、限流/大小校验 | 状态转换 |
| HookEventParser | `src/main/hooks/parser.ts` | zod 校验、事件归一化、字段裁剪/脱敏 | 猜测缺失字段 |
| ApprovalCoordinator | `src/main/approval/coordinator.ts` | 生成 requestId、维护待授权队列、超时、把用户决策回传给 gate | 自动批准、记忆“总是允许” |
| SessionRegistry | `src/main/session/registry.ts` | 会话索引、首次事件建会话、定时器、快照输出 | 终端定位 |
| SessionStateMachine | `src/main/session/stateMachine.ts` | 纯函数 reducer、幂等、乱序保护 | IO/通知副作用 |
| SessionFileWatcher | `src/main/session/sessionFileWatcher.ts` | 轮询 `~/.claude/sessions`，提供 pid/status 线索 | 把内部格式当唯一事实 |
| ProcessMonitor | `src/main/process/processMonitor.ts` | 批量存活探测、PID 复用防抖、超时 | 结束/重启任何进程 |
| NotificationService | `src/main/notification/service.ts` | Toast、声音、去重、冷却、点击聚焦、授权卡片定位 | 替代终端交互 |
| TrayManager | `src/main/tray/manager.ts` | 托盘菜单、待处理计数、关闭即隐藏 | 关闭即退出 |
| SessionStore | `src/main/persistence/` | 内存快照；阶段五 SQLite | 保存完整 prompt/tool_input |
| IPC | `src/main/ipc/` + `src/preload/` | 白名单通道、zod 入参校验、推送 | 暴露任意 fs/shell |
| Renderer | `src/renderer/` | 列表、详情、筛选、设置 | 直接访问 Node/文件系统 |
| Shared | `src/shared/` | 类型、zod schema、常量、状态字典 | 平台相关逻辑 |

---

## 5. 会话状态机

### 5.1 状态定义

| 状态 | 含义 | 是否需要用户介入 |
|---|---|---|
| `RUNNING` | 已提交提示词并正在工作（含思考/工具调用） | 否 |
| `WAITING_PERMISSION` | 等待用户批准工具调用 | 是 |
| `WAITING_INPUT` | 等待用户回答问题/选择（AskUserQuestion 等） | 是 |
| `COMPLETED` | 当前回合正常结束，等待下一次输入 | 否 |
| `FAILED` | 已识别的执行失败（`StopFailure`） | 是 |
| `STOPPED` | 会话已结束或进程已退出 | 否（异常退出时提醒） |
| `UNKNOWN` | 事件不足以判断 | 否（UI 说明原因） |
| `DISCONNECTED` | 监控暂时无法确认（应用重启、Hook 中断、数据陈旧） | 否（UI 说明原因） |

附加字段（不改变状态枚举）：

- `attention`: 是否进入需要介入的待处理队列，含 `type/toolName/since/reason`。
- `confidence`: `high | medium | low`，用于 UI 解释“为什么是这个状态”。
- `exitKind`: `normal | abnormal`（进程死亡时依据是否收到 `SessionEnd` 判断）。
- `approval`: 可选授权的当前状态：`pending | allowed | denied | timedOut | fallback | none`，含 `requestId`、`toolName`、输入摘要和时间。
- `currentTool`, `lastError`, `lastEventAt`, `lastActivityAt`, `sourceConfidence`。

### 5.2 状态转换表（完整实现依据）

| # | 事件 / 条件 | 当前状态 | 结果状态 | attention | 通知 | 说明 |
|---|---|---|---|---|---|---|
| 1 | `SessionStart(startup/resume/clear/compact)` | 任意/新 | `WAITING_INPUT` | 否 | 否 | 新会话已就绪，等待首条输入；不提醒 |
| 2 | `UserPromptSubmit` | 任意 | `RUNNING` | 清空 | 否 | 新回合开始 |
| 3 | `PreToolUse` | 任意 | `RUNNING` | 否 | 否 | 记录 `currentTool` |
| 4 | `PostToolUse` | 任意 | `RUNNING` | 否 | 否 | 清空 `currentTool`；阶段三再启用该 Hook |
| 5 | `PostToolUseFailure` | 任意 | `RUNNING` | 否 | 默认否（可配置低优先级） | 记录 `lastError`；**不置为 FAILED**，Claude 通常会自行恢复 |
| 6 | `PermissionRequest` 且 `tool_name != AskUserQuestion` | 任意 | `WAITING_PERMISSION` | 是 | 高 | 去重键含 toolName |
| 7 | `PermissionRequest` 且 `tool_name == AskUserQuestion` | 任意 | `WAITING_INPUT` | 是 | 高 | 这是“回答问题”，不是权限 |
| 8 | `Notification(permission_prompt)` | 已在等待且窗口内 | 不变 | 不变 | 否 | 与 #6/#7 去重 |
| 9 | `Notification(permission_prompt)` | 其他 | `WAITING_PERMISSION` | 是 | 高 | Hook 缺失时的兜底；置信度 medium |
| 10 | `Notification(idle_prompt)` 且当前 `RUNNING`（Stop 缺失） | `RUNNING` | `WAITING_INPUT` | 是 | 中 | 说明“60s 无输入，可能已结束但未收到 Stop”，置信度 low |
| 11 | `Notification(idle_prompt)` 且当前 `COMPLETED` | `COMPLETED` | 不变 | 否 | 否 | 正常完成后的固定行为，忽略 |
| 12 | `Stop` | 任意 | `COMPLETED` | 清空 | 可配置（默认开） | 回合结束，进程仍在 |
| 13 | `StopFailure` | 任意 | `FAILED` | 是 | 高 | 保留 `error` 摘要（截断） |
| 14 | `SessionEnd(reason)` | 任意 | `STOPPED` | 清空 | 默认否 | `reason` 仅展示，不据此判定失败 |
| 15 | 进程探测发现 PID 消失且无 `SessionEnd` | 非 `STOPPED` | `STOPPED` + `abnormal` | 是 | 高（可配置） | 异常退出提醒 |
| 16 | 进程探测发现 PID 消失且已有 `SessionEnd` | `STOPPED` | 不变 | 否 | 否 | 正常退出 |
| 17 | 应用重启后加载历史会话 | 新进程启动 | `DISCONNECTED` | 否 | 否 | 绝不自动恢复为 RUNNING |
| 18 | 重启后会话文件 `status=busy` 且 `updatedAt` 新鲜（≤15s）且 PID 存活 | `DISCONNECTED` | `RUNNING`（confidence medium） | 否 | 否 | 需版本校验；可关闭 |
| 19 | 重启后会话文件 `status=waiting` 且 PID 存活 | `DISCONNECTED` | `WAITING_PERMISSION` | 是 | 是 | 依据 `waitingFor` 文案展示 |
| 20 | 事件无法关联会话（未知 session_id） | — | 新建 `UNKNOWN` | 否 | 否 | 仅以 session_id 关联，不按 cwd 合并 |
| 21 | 重复事件（同 session + 事件 + tool_use_id + 内容哈希，10s 内） | 任意 | 不变 | 不变 | 否 | 幂等 |
| 22 | 乱序事件（receivedAt 早于 lastAppliedAt） | 任意 | 状态不变，仅入时间线 | 不变 | 否 | 由 relay 附加时间戳 |
| 23 | 长时间无事件但进程存活 | `RUNNING` | 不变 | 不变 | 默认否 | 仅 UI 显示“X 分钟无活动”，不猜测崩溃 |
| 24 | 事件结构解析失败 | 任意 | 不改变已知状态 | 不变 | 否 | 记录诊断计数，UI 提示数据源异常 |
| 25 | 授权开关开启，收到 `PermissionRequest`（非 AskUserQuestion） | 任意 | `WAITING_PERMISSION` + `approval=pending` | 是 | 高 | gate 阻塞等待应用决策 |
| 26 | 用户在应用内点击“允许” | `WAITING_PERMISSION` + pending | 状态不变，`approval=allowed` | 是 | 否 | UI 显示“已允许，等待执行”；等后续工具事件确认 |
| 27 | 用户在应用内点击“拒绝” | `WAITING_PERMISSION` + pending | `RUNNING`，`approval=denied` | 否 | 否 | Claude 收到 deny 后继续处理；等 Stop |
| 28 | gate 超时 / 应用离线 / 开关关闭 | `WAITING_PERMISSION` + pending | 状态不变，`approval=fallback` | 是 | 否（避免重复） | 原终端提示出现；UI 提示“请回原终端处理” |
| 29 | 授权开关开启，但 `tool_name == AskUserQuestion` | 任意 | `WAITING_INPUT` | 是 | 高 | gate 直接 exit 0，不进入应用内授权 |
| 30 | 过期/重复的用户决策（requestId 不匹配或已决策） | 任意 | 不变 | 不变 | 否 | 决策丢弃并记录诊断 |

### 5.3 状态机不变量

1. 只有 `WAITING_PERMISSION`、`WAITING_INPUT`、`FAILED`、异常 `STOPPED` 进入待处理队列。
2. `Stop` 永远不推断进程退出；`SessionEnd` 永远不推断失败。
3. 任何“无法判断”的情况输出 `UNKNOWN`/`DISCONNECTED`，禁止默认猜测为等待权限。
4. 同一 `session_id` 的重复/乱序事件不得导致状态回退（同一事件时间戳内）。
5. 状态转换只由纯函数产生，通知由订阅副作用触发，便于单元测试。
6. 会话身份仅由 `session_id` 决定；`cwd` 相同也不能合并。
7. 授权 gate 只在用户显式点击后输出决策；默认关闭；任何异常、超时、离线、字段缺失一律 exit 0。
8. 决策必须绑定 `requestId + session_id + tool_name + tool_input 哈希`；不匹配即丢弃，防止跨会话/过期授权。
9. 只有非 `AskUserQuestion` 的权限请求允许在应用内决策；问题回答永远回原终端。
10. 不提供“总是允许”或持久化授权；已有 settings 中的 allow 规则不受影响。

---

## 6. Hooks 安装与映射

### 6.1 安装策略

- 作用域：**用户级** `%USERPROFILE%\.claude\settings.json`（必须覆盖所有项目目录）。
- 只订阅必要事件：

  | 事件 | 用途 | async |
  |---|---|---|
  | `SessionStart` | 建会话、来源 | 是 |
  | `UserPromptSubmit` | RUNNING、回合开始 | 是 |
  | `PreToolUse` | 当前工具、RUNNING | 是 |
  | `PostToolUseFailure` | 错误摘要 | 是 |
  | `PermissionRequest` | 监控：权限/问答等待 | 是 |
  | `PermissionRequest` | 授权 gate：读取应用决策，开关关闭即 exit 0 | 否（同步） |
  | `Notification` | 权限兜底、空闲输入 | 是 |
  | `Stop` | COMPLETED | 是 |
  | `StopFailure` | FAILED | 是 |
  | `SessionEnd` | STOPPED | 否（同步 + 2s；实测 `-p` 退出时异步会丢失） |

  `PostToolUse` 先不装（高频），阶段三评估耗时后再决定；`Subagent*`、`TaskCompleted` 可选。

- matcher：**省略 matcher**（实测可捕获包括 `PowerShell` 在内的所有工具）。绝不硬编码 `Bash`。
- 监控 Hook 对象：默认 `{ type: "command", command: "<relay> <EventName>", async: true, asyncTimeout: 10, timeout: 2 }`；`SessionEnd` 例外，使用同步 + 2s 超时（实测异步会丢）。
- 授权 gate Hook：同步执行，`timeout` 取可配置等待上限（默认 30s，最大 55s）；它**始终随监控 Hooks 一起安装**，但运行时读取设置：开关关闭/应用离线即 exit 0，因此切换开关不需要重新安装 Hooks。
- 命令标记：监控命令包含 `ccw-hook-relay`，gate 命令包含 `ccw-hook-gate`，用于幂等安装/精确卸载。
- 合并算法：读取 → JSON 校验 → 备份 → 在目标事件数组追加（不替换）→ 原子写入（临时文件 + rename）→ 回读校验。任一步失败即中止并保留原文件。
- 卸载：只删除命令含标记的条目，清理空数组；用户原有条目原样保留。
- 备份：`%APPDATA%\Deckgate\backups\settings-<ts>.json`，仅本机、受限 ACL；**备份可能包含敏感 env（如 API Token），禁止打印/上传/写日志**。
- UI 明示：安装后需**重启已运行的 Claude 会话**才生效（实测确认）。

### 6.2 Relay 设计

- 读取 stdin，上限 256KB；超限则截断并标记，不阻塞。
- 附加 `receivedAt`、`relayVersion`，不修改原字段。
- 优先写本机命名管道（当前用户 ACL），50ms 超时；
- 应用未运行/超时：追加到 `%LOCALAPPDATA%\Deckgate\spool\<session>.jsonl`（小写入、行级 JSON），启动时回放并去重。
- 永远 exit 0，stdout 为空，不参与权限决策。
- 打包期需解决运行时依赖：候选方案见风险 R5。

### 6.3 可选应用内授权（默认关闭，已实测可行）

流程：

1. gate 收到 `PermissionRequest`，读取当前设置。
2. 若开关关闭、应用未运行、或 `tool_name == "AskUserQuestion"` → 立即 exit 0，原终端提示照常出现。
3. 开关开启且为普通工具权限 → 生成 `requestId`，通过命名管道把 `session_id / cwd / tool_name / tool_input / requestId` 发给应用，并阻塞等待。
4. UI 显示待授权卡片（工具名、命令/参数摘要、所属会话、倒计时）。用户点击“允许”或“拒绝”。
5. gate 收到决策后输出并退出：

   ```json
   {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{...}}}}
   {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"..."}}}
   ```

6. 超时、管道断开、应用崩溃、决策格式不合法 → gate exit 0，回退原终端提示；应用侧标记 `approval=fallback`。
7. 决策结果不写入 Claude 的 allow 规则，不提供“总是允许”。

已验证：`allow` 后工具实际执行；`deny` 后工具未执行且 Claude 收到 hook 阻断信息；gate 不返回决策时原终端提示正常显示。

安全约束：

- gate 是安全敏感组件，必须独立、极简、无第三方依赖；任何异常路径都只能“无决策退出”。
- 决策严格绑定 `requestId + session_id + tool_name + tool_input 哈希`，防止并发会话串台或过期授权。
- 输入摘要必须做控制字符净化、长度截断，避免 UI 欺骗；完整命令可在详情中查看，但不持久化。
- `AskUserQuestion` 永远不进入应用内授权（实测它同样触发 PermissionRequest；返回 allow/deny 会破坏问答流程）。
- 应用内授权默认关闭，首次开启需明确提示风险；不接受“自动允许/自动拒绝”。

### 6.4 Hooks → 状态映射速查

| Hook | 状态影响 | 通知 |
|---|---|---|
| `SessionStart` | → WAITING_INPUT（就绪） | 无 |
| `UserPromptSubmit` | → RUNNING | 无 |
| `PreToolUse` | RUNNING + currentTool | 无 |
| `PostToolUseFailure` | RUNNING + lastError | 可选低优先级 |
| `PermissionRequest`（普通工具） | → WAITING_PERMISSION；授权开启时附 `approval=pending` | 高 |
| 用户在应用内允许/拒绝 | 决策回传 gate；状态等后续事件确认 | 无 |
| gate 超时/离线 | `approval=fallback`，提示回原终端 | 无（避免重复） |
| `PermissionRequest`（AskUserQuestion） | → WAITING_INPUT；gate 永不决策 | 高 |
| `Notification(permission_prompt)` | 去重/兜底 WAITING_PERMISSION | 高 |
| `Notification(idle_prompt)` | Stop 缺失时 → WAITING_INPUT；否则忽略 | 中 |
| `Stop` | → COMPLETED | 完成提醒（可配） |
| `StopFailure` | → FAILED | 高 |
| `SessionEnd` | → STOPPED | 默认无 |
| 进程死亡（无 SessionEnd） | → STOPPED(abnormal) | 高 |

---

## 7. Windows 进程检测方案

### 7.1 身份关联

1. **主来源**：`~/.claude/sessions/*.json` 给出 `pid ↔ sessionId`，同时给出 cwd、startedAt、status、waitingFor。
2. **校验**：仅当 PID 存活且镜像名为 `claude.exe` 时，才认为会话进程存活。
3. **PID 复用防护**：若存在 `procStart`，比对进程启动时间；否则用 `startedAt` 与进程 StartTime 容差 ±60s 校验。不匹配则视为未知，不关联。
4. **无元数据的会话**（如 `-p` 会话、旧版本）：`pid=null`，只依赖 Hooks；UI 显示“进程信息不可用”。
5. **绝不**扫描所有 `node.exe` / 以命令行关键字猜测 Claude 进程；可选兜底：仅按镜像名 `claude.exe` + 已知安装路径枚举，且结果标为低置信度。

### 7.2 查询方式

- 频率：默认 5s 一轮，可配 2–30s；窗口隐藏/托盘时不提高频率；后台运行不密集轮询。
- 单轮一次批量查询候选 PID：

  ```powershell
  Get-Process -Id 119092,73448 -ErrorAction SilentlyContinue |
    Select-Object Id, ProcessName, StartTime
  ```

- 对比：整表 `Get-CimInstance Win32_Process` 实测约 **410ms**；批量 `Get-Process -Id` 明显更轻，阶段二基准后确定。
- 超时 3s，串行执行，禁止重叠；失败只标记 `processUnknown=true`，不崩溃、不清空会话。
- 详细页需要命令行/父进程时，按需单独查询，不进入轮询。
- 不结束、不重启、不挂起任何 Claude 进程。

### 7.3 终端识别

实测 `claude.exe` 父进程为 `explorer.exe`，进程链无法映射到 Windows Terminal 标签页；CMD/PowerShell 窗口的 `conhost` 关系也不稳定。

结论：

- `sourceTerminal` 永远标为 `UNKNOWN`（除非未来有可靠新证据）。
- 不实现“切换到原终端”按钮；详情页提供：
  - 复制 sessionId
  - 复制/打开工作目录
  - 明确提示“请回到启动该会话的终端处理”
- 托盘通知点击只聚焦本应用并定位会话，不尝试切终端。

---

## 8. 项目目录结构

```text
Deckgate/
├─ docs/
│  └─ phase-1-design.md
├─ scripts/
│  ├─ install-hooks.ps1          # 调用应用内 installer（dry-run/正式安装）
│  ├─ uninstall-hooks.ps1        # 精确移除本应用 Hooks
│  └─ diagnose.ps1               # 版本、路径、Hooks、管道、spool、进程诊断
├─ src/
│  ├─ main/
│  │  ├─ index.ts
│  │  ├─ hooks/
│  │  │  ├─ installer.ts
│  │  │  ├─ ingest.ts
│  │  │  ├─ parser.ts
│  │  │  └─ fixtures.ts          # 仅开发/测试用
│  │  ├─ approval/
│  │  │  ├─ coordinator.ts       # requestId、待授权队列、超时、回传
│  │  │  └─ policy.ts            # 默认关闭、AskUserQuestion 排除、校验
│  │  ├─ session/
│  │  │  ├─ registry.ts
│  │  │  ├─ stateMachine.ts
│  │  │  ├─ selectors.ts
│  │  │  └─ sessionFileWatcher.ts
│  │  ├─ process/
│  │  │  ├─ processMonitor.ts
│  │  │  └─ windowsQuery.ts
│  │  ├─ notification/
│  │  │  ├─ service.ts
│  │  │  ├─ dedupe.ts
│  │  │  └─ sounds/              # 打包的 wav
│  │  ├─ tray/
│  │  │  └─ manager.ts
│  │  ├─ persistence/
│  │  │  ├─ store.ts             # 阶段五实现
│  │  │  ├─ schema.ts
│  │  │  └─ retention.ts
│  │  └─ ipc/
│  │     ├─ channels.ts
│  │     └─ handlers.ts
│  ├─ hooks-relay/
│  │  └─ index.ts                # 监控事件 relay（无第三方依赖）
│  ├─ hooks-gate/
│  │  └─ index.ts                # 同步授权 gate（安全敏感，无第三方依赖）
│  ├─ preload/
│  │  ├─ index.ts
│  │  └─ api.ts
│  ├─ renderer/
│  │  ├─ app/
│  │  ├─ components/
│  │  ├─ pages/
│  │  ├─ stores/
│  │  ├─ hooks/
│  │  └─ styles/
│  └─ shared/
│     ├─ types/
│     ├─ schemas/                # zod：IPC、hook payload、设置
│     └─ constants/
├─ tests/
│  ├─ unit/                      # parser / stateMachine / dedupe / installer / approvalPolicy
│  ├─ integration/               # ingest+store+ipc / gate 超时与回退
│  ├─ e2e/                       # Playwright + Electron
│  └─ fixtures/hooks/            # 脱敏后的真实载荷
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ package.json
└─ tsconfig.json
```

---

## 9. MVP 开发顺序（阶段二起始清单）

### 阶段二：最小可运行闭环

1. 脚手架：electron-vite 6 + React 19 + TS strict + Tailwind 4；`npm run dev` 打开独立窗口。
2. `shared`：`SessionStatus`、`Session`、`HookEvent`、IPC 协议的 zod schema；先写单元测试样例。
3. 主进程内存 Registry + 快照/增量 IPC + preload 白名单 API；渲染进程深色列表页（先用模拟数据）。
4. Hook relay（Node 入口）→ spool + 命名管道；主进程 ingest + 回放。
5. `HookEventParser`：覆盖已实测 6 类事件；未知事件忽略但计数。
6. 状态机最小版：RUNNING / WAITING_PERMISSION / WAITING_INPUT / COMPLETED / STOPPED；先覆盖 SessionStart、UserPromptSubmit、PreToolUse、PermissionRequest、Stop、SessionEnd。
7. 安装器：合并全局 Hooks（备份/幂等/卸载/dry-run），并提供诊断脚本。
8. 真实会话验证：交互式会话 + `-p` 会话各一个；确认 UI 实时更新、无权限行为变化、Hook 延迟可接受。

阶段二验收：

- 应用窗口中能看到至少一个真实会话，并随提示词/工具/权限/Stop 变化。
- 权限弹窗仍然只出现在原终端，应用不做任何批准/拒绝（阶段二不实现应用内授权）。
- 卸载 Hooks 后用户配置与安装前一致。
- 重启应用不会把历史会话显示为 RUNNING。

### 阶段三：多会话与健壮性

- 完成 30 条状态转换与不变量测试。
- ProcessMonitor + SessionFileWatcher + 重启恢复 + 进程强杀/陈旧文件处理。
- 同目录多会话、未知 session、乱序/重复、解析失败。
- 详情页：完整 cwd、pid、时间线、lastError、最近工具、复制/打开目录。
- 筛选/搜索/排序/手动刷新。

### 阶段四：主动通知

- Toast（`app.setAppUserModelId`）、声音、分级、去重、冷却、测试按钮。
- 托盘：显示/隐藏、待处理计数、声音开关、退出；关闭窗口即隐藏。
- 通知点击 → 聚焦应用并选中会话。
- 验证最小化/隐藏后仍监控；验证专注助手/通知设置的影响并写入文档。

### 阶段四·补：可选应用内授权（默认关闭，可跳过）

前置条件：监控、状态机、通知均已稳定；否则不做审批入口。

- `hooks-gate`：同步 PermissionRequest 门控，默认 exit 0；仅普通工具权限、开关开启、应用在线时才等待决策。
- `ApprovalCoordinator`：requestId、待授权队列、超时、并发处理、过期决策丢弃、会话绑定校验。
- UI：待授权卡片（工具名、命令摘要、会话、倒计时）+ 允许/拒绝；拒绝后不重试、不记忆。
- 回退：开关关闭、应用离线、超时、管道异常、`AskUserQuestion` → 原终端提示。
- 安全评审：本地管道 ACL、输入净化、跨会话防串台、日志不落命令全文、无“总是允许”。
- 实测：与阶段一探针同构的 allow/deny/timeout 三条路径 + 真实交互式会话手工验收。

### 阶段五：持久化与交付

- SQLite + Drizzle：sessions / session_events / notifications / application_settings；幂等写入、索引、保留策略、脱敏。
- 设置页：通知、声音、冷却、轮询间隔、数据保留天数。
- electron-builder NSIS 安装包；安装/卸载/诊断/启动文档。
- Hook relay 打包方案定稿；卸载器端到端验证。

---

## 10. 主要风险与技术限制

| ID | 风险/限制 | 影响 | 缓解 |
|---|---|---|---|
| R1 | Hooks 启动时快照，已运行会话无事件 | 安装后短时间看不到现有会话 | 会话文件只读补充 + UI 提示“重启会话后生效” |
| R2 | 会话文件是内部格式，可能随版本变化 | pid/status 信号失效 | zod 宽容解析、版本白名单、连续失败自动禁用并提示 |
| R3 | 事件字段随 Claude Code 版本变化 | 解析失败/状态误判 | 未知字段忽略、未知事件仅计数、fixture 回归测试、诊断页显示版本 |
| R4 | 异步 Hook 在极快 SessionEnd 时会被取消 | 丢失收尾事件 | 已实测发生；`SessionEnd` 改为同步 + 2s 超时，其余监控 Hook 保持异步 |
| R5 | Hook relay 运行时依赖 | 安装后 Hook 无法执行 | 备选：Electron `ELECTRON_RUN_AS_NODE`、Node SEA、随包附带 node.exe；阶段二基准后定稿 |
| R6 | Windows Toast 受系统通知/安装方式/专注助手影响 | 提醒不显示 | AppUserModelID、安装包快捷方式、设置页说明 + “测试通知” |
| R7 | 无法可靠识别原终端 | 不能一键切回 | 明确不实现；提供复制 sessionId / 打开 cwd / 引导文案 |
| R8 | Stop 后 idle_prompt 与“完成”语义重叠 | 误报等待输入 | 按前序 Stop 抑制；仅 Stop 缺失时兜底 |
| R9 | 无法区分“完成任务”与“文本提问结束回合” | 部分等待输入不提醒 | 明确限制；AskUserQuestion 场景可靠覆盖 |
| R10 | `PostToolUseFailure` 不等于任务失败 | 噪声/误报 FAILED | 只记 lastError，不置 FAILED；仅 StopFailure 置 FAILED |
| R11 | 进程查询/管道失败 | 状态卡住 | 超时、串行、进程未知标志、不清空会话、不崩溃 |
| R12 | SQLite 原生模块与 Electron ABI | 阶段五构建失败 | 先做 better-sqlite3 + electron-rebuild 与 node:sqlite 双方案 spike |
| R13 | 备份文件含 env secrets | 敏感信息泄露 | 本机受限目录、绝不写日志/上传、卸载后可选清理 |
| R14 | 高频 Hooks 增加 Claude 延迟 | 用户体验下降 | 监控 Hook 全部 async；不装 PostToolUse；阶段二实测 relay 耗时 |
| R15 | 应用关闭期间无法通知 | 漏提醒 | spool 回放 + 启动后汇总“离开期间待处理” |
| R16 | 应用成为可选审批入口，扩大攻击面 | 本地提权/误授权风险 | 默认关闭；仅本机当前用户管道；逐次显式点击；无自动/记忆授权；gate 极简无依赖 |
| R17 | `PermissionRequest` 无 `tool_use_id`，并发请求可能串台 | 批错会话的命令 | gate 生成 `requestId`；决策绑定 `requestId + session_id + tool_name + 输入哈希`；过期即丢弃 |
| R18 | 用户不操作/应用崩溃/管道超时 | Claude 卡住 | gate 等待上限默认 30s，超时 exit 0 回退终端；UI 显示倒计时 |
| R19 | `AskUserQuestion` 被误当作权限放行/拒绝 | 问答流程被破坏 | gate 对 `AskUserQuestion` 硬编码 exit 0，永不决策 |
| R20 | 同步 gate 增加权限提示延迟 | 交互变慢 | 开关关闭/离线时立即 exit 0；目标 p95 < 150ms；阶段四基准 |
| R21 | 工具输入含控制字符，UI 展示可被欺骗 | 用户误点允许 | 纯文本渲染、控制字符净化、长度截断、完整内容需展开；不使用 HTML |

未实测项（必须保持标注，直到补充测试）：

- `StopFailure` 载荷与触发条件。
- `SubagentStart` / `SubagentStop` / `TaskCompleted`。
- Windows Toast 在开发模式与安装包下的真实表现。
- 通知点击激活窗口（Electron 行为）。
- electron-builder 产物在无 Node 环境的机器上的 Hook relay 可用性。
- 长时间（数小时）轮询的 CPU/内存表现。

---

## 11. 测试计划

### 单元测试（Vitest）

- Parser：真实脱敏 fixture（每个已实测事件）、畸形 JSON、缺字段、未知事件、超大输入、中文/空格路径、CRLF、重复字段。
- StateMachine：按 5.2 表逐条 + 组合序列：
  - 正常一轮：Start → Prompt → PreTool → Stop → idle_prompt
  - 权限：Prompt → PreTool → PermissionRequest → Notification → PostToolUseFailure/Stop
  - AskUserQuestion：PreTool → PermissionRequest → 用户选择 → PostToolUse → Stop
  - 工具失败后恢复：PostToolUseFailure → Stop
  - StopFailure、SessionEnd、进程死亡、异常退出
  - 重复/乱序、Stop 缺失 + idle_prompt、应用重启、未知 session、同 cwd 双会话
  - 陈旧会话文件 + PID 复用
- Dedupe/冷却：假时钟，验证权限双事件只提醒一次、完成提醒不重复。
- Installer：示例 settings（含已有 Hooks、无 Hooks、非法 JSON、只读文件、并发），安装两次幂等、卸载精确、备份可恢复。
- ApprovalPolicy：开关关闭/应用离线/AskUserQuestion → 必须 exit 0；allow/deny 输出 schema；过期 requestId、会话不匹配、输入哈希不匹配全部丢弃；并发请求按 requestId 隔离。
- IPC schema：非法参数全部拒绝。

### 集成测试

- stdin → relay → pipe → ingest → parser → state → snapshot。
- relay 在应用离线时写 spool，启动后回放且去重。
- 进程查询超时/异常注入，监控不崩溃。
- 会话文件 watcher 对非法 JSON、消失文件、PID 死亡的处理。
- gate 三条路径：allow、deny、超时/离线 exit 0（用隔离探针 + 假应用服务）。

### E2E（Playwright + Electron）

- 启动应用，注入合成事件，验证统计、列表、状态筛选、搜索、详情、复制按钮。
- 托盘隐藏/显示、关闭窗口后应用仍存活（自动化能力有限的部分标注手动）。
- 通知点击聚焦与选中（可 mock Notification）。
- 重启应用后历史会话为 DISCONNECTED/STOPPED，不显示 RUNNING。

### 手工验收（必须真实执行）

- PowerShell、CMD、Windows Terminal 各启动会话；同目录双会话。
- 权限请求（普通工具）、AskUserQuestion、Stop 后 60s、强制结束进程、应用重启、窗口隐藏。
- 安装/卸载 Hooks 前后 diff 全局设置。
- 专注助手开启/关闭下的 Toast。
- 应用内授权（阶段四·补）：开关关闭、开启后允许、拒绝、超时、关闭应用、并发两个会话。
- 无 Node 的干净虚拟机安装包验证（阶段五）。

### 性能与安全

- relay 单次耗时（p50/p95）、Claude 工具调用增加延迟（目标 p95 < 50ms，async 下应为 0）。
- gate 权限提示额外延迟（开关关闭/离线时目标 p95 < 150ms；开启时等待用户属预期）。
- 10 会话下主进程 CPU/内存、进程轮询开销。
- IPC 模糊测试、路径/命令注入检查、日志脱敏扫描、数据库内容抽查。

---

## 12. 验收标准映射

| # | 验收标准 | 阶段 |
|---|---|---|
| 1 | 独立窗口中查看多个真实会话 | 2 |
| 2 | 同目录多会话可区分 | 2/3 |
| 3 | 只识别官方事件实际支持的状态 | 3 |
| 4 | 无法判断显示 UNKNOWN | 3 |
| 5 | 权限等待提醒回原终端 | 4 |
| 6 | 等待输入提醒 | 3/4 |
| 7 | 完成/失败按设置提醒 | 4 |
| 8 | 通知与声音可独立测试 | 4 |
| 9 | 隐藏窗口后继续监控 | 4 |
| 10 | 重启不把旧会话标为运行中 | 3 |
| 11 | 不覆盖已有 Hooks | 2 |
| 12 | 默认不修改权限决策 | 2（监控 Hook 只读） |
| 13 | 不自动执行/批准命令 | 全程；可选授权仅限用户逐次显式点击 |
| 14 | 可构建安装包 | 5 |
| 15 | 完整 PowerShell 文档 | 5 |
| 16 | 可选应用内授权（默认关闭，允许/拒绝/超时回退） | 4·补 |

---

## 13. 已确定的默认方案

以下原“决策项”已按默认方案确定，不需要你逐条选择：

1. **会话文件补充信号**：默认启用，只读、版本校验、失败自动降级。
2. **数据最小化**：默认不持久化 `prompt`、`tool_input`、`tool_response`；只保留工具名、错误摘要（截断）、时间线元数据。
3. **全局 Hooks 安装**：写入用户级 `~/.claude/settings.json`，带备份/幂等/精确卸载。
4. **不实现终端切换**：只提供复制 sessionId、打开工作目录和引导文案。
5. **Hook relay 打包方式**：阶段二先用 Node 入口跑通，阶段五再定 SEA/Electron-as-node。
6. **产品范围**：默认“只监控提醒”；另提供默认关闭的“应用内授权”开关，在监控/通知稳定后（阶段四·补）实现。

授权模式的安全共识：只有用户逐次点击才产生 allow/deny；任何超时、离线、异常、`AskUserQuestion` 都回退原终端；不提供自动批准或“总是允许”。

---

## 附录：验证产物

- 监控探针目录：`C:\Users\<user>\AppData\Local\Temp\ccw-hook-probe`
  - `hook.js`：stdin 采集器（只写本地 JSONL）
  - `events.jsonl`：全部真实事件载荷
  - `.claude/settings.json`：项目级探针 Hooks（未触碰全局配置）
- 授权探针目录：`C:\Users\<user>\AppData\Local\Temp\ccw-hook-approve`
  - `approve.js`：阻塞 4s 后输出 allow/deny 决策
  - `events.jsonl`：PermissionRequest、决策、后续工具事件
  - `tty.log` / `tty-deny.log`：winpty 会话输出
- 参考文档：
  - Hooks reference: https://code.claude.com/docs/en/hooks
  - Async hooks issue: https://github.com/anthropics/claude-code/issues/21090
