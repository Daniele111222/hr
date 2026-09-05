# Example: 个人授权认证 H5 — AI 开发规范

This is a worked example of an AGENTS.md for a React + TypeScript + Vite + react-vant H5 project. Reference this when you need to see how the templates compose for a real project. Don't paste it verbatim — adapt to the project at hand, remove any rule that was not verified in the target codebase, and do not copy version numbers into generated output.

---

**技术栈**: React + TypeScript + Vite + react-vant + React Router
**项目类型**: H5
**目标读者**: AI 编程助手（Claude Code / Cursor 等）为主，人类开发者次之

---

## 🎯 核心开发理念

### 1. 页面结构与公共组件边界
- **业务域聚合**：强相关页面（列表 / 详情 / 编辑 / 结果）放在同一业务目录，避免类型、枚举、静态数据散落。
- **公共组件慎用**：只有跨 2 个以上业务域复用的组件才放入 `src/components/`；单页私有组件保留在页面目录下。
- **NavHeader 统一入口**：涉及页面标题或顶部占位时必须使用 `src/components/NavHeader/NavHeader.tsx`，禁止派生多个导航栏实现。

### 2. 移动端 H5 专项能力
- **viewport 适配**：CSS 中写 px，由 `postcss-px-to-viewport` 转 vw；禁止手写 vw / rem
- **1px 边框 / DPR / 安全区**：使用项目封装方案，禁止裸写 `border: 1px solid`
- **容器感知**：微信 / 支付宝 / 手机浏览器，UA 与 JSBridge 不同
- **弱网降级**：骨架屏 + 重试 + 缓存

### 3. 数据与服务层约束
- **服务层单一入口**：接口调用统一放在 `src/service/`，并通过 `src/service/request.ts` 发起。
- **接口类型同域维护**：服务模块的请求 / 响应类型放在同级 `types.ts`，禁止页面内临时声明接口返回结构。
- **时间与 ID 统一处理**：后端 ID 保持 string；时间展示统一经过 `src/utils/dateUtils.ts`。

---

## ⚠️ 项目背景与最高优先级原则

### 项目现状
- 多人协作，编码风格存在差异
- 历史代码并存，部分早期代码质量参差不齐
- 业务迭代频繁，需求变更快
- H5 环境复杂，需适配微信 / 支付宝 / 手机浏览器

### 最高优先级原则（红线）

#### 1. 技术栈强制对齐
- **必须**使用：React + TypeScript + Vite + react-vant
- **禁止**引入新 UI 库（如 Material-UI、Chakra）或状态管理库（如 Redux、Zustand）
- **禁止**使用未在 `vite.config.ts` / `package.json` 中配置的插件

#### 2. 历史代码处理原则
- **保持不动**：`src/` 下已存在代码（除明确需要修改）保持原样
- **不强制复用**：历史代码中的公共方法 / 组件不强制复用，可按本规范重新实现
- **增量改进**：新功能严格按本规范实现，逐步提升整体代码质量

#### 3. 类型与数据规范（强制）
- 与后端接口类型保持一致；接口请求 / 响应必须显式定义到 `types.ts`
- **禁止 `any`**：必要时使用 `unknown` + 类型守卫
- **大整数 ID 全链路 string**：禁止 `Number(id)` / `parseInt(id)` / `+id` — JS number 精度 53 位会丢
- **时间字段统一格式化**：使用 `src/utils/dateUtils.ts` 的 `formatDateTime` / `formatDate`；禁止页面内裸渲染时间戳或自实现格式化

#### 4. 服务层规范（强制）
- 服务文件位置：`src/service/` （注意不是 `src/services/`）
- 请求方法：使用 `src/service/request.ts` 封装
- 各服务模块独立导出，按需导入，无需统一 index.ts
- 接口响应类型定义在服务文件同级 `types.ts`

#### 5. 文档同步规范（强制）
- 修改公共组件 / 公共方法 / 新建公共文件夹，须询问是否同步 `AGENTS.md`
- 即使历史代码不规范，新代码也必须遵循本规范

---

## 🛠 技术栈与项目结构

| 类别 | 技术选型 | 说明 |
|------|---------|------|
| 框架 | React | 函数组件 + Hooks |
| 语言 | TypeScript | 类型定义以服务层和页面域为边界 |
| 构建 | Vite | 项目构建入口，插件以 `vite.config.ts` 为准 |
| UI 库 | react-vant | 移动端组件库，禁止并行引入新 UI 体系 |
| 路由 | React Router DOM | 声明式路由 |
| 样式 | Less + CSS Module | 新代码使用 `*.module.less` |
| HTTP | Axios | 通过 `src/service/request.ts` 封装 |

```
src/
├── pages/             # 业务页面
├── components/        # 跨页面公共组件（见 docs/common-components.md）
├── hooks/             # 跨页面公共 Hook
├── service/           # 接口请求层
├── utils/             # 公共工具
└── styles/            # 全局样式 / 主题变量
```

---

## 📋 组件与样式规范

### 组件目录结构

```
src/pages/{PageName}/
├── index.tsx
├── index.module.less
├── types.ts
├── enum.ts
├── components/
├── hooks/
├── data.ts
└── assets/
```

### 业务域聚合

强相关页面（列表 / 详情 / 编辑 / 结果）共属同一业务域时，聚合到同一文件夹：

```
src/pages/DataZone/
├── list/
├── detail/
├── components/   # 子页共享组件
├── hooks/
├── types.ts
└── enum.ts
```

判断准则：是否共享 `types.ts` / `data.ts` / `assets/` / 子组件。

### Hooks 分类

| 类型 | 位置 | 示例 |
|------|------|------|
| 页面级 | `src/pages/{Page}/hooks/` | `useAboutusData.ts` |
| 公共 | `src/hooks/` | `useAuth.ts` |

命名：`use` 前缀 + camelCase。

### NavHeader 使用约定
- 组件路径：`src/components/NavHeader/NavHeader.tsx`
- 微信环境下自动隐藏，无需页面内判断
- Props：`title` / `textColor` / `borderColor`
- 页面根节点必须加 `data-nav-header` 属性，由全局样式处理顶部占位
- **禁止**页面 less 中手写 `padding-top` 解决导航栏遮挡 — 会与全局占位冲突

### 枚举值规范
- 接口枚举值统一抽到对应业务域的 `enum.ts`
- 后端枚举 → 前端文案映射也放在 `enum.ts` 或同业务域纯函数
- 禁止页面 / 组件中散落硬编码枚举

### CSS Module
新代码统一使用 CSS Module（`*.module.less`），历史全局 less 保持原样。

```tsx
import styles from './index.module.less';

export const Authorization: React.FC = () => (
  <div className={styles.authorizationRoot}>
    <div className={styles.pageTitle}>授权列表</div>
  </div>
);
```

---

## ✅ 检查与验证机制

### 代码提交前检查清单
- [ ] 类型检查无错误，无 `any`（特殊场景需注释说明）
- [ ] ESLint + Prettier 通过
- [ ] 文件命名：组件 PascalCase，工具 camelCase
- [ ] 样式作用域：使用 CSS Module，`.module.less` 后缀
- [ ] 性能：合理使用 useMemo / useCallback，无冗余渲染
- [ ] 错误处理：API 调用有 try-catch 或错误处理
- [ ] 移动端：1px 边框、安全区适配

### 代码审查关注点

**架构**
- 组件职责是否单一？业务逻辑是否抽离为纯函数 / Hook？
- 状态管理是否合理？类型定义是否完整？

**性能**
- 不必要的重渲染？图片懒加载？长列表虚拟滚动？路由按需加载？

**体验**
- 加载 / 错误 / 空状态是否友好？弱网是否可降级？

---

## 🔧 公共工具与约定

- **时间格式化**：`src/utils/dateUtils.ts` 的 `formatDateTime(value)` / `formatDate(value)`，兼容毫秒时间戳、数字字符串、ISO 字符串、`YYYY-MM-DD HH:mm:ss`
- **文本截断**：`src/utils/textUtils.ts` 的 `truncateText(text, maxLength)`，`maxLength` 必须显式传入
