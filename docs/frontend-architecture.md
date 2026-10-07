# 前端架构

## 技术基线

- Node.js 24.21.0 LTS，通过仓库根目录 `.nvmrc` 固定。
- pnpm 12.4.2，通过 `package.json#packageManager` 固定。
- React 19、TypeScript strict、Vite、Ant Design。
- React Router 负责页面路由，TanStack Query 负责服务端状态。
- React Hook Form 与 Zod 负责表单状态和即时输入校验。
- Vitest、Testing Library 和 Playwright 分别覆盖逻辑、交互与关键业务流程，浏览器验收按实际关键流程运行。

## 模块结构

```text
frontend/src/
├── app/          # 应用启动、Provider、路由和整体布局
├── pages/        # 页面级组装，不承载可复用业务规则
│   ├── overview/            # index.tsx + index.module.less
│   ├── organization/        # index.tsx + index.module.less
│   ├── employees/           # index.tsx + index.module.less
│   ├── rules/               # index.tsx + index.module.less
│   ├── imports/             # 三类导入、批次纠错与只读历史详情
│   ├── payroll/             # 期间、批次、试算、激励、台账、补发
│   ├── exports/             # 四类导出与报告下载
│   └── feature-placeholder/ # 历史占位组件
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

组织维护四个列表独立分页，页码和每页条数保存在 URL 中。`shared/api/resources.ts` 导出的 `Page<T>`、`PageParams` 从生成的 OpenAPI 类型提取通用分页结构；列表摘要使用 `total`，当前页使用 `items`。表单选择器调用 `/options` 接口，关联行名称使用分页响应中的名称字段，避免把某一页误当作完整数据集。

## 运行边界

开发环境由 Vite 把 `/api` 转发到本机 FastAPI `127.0.0.1:31000`。规则维护页面 `/rules` 通过 TanStack Query 读取和新增城市规则、考勤规则，展示版本、生效期、来源及缺失/过期状态。正式本地运行由 FastAPI 托管 frontend/dist，业务接口保留 /api 前缀，深链接刷新返回 SPA；Compose 通过只读挂载接入构建产物。Vite 保留 /api 路径；API 单独运行也提供 /api 别名。

第一版不实现登录和复杂权限。服务只监听 `127.0.0.1`；身份证号、银行卡号和工资结果不得写入 `localStorage`、浏览器持久缓存或前端日志。

## 当前落地（2026-10-04）

业务响应类型来自完整 OpenAPI（77 个 HTTP 操作），`npm run api:generate` 通过后端本地虚拟环境离线生成 schema，无需启动服务。工资期间、主体、批次类型/状态、台账部门/员工和导出模板筛选保存在 URL；菜单用年月衔接期间 ID，避免历史期间切换到最新期间。部分既有表单仍使用 Ant Design Form，不能把 React Hook Form/Zod 描述为全仓库实际实现。

首页读取真实准备状态、只读试算摘要、正式金额和导出版本；摘要不记录“已查看”凭证。正式台账详情独立路由 `/payroll/ledger/records/:recordId` 仅展示历史快照和计算依据，不重新计算工资。敏感号码脱敏；没有保存的事实显示 —，金额由 `shared/money.ts` 按文本格式化。

13 文件/54 项测试、生产构建、lint 与格式检查通过；8 页面×9 视口无整页溢出，表格在容器内横向滚动。04 用户页面验收与真实工资对账尚待业务确认，见 [完成情况](mvp-completion-2026-10-03.md)。

历史记录查看详情为只读视图，三类导入共用 `pages/imports/failure-table.tsx` 展示每条失败原因、工作表、行列位置、原始值与历史校验值。员工历史摘要不包含明细行，打开详情时通过独立 Query 加载完整数据并提供加载、失败及重试状态；不把缺失详情当成无失败行。本次上传预览与历史选中批次单独保存，历史入口只读，本次上传入口保留逐行修正及其接口调用。
