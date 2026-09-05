---
name: rule-trigger-system
version: 2.0.0
description: 基于MCP Resource的动态规则加载系统。根据用户意图、文件类型和关键词自动匹配并加载必要的规则文件，避免不必要的上下文损耗。当AI处理代码、配置或文档任务时自动触发，确保仅加载当前任务所需的最小规则集。
author: System
cacheable: true
---

# 动态规则触发系统 v2.0

## 核心目标

通过MCP Resource机制和触发器实现**精准、按需**的规则加载，最大限度减少上下文损耗。

**工作流**: 意图识别 → 触发器匹配 → 资源声明 → 按需加载规则 → 执行任务

---

## Reference 引用说明

本Skill通过内置的 Reference 机制暴露规则文件，供AI按需读取。规则文件位于skill目录的 `references/rules/` 下。

| 规则名称 | 文件路径 | 说明 |
|---------|---------|------|
| react-patterns | `@path references/rules/react-patterns.md` | React组件开发规范 |
| ts-strict | `@path references/rules/ts-strict.md` | TypeScript严格类型规范 |
| ui-system | `@path references/rules/ui-system.md` | UI/样式系统规范 |
| testing-strategy | `@path references/rules/testing-strategy.md` | 测试策略规范 |
| security-compliance | `@path references/rules/security-compliance.md` | 安全与合规规范 |
| performance-tuning | `@path references/rules/performance-tuning.md` | 性能优化规范 |

### 读取时机

当触发器匹配成功后，AI应自动读取对应的规则文件：
- 读取方式：使用 `@path` 引用直接加载文件内容到上下文
- 读取时机：触发器匹配成功后，加载规则内容作为最高优先级约束

---

## 触发器匹配机制

### 匹配原则

- **单一触发**: 命中任意条件即视为触发
- **多重触发**: 同时命中多个规则时，**全部加载**
- **覆盖规则**: 后加载的规则覆盖先加载的规则

### Priority 与加载顺序

- **Priority 数值越高，优先级越高**
- 当多个规则被触发时，按 priority 从高到低依次加载
- 后加载的高优先级规则覆盖低优先级规则的冲突内容
- Priority 相同时，按规则被触发的顺序加载

### 关键词重叠冲突解决策略

当触发条件同时命中多个规则时，按以下策略解决冲突：

| 冲突场景 | 激活规则 | 压制规则 | 原因 |
|---------|---------|---------|------|
| `.tsx` + `React` + `type` | react-patterns (95) | ts-strict (90) | React 上下文优先 |
| `.tsx` + `React` + `interface` | react-patterns (95) | ts-strict (90) | React 上下文优先 |
| `api` + `bundle` | security-compliance (100) | performance-tuning (80) | 安全规则最高优先级 |
| `encrypt` + `bundle` | security-compliance (100) | performance-tuning (80) | 安全规则最高优先级 |
| `auth` + `api` | security-compliance (100) | 其他 | 安全规则最高优先级 |
| `memo` + `React` | react-patterns (95) | performance-tuning (80) | 组件相关优先 |
| `useMemo` + `React` | react-patterns (95) | performance-tuning (80) | 组件相关优先 |
| `useCallback` + `React` | react-patterns (95) | performance-tuning (80) | 组件相关优先 |

**核心原则**：
1. **Security 规则 (priority: 100) 永远最高**，任何与安全相关的触发都优先
2. **React 上下文优先**：`.tsx` 文件中，react-patterns 覆盖 ts-strict
3. **按文件类型区分**：`.ts` 文件中的类型关键词触发 ts-strict，`.tsx` 中的触发 react-patterns
4. **性能优化为底层规则**：performance-tuning 只在独立触发时主导，遇上层规则时退让

### 规则映射表

| 触发条件 | 依赖资源URI | 说明 |
|---------|-------------|------|
| **后缀**: `.ts`, `.tsx` + 关键词: `interface`, `type`, `enum` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ts-strict.md` | TypeScript类型定义 |
| **后缀**: `.tsx` + 关键词: `component`, `props`, `hook`, `React` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md` | React组件开发 |
| **关键词**: `style`, `css`, `tailwind`, `layout`, `ui` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ui-system.md` | 样式与布局 |
| **后缀**: `.test.ts`, `.test.tsx`, `.spec.ts`, `.spec.tsx` + **关键词**: `test`, `spec`, `mock`, `coverage`, `vitest` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/testing-strategy.md` | 测试编写 |
| **关键词**: `api`, `auth`, `security`, `token`, `encrypt` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/security-compliance.md` | API与安全 |
| **关键词**: `performance`, `optimize`, `bundle`, `lazy` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/performance-tuning.md` | 性能优化 |
| **命令**: `/review`, `/audit` | **加载所有资源** | 代码审查模式 |
| **命令**: `/ts` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ts-strict.md` | TypeScript 类型检查 |
| **命令**: `/react`, `/component` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md` | React 组件开发 |
| **命令**: `/ui`, `/style`, `/design` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ui-system.md` | UI 样式设计 |
| **命令**: `/test`, `/spec` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/testing-strategy.md` | 测试编写 |
| **命令**: `/security`, `/audit` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/security-compliance.md` | API 与安全 |
| **命令**: `/perf`, `/optimize` | `file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/performance-tuning.md` | 性能优化 |

---

## 资源加载执行流程（关键指令）

### 步骤1: 意图识别

分析用户输入，提取以下信息：
- **任务类型**: 编码/配置/文档/测试
- **文件路径和后缀**: `.tsx`, `.ts`, `.css` 等
- **领域关键词**: component, style, test, api 等

### 步骤2: 触发器匹配

对照**规则映射表**，检查是否命中条件：
- 如果命中 → 继续步骤3
- 如果未命中 → 使用**全局默认原则**（见下文）

### 步骤3: 资源声明与加载

**必须执行的操作**:

1. **声明触发**（在响应开头）:
   ```
   [System]: 检测到触发条件 [React组件开发]，正在加载依赖资源 [file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md]
   ```

2. **读取资源**（使用 MCP Resource 工具）:
   ```typescript
   // 使用 MCP resources/read 工具
   {
     "uri": "file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md"
   }
   ```

3. **应用规则**（将加载的内容作为最高优先级约束）:
   - 所有生成的代码必须符合规则文件中的规范
   - 规则覆盖全局默认原则中的冲突项

### 步骤4: 执行与验证

- 结合动态规则和全局原则生成输出
- 动态规则**覆盖**全局原则
- 确保输出符合所有已加载规则

---

## 全局默认原则（后备机制）

当**没有触发任何规则**时，遵循以下原则:

### 语言标准
- TypeScript严格模式，禁止 `any`，明确定义Interface/Type

### 架构模式
- 优先函数组件和React Hooks，禁止类组件

### 代码风格
- PascalCase(组件/类), camelCase(函数/变量), UPPER_SNAKE_CASE(常量)
- 逻辑hooks在顶部，UI渲染在底部

### 错误处理
- 严禁吞掉错误，使用Try/Catch或Error Boundaries

### 注释规范
- 复杂逻辑包含TSDoc风格注释，解释"Why"而非"What"

---

## 错误处理与异常恢复

### 常见错误场景

#### 1. 资源文件不存在

**症状**: MCP resources/read 返回 404 或文件未找到

**处理策略**:
```
1. 声明错误: [System]: 资源文件 [URI] 不存在，回退到全局默认原则
2. 使用全局默认原则继续执行任务
3. 在输出末尾添加警告: ⚠️ 未加载规则文件，使用默认原则
```

#### 2. 资源文件格式错误

**症状**: 文件内容不是有效的Markdown或缺少关键部分

**处理策略**:
```
1. 尝试解析有效部分
2. 如果无法解析，回退到全局默认原则
3. 记录错误: [System]: 资源文件格式异常，部分规则可能未生效
```

#### 3. 多个规则冲突

**症状**: 同时触发多个规则，且规则间存在矛盾

**处理策略**:
```
1. 加载所有命中的规则
2. 后加载的规则覆盖先加载的规则
3. 在输出中声明: [System]: 已加载 N 个规则，按加载顺序应用
```

#### 4. 触发器误匹配

**症状**: 规则被错误触发（如测试文件被识别为组件开发）

**处理策略**:
```
1. 分析实际意图 vs 触发条件
2. 如果确认误匹配，回退到全局默认原则
3. 允许用户反馈: 是否需要应用 [规则名]？（是/否/调整）
```

---

## 使用示例

### 示例1: 创建React组件

```
用户: 帮我创建一个用户卡片组件

AI分析:
- 文件后缀: .tsx (命中)
- 关键词: component, props (命中)
- 触发: React组件模式 + TypeScript严格类型

[System]: 检测到触发条件 [React组件开发]，正在加载依赖资源 [file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md, file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ts-strict.md]...

[MCP Resource读取]: 
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ts-strict.md ✓

[System]: 规则加载完成，开始生成组件...

[生成的组件代码，完全符合规则要求]
```

### 示例2: 配置Tailwind样式

```
用户: 给按钮添加悬停效果和过渡动画

AI分析:
- 关键词: style, tailwind, ui, design (命中)
- 触发: UI系统设计

[System]: 检测到触发条件 [UI样式设计]，正在加载依赖资源 [file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ui-system.md]...

[MCP Resource读取]: file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ui-system.md ✓

[生成的样式代码，完全符合规则要求]
```

### 示例3: 代码审查

```
用户: /review 检查这个PR的代码质量

AI分析:
- 命令: /review (命中 LOAD ALL)
- 触发: 加载所有规则

[System]: 检测到触发条件 [代码审查命令]，正在加载所有依赖资源 [@rules/*.md]...

[MCP Resource读取]:
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/react-patterns.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ts-strict.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/ui-system.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/testing-strategy.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/security-compliance.md ✓
- file:///C:/Users/hyperchain/.agents/skills/rule-trigger-system/references/rules/performance-tuning.md ✓

[System]: 所有规则加载完成，开始代码审查...

[详细的代码审查报告，包含所有规则的检查项]
```

---

## 自定义扩展

### 添加自定义规则

1. 在 `references/rules/` 目录创建 `.md` 文件
2. 添加前置元数据定义触发条件
3. 编写规则内容

示例:
```markdown
---
triggers:
  extensions: [".py", ".pyw"]
  keywords: ["def", "class", "import"]
  commands: ["/python"]
priority: 100
cacheable: true
version: "1.0.0"
---

# Python 开发规范

... 规则内容 ...
```

### 修改触发器映射

编辑 `SKILL.md` 中的**规则映射表**，添加、删除或修改触发条件。

---

## 故障排除

### 规则未触发

1. 检查触发条件定义是否正确（后缀、关键词、命令）
2. 确认规则文件路径正确（`references/rules/*.md`）
3. 查看日志中的匹配过程

### 规则冲突

1. 检查多个规则是否命中同一触发条件
2. 调整规则的 `priority` 值（数值越高优先级越高）
3. 明确规则间的覆盖关系（后加载覆盖先加载）

### 性能问题

1. 减少同时加载的规则数量（只在必要时使用`/review`加载所有规则）
2. 启用规则缓存（设置`cacheable: true`）
3. 优化规则文件的读取方式（按需读取，不要一次性读取所有规则）

### MCP Resource 读取失败

**症状**: `[System]: 资源文件 [URI] 读取失败`

**解决方案**:
1. 检查文件路径是否正确
2. 确认文件存在且可读
3. 如果持续失败，回退到全局默认原则继续执行任务

---

## 设计原则摘要

本Skill遵循以下核心设计原则:

1. **按需加载**: 仅加载当前任务所需的规则，避免全量加载
2. **触发器精确**: 通过文件类型+关键词双重匹配，确保精准触发
3. **渐进式披露**: 规则分层加载，核心机制先加载，细节按需
4. **最小上下文损耗**: 总长度控制在合理范围，避免token浪费
5. **可扩展性**: 支持自定义规则和触发器映射
6. **健壮性**: 完善的错误处理和回退机制
7. **可操作性**: 明确的执行指令和操作流程
