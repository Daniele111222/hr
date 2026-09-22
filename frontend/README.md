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

开发服务器把 `/api/*` 转发到 `http://127.0.0.1:31000/*`。可通过
`VITE_API_BASE_URL` 覆盖请求前缀。

## 常用命令

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm api:generate
```

`api:generate` 从正在运行的 FastAPI OpenAPI 文档生成 TypeScript 类型。生成文件只描述接口契约，不放置业务逻辑。
