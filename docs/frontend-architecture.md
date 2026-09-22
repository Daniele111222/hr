# 前端架构

## 技术基线

- Node.js 24.21.0 LTS，通过仓库根目录 `.nvmrc` 固定。
- pnpm 12.4.2，通过 `package.json#packageManager` 固定。
- React 19、TypeScript strict、Vite、Ant Design。
- React Router 负责页面路由，TanStack Query 负责服务端状态。
- React Hook Form 与 Zod 负责表单状态和即时输入校验。
- Vitest、Testing Library 和 Playwright 分别覆盖逻辑、交互与关键业务流程；Playwright 在首条完整业务竖切时接入。

## 模块结构

```text
frontend/src/
├── app/          # 应用启动、Provider、路由和整体布局
├── pages/        # 页面级组装，不承载可复用业务规则
│   ├── overview/            # index.tsx + index.module.less
│   ├── organization/        # index.tsx + index.module.less
│   ├── employees/           # index.tsx + index.module.less
│   ├── rules/               # index.tsx + index.module.less
│   └── feature-placeholder/ # index.tsx + index.module.less
├── features/     # 按员工、导入、工资、规则、导出等业务能力组织
└── shared/       # API 客户端、通用 UI、格式化和配置
```

页面目录使用“一个页面一个文件夹”的约束：页面入口、页面私有组件和 `*.module.less` 放在同一目录；路由只负责懒加载页面入口。页面之间不得通过相对路径引用其他页面的私有文件，需要复用时下沉到 `features` 或 `shared`，并先确认复用边界。

样式统一使用 Less：全局样式使用 `src/index.less`，应用壳层使用 `*.module.less`，页面和业务模块使用局部 `*.module.less`。Less 变量只在所属样式模块内定义；跨模块稳定复用的设计 token 再提升到共享主题文件，避免建立一个包含大量隐式全局变量的样式目录。

新增业务优先放入对应 `features` 模块。只有两个以上业务模块稳定复用的内容才进入 `shared`，避免预建空目录和浅层转发模块。

## 状态职责

- 后端数据和异步状态放入 TanStack Query。
- 筛选、分页和当前工资期间优先放入 URL。
- 表单状态放入 React Hook Form。
- 页面局部交互使用 React 本地状态。
- 第一版不引入 Redux 或 Zustand。

工资批次、试算、确认、锁定和更正均为后端权威状态。前端修改成功后使相应查询失效并重新获取，不在浏览器中维护平行状态机。

## 接口契约

FastAPI OpenAPI 是请求与响应类型的唯一来源。`openapi-typescript` 生成 `src/shared/api/schema.d.ts`，`openapi-fetch` 提供类型安全的基础请求客户端。业务模块可以在此基础上封装查询配置，但不得复制后端 DTO。

金额由后端以十进制字符串返回，前端只负责展示和输入，不使用 JavaScript `number` 执行业务金额计算。工资期间使用 `YYYY-MM` 字符串，避免无意义的时区转换。

## 运行边界

开发环境由 Vite 把 `/api` 转发到本机 FastAPI `127.0.0.1:31000`。规则维护页面 `/rules` 通过 TanStack Query 读取和新增城市规则、考勤规则，展示版本、生效期、来源及缺失/过期状态。正式本地运行保持同源访问，后续在发布竖切中确定由 FastAPI 直接托管静态文件还是增加静态 Web 容器。

第一版不实现登录和复杂权限。服务只监听 `127.0.0.1`；身份证号、银行卡号和工资结果不得写入 `localStorage`、浏览器持久缓存或前端日志。
