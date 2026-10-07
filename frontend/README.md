# PayLite 前端

基于 React、TypeScript、Vite 和 Ant Design 的本地工资核对界面。

## 环境

- Node.js 24.21.0
- pnpm 12.4.2

从仓库根目录执行 `nvm use`，然后：

```bash
cd frontend
corepack pnpm install
corepack pnpm dev
```

开发服务器保留 `/api/*` 路径，转发到 `http://127.0.0.1:31000/api/*`。可通过
`VITE_API_BASE_URL` 覆盖请求前缀。

## 常用命令

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm api:generate
```

`api:generate` 使用 `backend/.venv` 离线读取 FastAPI 应用的 OpenAPI 并生成 TypeScript 类型，无需启动后端。生成文件只描述接口契约，不放置业务逻辑。

正式本机运行先执行 `build`，再从仓库根启动 `docker compose up -d --build backend`。FastAPI 同源托管 `frontend/dist`，浏览器访问 `http://127.0.0.1:31000`；Compose 以只读方式挂载构建产物，缺少构建时后端拒绝启动。
