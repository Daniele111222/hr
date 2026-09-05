# Backend Service Template

For HTTP / RPC / GraphQL services (Express, Nest, Fastify, Koa, FastAPI, Django, Flask, Spring, Gin, Echo, Rails, .NET, etc.).

**IMPORTANT**: This template provides STRUCTURE, not content. Every rule you include must come from actual project observation or user confirmation. Generic backend best practices that apply to all services should be DELETED unless the project has specific reason to emphasize them.

---

## Core philosophy additions

<!-- VALIDATION GATE: Only include bullets that reflect THIS project's actual architecture.
     "路由层只做参数校验" is common advice but KEEP it if the project has a history of fat controllers.
     "业务逻辑集中在 service 层" — KEEP only if the project actually has a service layer.
     DELETE bullets that describe aspirational architecture not yet implemented. -->

- **接口契约优先**
  - 路由 / Schema / Type 三者保持单一事实源（OpenAPI / Zod / Pydantic / Protobuf / TypeBox）
  - 请求 / 响应类型显式声明，禁止 `any` / `dict` / `interface{}` 透传
  - 破坏性变更走版本号或 deprecation 流程，禁止静默改 schema

- **分层与职责**
  - 路由层只做参数校验 + 编排，禁止写业务逻辑
  - 业务逻辑集中在 service / use-case 层，纯函数化便于测试
  - 数据访问层（repository / DAO）独立，禁止业务层直接拼 SQL / ORM 查询

- **可观测性与可回滚**
  - 关键路径打 log（结构化日志，含 requestId / userId）
  - 慢查询、外部调用必须埋点
  - 数据库 migration 必须向前兼容，回滚脚本与上线脚本同 PR

---

## Red-line additions

<!-- VALIDATION GATE: Each rule block below should only be included if:
     1. The project actually uses the referenced tools/patterns
     2. The file paths mentioned have been verified to exist
     3. The rules address real problems (past incidents, team pain points)
     Generic security advice like "validate all input" should only be included
     if the project has had actual security issues or the team specifically requested it. -->

```markdown
#### 接口层规范（强制）
- 路由定义集中在 `{{routes/ 或 controllers/}}`，按业务域拆分
- 请求参数 / 响应体使用 {{Zod / class-validator / Pydantic / 等}} 校验
- 错误返回统一结构：`{ code, message, requestId, data? }`，禁止裸抛异常到客户端
- 接口版本：URL 路径携带 `/v1`、`/v2` 或通过 Header，禁止同 URL 改返回结构
```

```markdown
#### 数据层规范（强制）
- 数据库访问统一通过 {{ORM / repository}}，禁止业务代码拼接 raw SQL（明确需要时加注释 + 参数化）
- 事务边界由 service 层管理，禁止 controller 内开事务
- 大整数主键（雪花 ID 等）必须按 string 序列化输出，JSON 中保留为字符串
- 时间字段统一 UTC 存储，输出按 ISO 8601；时区转换在应用层完成，禁止数据库内做时区运算
```

```markdown
#### 安全与认证（强制）
- 所有接口默认需要认证，公开接口必须显式注解 `@public` / 等价标记
- 权限校验在 middleware / guard 层，禁止业务代码内散落 `if (user.role === 'admin')`
- 敏感字段（密码、token、密钥）输出前必须脱敏；日志中禁止打印
- 用户输入到 SQL / Shell / 文件路径前必须校验，防注入 / 路径穿越
```

```markdown
#### 异步与外部依赖
- 外部调用（HTTP / 数据库 / 消息队列）必须设超时；
  禁止使用默认无超时配置
- 重试策略：指数退避 + 上限次数 + 幂等性保证，禁止无脑 retry
- 长任务走队列 / 后台作业，禁止在 HTTP handler 内同步执行 > 5s 的任务
```

---

## Section: 项目结构（典型布局）

<!-- VALIDATION GATE: This structure must match the ACTUAL `ls` output of the project.
     If the project uses `app/` instead of `src/`, show `app/`.
     If there's no `migrations/` directory, don't include it.
     Never show a directory that doesn't exist yet — that's aspirational, not a constraint. -->

```markdown
src/
├── routes/ (或 controllers/)   # 路由 / 接口入口，只做参数校验 + 编排
├── services/                   # 业务逻辑，纯函数为主
├── repositories/ (或 dao/)     # 数据访问层
├── models/ (或 entities/)      # 数据模型 / ORM 实体
├── middlewares/                # 认证 / 日志 / 错误处理
├── schemas/ (或 dtos/)         # 入参 / 出参 schema
├── utils/                      # 通用工具
├── config/                     # 配置（按环境）
└── migrations/                 # 数据库迁移脚本
```

Adapt to actual layout. If the project uses Hexagonal / DDD / Clean Architecture, document that explicitly:

```markdown
本项目采用 {{Hexagonal / Clean / DDD}} 架构，依赖方向：
{{domain → application → infrastructure}} （内层不依赖外层）
```

---

## Section: 数据库与迁移

<!-- VALIDATION GATE: Only include if the project actually uses a database.
     ORM name, naming conventions, and migration tool must be confirmed from actual code/config.
     If no migrations directory exists yet, note it as a follow-up, don't write migration rules. -->

```markdown
### 数据库规范
- ORM：{{Prisma / TypeORM / SQLAlchemy / GORM / 等}}
- 命名：表名复数 snake_case（{{users / order_items}}），字段 snake_case
- 主键：{{自增 / UUID / 雪花}}，统一在 {{config}} 中定义
- 索引：所有 WHERE 高频字段加索引；JOIN 字段必须有索引
- 软删除：使用 `deleted_at` 列；查询默认过滤已删除记录

### 迁移规范
- 一次 PR 一个迁移文件，禁止合并多个变更
- 必须向前兼容：先发应用兼容新旧 schema，再发迁移
- 大表变更（加列 / 改类型）走分批 / online DDL，禁止 ALTER TABLE 锁全表
- 回滚脚本与上线脚本同 PR 提交
```

---

## Section: 日志与错误

<!-- VALIDATION GATE: Only include if the project has an established logging pattern.
     Check for actual logger imports in the code. If the project just uses print()/console.log(),
     this section should note "需建立统一日志方案" rather than prescribing one that doesn't exist. -->

```markdown
### 日志
- 结构化 JSON 日志，字段包含 `timestamp` / `level` / `requestId` / `userId?` / `event` / `data`
- 级别使用：
  - `error` — 影响用户请求的失败
  - `warn` — 异常但可恢复（重试成功、降级）
  - `info` — 关键业务事件（登录、下单、支付回调）
  - `debug` — 开发期定位，生产关闭
- 禁止 `console.log` / `print()` 散落代码，统一通过 `{{logger module}}`

### 错误处理
- 业务错误：继承 `BusinessError`，携带 code + httpStatus，由全局中间件转换为响应
- 系统错误：捕获后包装为 5xx，原始堆栈打 log 但不返回给客户端
- 404 / 401 / 403 通过中间件统一返回，禁止 controller 内手写
```

---

## Section: 测试

<!-- VALIDATION GATE: Only include if the project has actual tests.
     Check for test files, test config, and test commands in package.json/pyproject.toml.
     If no tests exist yet, don't prescribe a full testing strategy — note it as a follow-up. -->

```markdown
### 测试规范
- 单元测试：覆盖 service 层纯函数，目标行覆盖 > {{60-80%}}
- 集成测试：覆盖关键接口的成功 + 失败路径，使用真实数据库（容器化）
- E2E 测试：覆盖核心业务流（登录 → 下单 → 支付）
- 禁止在测试中 mock 数据库的 SQL 行为（mock 易与真实迁移分歧，曾踩坑）；
  使用 Testcontainers / 内存数据库替代
- 测试数据使用 factory 模式生成，禁止硬编码大段 fixture
```

---

## Section: 部署与运行时

<!-- VALIDATION GATE: Only include if the project has deployment infrastructure.
     Check for Dockerfile, docker-compose, CI config, health check endpoints.
     If the project is still in early development with no deployment, skip this section. -->

```markdown
### 配置
- 配置通过环境变量注入，禁止把生产配置写进代码
- 必须配置项在启动时校验，缺失立即 fail-fast
- 密钥统一通过 {{Secrets Manager / Vault / 环境变量}} 注入

### 健康检查
- `/healthz` 返回服务自身状态
- `/readyz` 返回依赖（数据库、缓存、外部服务）就绪状态
- 禁止 healthz 内做重 IO，避免假阳性触发重启

### 优雅停机
- 收到 SIGTERM 后停止接受新请求，等待进行中请求完成（限时）
- 关闭数据库连接池 / 消息队列消费者后再退出
```

---

## Section: 审查关注点

### 架构层面
- 分层是否清晰？路由是否泄漏业务逻辑？
- 接口契约是否变更？是否破坏向前兼容？
- 事务边界是否合理？

### 性能层面
- N+1 查询？是否使用 dataloader / 预加载？
- 慢查询是否有索引覆盖？
- 大批量操作是否分页 / 分批？

### 安全层面
- 所有输入是否校验？SQL / 命令注入风险？
- 权限边界是否清晰？水平越权 / 垂直越权？
- 敏感信息是否脱敏？日志是否泄露 PII？

---

## Code examples requirement

When including code examples in the generated AGENTS.md:

1. **Service/route patterns must come from actual project code** (simplified). If the project uses class-based services with `__init__(self, db)`, show that pattern. If it uses standalone functions, show that.
2. **Error handling examples must reflect the project's actual error hierarchy** — don't invent `BusinessError` if the project uses `HTTPException` directly.
3. **Keep examples minimal** — show the pattern (5-15 lines), not the full implementation.
4. **Never show aspirational code** — if the project doesn't have a pattern yet, don't invent one. Note it as a follow-up instead.
