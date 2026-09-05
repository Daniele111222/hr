# CLI Tool / Library Template

For published packages (npm / PyPI / crates.io) and standalone CLI binaries.

---

## Core philosophy additions

- **公共 API 即契约**
  - 一旦导出的符号 / CLI flag 即视为公共 API，破坏性变更走 semver major
  - 内部模块用 `internal/` / `_private` 等约定显式隔离
  - 文档（README + JSDoc / docstring）与代码同步更新

- **零依赖偏好**
  - 库：依赖越少越好，能用语言内置就不引入；明确区分 `dependencies` / `peerDependencies` / `devDependencies`
  - CLI：可执行体积、启动时间是用户体验，控制依赖树

- **跨环境鲁棒性**
  - 库：兼容 Node / Bun / Deno / 浏览器（按声明的 target），版本边界明确
  - CLI：兼容 macOS / Linux / Windows 的路径、换行、终端能力

---

## Red-line additions

```markdown
#### API 与版本（强制）
- 公共 API（`index.ts` 导出 / `__all__` / CLI flags）变更必须更新 CHANGELOG
- 破坏性变更走 major bump；新增字段保持向后兼容（默认值 / 可选）
- Deprecation：保留旧 API + 警告 ≥ 1 个 minor 版本，再移除

#### 包结构
- 入口文件保持精简，仅做导出聚合；禁止 side effect（顶层 IO / 全局污染）
- 提供 ESM + CJS 双产物（如目标包含 Node legacy），通过 `exports` 字段声明
- TypeScript：发布 `.d.ts`，types 优先于 main / module 字段
- 树摇友好：按需 export，禁止 barrel 文件聚合大量子模块

#### CLI 用户体验
- `--help` 文案完整，每个 flag 一句说明 + 示例
- 错误信息：明确 "what went wrong / why / what to do next" 三段式
- 输出区分 stdout（数据）/ stderr（日志）— 利于管道
- 退出码：`0` 成功，非 0 表示失败，常见错误使用稳定退出码
- 支持 `--json` / 类似机器可读输出模式，便于脚本集成
```

---

## Section: 目录结构

```markdown
src/                  # 源码
├── index.ts          # 公共入口（只 re-export）
├── core/             # 核心实现
├── internal/         # 内部工具，禁止从包外引用
└── cli/ (CLI only)   # CLI 入口与命令解析

tests/                # 测试
docs/                 # 用户文档
examples/             # 用法示例（CI 中实际执行验证）
```

---

## Section: 测试

```markdown
### 测试规范
- 单元测试覆盖核心模块所有公共 API
- 集成测试：典型用法路径必须覆盖
- 跨平台：CI 在 Linux / macOS / Windows 三平台并行运行（库 / CLI）
- 跨版本：CI 在最低支持版本 + 当前 LTS + 最新版同时运行
- 公共 API 变更必须新增 / 更新测试
- 示例代码（examples/）在 CI 中可运行，禁止注释式假代码
```

---

## Section: 发布

```markdown
### 发布流程
- 版本号通过 {{changesets / semantic-release / npm version}} 管理
- 发布前自动运行：lint + typecheck + test + build + 包大小检查
- 包大小预算：{{e.g. ESM gzip < 10KB}}；超出预算 PR 必须解释或拆包
- 禁止手工 `npm publish`；走 CI tag 流程，可审计
- 包内文件白名单：`package.json` 的 `files` 字段必须显式声明，避免泄漏源码 / 测试
```

---

## Section: 文档约定

```markdown
### README 结构
1. 一句话定位 + 徽章（npm 版本 / 构建状态 / 大小）
2. Quick start（30 秒可跑通的最小示例）
3. 安装
4. 核心用法（典型场景）
5. API 参考（链接到生成文档或简表）
6. 配置 / FAQ
7. 贡献指南链接 + License

### API 文档
- 所有 public 符号必须有 {{JSDoc / docstring}}，包含：参数、返回、抛错、示例
- 行为变更需更新示例代码
- CLI flag 变更需更新 README 中的命令示例
```

---

## Section: 审查关注点

### 公共 API
- 是否新增 / 删除 / 修改了 export？语义版本号是否相应调整？
- 默认值变化是否会影响现有用户？
- 错误消息变化是否被脚本依赖（破坏性）？

### 性能
- 启动时间（CLI）/ 包大小（库）是否回归？
- 树摇是否生效？是否新增了顶层 side effect？

### 兼容性
- 是否引入了新的 peerDependency 约束？
- 最低支持版本是否提升？CHANGELOG 是否说明？
