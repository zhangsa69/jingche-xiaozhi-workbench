# 06. 公司管控中心

> **翻译说明：** 本页是与 [英文源规格](/spec/02-architecture/06-control-plane) 一一对应的机器辅助翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

> 范围：公司部署 PI-Desktop 时的员工身份、网关配置与小智豆额度。
> 状态：已接受（ADR 0267）
> 交叉引用：[01-architecture](01-architecture.md) ·
> [ADR 0267](../../adr/0267-standalone-control-plane-for-accounts-gateway-and-quota.md) ·
> [deploy README](../../../apps/control-plane/deploy/README.md) ·
> [E2E plan](../06-delivery/04-e2e-test-plan.md)

---

## 1. 在进程模型中的位置

管控中心是**叠加**的。它不会把智能体执行、会话存储或宿主协议搬离桌面端。

```text
Renderer  ── preload IPC ──►  Electron Main  ── HTTPS ──►  control-plane (Linux)
    │                              │                            │
    └─ UI、网关门槛、额度胶囊        └─ 会话 + 令牌（永不进渲染层）  └─ 自有 SQLite、SMTP、网关代理
```

硬性规则：

- 令牌、SMTP 凭据、网关密钥与服务端数据库永不进入渲染层。
- 渲染层只看到身份与额度的投影（`ControlPlaneStatus`）。
- 未配置管控中心的部署（`required: false`）与本地安装完全一致。

## 2. 仓库结构

| 路径 | 职责 |
|---|---|
| `apps/control-plane/src/main.rs` | 进程入口、tracing、优雅关闭 |
| `apps/control-plane/src/config.rs` | 环境配置与校验 |
| `apps/control-plane/src/api/` | HTTP 路由：auth、me、usage、网关代理、admin |
| `apps/control-plane/src/auth/` | 口令哈希、令牌签名、验证码 |
| `apps/control-plane/src/domain/` | 用户、网关、额度流水、审计 |
| `apps/control-plane/migrations/` | 版本化 SQLite 表结构 |
| `apps/control-plane/web/` | 管理控制台（React + Vite） |
| `apps/control-plane/deploy/` | systemd 单元、nginx 示例、环境变量示例、备份脚本 |
| `apps/desktop/electron/main/control-plane-client.ts` | 桌面客户端、会话持久化 |
| `apps/desktop/electron/main/ipc/control-plane-ipc.ts` | IPC 通道与入参校验 |
| `apps/desktop/src/features/auth/` | 启动门槛、登录、账号胶囊 |

管控中心是独立的 workspace crate，拥有自己的数据库与迁移序列。它不复用 host-core 的 `user_version` 链，也不得触碰客户端数据库。

## 3. 数据模型

| 表 | 用途 |
|---|---|
| `users` | 账号、显示名、角色、状态、口令哈希 |
| `email_codes` | 带用途、有效期、尝试次数的验证码 |
| `sessions` | 刷新令牌哈希、有效期、吊销、User-Agent |
| `gateways` | 提供商 base URL、模型、加密凭据、默认标记 |
| `quota_accounts` | 以毫豆为单位的权威余额 |
| `quota_ledger` | 每次发放/调整为记录，含操作者与变动后余额 |
| `usage_events` | 按请求的令牌与豆结算（`request_id` 唯一） |
| `quota_policy` | 令牌→豆的换算、默认发放、周期上限 |
| `audit_log` | 操作者、动作、目标、负载、IP、时间戳 |

索引覆盖运维上关键的访问路径：`users(status)`、`users(created_at)`、`quota_ledger(user_id, created_at)`、`usage_events(user_id, created_at)`、`usage_events(created_at DESC)`、`audit_log(created_at DESC)`、`audit_log(action, created_at DESC)`。

## 4. 身份生命周期

1. **请求验证码**（`POST /api/v1/auth/register/code`）——拒绝已存在的邮箱，按邮箱冷却、按小时限次，并限制 IP 窗口。
2. **注册**（`POST /api/v1/auth/register`）——核销验证码，校验口令强度（≥ 10 字符、首尾无空白、命中黑名单则拒绝），发放 `default_grant_millibeans` 并立即签发会话。
3. **登录**（`POST /api/v1/auth/login`）——失败按 `email|ip` 累加防护计数；达上限后 15 分钟内返回 `429`。登录成功清零并写入审计事件。
4. **刷新**（`POST /api/v1/auth/refresh`）——原地轮换刷新哈希；被吊销、已过期或账号被停用时返回 `SESSION_REVOKED`。
5. **登出**（`POST /api/v1/auth/logout`）——吊销刷新会话。即便调用失败，桌面端也会清理本地状态。
6. **重置**（`POST /api/v1/auth/password/reset`）——核销重置码，替换哈希，并吊销该账号的**全部**会话。

访问令牌短生命周期（`CONTROL_PLANE_ACCESS_TTL_SECONDS`，默认 900），使用 `CONTROL_PLANE_SECRET` 签名。刷新令牌以哈希形式存储，并在每次刷新时轮换。

对未知邮箱重置口令，返回与已知邮箱相同的提示，使该端点无法用于枚举员工。

## 5. 小智豆账本

服务端是唯一权威。

- 余额以整数**毫豆**存储，避免浮点漂移。
- `quota_policy` 持有 `millibeans_per_1k_prompt`、`millibeans_per_1k_completion`、`default_grant_millibeans`、`period`（`daily` | `weekly` | `monthly` | `none`）与 `period_millibeans`。
- 换算**仅在**服务端发生。客户端无法提交自己的费率、价格或余额。
- `charge` 在单个 SQLite 事务内完成读-校验-写，因此并发上报不会超支余额或周期上限。
- `usage_events.request_id` 唯一：重试的上报返回 `Duplicate` 并带回原始扣费，不会重复计费。
- 余额或周期上限耗尽时返回 `402 INSUFFICIENT_QUOTA`。

发放与人工调整会向 `quota_ledger` 追加记录，含操作者、原因与变动后余额，因此每一次余额变化都可解释。

**谁来扣费。** 代理不扣费。桌面端在每轮结束后上报一次 `POST /api/v1/usage/charge`，携带 `promptTokens` 与 `completionTokens`；服务端套用策略。这样小规模部署的热路径不含计费逻辑，代价是信任客户端的令牌计数：被改造的客户端可以少报。价格、周期上限与余额始终留在服务端，每次扣费都带操作者写入审计，`request_id` 让重试上报幂等。代理仍会预检余额，因此耗尽的账号无法开始新一轮。

## 6. 网关配置

- 网关记录保存提供商、base URL、默认模型、启用标记，以及用部署密钥封装的凭据。
- 管理控制台只显示打码后的凭据；明文不会被任何读接口返回，也不会写入日志。
- `POST /api/v1/admin/gateways/{id}/test` 执行有界探测并回报结果，不回显密钥。
- 员工调用 `POST /api/v1/gateway/chat/completions`；服务端注入凭据并转发响应。流式回答从首个分片起逐字节转发（反向代理必须保持 `proxy_buffering off`），请求会被改写以补上 `stream_options.include_usage`，使末尾分片带回令牌数供客户端上报。
- 对按会话 id 路由的上游，代理会补一个推导出的 `x-opencode-session` 头，在一次桌面登录内保持稳定。opencode zen 端点缺失该头会直接拒绝（`400 Request is missing x-opencode-session`），在客户端表现为 `502 GATEWAY_ERROR`。忽略该头的提供商不受影响，且该值不含会话行 id。
- 该路由由网关作用域的令牌（见 §7）认证；完整会话令牌同样可用，因此管理控制台与脚本无需特殊路径。
- 轮换 `CONTROL_PLANE_SECRET` 会使已存储的网关凭据不可读，之后必须重新录入密钥。部署指南中有说明。

## 7. HTTP 接口面

响应信封：成功为 `{ "data": ... }`，失败为 `{ "error": { "code", "message" } }`。

| 分组 | 路由 |
|---|---|
| 认证 | `auth/register/code`、`auth/register`、`auth/login`、`auth/refresh`、`auth/logout`、`auth/password/code`、`auth/password/reset`、`auth/gateway-token` |
| 自身 | `me`、`me/usage` |
| 用量 | `usage/charge` |
| 网关 | `gateway/chat/completions` |
| 管理 | `admin/overview`、`admin/users`、`admin/users/{id}`、`admin/users/{id}/grant`、`admin/users/{id}/ledger`、`admin/gateways`、`admin/gateways/{id}`、`admin/gateways/{id}/test`、`admin/quota-policy`、`admin/ledger`、`admin/audit`、`admin/system` |
| 运维 | `GET /healthz`、`GET /readyz` |

桌面端使用的错误码：`INVALID_CREDENTIALS`、`SESSION_REVOKED`、`EMAIL_ALREADY_REGISTERED`、`INSUFFICIENT_QUOTA`、`RATE_LIMITED`、`FORBIDDEN`、`SERVICE_UNAVAILABLE`。

管理路由要求 `role = "admin"`；注册时对 `CONTROL_PLANE_ADMIN_EMAILS` 中的邮箱直接赋该角色。

### 令牌作用域

`POST /api/v1/auth/gateway-token` 用一个会话换取 `scope = "gateway"` 的令牌，有效期不超过 `CONTROL_PLANE_GATEWAY_TOKEN_DAYS`（并受会话到期时间约束）。它与同一 `sessions` 行绑定，因此登出、账号停用或口令重置都会立即使其失效，且无需改表。`AuthUser` 会以 `403 FORBIDDEN_SCOPE` 拒绝网关作用域令牌，因此运行时持有的凭据无法读 `/me`、调用管理 API 或扣减账本。在作用域机制出现之前签发的令牌按 `scope = "full"` 解析。

## 8. 桌面端集成

- `PI_DESKTOP_CONTROL_PLANE_URL` 选择源站。它会被规范化（去尾部斜杠、必须有 scheme），并优先于会话中保存的源站。
- 除非主机是回环地址，或设置了 `PI_DESKTOP_ALLOW_INSECURE_CONTROL_PLANE=1` **且** 主机属于 RFC1918 / IPv6 ULA，否则拒绝明文 HTTP。该开关是为没有证书颁发机构的内部试点准备，永不放开公网主机。未开启时，已配置但被拒的源站会以明确说明阻断工作台，而不是退化成“没有管控中心”。
- 会话文件（`control-plane-session.json`，权限 `0600`）保存源站、两个令牌与访问令牌到期时间。平台支持时，令牌用 Electron `safeStorage` 封装。
- IPC 通道：`controlPlaneStatus`、`controlPlaneLogin`、`controlPlaneRegister`、`controlPlaneRequestCode`、`controlPlaneResetPassword`、`controlPlaneLogout`、`controlPlaneRefreshProfile`，外加 `controlPlaneChanged` 事件。
- **网关提供商。** 登录后主进程创建（或刷新）一行 host-core 提供商记录，名称为 京车小智模型网关：`openai_compatible`，`baseUrl` 为去掉 `/chat/completions` 的代理端点，凭据为网关令牌。指纹文件（`control-plane-provider.json`）避免每次刷新都写盘；登出会停用该记录。
- **部署方拥有模型行。** 当管控中心为必需（`required: true`）时，不允许任何其他模型服务：主进程强制把网关记录写入 `defaultProviderId` / `defaultModelId`，在会话有效期内停用其余所有提供商记录，并把仍钉在本地提供商上的会话改写过去——因为一轮对话在解析时会先看 `session.providerId`，再看全局默认。登出，或部署不再要求管控中心时，会恢复此前被停用的记录。渲染层隐藏模型设置分区，模型选择器变为只读标签，配置类错误的提示也不再深链到设置页。
- **用量上报。** 一轮结束时，主进程为使用了该提供商记录轮次的会话上报本轮令牌数，以 `sessionId:turnId` 作为幂等键。传输失败重试一次；客户端错误不重试。余额刷新被限制为每分钟一次通知，避免长对话刷屏渲染层。
- `ControlPlaneGate` 包裹应用外壳。状态未知时显示连接中；失败时显示重试界面，且**不会**打开工作台，因为过期的权限不可接受。
- `me` 返回 `401` 时清理本地会话并回到登录页。
- 侧边栏账号胶囊显示员工、剩余余额、手动刷新与登出（需二次确认）。

## 9. 部署要求

- 反向代理终结 TLS；服务只监听回环地址。
- `CONTROL_PLANE_SECRET`（≥ 32 字符）、`CONTROL_PLANE_PUBLIC_URL`、`CONTROL_PLANE_DATA_DIR` 为必填；生产环境必须配置 SMTP。
- 迁移在启动时于一个事务内执行；迁移失败会中止启动，而不是以半迁移的表结构对外服务。
- `systemd` 在进程失败时重启；日志写入 journald 或轮转文件。
- `readyz` 会用一次查询证明数据库可用，便于代理把被锁或损坏的实例移出轮转。
- `deploy/backup.sh` 生成一致的 SQLite 快照；部署 README 记录恢复与回滚步骤。
- `control-plane --check-mail <address>` 会发送一封真实邮件，失败时以非零码退出。它故意绕过开发期的日志兜底，因此运行通过即可证明中继与凭据可用。不会打印任何机密。

## 10. 失败行为

| 情况 | 桌面端行为 |
|---|---|
| 未配置管控中心 | 工作台照旧打开（`required: false`） |
| 管控中心不可达 | 重试界面；工作台保持关闭 |
| 访问令牌过期 | 静默刷新，然后重试一次 |
| 刷新被拒 | 清理本地会话，显示登录页 |
| 额度耗尽 | 向调用方返回 `402 INSUFFICIENT_QUOTA` |
| 账号被停用 | 登录/刷新返回 `403`，显示登录页并给出服务端提示 |
