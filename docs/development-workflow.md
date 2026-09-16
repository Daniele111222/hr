# 后端开发与 CI/CD 工作流

## 本地开发

首次启用提交后自动更新本地后端容器：

```bash
git config core.hooksPath .githooks
```

以后提交涉及 `backend/` 或 `docker-compose.yml` 时，`.githooks/post-commit` 会自动执行：

```bash
docker compose build backend
docker compose up -d --no-deps backend
```

只修改产品文档、README 或 Excel 模板时，不会触发后端镜像重建。

本地服务：

- Backend：`http://127.0.0.1:8000`
- Health：`http://127.0.0.1:8000/health`
- PostgreSQL：`127.0.0.1:55432`

## 容器启动迁移

后端容器启动时由 `backend/docker-entrypoint.sh` 执行：

```bash
alembic -c alembic.ini upgrade head
```

迁移成功后才启动 Uvicorn。数据库通过 Compose healthcheck 后，才允许 backend 启动。

如果使用 [backend/sql/001_initial_schema.sql](../backend/sql/001_initial_schema.sql) 直接初始化数据库，仍需执行：

```bash
cd backend
alembic stamp 0001_initial_schema
```

## GitHub Actions

[`.github/workflows/backend-ci.yml`](../.github/workflows/backend-ci.yml) 在以下情况运行：

- Pull Request 修改后端、Compose 或 workflow 文件
- push 到 `main` 且修改后端、Compose 或 workflow 文件

CI 包含：

1. Python 3.13 环境安装后端依赖。
2. Ruff lint 和格式检查。
3. `lint-imports` 检查已落地的数据库层与应用/HTTP 层导入禁令。
4. Python 编译检查。
5. 使用 PostgreSQL 16 service container 运行完整测试，包括集成测试。
6. 测试通过后构建 `paylite-backend:${{ github.sha }}` 镜像。

当前 workflow 只验证和构建镜像，不推送 GHCR/Docker Hub，也不自动部署生产环境。

后端分层、应用工厂、ORM 按主题分包、三种数据形态和事务边界见 [后端架构](backend-architecture.md)。当前架构检查只约束已经存在的模块；`services`、`domain`、`excel` 在对应业务竖切实现前不预建空目录。

## 提交失败或容器未更新

`post-commit` 是提交完成后执行的。如果 Docker 构建失败，Git commit 不会回滚，本地容器会继续运行旧镜像。可以手动重试：

```bash
docker compose build backend
docker compose up -d --no-deps backend
```

查看日志：

```bash
docker compose logs -f backend
```

## 测试数据库安全

集成测试需要专用测试数据库，并显式设置：

```bash
PAYLITE_ALLOW_TEST_DATABASE_RESET=1
```

测试 teardown 会执行数据库 downgrade，因此不能把测试 URL 指向开发数据库 `paylite`。
