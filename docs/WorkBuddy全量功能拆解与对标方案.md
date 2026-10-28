# WorkBuddy 全量功能拆解与对标方案

> 目标：把腾讯 WorkBuddy 拆成可实施的功能点，逐项对照本项目（京车小智工作台），给出一份「尽可能像」的改进方案。
> **本版口径（重要）**：本项目为**个人自用**，只模仿「实用功能 + 前端界面」；账号登录、套餐积分额度、云同步、多端账号、团队协作等商业化能力**一律剔除**（依据见 §3 与 §8，界面表现见 §5.4）。
> 上一版仅覆盖过程可视化，见 `docs/WorkBuddy对标功能改进清单.md`；本文档把它降级为第 5.1 节专题。
> 资料基准：WorkBuddy 官方文档 `codebuddy.cn/docs/workbuddy`（新建任务栏 / 右侧边栏）+ 腾讯云官方文章 + 公开评测，界面以 2026-09-28 的 5.6.2 版为准。**公开资料整理，未实机验证**；本项目证据均为真实代码 `path:line`。
> 基线：typecheck 8/8；`apps/desktop` 2050 通过 / 0 失败 / 6 跳过；i18n 8 语言。

---

## 1. WorkBuddy 功能全景（8 域 / 52 功能点）

### D1 入口与导航

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 1 | 四栏布局 | 顶部工具栏 / 左侧导航 / 中间工作区 / 右侧结果面板 |
| 2 | 新建任务 | 每个对话 = 一个独立任务，独立工作空间与上下文；未指定目录则自动建独立工作目录 |
| 3 | 任务列表 | 保存历史任务，可回溯、修改、重启 |
| 4 | 多任务切换 | 执行中任务显示在左侧边栏，随时切换查看进度 |
| 5 | 空间（工作空间） | 决定文件落在哪里；首次使用需授权文件夹 |
| 6 | 资料库 | 沉淀可被 AI 引用的资料集合 |
| 7 | 专家 / 技能中心 | 查看、启用、管理内置技能包与专家 |
| 8 | Claw 远程入口 | 设备绑定、远程任务记录 |
| 9 | 个人中心 | 账号登录、权限管理、个人数据、版本更新 |

### D2 任务与模式

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 10 | 三工作模式 | Ask（不改文件、消耗最低）/ Plan（先出方案再执行）/ Craft（直接读写文件交付） |
| 11 | 每对话独立上下文 | 任务之间互不影响，各自维护上下文与工作空间 |
| 12 | 多任务并行 | 同时发起并管理多个独立任务 |
| 13 | 循环执行确认 | 检测到可能循环时，在工具调用前暂停并弹确认（继续 / 停止） |
| 14 | 任务进程 | 本轮执行的步骤清单，可从浮层查看 |
| 15 | 随时介入 | 中断、补充指令、修正方向 |
| 16 | 任务重启 | 从历史任务重新开始 |

### D3 执行可视化

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 17 | 实时思考过程 | 中间区展示 AI 思考内容 |
| 18 | 执行步骤 | 多步骤进度条，当前步可见 |
| 19 | 运行日志 | 全程可视化，便于排查 |
| 20 | 每条回复运行时间 | 从发出消息起计时，响应时实时展示，完成后定格为最终耗时 |
| 21 | 工具调用明细 | 工具名、参数、结果、耗时 |
| 22 | 任务概览浮层 | 对话区右上角图标：产物（带数量）+ 任务进程 |

### D4 交付物与右侧面板

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 23 | 右侧标签页 | 产物 / 工作空间文件 / 变更 / 浏览器 / 终端，可同时打开、随时切换，支持全屏与关闭 |
| 24 | 产物聚合 | 按当前对话列出全部产物，无产物时显示「暂无产物文件」 |
| 25 | 全部中间文件 | 工作空间文件树 |
| 26 | 变更追踪 | 对本地文件的改动记录 |
| 27 | 文件预览编辑 | 在面板内预览并编辑 |
| 28 | 浏览器预览 | 内嵌浏览器打开网页 / 本地页面 |
| 29 | 终端 | 右侧标签页内终端 |
| 30 | Word 生成 | 报告 / 会议纪要 / 周报 / 邮件，框选即改（润色、改写、扩写） |
| 31 | Excel 分析 | 自然语言建透视表、分析趋势、生成图表，原表不变 |
| 32 | PPT 生成 | 一句话生成大纲 + 配图 + 讲稿，可预览后生成，批量套模板 |
| 33 | PDF | 生成与预览 |
| 34 | 导出 / 另存 | 产物另存、下载 |
| 35 | 人机双写 | V5.3.5：Word/Excel/PPT/Markdown 中框选让 AI 改写并写回原文件，版本记录可回退 |
| 36 | 模板体系 | 文档 / PPT 模板批量套用 |

### D5 扩展生态

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 37 | 专家中心 | 内置 140+ / 151 位专家，覆盖 12 大类 |
| 38 | 专家定制 | 上传知识库定制专属专家 |
| 39 | 专家团 | 多专家分工协作，复合指令并行处理 |
| 40 | 技能 | 平台 2 万+ 技能包，可沉淀为团队资产 |
| 41 | 连接器 | 打通外部系统（腾讯文档等） |
| 42 | 模型 + 自动模式 | 混元 / DeepSeek / GLM / Kimi / MiniMax，自动模式按任务复杂度选模型 |

### D6 跨端与远程

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 43 | Claw 五 IM 接入 | 微信 / 企微 / QQ / 飞书 / 钉钉，WebSocket 长连接 + HTTP webhook |
| 44 | 手机下达 | 语音下达任务、拍照发需求（白板 → 文档） |
| 45 | 三端同步 | PC / App / 小程序任务与产物实时同步 |

### D7 账号与商业化（本项目明确不做）

> 本项目为个人自用，无多租户、无运营诉求。以下三项仅作为 WorkBuddy 的功能记录，**一律不实现**，后续章节的矩阵判定统一标为「不做」。

| # | 功能点 | WorkBuddy 行为要点 | 本项目决定 |
|---|---|---|---|
| 46 | 登录 | 腾讯云账号 / 微信扫码 | **不做**：不做任何登录/账号 UI，启动即用 |
| 47 | 套餐与积分 | 不同模式积分消耗不同（Ask 最低、Craft 最高） | **不做**：不显示套餐、积分、额度、余额；模型用量只做本地统计（token 已可见） |
| 48 | 云同步 | 任务与产物多端一致 | **不做**：单机闭环，只提供本地备份/导出 |

### D8 安全与运维

| # | 功能点 | WorkBuddy 行为要点 |
|---|---|---|
| 49 | 首次文件夹授权 | 授权后仅在范围内读写 |
| 50 | 隐私说明 | 明确文件是否上传 |
| 51 | 自动更新 | 应用内检查更新 |
| 52 | 快捷键 | 常用操作可快捷触发 |

---

## 2. 全量对标矩阵

判定口径：**已有**＝可直接用；**部分具备**＝有机能但缺一层；**缺失**＝无对应实现；**不做**＝个人自用场景明确排除。

| # | 功能点 | 本项目现状 | 证据 | 判定 |
|---|---|---|---|---|
| 1 | 四栏布局 | 顶栏 + Sidebar + 转写区 + WorkPanel | `features/app/AppShell.tsx:85,234-247`、`components/workpanel/WorkPanel.tsx:135` | 已有 |
| 2 | 新建任务独立工作目录 | 新会话沿用当前项目根；每会话有 `scratch/`、`attachments/` | `electron/main/runtime/session-launch.ts:579-580` | 部分具备 |
| 3 | 任务列表（回溯/重启） | 分组/置顶/重命名/搜索/归档/删除齐全，无「重启任务」入口 | `Sidebar.tsx:1571,1848,1874,1920`、`protocol.ts:88` | 部分具备 |
| 4 | 多任务切换 | 引擎 `runningSessions: Record` 支持并行，UI 单 `activeSessionId` | `stores/app-state.ts:125,139-141`、`Sidebar.tsx:1441` | 部分具备 |
| 5 | 空间 / 首次授权 | 项目多根 + 插件 fs 规则 + 逐次同意，无「一次授权目录」模型 | `types/workspace.ts:38,44`、`plugin-fs-consent.ts:21-51` | 部分具备 |
| 6 | 资料库 | 无；仅有项目记忆/指令注入（`knowledge`、`library` 全仓 0 命中） | `session-launch.ts:338,349,371` | 缺失 |
| 7 | 专家/技能中心 | 技能页 + 插件页 + 市场；无专家中心 | `settings/AgentSkillsPage.tsx`、`features/plugins/` | 部分具备 |
| 8 | Claw 入口 | 无 | — | 缺失 |
| 9 | 个人中心 | 仅第三方 provider 的 OAuth / key；个人自用不需要账号中心 | `settings/VendorAccountsSection.tsx` | **不做**（顶栏改为设置 + 检查更新，见 §5.4） |
| 10 | 三工作模式 | `plan` / `goal` / `agent` 语义可映射，但缺 Ask，UI 无三选一 | `types/common.ts:2`、`composer/ComposerModeIcon.tsx`、`Composer.tsx:308-327` | 部分具备 |
| 11 | 独立上下文 | 会话级 messages / compaction / 用量 | `types/sessions.ts:54`、`context-compaction.ts:34` | 已有 |
| 12 | 多任务并行 | 引擎支持「sessions run independent agents」，界面一次只看一个 | `app-state.ts:139-141`、`transcript-slice.ts:152-155` | 部分具备 |
| 13 | 循环执行确认 | 有重复 Edit / 同路径变更的自动终止守卫，但不暂停询问 | `errors.ts:75-77`、`agent-runtime/src/runtime.ts:270-288` | 部分具备 |
| 14 | 任务进程 | 无 steps 结构 | `types/plans.ts:58-125` | 缺失 |
| 15 | 随时介入 | abort + steer + 排队（可编辑/插队） | `ComposerToolbar.tsx:282-303`、`ComposerStatus.tsx:53-139` | 已有 |
| 16 | 任务重启 | 可重发消息，无历史任务一键重启 | `Sidebar.tsx:1898` | 部分具备 |
| 17 | 实时思考过程 | 折叠思考行 + 摘要 ticker + 组级计时 | `transcript/shared.tsx:539-604`、`ActivityGroup.tsx:273-277` | 部分具备 |
| 18 | 执行步骤 | 无多步骤进度条 | 见 §5.1 | 缺失 |
| 19 | 运行日志 | NDJSON 落盘齐全，应用内仅「打开文件夹」 | `electron/main/logger.ts:236-341`、`ipc/diagnostics-ipc.ts:27-32` | 缺失 |
| 20 | 每条回复运行时间 | 只有组级「处理用时」，无 per-message 实时→定格 | `ActivityGroup.tsx:424-459`、i18n `chat.processedFor` | 部分具备 |
| 21 | 工具调用明细 | 名称/参数/结果 + spinner；普通工具无耗时无序号 | `transcript/ToolRow.tsx:449-461` | 部分具备 |
| 22 | 任务概览浮层 | 无；WorkPanel 只有平铺标签 | `lib/work-panel-tabs.ts:1-11` | 缺失 |
| 23 | 右侧标签页 | `new` / `review` / `file` / `plugin` / `sidechat` 五类，缺产物/终端 | `lib/work-panel-tabs.ts:1-11`、`workpanel/`（7 文件） | 部分具备 |
| 24 | 产物聚合 | 无按会话产物清单，只能逐个打开 | `app-store.ts:317-327` | 缺失 |
| 25 | 全部中间文件 | 工作区文件树 | `workpanel/FilesTab.tsx:175-246` | 已有 |
| 26 | 变更追踪 | `ReviewChange` 持久 diff + 回滚 | `types/workpanel.ts:25-39`、`protocol.ts:239` | 已有 |
| 27 | 文件预览编辑 | 只读预览（markdown/代码/图片），无编辑 | `FilesTab.tsx:73-140` | 部分具备 |
| 28 | 浏览器预览 | 内嵌 BrowserView + CDP | `electron/main/browser-host.ts:60`、`protocol.ts:276` | 已有 |
| 29 | 终端 | 无终端面板（`*erminal*` 0 文件） | `apps/desktop/src` | 缺失 |
| 30 | Word 生成 | 工具集只有 Read/Glob/Grep/Write/Edit/Bash + 插件工具 | `agent-runtime/src/runtime.ts:2983-2998` | 缺失 |
| 31 | Excel 分析 | 无生成/解析能力，无 exceljs 依赖 | `apps/desktop/package.json:33-60` | 缺失 |
| 32 | PPT 生成 | 无 pptxgenjs 等依赖 | 同上 | 缺失 |
| 33 | PDF | BrowserPreview 具备渲染能力但未接 `printToPDF` | `electron/main/browser-host.ts:60` | 部分具备 |
| 34 | 导出 / 另存 | 无写盘 RPC、无 `showSaveDialog` | `protocol.ts:246-253` | 缺失 |
| 35 | 人机双写 | 无文档编辑器；仅选区引用进输入框 | `components/SelectionQuoteButton.tsx` | 缺失 |
| 36 | 模板体系 | 只有插件脚手架与 prompt 模板 | `plugin-devkit/src/templates.ts`、`agent-runtime/src/prompt-templates.ts` | 缺失 |
| 37 | 专家中心 | 无；有可自定义 subagent | `types/subagent-definition.ts:29`、`settings/SubagentModelPicker.tsx` | 缺失 |
| 38 | 专家定制知识库 | 无 | — | 缺失 |
| 39 | 专家团 | `Task` 工具可并行委派子智能体，无编排与汇总视图 | `workpanel/SubagentPanel.tsx`、`lib/subagent-topology.ts` | 部分具备 |
| 40 | 技能 | 热插拔（全局 + 项目两层）+ 市场 + 编辑器 | `crates/host-core/src/user_skills.rs:140-149,558-575`、`protocol.ts:202-212` | 已有 |
| 41 | 连接器 | MCP 双端 + 本地控制服务 + 插件贡献 MCP servers | `electron/main/mcp-control.ts:56-58,821`、`spec/07-plugins/02-plugin-manifest-schema.md:85-97` | 部分具备 |
| 42 | 模型 + 自动模式 | 22 个内置 provider + 七档思考强度 + 子智能体独立模型；无自动路由 | `provider-presets.ts:28`、`types/models.ts:2`、`ComposerModelPicker.tsx:66` | 部分具备 |
| 43 | Claw 五 IM | 无 | — | 缺失 |
| 44 | 手机下达 | 无 | — | 缺失 |
| 45 | 三端同步 | 无 | — | **不做**（与 48 同属云同步，个人自用改为本地备份） |
| 46 | 登录 | 无自有账号 | `settings/VendorAccountsSection.tsx`（仅 provider OAuth） | **不做** |
| 47 | 套餐与积分 | 无；用户自带 key | — | **不做** |
| 48 | 云同步 | 无；全本机 SQLite + data 目录 | `crates/host-core/src/state.rs:35-125` | **不做** |
| 49 | 首次文件夹授权 | 有逐次同意，无首次引导 | `plugin-fs-consent.ts:21-51`、`workspace-roots.ts:44-82` | 部分具备 |
| 50 | 隐私说明 | 有 `docs/privacy-policy.md`，应用内无说明页 | `docs/privacy-policy.md` | 部分具备 |
| 51 | 自动更新 | electron-updater：Win NSIS / Linux AppImage 全自动 | `electron/main/updater.ts:8,37` | 已有 |
| 52 | 快捷键 | 可改键 + 快捷键表 | `types/settings.ts:58`、`keyboard-shortcuts.ts` | 已有 |

**分布**：需实现 47 项中，已有 9 项（1/11/15/25/26/28/40/51/52）、部分具备 20 项、缺失 18 项；另有 5 项（9/45/46/47/48）因个人自用**明确不做**。
**缺口结构**：交付物（30-36）、生态（37-38）、跨端（43-45）三块几乎整体空白；内核侧（Agent 循环 / 权限 / 审计 / 模型 / 插件 / 技能）反而强于 WorkBuddy 的公开描述。
**去商业化后的口径**：所有对标项必须是「单机可闭环」的——不引入服务端、不引入账号、不引入计费。凡是需要后端才能成立的项，一律归入 §8 不模仿清单。

---

## 3. 模仿策略分级

「尽可能模仿」不等于「全部照抄」。**个人自用是本项目的硬约束**：只模仿「实用功能 + 前端界面」，凡需要账号体系、服务端、计费与运营的能力全部剔除。

| 策略 | 含义 | 项数 | 说明 |
|---|---|---|---|
| **A 直接对齐** | 交互形态照做，底层复用现有能力 | 13 | 低成本高感知，优先做 |
| **B 改造实现** | 目标一致，实现路径换成本项目更合适的 | 14 | 需要设计，不新建引擎 |
| **C 自研替代** | 依赖外部服务，本机用等效方案实现 | 3 | 体验接近，成本可控 |
| **D 不模仿** | 与个人自用定位冲突或成本畸高 | 9 | 明确不做，写清理由 |

**A 类（13）**：四栏微调、任务概览浮层、每条回复耗时、三模式命名与语义、循环确认、产物聚合、导出另存、终端标签、任务历史重启、首次授权引导、隐私说明页、专家中心（用现有 subagent 升级）、模板套用。

**B 类（14）**：任务进程 steps、思考行增强、工具序号耗时、看门狗静默升级、日志面板、变更增强、预览增强、专家知识库、专家团编排、资料库、提示词库、自动选模型、多任务标签、`#` 引用与语音。

**C 类（3）**：PDF 用 `printToPDF`（本机 Electron 能力）；office 用插件 + JS 库（纯本地文件生成）；Claw 用局域网手机页 + 二维码配对（不接入 IM 平台）。

**D 类（9）**：账号/扫码登录（含个人中心入口）、套餐与积分额度、云同步与多端账号、五 IM 官方接入、小程序端、人机双写（格式保真回写）、2 万技能包运营、团队协作/分享链接。详见 §8。

> 已从上一版剔除的 3 项：**账号登录**（原 C 类「无需登录」）、**套餐积分**（原 C 类「本地用量统计」）、**云同步**（原 C 类「本地备份替代」）。前两项直接不做，第三项只保留本地备份（W-37），不上云。

---

## 4. 改进方案总表（W-01 … W-40）

规模：S ≤ 3 人日，M ≤ 10 人日，L ≤ 25 人日，XL > 25 人日。
**准入条件**：每项都必须能在单机内闭环——不新增服务端、不引入账号、不出现计费入口。任一条件不满足的项，直接进 §8 不模仿清单。

### 4.1 P0 — 体验闭环（M1 / M2）

| 编号 | 方案 | 功能点 | 落点 | 规模 |
|---|---|---|---|---|
| W-01 | **三模式对齐**：`Mode` 扩为 `read-only / plan / goal / agent`（wire 值用 `read-only`，避开 `PermissionMode` 已占用的 `ask`；`ask` 仅作历史别名归一），UI 三选一「问一问 / 想一想 / 做一做」，只读模式不写文件 | 10 | `types/common.ts:2`、`normalizeMode:6-11`、`crates/host-core/src/permissions.rs:148-239`（`read_only_mode_allows` 白名单）、`ComposerModeIcon.tsx`、8 语言 | M |
| W-02 | **每条回复运行时间**：assistant 消息尾部 `用时 12s`，流式中实时走、完成定格 | 20 | `transcript/AssistantTurns.tsx`、`events-slice.ts:240-247` | S |
| W-03 | **任务概览浮层**：对话区右上角图标 → 产物 N + 任务进程；点击产物开新标签；空态「暂无产物文件」 | 22/24 | 新建 `transcript/TaskOverviewPopover.tsx`；数据复用 `work-panel-slice` + steps | M |
| W-04 | **循环执行确认**：工具调用前做重复度检测（同工具同参数第 N 次），命中则暂停并弹「继续 / 停止」 | 13/13 | 复用 `errors.ts:75-77` 守卫、`runtime.ts:270-288`；新增待确认事件 + `ToolRow` 确认条。**已实施**时改为复用既有 asktool 通道（见 §11），未新增事件与 `ToolRow` 确认条 | M |
| W-05 | **任务进程 steps**（结构性，见 §5.1）——已实施：步骤从已批准的 Markdown 快照解析（不落库、不加迁移），进度由 `UpdateStep` 工具行重放得出，`第 3/8 步` 常驻转写流之上，当前步高亮、点击定位到工具行 | 18/18 | 新建 `packages/shared/src/plan-steps.ts`（`parsePlanSteps` / `planStepProgress`）、`runtime.ts`（`buildPlanStepTool` + 指令注入）、`apps/desktop/src/components/PlanStepBar.tsx`、`ChatTranscript.tsx` 挂载点、`styles/chrome.css` | L |
| W-06 | 思考行计时 / 常驻偏好 / 末行摘要 | 17 | `transcript/shared.tsx:539-604`、`ActivityGroup.tsx:343-349` | S |
| W-07 | 工具行序号 + 单步耗时 | 18/21 | `transcript/ToolRow.tsx:274-292,363` | S |
| W-08 | 看门狗 + 静默升级（20s / 45s / 120s） | 19 前置 | 新建 `electron/main/runtime/watchdog.ts`、`types/sessions.ts:150-174` | M |
| W-09 | 会话级「已运行 12m」「最后活动 30s 前」 | 4 | `Sidebar.tsx:1441-1444`、`agentStatuses.activity.since` | S |
| W-10 | 左侧任务行显示步骤进度 `3/8` | 4/18 | `Sidebar.tsx:1441`、`lib/sidebar-session-status.ts:14-50` | S |

### 4.2 P1 — 交付闭环（M3 / M4）

| 编号 | 方案 | 功能点 | 落点 | 规模 |
|---|---|---|---|---|
| W-11 | **产物聚合标签页**：`WorkPanelTabKind` 增 `artifact`，按会话三分组「产物 / 本次改动 / 全部文件」 | 23/24 | `lib/work-panel-tabs.ts:1-11,163-169`、新建 `workpanel/ArtifactsTab.tsx` | M |
| W-12 | **office 插件**：docx / xlsx / pptx 三工具，依赖打进插件包，产物落 `scratch/<sessionId>` | 30/31/32 | `plugin-runtime.ts:993-996`、`runtime.ts:2997`（PluginPack）、`protocol.ts:171-177` | L |
| W-13 | **PDF 生成**：隐藏 BrowserWindow 渲染 HTML → `printToPDF` → scratch | 33 | 复用 `browser-host.ts:60` | S |
| W-14 | **导出 / 另存 RPC**：`fsWrite`、`dialog.showSaveDialog`、`artifactExport` | 34 | `protocol.ts:246-253`（现全只读）、`IPC_WHITELIST:290-293`、`workspace-ipc.ts:744-773` | M |
| W-15 | **终端标签页**：先做「命令输出面板」（无交互 PTY），复用 host shell 流式输出；二期再评估 node-pty | 29 | `crates/host-core/src/tools/shell.rs`、`lib/work-panel-tabs.ts:1-11` | L |
| W-16 | **变更追踪增强**：按文件分组、批量回滚、与消息双向定位 | 26 | `workpanel/ReviewTab.tsx:9-47`、`protocol.ts:239` | M |
| W-17 | **运行日志面板**：按会话时间窗过滤、分类、搜索、跟随尾部 | 19 | `logger.ts:236-341`、新 RPC `logTail` | L |
| W-18 | **任务历史与重启**：历史任务页（重跑 / 复用输入 / 复用工作空间） | 3/16 | `Sidebar.tsx:1571`、新建 `pages/TasksPage.tsx` | M |
| W-19 | **富格式预览**：docx/xlsx/pptx 转 HTML 交给内嵌浏览器；PDF 用 Electron 自带 viewer | 27/33 | `browser-host.ts:60`、`protocol.ts:240-245` | M |
| W-20 | **首次授权引导 + 空间概念**：新任务时选择/授权工作目录，展示文件落点 | 5/49 | `workspace-roots.ts:44-82`、`plugin-fs-consent.ts:21-51` | M |
| W-21 | **应用内隐私说明页**：明确哪些内容上行、哪些只在本机 | 50 | `docs/privacy-policy.md`、`features/settings/SettingsPage.tsx` | S |
| W-22 | **模板体系**：文档/PPT 模板目录 + 变量 + 批量套用（先文件模板，后可视化编辑） | 36 | `workspace-ipc.ts:66`（现有模板加载）、`agent-runtime/src/prompt-templates.ts` | M |

### 4.3 P2 — 扩展生态（M5）

| 编号 | 方案 | 功能点 | 落点 | 规模 |
|---|---|---|---|---|
| W-23 | **专家中心**：把现有 subagent 升级为「专家」——分类、头像、默认模型、默认提示词、一键选用；先做 12 个领域预设（不追 151 位） | 37 | `types/subagent-definition.ts:29`、`settings/SubagentModelPicker.tsx`、新建 `pages/ExpertsPage.tsx` | L |
| W-24 | **专家知识库绑定**：专家可挂「资料集」，启动时注入引用索引而非全文 | 38 | `session-launch.ts:338-371`、W-26 | M |
| W-25 | **专家团**：一次指令派给多个专家，结果汇总成一份交付物 | 39 | `runtime.ts` Task 工具、`workpanel/SubagentPanel.tsx`、`lib/subagent-topology.ts` | L |
| W-26 | **资料库**：本地资料集（文件夹/文件/网页剪藏），可被 `@资料` 引用；复用 fsIndex 与附件存储 | 6 | `protocol.ts:252`（fsIndex）、`prompt-attachments.ts` | L |
| W-27 | **提示词库**：收藏、标签、上箭头历史召回、团队共享 | 输入侧 | `Composer.tsx:230`（现有增强草稿）、`lib/composer-draft-cache.ts` | M |
| W-28 | **自动模式选模型**：按模式/任务长度/是否含图/工具需求做规则路由，UI 增「自动」项 | 42 | `ComposerModelPicker.tsx:66`、`provider-presets.ts:28` | M |
| W-29 | **多任务并行标签**：顶部会话标签栏，标签显示步骤进度与运行态；`activeSessionId` 单值改造 | 4/12 | `app-state.ts:125,139-141`、`Sidebar.tsx:1441` | L |
| W-30 | **`#` 会话/片段引用** | 输入侧 | `composer-trigger.ts:15`（现只有 `/`、`@`） | M |
| W-31 | **语音输入**：系统级录音 + 转写（可先只做 Windows/macOS 原生） | 44 前置 | `ComposerToolbar.tsx:113` | M |
| W-32 | **本地模型预设**：Ollama / LM Studio 探测与一键添加 | 42 | `settings/ProviderSetupDialog.tsx:157`、`provider-presets.ts` | S |
| W-33 | **上下文挑选注入**：勾选消息/文件进入上下文，而非只看用量环 | 输入侧 | `ContextUsageInspector.tsx:38`、`lib/context-usage.ts:95` | M |
| W-34 | **连接器市场**：MCP 一键安装目录（把现有插件/MCP 能力产品化） | 41 | `mcp-control.ts:56-58,821`、`features/plugins/MarketplacePanel.tsx` | M |

### 4.4 P3 — 本地跨端与工程化（M6，全部可选）

> 上一版此处的 **W-38 云同步**、**W-39 账号与额度**、**W-44 人机双写** 已按「个人自用、去商业化」删除，编号整体前移，全文引用已同步。原 W-40 崩溃上报也收敛为纯本地转储。

| 编号 | 方案 | 功能点 | 落点 | 规模 |
|---|---|---|---|---|
| W-35 | **局域网手机控制页**（Claw 替代 1.0）：本机起 HTTPS + 二维码配对，手机浏览器下发任务、看进度、取产物；无账号、配对即身份 | 43/44 | 已有本地 HTTP 雏形 `mcp-control.ts:821`；新增配对令牌与鉴权 | L |
| W-36 | **Webhook 入口**：本机 POST 建任务、查状态、取产物，供自己的脚本/快捷指令调用 | 43 | 同 W-35 | M |
| W-37 | **本地备份 / 导出 / 恢复**：一键导出 data 目录与会话包，支持换机迁移 | 48 替代 | `crates/host-core/src/state.rs:35-125` | M |
| W-38 | **多窗口**：把任务在独立 BrowserWindow 打开 | 4 | 单主窗 `bootstrap/window.ts:148`、插件窗先例 `plugin-panel-host.ts:338` | L |
| W-39 | **LSP 集成**：编辑器侧跳转/诊断 | 生态 | 无现状，需新进程与协议 | XL |
| W-40 | **定时任务真实调度器**：现有 `ScheduledTask` 只有数据模型与「立即运行」 | 生态 | `runtime/scheduled.ts:23`（仅迁移，无轮询） | M |

**稳定性（不与上面并列编号）**：崩溃转储只写本机 `data/crash/`，不做任何上报（对标 WorkBuddy 的崩溃收集，但去掉云端）；实现上新增 `crashReporter` 初始化 + 设置页「打开崩溃目录」。

---

## 5. 重点专题（可视化 / 交付物 / 并行 / 界面规格）

### 5.1 过程可视化（用户最看重，P0）

完整方案见 `docs/WorkBuddy对标功能改进清单.md` 第 3 节，核心是四件事：

1. **思考过程有计时**：`思考中 · 12s` / `已思考 12s`，配低频呼吸态，避免「静止 = 卡死」（W-06）。
2. **任务节点有结构**：`PlanStep[]` 挂到计划域，`第 3/8 步` 常驻，当前步高亮，点击定位到工具行（W-05）。
3. **单步有编号与耗时**：`#3 · 1.2s`，组头 `第 3/8 步 · 已用 2m14s`（W-07）。
4. **静默会升级**：20s / 45s / 120s 三档提示 + 停止/重试入口，看门狗只在跨阈值时推一次（W-08）。

WorkBuddy 独有的两点这版补上：**每条回复独立计时并定格**（W-02）、**右上角任务概览浮层同时列产物与任务进程**（W-03）。

### 5.2 产物与交付（最大结构性缺口）

**结论：本项目唯一缺的是「office 文件写入器」这一块砖**，其余全部现成——技能分发、插件隔离与打包、scratch 目录、BrowserPreview 渲染宿主、审计与权限。

四步走：

| 步 | 动作 | 成本 | 说明 |
|---|---|---|---|
| 1 | 装技能 | 0 代码 / 1 天 | 内置技能目录已收录 `docx / pdf / pptx / xlsx` 四个条目（`packages/shared/src/skill-catalog-builtin.ts:23-62`），市场拉取通道已通 |
| 2 | 补执行运行时 | 1–2 周 | 推荐**插件路线**：office 插件内打包 `docx / exceljs / pptxgenjs`，用已有 `PluginPack`（`runtime.ts:2997`）分发，产物写 `scratch/<sessionId>`；避免主仓引入重依赖 |
| 3 | 打通写盘与导出 | 3–5 天 | 新增 `fsWrite` / `artifactExport` / `showSaveDialog`，WorkPanel 增 `artifact` 标签（W-11 / W-14） |
| 4 | 预览闭环 | 3–5 天 | 首版不自研渲染器：转 HTML 交 `BrowserPreview`，PDF 用 Electron 内置 viewer（W-19） |

**与 WorkBuddy 的差距收敛预期**：完成 1–4 步后，「一句话 → 产物 → 面板可见 → 可预览 → 可导出」闭环达成；仍不拥有人机双写与 2 万技能生态（见 §8）。

### 5.3 多任务并行（引擎已就绪，只缺 UI）

- 引擎侧已支持并行：`runningSessions: Record<string, boolean>`，注释明确 sessions run independent agents（`stores/app-state.ts:139-141`）。
- 缺口在「可见与可切换」：`activeSessionId` 是单值（`app-state.ts:125`），界面一次只能看一个会话。
- 改造路径（W-29）：新增 `openSessionTabs: string[]` + `activeTabId`，标签上复用现有运行态与步骤进度；侧栏列表保留，二者共享同一数据源；切标签时 WorkPanel 的 per-session context 已存在（`lib/work-panel-tabs.ts:45-73`），无需重写。
- 同时把「执行中任务显示在左侧」对齐：`Sidebar.tsx:1441` 增加 `3/8` 与时长（W-09 / W-10）。

### 5.4 前端界面还原规格（个人自用版）

「只模仿前端界面」需要一个可验收的版面清单。以下尺寸/比例是**参照 WorkBuddy 版面关系给出的建议值**（非官方标注），落点全部指向现有组件。

**(1) 顶栏（建议 48px，三段式）**

| 区 | 内容 | 落点 | 明确不出现 |
|---|---|---|---|
| 左 | 当前任务标题（可点改名） | `AppShell.tsx` 顶栏 | logo 大图、品牌横幅 |
| 中 | 模式三选一「问一问 / 想一想 / 做一做」+ 模型选择 + 思考强度 | `ComposerModeIcon.tsx`、`ComposerModelPicker.tsx`、`thinking-levels.ts` | — |
| 右 | 任务概览入口 → 设置（齿轮）→ 检查更新 | `WorkPanel` 入口、`SettingsPage`、`updater.ts` | **头像、昵称、登录、套餐、积分、Claw 绑定** |

**(2) 左侧栏（建议 260–300px，可拖拽）**

- 顶部：整宽主色「新建任务」按钮。
- 导航 4 项：任务 / 专家 / 技能 / 资料库（对应 W-18 / W-23 / 40 / W-26）。
- 任务列表：分组「今天 / 昨天 / 更早」；行高 32；hover 显示重命名、归档；运行中行左侧色点 + `3/8` + 时长。
- 底部：设置齿轮。
- **不做**：个人中心区块、Claw 设备卡、积分余额条。

**(3) 中间工作区**

- 自上而下：任务标题栏 →（有 steps 时）计划步骤条 → 转写流 → composer。
- 右上角：任务概览图标（产物数量 badge），点开即浮层（W-03）。
- assistant 消息尾部：`用时 12s`、复制、重新生成（W-02）。
- composer：多行、`+` 附件、`/` 命令、`@` 引用、模式与模型入口；发送与停止同键位切换。
- 空态：一句副标题 + 4 张示例任务卡（纯前端，成本极低、观感提升明显）。

**(4) 右侧栏（建议 360–560px，可拖拽 / 可全屏 / 可关闭）**

- 标签栏形态对齐 WorkBuddy：`图标 + 标题 + ×`，末尾 `+` 弹出五类（产物 / 文件 / 变更 / 浏览器 / 终端）。
- 空态文案：「暂无产物文件」+ 一行「任务生成的文件会出现在这里」。
- 标签集按会话隔离：切任务时恢复该任务自己的标签与滚动位置（`lib/work-panel-tabs.ts:45-73` 已有 per-session context）。

**(5) 视觉规范（建议值）**

| 项 | 取值 |
|---|---|
| 圆角 | 6（行内元素）/ 8（卡片）/ 12（浮层） |
| 行高 | 32（列表）、36（按钮）、24（消息内行） |
| 间距 | 4 / 8 / 12 / 16 四档，禁止出现 5、7、10 这类散值 |
| 字号 | 12（元信息）/ 13（正文辅）/ 14（正文）/ 16（标题） |
| 状态色 | 运行中蓝、成功绿、失败红、长时间静默黄（W-08 用） |
| 动效 | 呼吸点 2s、ticker 淡入 200ms、标签切换 120ms；不使用骨架屏闪烁 |
| 等宽字体 | 耗时、路径、`#3 · 1.2s` 一律等宽，避免数字跳动 |

**(6) 去商业化的界面表现（负向清单，评审时逐条核对）**

1. 首启直接进主界面，无登录、无引导页、无「剩余额度」提示。
2. 设置页不出现「账户」「订阅」「套餐」「额度」「发票」分组。
3. 顶栏无头像/昵称入口；无「升级」角标。
4. 模型选择里不显示价格与倍率，只显示名称与上下文长度。
5. 用量只用上下文占比环（`ContextUsageInspector.tsx:38`），不折算金额。
6. 任何「分享 / 邀请 / 团队」入口都不出现。

**(7) 界面还原验收（肉眼可查）**

- 1080p 下四栏同屏可见，右侧默认约 420px，不出现横向滚动。
- 单任务闭环 3 步可达：新建 → 看步骤进度 → 切到产物 → 另存。
- 关键标签文案与 WorkBuddy 一致：`新建任务`、`问一问 / 想一想 / 做一做`、`任务`、`产物`、`变更`、`终端`、`暂无产物文件`、`第 3/8 步`、`用时 12s`。

---

## 6. 分层实施路线

| 里程碑 | 范围 | 交付判定 | 依赖 | 规模 |
|---|---|---|---|---|
| **M1 感知** | W-02 / W-06 / W-07 / W-08 / W-09 | 思考行有计时与呼吸态；回复尾部有定格耗时；工具行 `#n · 1.2s`；静默 20/45/120s 三档且只推一次 | — | S–M |
| **M2 任务与模式** | W-01 / W-03 / W-04 / W-05 / W-10 | Ask/Plan/Craft 三选一生效（Ask 不写文件）；右上角浮层可用；步骤 `第 3/8 步`；循环确认可暂停 | M1（复用 steps 与计时） | M–L |
| **M3 交付闭环** | W-11 / W-12 / W-13 / W-14 / W-19 | 产物标签可用；docx/xlsx/pptx 能生成并预览；可另存到用户目录 | M2 | L |
| **M4 交付收尾** | W-15 / W-16 / W-17 / W-18 / W-20 / W-21 / W-22 | 终端/日志两个新标签；任务历史可重跑；首次授权引导；模板套用 | M3 | M |
| **M5 生态** | W-23 – W-34 | 专家中心 12 预设；资料库可引用；多任务标签；自动选模型 | M4 | L |
| **M6 本地跨端** | W-35 – W-40（全部可选，按需裁剪） | 手机页可下发任务并取产物；本地备份恢复；定时调度 | M5 | XL |

> 路线图已剔除账号、计费、云同步：M1–M6 全部为单机可交付。M6 若不做，产品仍是完整形态。

排序理由：M1/M2 直接消除「以为卡死」，是用户当前最痛的点；M3 是「像 WorkBuddy」的观感分水岭（没有产物面板就永远像聊天工具）；M5 才谈生态，否则专家/资料库没有消费场景。

M1 与 M2 可并行（改动文件不重叠：`transcript/*` vs `electron/main/runtime/*` + `types/*`）；M3 的 office 插件与主仓解耦，可独立发包验证。

---

## 7. 工程约束与风险

| 约束 | 具体要求 | 风险 |
|---|---|---|
| 新依赖 | office 三库（`docx`/`exceljs`/`pptxgenjs`）**放进插件包**，不进主仓 `package.json` | 主仓体积从 ~122MB 起增；插件安装需校验完整性 |
| 许可 | 三库均为 MIT / Apache-2.0，需在插件 README 标注 | 低 |
| 原生模块 | 终端若走 `node-pty` 需 electron-rebuild，与现有打包链冲突 | 一期只做「命令输出面板」，不做交互 PTY |
| 写盘安全 | 新增 `fsWrite` 必须限制在已授权根 + 拒绝符号链接逃逸 + 审计落盘 | 与现有 `denylist`（`tools/ignore_rules.rs:5-7`）、审计（`audit.rs:9-70`）保持一致 |
| Rust schema | steps 需 `SCHEMA_VERSION` 16→17，并保证旧库可读（读不到降级为无节点） | 必须写迁移测试 |
| i18n | 所有新文案 8 语言齐备（en/zh-CN/zh-TW/de/es/fr/ko/tr） | 有 `catalogs.test.mjs` 守门 |
| 测试基线 | 每阶段 `pnpm -r typecheck` 8/8；desktop ≥2050 通过 / 0 失败 | 新增用例集中在 `active-turn-surface` / 新建 `plan-steps-contract` / `artifact-panel` |
| 不改内核语义 | 不动 Agent 循环、权限裁决、审计结构 | 只加只读字段与可选事件 |
| 去商业化（硬约束） | 不新增服务端代码；不出现登录、套餐、积分、额度、分享、邀请 UI；不引入需要联网鉴权的 SDK | 出现即回退评审；后续需求若提到「账号/付费/云端」默认拒绝 |
| 本地优先 | 新增能力的默认路径必须离线可用；联网仅限用户自带 provider key 调用模型本身 | 断网时除模型调用外功能完整 |

---

## 8. 不模仿清单及理由

| WorkBuddy 能力 | 不做的理由（个人自用口径） | 替代 |
|---|---|---|
| 账号登录（腾讯云 / 微信扫码） | 单用户单机，登录只增加摩擦与隐私面，不带来任何能力 | 启动即用，无账号概念 |
| 套餐 / 积分 / 额度 / 余额 | 无计费主体，模型费用由自己的 API key 直接结算；界面出现额度只会干扰 | 只在设置里显示上下文用量环，不折算金额 |
| 云同步 / 多端账号体系 | 需要服务端、鉴权与数据合规，属于另一个产品 | W-37 本地备份/导出/恢复，换机手动迁移 |
| 五 IM 官方接入（微信/企微/QQ/飞书/钉钉） | 需企业资质、审核与长连接后台，个人无法承担 | W-35 局域网手机页 + W-36 webhook（自己的脚本够用） |
| 小程序端 | 需云托管与平台审核 | 手机浏览器访问 W-35 页面即可 |
| 人机双写（Word/Excel/PPT 框选改写回写） | 等于再造一个格式保真编辑器，成本 XL；产物生成已覆盖 90% 场景 | 生成 → 预览 → 另存 → 针对单段定向重生成 |
| 2 万技能包 / 151 位专家运营 | 属内容运营而非工程能力，个人使用也用不到长尾 | 12 个领域预设 + 技能市场按需拉取 |
| 团队协作 / 分享链接 / 邀请 | 无协作者，分享即发送文件 | 产物直接另存或复制路径 |

> 判定原则一句话：**需要「另一个人的账号」或「一台我的服务器」才能成立的功能，一律不做。**

---

## 9. 验收矩阵

| 改进项 | 可测点 | 测试落点 |
|---|---|---|
| W-01 三模式 | `normalizeMode` 接受 `read-only` 与别名 `ask`；只读模式下写文件工具被拒绝 | `packages/shared/src/protocol.test.ts`、`crates/host-core/src/permissions.rs` 单测 |
| W-02 回复耗时 | 流式中每秒更新，完成后不再变化 | 新建 `apps/desktop/test/turn-duration.test.mjs` |
| W-03 概览浮层 | 产物数、任务进程、空态文案 | 新建 `task-overview-popover.test.mjs` |
| W-05 步骤 | steps 解析、推进、重启一致 | 新建 `plan-steps-contract.test.mjs` |
| W-08 静默升级 | 20s/45s/120s 各触发一次且仅一次 | `active-turn-surface.test.mjs` |
| W-11/W-14 产物 | 标签类型、分组顺序、写盘仅在授权根内 | 新建 `artifact-panel.test.mjs` |
| W-12 office | 生成文件可打开、字段完整 | 插件包内自带 e2e |
| W-17 日志 | 过滤、尾部跟随、脱敏 | 新建 `log-panel.test.mjs` |
| W-29 多任务 | 标签切换不串会话、运行态正确 | `sidebar-session-status.test.mjs` + 新建 `session-tabs.test.mjs` |
| 去商业化（§8） | 全部 8 语言 catalog 中不存在 `login` / `subscription` / `quota` / `credits` / `plan.*price` 类键；设置页渲染后无「账户/套餐/额度」分组；顶栏无头像节点 | 新建 `apps/desktop/test/no-commercial-ui.test.mjs`（扫描 i18n key + 关键组件导出） |
| 界面还原（§5.4） | 标签栏五类可开出；空态文案正确；四栏在 1080p 同屏无横向滚动 | 新建 `work-panel-artifact-tab.test.mjs` + 视觉回归截图 |

---

## 10. 一页总结

- WorkBuddy 的 52 项能力里：本项目**已有 9 项、部分具备 20 项、缺失 18 项、明确不做 5 项**（个人中心 / 账号 / 套餐积分 / 云同步 / 三端账号）。
- 缺失集中在**交付物（office + 导出 + 终端）、生态（专家/资料库）、跨端（Claw）**，而非 Agent 内核。
- 去商业化后目标形态更简单：**不登录、不付费、除模型调用外全离线的个人工作台**。「尽可能像」= 版面像 + 过程可见 + 产物可交付，仅此三条。
- 最短路径：**M1 感知 → M2 三模式与步骤 → M3 产物闭环**；M6 全部可选，不做也不残缺。
- 界面以 §5.4 为验收清单：顶栏无头像、左栏四入口、右侧五类标签、`第 3/8 步`、`用时 12s`、`暂无产物文件`。
- 用户最在意的「以为卡死」由 **W-02 / W-05 / W-06 / W-07 / W-08 / W-09** 六项覆盖，全部在 M1–M2，不改内核语义。

---

## 11. 实施记录（M1、M2 均已收口）

> 本节每一行都对应真实代码改动与测试；§4 的编号与范围保持不变。
> 截至 2026-10-28 的完整盘点（做了什么 / 剩下什么 / 下一步排序）见 `docs/进度报告-2026-10-28.md`。

| 编号 | 状态 | 落点 | 验证 |
|---|---|---|---|
| W-02 每条回复用时 | 已实施 | `features/chat/transcript/AssistantTurn.tsx`：整轮墙钟，流式每秒递增、完成定格，重载时按末条时间戳重建；`transcript/shared.tsx`：`MessageMeta` 新增 `durationMs` / `live`；`styles/messages.css`：等宽数字防跳动 | `test/reply-duration-and-step-rows.test.mjs` |
| W-07 工具序号与耗时 | 已实施 | `transcript/ToolRow.tsx`：`stepIndex` + 单步耗时（运行中 tick，`toolDurationMs` 到达后定格）；`transcript/ActivityGroup.tsx`：组内计数，仅当工具数 > 1 才显示序号 | 同上 |
| W-08 长时间静默提示 | 已实施 | 新增 `transcript/silence-ladder.ts`：`SILENCE_RUNGS = [20, 45, 120]`、`silenceLevel`（单调升档）、`SILENCE_HINT_KEYS` 与兜底文案；`transcript/ActivityGroup.tsx`：`WorkingIndicator` 按档位选文案并暴露 `data-silence`，`aria-live="polite"` 只播当前档；`styles/messages.css`：`.is-slow` 换行不挤压标签，第三档提亮为 `--ds-text-secondary`；8 语言新增 `verySlowResponseHint` / `stalledResponseHint`。**与 §4.1 的差异**：没有新建 `electron/main/runtime/watchdog.ts`——`elapsed` 每秒 tick 且档位只升不降，文本天然只在跨档时变化，等价且不必新增跨进程通道；停止入口沿用 `ComposerStatus` 已有的 abort | `test/slow-response-hint.test.mjs`（3 例，含 8 语言 key 完整性） |
| W-09 侧栏运行时长 | 已实施 | 新增 `components/SessionRunningElapsed.tsx`（组件内自 tick，避免整栏每秒重渲染）；接入 `components/Sidebar.tsx`；`styles/sidebar-threads.css` | `test/session-running-elapsed.test.mjs` |
| W-06 思考行计时 | 已具备 | `ActivityGroup.tsx` 已有 `chat.thinkingFor` / `chat.thoughtFor` 与 1s tick，无需改动 | 人工核对 |
| W-03 任务概览浮层 | 已实施 | 新增 `components/TaskOverviewPopover.tsx`（触发器 + 浮层，复用 `placeContextInspector` 定位、点击外部/Esc 关闭）；接入 `components/ConversationTopbar.tsx` 右上角；`styles/chrome.css`。产物 = 转写中 `Write`/`Edit` 的 review 记录（按路径去重、排除已回滚），任务进程 = 工具调用末 6 条且保留全局序号；产物行点击开文件标签。**落点与 §4.1 的 `transcript/` 不同**：它是顶栏控件，与 `ConversationTopbar` 同目录更内聚 | `test/task-overview-popover.test.mjs` |
| W-05 任务进程步骤 | 已实施 | **不落库、不加迁移**：步骤从 `planCheckpoints[sessionId].markdown`（用户批准的那份快照）解析，进度从转写里的 `UpdateStep` 工具行重放，因此重启、第二个窗口、侧栏读到的是同一组数字。`packages/shared/src/plan-steps.ts`：`parsePlanSteps`（勾选框 → 编号列表 → `Step N:` → 编号标题，首个产出 ≥2 项的形态胜出，跳过围栏代码，上限 40）+ `planStepProgress`（只计成功行、单调不回退、`anchors` 记录每步起始行）；`runtime.ts`：仅 `autonomousExecution && mode === "agent" && planSteps.length >= 2` 时注册 `UpdateStep`（核心工具集），批准执行时注入 `<approved-steps>` 清单并要求「进入第 n 步前调用 `step=<n>`」，普通 prompt 清空并在重建目录时摘掉；`components/PlanStepBar.tsx`：`第 3/8 步` + 步骤药丸（done/active），点击按 `[data-message-id]` 滚到对应工具行；挂在 `.thread-scroll` **之外**（不随转写滚动、不影响 minimap 测高），阅读窗口隐藏。**落点与 §4.1 的 Rust `plans/{model,repository}.rs` 不同**：Rust 侧无需改动即可满足「重启一致」，因为快照与工具行本就持久化 | `packages/shared/src/plan-steps.test.ts`（15 例，含重启重放与失败行不计）、`packages/agent-runtime/src/runtime.test.ts`（`offers a step marker only while an approved contract executes`）、`test/plan-steps-contract.test.mjs`（6 例） |
| W-10 侧栏步骤进度 | 已实施 | 新增 `components/SessionPlanProgress.tsx`：运行中的会话行显示 `3/8`，与 W-05 共用 `parsePlanSteps` / `planStepProgress`，**没有第二个计数器**。数据源为 `activeSessionId` 的 `messages`，其他会话用 `retainedTranscripts`（保留 pane 最后画面）；没有转写的会话不显示（宁可空白也不写假的 `0/8`）。只有 `runningSessions[id] === true` 才挂内层组件，空闲行不参与转写重放。接入 `components/Sidebar.tsx`；`styles/sidebar-threads.css` 新增 `.thread-item-steps`。**已知局限**：后台会话切走后进度停住，切回即校正 | `test/session-plan-progress.test.mjs`（4 例） |
| W-04 循环执行确认 | 已实施 | 判定 = **同工具 + 同参数 + 同结果**：`runtime.ts` 的 `repeatCallKey`（键排序、长字符串截 200 字符、`Map` 上限 64）与结果指纹（`ok\|text.slice(0,400)`）一致才累加，指纹一变即清零，所以「同一处反复改、每次都有新报错」不会被误杀。第 3 次命中时在写锁**之外** `await pauseRepeatedCall(...)` 挂起该次调用，经 `waitForAskTool` 发问、`resolveAskTool` 收回，`continue` 放行并 `resetMutationBudget`（否则同一步会被 mutation failure budget 立刻再杀一次），`stop` 以 `details.errorCode = "REPEAT_CALL_STOPPED"` 终止并走 `reportRepeatTermination` 收轮。**与 §4.1 的差异（两条）**：①没有新增待确认事件——asktool 通道本就能从 runtime 阻塞到 renderer 再 resolve，复用它等于零新增跨进程协议；②确认条不在 `ToolRow`，而在 `AskToolCard` 的 guard 形态（标题/问题/两个按钮全部走 locale，隐藏进度、指示点、全部拒绝、跳过与自定义输入，点一下即决策）。问题文本用哨兵 `@@repeat-guard@@<tool>\|<count>`，两端都从 `packages/shared/src/repeat-guard.ts` 读写，renderer 侧翻成 8 语言文案；`resolveRepeatGuardDecision` 把「关闭窗口 / 中途放弃 / 无答案」一律当 `stop` | `packages/shared/src/repeat-guard.test.ts`（4 例）、`packages/agent-runtime/src/runtime.test.ts`（`pauses a repeated Edit mismatch and stops when the user says so` / `runs the third identical call after the user chooses to continue` / `does not ask when the repeated call keeps producing new output`）、`test/repeat-guard-card.test.mjs`（5 例，含 8 语言 key 齐平） |

新增 i18n key（8 语言已齐）：`nav.sessionRunningFor`、`chat.slowResponseHint`、`chat.verySlowResponseHint`、`chat.stalledResponseHint`、`chat.overview{Title,Elapsed,Artifacts,NoArtifacts,Steps,NoSteps,ToolCalls}`、`settings.modeReadOnly`、`chat.modeReadOnly`、`chat.modeReadOnlyHint`、`chat.stepsProgress`、`chat.stepsPending`、`chat.stepsGoTo`、`askTool.repeatGuard{Title,Question,Continue,Stop}`。

基线：`apps/desktop` 2091 tests / 2085 pass / 6 skip / 0 fail；`packages/shared` 700 pass；`packages/agent-runtime` 475 pass；`packages/i18n` 24 pass；`cargo test -p host-core` 429 pass / 0 fail；受影响包 build（含 tsc）通过；`check-style-tokens.mjs` 通过。





