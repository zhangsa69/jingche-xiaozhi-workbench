# WorkBuddy 对标功能改进清单

> 对标对象：腾讯 WorkBuddy（四栏式 AI 办公工作台：左侧任务列表、中间实时思考/步骤/日志、右侧产物面板、顶部模式与模型）。
> 本文档只做规划，不改代码。每条「现状」都给出 `path:line`，便于后续按行改造。
> 基线：`pnpm -r --if-present typecheck` 8/8 通过；`apps/desktop` `node --test test/*.test.mjs` 2050 通过 / 0 失败 / 6 跳过。

---

## 1. 结论摘要

1. **过程可视化的骨架已经存在，缺的是「静默时的证据」。** 已有思考折叠行（`features/chat/transcript/shared.tsx:539-604`）、活动组耗时（`ActivityGroup.tsx:267-271`）、7 种安静期相位（`packages/shared/src/types/sessions.ts:150-174`）、工具 spinner（`ToolRow.tsx:449-461`）、停止/转向/排队（`ComposerToolbar.tsx:282-303`）。真正的差距不是「没有展示」，而是**连续 N 秒没有任何变化时，界面没有一句话解释为什么**。
2. **任务节点完全缺失，这是与 WorkBuddy「多步骤进度条」最大的结构性差距。** 计划域只有整份 markdown 快照，`PlanProposal` / `PlanExecution` / `PlanningStateEvent` 均无 `steps` 字段（`packages/shared/src/types/plans.ts:58-125`），前端无法渲染「第 3/8 步、当前步高亮」。
3. **三个断点直接造成「卡死」体感**：等首个 token 时只有静止文案 + 秒表（`ActivityGroup.tsx:127-128`）；工具执行中普通工具行无耗时、无序号（`ToolRow.tsx:449-461`）；全局层只有「进行中」色点，无已运行时长（`Sidebar.tsx:1441-1444`）。
4. **右侧产物面板是能力缺口，不是界面缺口。** 已有 diff 与回滚（`packages/shared/src/types/workpanel.ts:25-39`、`protocol.ts:239`）、只读文件树（`FilesTab.tsx:175-246`），但没有按会话聚合的产物清单，也没有任何写盘/导出通道（`protocol.ts:246-253` 全为只读）。
5. **日志在磁盘上完备，在应用内零入口。** NDJSON 按 `app|host|agent` × 分类落盘、5MB 轮转、写入脱敏（`electron/main/logger.ts:236-341`），但协议只有「打开日志文件夹」（`protocol.ts:230` → `electron/main/ipc/diagnostics-ipc.ts:27-32`）。
6. **优先级判据**：P0 = 让「卡住」可证伪（思考 + 步骤 + 心跳）；P1 = 让「过程」可回看（日志 + 产物）；P2 = 让「并行」可调度（多任务标签 + 工作模式）。

---

## 2. 现状差距对照表

| # | WorkBuddy 能力 | 本项目现状 | 证据 | 结论 |
|---|---|---|---|---|
| 1 | 中间区实时展示思考过程 | 思考折叠行 + 摘要 ticker + 组级计时 + 16ms 流合并 | `features/chat/transcript/shared.tsx:539-604`、`ActivityGroup.tsx:273-277`、`packages/shared/src/message-stream.ts:11` | 部分具备 |
| 2 | 思考内容可常驻/可回看 | 仅「活动组最后一项」自动展开，无「始终展开思考」偏好 | `ActivityGroup.tsx:343-349` | 缺失 |
| 3 | 执行步骤可视化（第 N/M 步） | 无步骤结构，`plans.ts` 只有 `markdown`/`plan` 字符串 | `packages/shared/src/types/plans.ts:70,86,97` | 缺失 |
| 4 | 左侧多步骤进度条 | 侧栏只有运行色点，无进度 | `components/Sidebar.tsx:1441-1444` | 缺失 |
| 5 | 运行日志实时可见 | NDJSON 落盘齐全，应用内仅「打开日志文件夹」 | `electron/main/logger.ts:236-260`、`electron/main/ipc/diagnostics-ipc.ts:27-32` | 缺失 |
| 6 | 右侧产物面板 | `new/review/file/plugin/sidechat` 五类标签 | `lib/work-panel-tabs.ts:1-11`、`components/workpanel/`（7 文件） | 部分具备 |
| 7 | 全部中间文件 | 工作区文件树 + 单文件只读查看 | `workpanel/FilesTab.tsx:35-140,175-246` | 部分具备 |
| 8 | 变更记录 + 逐条回滚 | `ReviewChange` 持久 diff + rollback RPC | `packages/shared/src/types/workpanel.ts:25-39`、`protocol.ts:239` | 已有 |
| 9 | 产物预览 / 导出 | 只读查看器（含 markdown 渲染）+ 浏览器预览；无导出 | `workpanel/FilesTab.tsx:73-140`、`protocol.ts:246-253` | 部分具备 |
| 10 | 随时中断 / 补充指令 / 修正方向 | `abort` + 转向（steer）+ 排队队列 | `composer/ComposerToolbar.tsx:282-303`、`ComposerStatus.tsx:53-139` | 已有 |
| 11 | 多任务窗口切换 | `runningSessions: Record` 支持并行跑，但 `activeSessionId` 单值，界面一次一看 | `stores/app-state.ts:125,139-141`、`Sidebar.tsx:1441` | 部分具备 |
| 12 | 文件夹授权 | 插件级 fs 规则（`workspace`/`userSelected` + glob）+ 逐次同意 | `packages/shared/src/types/plugins.ts:108-127`、`electron/main/plugin-fs-consent.ts:21-51` | 部分具备 |
| 13 | 工作模式（文档/表格/PPT/研究） | 只有 `plan|goal|agent` 运行模式 | `packages/shared/src/types/common.ts:2` | 缺失 |
| 14 | 历史任务回溯 / 重启 | 会话列表 + 项目标签 + 转写窗口化回放 | `Sidebar.tsx:659-663`、`transcript/ChatTranscript.tsx` | 已有 |
| 15 | 技能/专家中心 | 插件页 + `resources/skills` + skill 市场 | `features/plugins/usePluginsPage.ts`、`resources/skills` | 已有 |
| 16 | 远程调度（Claw / 手机联动） | 无 | — | 缺失（P2 可选） |

**归因**：1/2/10/14/15 属「已有但表达不足」；3/4/5/13 属「能力缺失」；6/7/9/11/12 属「有零件无整机」。

---

## 3. P0 改进清单（让「卡住」可证伪）

### P0-A 思考过程可视化增强

| 编号 | 问题 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| A1 | 思考行头部只有「思考」二字，行内无计时，无法判断是刚开始还是已思考 3 分钟 | 行头显示 `思考中 · 12s`，结束后转 `已思考 12s`；流式期间加低频呼吸点（CSS animation，避免每秒重排） | `transcript/shared.tsx:539-604`（`ThinkingRow`）；计时源复用组级 `since`（`ActivityGroup.tsx:267-271`） | S |
| A2 | 思考只在「活动组最后一项」时自动展开，用户想全程可见只能每次手点 | 新增设置「始终展开思考」（默认关）；开启后 `ThinkingRow` 忽略 `autoOpen` 直接展开 | `ActivityGroup.tsx:343-349`；设置项落 settings store + `components/settings/` | S |
| A3 | 摘要取整段压缩后的首行，长思考时摘要不动，像停了 | 摘要改为「最后一行非空内容」，单行淡入替换（复用现有 ticker `ActivityGroup.tsx:304-306`） | `transcript/shared.tsx:539-604` 摘要取值 | S |

> 思考与答案已分通道渲染，无需改协议；A1–A3 全在渲染层 + 设置项。

### P0-B 任务节点可视化（结构性改动）

| 编号 | 问题 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| B1 | 计划只有 markdown 快照，无步骤数组 | 契约新增可选 `steps`：`{ id, index, title, status: "pending"\|"active"\|"done"\|"failed"\|"skipped", startedAt?, endedAt?, durationMs?, toolCallId? }`；挂到 `PlanProposal` / `PlanExecution` / `PlanningStateEvent` | `packages/shared/src/types/plans.ts:58-125` | M |
| B2 | 步骤来源未定义 | 一期从计划 markdown 解析有序列表/复选框（零模型改动）；二期再评估模型直接输出结构化 steps（§9 待确认 1） | `packages/agent-runtime/src/runtime.ts:1991`（`setPlanningState` 唯一 emit 点） | M |
| B3 | 步骤需跨重启保持 | 宿主 SQLite 增列 `steps_json`，同步 `PROPOSAL_COLUMNS`；`SCHEMA_VERSION` 16→17 | `crates/host-core/src/plans/model.rs`、`plans/repository.rs`、`packages/shared/src/protocol.test.ts:28-29` | M |
| B4 | 用户看不到「第几步、哪一步在做」 | 新增 `PlanStepsList`：`第 3/8 步` + 当前步高亮 + 每步耗时 + 点击定位到对应工具行；计划执行中常驻转写区顶部 | 新建 `features/chat/transcript/PlanStepsList.tsx`，由 `ChatTranscript.tsx:266-273` 状态泳道调用；合并逻辑复用 `lib/plan-mode-state.ts:81-113` | M |
| B5 | 侧栏只有色点，看不出进度 | 运行中会话行显示 `3/8` + 当前步标题（截断），无 steps 时回落「进行中」 | `Sidebar.tsx:1441-1444`、`lib/sidebar-session-status.ts:14-50` | S |

**验收**：plan 模式提交 5 步任务，界面稳定显示 `第 1/5 步`，每步完成打勾并累加耗时；重启渲染进程后步骤状态与宿主一致。

### P0-C 步骤序号与单步耗时

| 编号 | 问题 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| C1 | 普通工具行无耗时（仅子智能体拓扑有） | 工具行显示 `#3 · 1.2s`；运行中随 tick 增长，结束后冻结 | `transcript/ToolRow.tsx:274-292,363`（已有 `duration` 拼接点，扩展取值） | S |
| C2 | 耗时只落 message 层，运行中拿不到 | `tool_start` 增可选 `startedAt`（对齐 envelope `ts`，`runtime.ts:4722-4728`）；运行中由渲染层 `now - startedAt` 计算，避免跨进程时钟漂移 | `packages/shared/src/types/agent.ts:231`；`electron/main/runtime/sidecar.ts:180-189` 已有 `startedAt` 记录可对齐 | S |
| C3 | 组头只有「N 个步骤」，无进度口径 | 组头改 `第 3/8 步 · 已用 2m14s`（有 steps）或 `3 个步骤 · 已用 2m14s`（无 steps） | `ActivityGroup.tsx:390-393`、i18n `chat.stepsProgress` | S |

### P0-D 防卡死（心跳 + 静默升级）

| 编号 | 问题 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| D1 | 无心跳/看门狗，只在 host 进程真正退出时才知道出事 | main 侧看门狗：仅在有运行中 turn 时每 1s tick，维护 `lastEventAt` / `lastTokenAt` / `turnStartedAt`；**只在跨阈值时**推事件 | 新建 `electron/main/runtime/watchdog.ts`；订阅 `runtime/sidecar.ts:99,174` 事件流；存活态参考 `runtime/host.ts:300-339` | M |
| D2 | 契约里没有「安静了多久」 | `AgentActivity` 增可选 `lastActivityAt`、`silentForMs`；新增 phase `stalled`（附 `silentForMs`、`reason: "no-event"\|"no-token"\|"tool-hung"`） | `packages/shared/src/types/sessions.ts:150-174`；`ActivityGroup.tsx:124-143`（无 default，TS 强制补分支） | M |
| D3 | 等首 token 只有静止文案，不升级 | 三档：无事件 20s → `等待模型响应 · 20s` + 「仍在运行」；无 token 45s → `已 45s 无输出` + 停止/重试建议；120s → 强提示条（带「停止并重试」） | `ActivityGroup.tsx:424-459`（`WorkingIndicator`）、`:461-547`（`RunActivityIndicator`） | M |
| D4 | 全局层无已运行时长 | 侧栏运行行显示 `12m`；顶栏运行 chip 显示 `已运行 12m`；数据用 `agentStatuses[sid].activity.since` | `Sidebar.tsx:1441-1444`、`stores/slices/events-slice.ts:240-247` | S |
| D5 | 断连只有三态文案，不知重连第几次 | `hostStatus` 增可选 `attempt`；banner 显示「正在重连（第 2 次）」 | `protocol.ts:273`、`runtime/host.ts:300-339`、`features/app/AppShell.tsx:178-196` | S |
| D6 | 后端自身不产生存活信号 | 一期用 main 看门狗（不改 Rust）；二期可选 Rust `tokio::interval` 心跳 + notification（`crates/host-core/src/rpc/mod.rs:283` 现无周期任务） | §9 待确认 2 | M（可选） |

**验收（核心断言）**：用假 provider 让首 token 延迟 60s，界面必须在 20s / 45s 各出现一次升级文案，且只产生一次状态更新（不得每秒 setState）；点「停止」后 1s 内回到空闲态。

---

## 4. P1 改进清单（让「过程」可回看）

| 编号 | 能力 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| E1 | 运行日志面板 | 新增 WorkPanel 标签 `log`：按会话时间窗过滤、按 `tool/permission/runtime` 分类、关键字搜索、跟随尾部 | `lib/work-panel-tabs.ts:1-11,163-169`；新 RPC `logTail`（`protocol.ts:50-263`，白名单自动派生 `:290-293`）；main 读 `<dataDir>/logs/<channel>/<category>.log`（`logger.ts:242-260`），脱敏复用 `:306-314` | L |
| E2 | 错误回链 | 错误卡/失败工具行提供「查看当时的日志」，跳到对应时间窗 | `ActivityGroup.tsx:476-523`（错误浮层） | S |
| E3 | 产物聚合视图 | 新增标签 `artifact`：分组「产物 / 本次改动 / 全部文件」；产物取 `PlanProposal.artifact` + 检出文件，改动复用 `ReviewChange` | `workpanel/` 新增 `ArtifactsTab.tsx`；数据源 `workpanel.ts:25-39`、`app-store.ts:317-327` | M |
| E4 | 产物预览与导出 | 保留只读预览；导出需新增写盘 RPC（现 `protocol.ts:246-253` 全只读），先做「在文件夹中显示 + 复制路径」 | `protocol.ts` 新 `fsWrite`/`artifactExport`；边界见 §9 待确认 4 | M |
| E5 | 变更记录增强 | 按文件分组、批量回滚、改动与会话消息双向定位 | `workpanel/ReviewTab.tsx:9-47`、`protocol.ts:239` | M |
| E6 | 会话级目录授权 | 首次进入会话一次授权目录（比插件 glob 更粗），越界写入需再次确认 | `electron/main/workspace-roots.ts:44-82` + 新会话授权存储；交互复用 `plugin-fs-consent.ts:21-51` | M |

---

## 5. P2 改进清单（让「并行」可调度）

| 编号 | 能力 | 目标行为 | 落点 | 规模 |
|---|---|---|---|---|
| F1 | 多任务并行标签 | 顶部会话标签栏，可在运行中的多会话间切换，标签显示步骤进度与运行态；侧栏列表保留 | `app-state.ts:125`（单值 `activeSessionId`）→ `openSessionTabs`；运行态已有 `runningSessions: Record`（`:139-141`）直接驱动 | L |
| F2 | 工作模式入口 | 新建时选「编码 / 文档 / 表格 / 演示 / 研究」，影响 system prompt 与工具白名单 | 不扩 `Mode`（`common.ts:2` 影响 plan/goal/agent 语义与 `normalizeMode:6-11`），新增会话字段 `workMode?`；入口在 composer 顶部 | L |
| F3 | 技能中心聚合 | 插件、skills、专家预设收敛到一个可搜索页 | `features/plugins/`、`resources/skills` | M |
| F4 | 远程调度 | 手机端下发任务、桌面执行回传（对标 Claw） | 需新增网络通道与鉴权，独立立项 | XL |

---

## 6. 契约与事件改动清单

| 层 | 文件 | 改动 | 兼容性 |
|---|---|---|---|
| 契约 | `packages/shared/src/types/plans.ts:58-125` | 新类型 `PlanStep`；`steps?` 挂三处 | 全可选，旧回放不变 |
| 契约 | `packages/shared/src/types/sessions.ts:150-174` | 新 phase `stalled`；`lastActivityAt?`、`silentForMs?` | 可选字段 |
| 契约 | `packages/shared/src/types/agent.ts:231` | `tool_start` 增 `startedAt?` | 可选字段 |
| 契约 | `packages/shared/src/protocol.ts:264-287` | 新事件 `sessionWatch`（或 `hostStatus` 扩字段）；新 RPC `logTail` | 同步 `protocol.test.ts:28-29` 的 `PROTOCOL_VERSION` / `SCHEMA_VERSION` |
| 运行时 | `packages/agent-runtime/src/runtime.ts:1991,4731-4735` | steps 生成/推进；`stalled` 产生点 | 向后兼容 |
| 运行时 | `packages/agent-runtime/src/native-pi-session.ts:424-429` | `tool_start` 带时间 | 向后兼容 |
| 宿主 | `crates/host-core/src/plans/{model,repository}.rs` | `steps_json` 列 + schema 迁移 | 需 `SCHEMA_VERSION` 16→17 |
| 宿主 | `crates/host-core/src/rpc/mod.rs:283,1192` | （二期可选）心跳 tick 与 notification 方法 | 二期 |
| 主进程 | `electron/main/runtime/watchdog.ts`（新） | 1s tick 看门狗，跨阈值才推 | 无 |
| 主进程 | `electron/main/runtime/sidecar.ts:99,174,180-189` | 事件流喂看门狗；对齐 `startedAt` | 无 |
| 主进程 | `electron/main/logger.ts:236-341` | 供 `logTail` 读取（复用脱敏） | 无 |
| 渲染 | `ActivityGroup` / `ToolRow` / `Sidebar` / `workpanel` | 见 §3、§4 | 无 |

**静态保护现状**：无 zod 校验；事件 union 靠 TS 联合类型与 `racp.ts:684,710`、`agent-host.ts:309` 的 switch；`AgentActivity.phase` 的 switch 没有 default（`ActivityGroup.tsx:124-143`），新增 phase 会被 TS 强制补齐——这是本项目唯一的编译期护栏，必须保留。

---

## 7. i18n 键清单与测试落点

### 7.1 新增文案（8 语言齐备：en / zh-CN / zh-TW / de / es / fr / ko / tr）

| 建议键 | zh-CN 参考 | 用途 |
|---|---|---|
| `chat.thinkingRunning` | `思考中 · {{time}}` | A1 思考行计时 |
| `chat.alwaysExpandThinking` | `始终展开思考` | A2 设置项 |
| `chat.stepOfTotal` | `第 {{current}}/{{total}} 步` | B4 |
| `chat.stepsProgress` | `第 {{current}}/{{total}} 步 · 已用 {{time}}` | C3 |
| `chat.stepFailed` | `第 {{current}} 步失败` | B4 |
| `chat.lastActivity` | `最后活动 {{time}} 前` | D4 |
| `chat.sessionRunningFor` | `已运行 {{time}}` | D4 |
| `chat.noOutputFor` | `已 {{time}} 无输出` | D3 |
| `chat.stalledHint` | `仍在运行，可继续等待或停止重试。` | D3 |
| `chat.stalledStrong` | `长时间无响应，建议停止并重试。` | D3 |
| `chat.reconnectAttempt` | `正在重连（第 {{attempt}} 次）` | D5 |
| `panel.logs` | `运行日志` | E1 |
| `panel.artifacts` | `产物` | E3 |
| `panel.allFiles` | `全部文件` | E3 |
| `panel.changes` | `本次改动` | E3 |
| `workMode.code/doc/sheet/slides/research` | `编码 / 文档 / 表格 / 演示 / 研究` | F2 |

约束：与现有 `chat.thinkingFor`(:480)、`chat.thoughtFor`(:481)、`chat.processingSteps`(:491) 并存，不复用语义不同的旧键；新增后必须跑 `packages/i18n/test/catalogs.test.mjs`。

### 7.2 测试落点

| 改动 | 落点文件 | 方式 |
|---|---|---|
| 静默升级提示（D3/D4） | `apps/desktop/test/active-turn-surface.test.mjs` | 该文件已是活动指示器与 i18n key 的守门人（`:19-30`），追加 `stalled` 分支与键存在性断言 |
| 工具序号/单步耗时（C1/C2） | `apps/desktop/test/tool-run-head.test.mjs`、`tool-display.test.mjs` | 展示层源文本断言；耗时模型逻辑放 `lib/` 后可在 `subagent-topology.test.mjs` 真实单测 |
| 步骤契约（B1/B2） | 新建 `apps/desktop/test/plan-steps-contract.test.mjs` | 照 `plan-renderer-flow.test.mjs:24-30` 的源契约风格；解析函数抽到 `lib/plan-steps.ts` 后改为真实单测 |
| 侧栏进度与时长（B5/D4） | `apps/desktop/test/sidebar-session-status.test.mjs` | 断言 `renderSessionStatus` 输入 steps 后的输出文案 |
| 协议版本与事件（§6） | `packages/shared/src/protocol.test.ts:28-29` | `PROTOCOL_VERSION` / `SCHEMA_VERSION` 显式加断言 |
| 运行时 phase 推进（D2） | `packages/agent-runtime/src/runtime.test.ts` | 该文件已 232KB 且直接调 `setAgentActivity`（`:1356,1440`），只加最小用例，避免继续膨胀 |
| 日志面板（E1） | 新建 `apps/desktop/test/log-panel.test.mjs` | 源契约：RPC 名、分类映射、脱敏调用 |
| 产物面板（E3/E4） | 新建 `apps/desktop/test/artifact-panel.test.mjs` | 源契约：标签类型、分组顺序、只读边界 |

**基线不破坏**：每阶段结束跑 `pnpm -r --if-present typecheck`（须 8/8）与 `cd apps/desktop && node --test test/*.test.mjs`（须 ≥2050 通过 / 0 失败）。

---

## 8. 里程碑排期

| 阶段 | 范围 | 交付判定 | 依赖 | 规模 |
|---|---|---|---|---|
| **M0（本文档）** | 差距表 + P0/P1/P2 清单 + 契约/文案/测试落点 | 评审通过 | — | S |
| **M1 感知先行** | P0-A（A1–A3）+ P0-C（C1–C3） | 思考行有计时与呼吸态；工具行有 `#n · 1.2s`；组头有进度与总时长；typecheck 8/8、测试无回归 | M0 | S–M |
| **M2 防卡死** | P0-D（D1–D5） | 20s/45s/120s 三档升级可见且只推一次；侧栏显示已运行时长；断连显示重连次数 | M1（复用计时与泳道） | M |
| **M3 任务节点** | P0-B（B1–B5） | `第 3/8 步` 常驻可见、当前步高亮、点击定位；重启后步骤一致；Rust 迁移通过 | M2 | L |
| **M4 过程回看** | P1（E1–E6） | 日志面板可搜索跟随；产物三分组可用；变更可批量回滚 | M3 | L |
| **M5 并行与模式** | P2（F1–F3） | 多会话标签可切换且显示进度；工作模式入口生效 | M4 | L–XL |

排期建议：M1 与 M2 可并行（改动文件不重叠：`transcript/*` vs `electron/main/runtime/*`）；M3 是唯一触及 Rust schema 的里程碑，需单独分支与迁移测试。F4（远程调度）不排入本轮路线图。

---

## 9. 待确认项

| # | 决策点 | 方案 A | 方案 B | 倾向 |
|---|---|---|---|---|
| 1 | 步骤来源 | 从 plan markdown 解析有序列表/复选框（零模型改动，可能解析不准） | 让模型输出结构化 `steps`（准确，需改 prompt 与工具契约） | A 先行，B 作为 M3 末期增强 |
| 2 | 心跳归属 | main 进程看门狗（不改 Rust，只能看到「主进程视角」） | Rust `tokio::interval` 周期心跳（能反映 host 内部真实推进，需新事件与 schema） | 一期 A；若发现 host 内部挂起无法被 A 识别，再上 B |
| 3 | 阈值取值 | 20s / 45s / 120s 三档 | 按 provider 首包 P95 分位数动态调整 | 先固定值，后续用真实耗时分布校准 |
| 4 | 产物导出边界 | 新增 `fsWrite` RPC（渲染层可写盘，需严格白名单） | 只做「在文件夹中显示 + 复制路径」，导出交给插件 | B 更安全，导出另立项 |
| 5 | 工作模式建模 | 扩展 `Mode` 枚举 | 新增会话字段 `workMode?` 与 `Mode` 解耦 | B（`Mode` 已承载 plan/goal/agent 执行语义，混入交付物类型会污染 `normalizeMode`） |
| 6 | schema 迁移 | 直接 `SCHEMA_VERSION` 16→17（旧库不可回退） | 先做只读兼容（读不到 steps 时降级为无节点） | 迁移 + 降级读取并行，保证旧会话可打开 |

---

## 附：本文档未覆盖的内容

- 远程调度（F4）、移动端联动：需独立的产品与安全评估，不含在 M1–M5。
- WorkBuddy 的办公文档生成（docx/xlsx/pptx）本体能力：属模型与工具链能力，不是可视化问题，另行立项。
- 后端健壮性遗留项（`native-pi` 绕过会话互斥、通知 handler 无隔离、外链静默成功、`uncaughtException` 不退出、Rust 阻塞 IO）与本清单独立，建议单开一轮。
