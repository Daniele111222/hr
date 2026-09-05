# Base Template (all project types)

Universal sections every `AGENTS.md` should include. Adapt phrasing to the project's actual situation — don't paste verbatim.

**CRITICAL**: Every section below has a "validation gate". If the gate condition is not met, DELETE the section entirely. An empty section filled with generic advice is worse than no section.

---

## Section: Header

```markdown
# {{ProjectName}} — AI 开发规范

**技术栈**: {{primary frameworks, no version numbers}}
**项目类型**: {{archetype}}
**目标读者**: AI 编程助手（Claude Code / Cursor / Copilot 等）为主，人类开发者次之

---
```

## Section: 项目知识库 / Navigation Map

<!-- VALIDATION GATE: Include this section when the repo has multiple layers, packages,
     runtime entry points, or task-specific folders. DELETE it for tiny projects where a
     navigation map would duplicate the directory tree. Every path/symbol must be verified. -->

This section helps future AI sessions start in the right place before applying rules. Keep it compact and factual.

### Overview

```markdown
## OVERVIEW

{{1-3 lines: product purpose + architecture + one standout capability}}
```

Do not write marketing copy. This is an orientation sentence, not a README.

### Where To Look

```markdown
## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| {{task category}} | `{{verified/path}}` | {{short note}} |
```

Use 5-10 rows. Prefer task routes such as "认证", "路由", "数据模型", "API 服务层", "数据库迁移", "测试", "3D 动画", "本地服务". Do not list every folder.

### Code Map

```markdown
## CODE MAP

| Symbol | Type | Location | Role |
|--------|------|----------|------|
| `{{symbol}}` | {{Function/Component/Class/Store/etc.}} | `{{verified/path}}` | {{role}} |
```

Use 3-8 stable anchors only. Good anchors include app entry points, routers, stores, request clients, database/session factories, public components, and core services. Line numbers are optional; omit them when they are likely to churn.

### Commands

````markdown
## COMMANDS

```bash
# {{scope}}
{{verified command}}
```
````

Only include commands verified from manifests, pyproject, README, existing docs, or the user's explicit instructions. Group commands by package or runtime.

### Known Follow-Ups

```markdown
## KNOWN FOLLOW-UPS

- `{{verified/path}}` — {{observed TODO/gap}}
```

Only include TODOs or gaps observed in code/docs. Do not convert wishes into facts. If follow-ups are stale-prone, add an HTML comment warning near this section.

---

## Section: 核心开发理念

<!-- VALIDATION GATE: Each bucket MUST contain at least 1 rule that is specific to THIS project
     (passes the specificity test from writing-style.md). If a bucket only has generic knowledge
     like "高内聚低耦合" or "声明式 UI", delete that bucket. -->

3-5 capability buckets. Each bucket is a heading + 2-4 bullets. Pick buckets that match the archetype:

**Universal candidates**:
- 声明式 / 模块化思维（frontend, fullstack）
- 防御性编程与可测试性（all）
- 类型安全与契约优先（TypeScript / Rust / Go projects）
- 接口契约与领域建模（backend, fullstack）
- 性能与资源边界（mobile, embedded, perf-sensitive）

**Format**:
```markdown
## 🎯 核心开发理念

### 1. {{Bucket name}}
- **{{Sub-principle}}**：{{one-sentence enforcement clause}}
- **{{Sub-principle}}**：{{one-sentence enforcement clause}}
```

Avoid abstract aspirations ("写优雅的代码"). Each bullet should be checkable.

**Anti-pattern examples** (DELETE these if they appear in your draft):
- "组件应高内聚低耦合" — too generic, applies to all projects
- "基于状态渲染 UI" — basic React, not a project rule
- "使用 Hooks 管理状态与副作用" — basic React, not a project rule
- "防御性编程：外部数据判空" — universal practice, not project-specific

**Good examples** (project-specific, keep these):
- "3D 动画必须使用 `useFrame`，禁止 `setInterval` — 避免帧率不同步导致抖动"
- "所有 API 响应必须经过 `src/utils/responseNormalizer.ts` 标准化后再使用"
- "移动端 CSS 写 px，由 postcss-px-to-viewport 转 vw；禁止手写 vw/rem"

---

## Section: 项目背景与最高优先级原则（红线）

<!-- VALIDATION GATE: This section is ALWAYS required. But each sub-rule must:
     1. Have been confirmed via scan or interview (no fabrication)
     2. Include a "why" clause explaining the consequence of violation
     3. Reference actual file paths that were verified to exist -->

This is the **most important section**. AI reads it first.

```markdown
## ⚠️ 项目背景与最高优先级原则

### 项目现状
- {{2-4 bullets describing the actual situation: team size, history, iteration speed, runtime environments}}

### 最高优先级原则（红线）

#### 1. 技术栈强制对齐
- **必须**使用项目已配置的技术栈：{{list}}
- **禁止**引入新的 {{category}} 库（如 {{counter-examples}}）
- **禁止**使用未在 {{config file}} 中配置的工具/插件

#### 2. 历史代码处理原则
- {{保持不动 / 增量改进 / 全量重写 — pick policy that matches team}}
- {{whether legacy utilities are reusable or to be replaced}}

#### 3. 类型与数据规范（强制）
- {{language-specific type rules — see archetype templates}}
- {{ID / time / money handling rules — these are nearly universal}}

#### 4. {{Service Layer / API Layer / Data Layer}} 规范（强制）
- {{where this lives, what wrapper to use, where types go}}

#### 5. 文档同步规范（强制）
- 修改公共组件 / 公共方法 / 新建公共文件夹时，需询问是否同步更新 AGENTS.md
- 新规则发现时，AI 应主动提示用户是否纳入 AGENTS.md
```

The 5 categories above are a checklist. If a category genuinely doesn't apply, drop it. Don't add empty placeholders.

---

## Section: 技术栈与项目结构

<!-- VALIDATION GATE: Do NOT list exact version numbers here — they rot fast.
     Instead, reference package.json/pyproject.toml for versions.
     Only list the tech category + name + a note about WHY it was chosen or HOW it's used.
     Directory structure must match actual `ls` output, not imagination. -->

### 核心技术栈表格

```markdown
| 类别 | 技术选型 | 说明 |
|------|---------|------|
| 框架 | {{name}} | {{1-clause note on how it's used}} |
| 语言 | {{name}} | {{1-clause note}} |
| 构建 | {{name}} | {{1-clause note}} |
| {{UI lib / ORM / etc}} | {{name}} | {{1-clause note}} |
| 测试 | {{name}} | {{1-clause note}} |
```

Only list categories the project actually uses. Empty rows ("- 无") are noise.
**Do NOT include version numbers** — they belong in package.json and will go stale here.

### 目录结构

```markdown
src/
├── {{folder}}/      # {{purpose}}
├── {{folder}}/      # {{purpose}}
└── {{folder}}/      # {{purpose}}
```

Keep to top 2 levels. Drill into a third level only if it carries a rule (e.g. "页面级 hooks 必须放在 `src/pages/{Page}/hooks/`").

---

## Section: 检查与验证机制

<!-- VALIDATION GATE: Only include checks that are NOT already automated by CI/lint.
     If ESLint already catches unused vars, don't list "no unused vars" here.
     Focus on checks that require human/AI judgment. -->

### 代码提交前检查清单

```markdown
- [ ] **类型检查**：{{tsc / mypy / cargo check}} 无错误
- [ ] **代码风格**：通过 {{linter}} 与 {{formatter}}
- [ ] **测试**：{{unit / integration}} 测试通过
- [ ] **构建**：{{build command}} 成功
- [ ] **{{domain-specific check}}**：{{e.g. 接口契约、迁移兼容、移动端预览}}
```

### 代码审查关注点

3 angles, each with 3-4 questions:

**架构层面**
- {{archetype-specific architectural questions}}

**性能层面**
- {{archetype-specific perf questions}}

**{{体验 / 安全 / 可观测性 — pick the most relevant third angle}}**
- {{questions}}

---

## Section: 公共工具与约定

<!-- VALIDATION GATE: ONLY list utilities that were OBSERVED in the Phase 1 scan.
     Every path and function name here must have been confirmed to exist.
     If you didn't see it in the code, don't write it here.
     DELETE this section entirely if the project has no shared utilities worth calling out. -->

List shared helpers the team wants AI to **reuse rather than reinvent**. One bullet per helper:

```markdown
- **{{功能名}}**：统一使用 `{{path/to/util.ts}}` 中的 `{{functionName}}`；{{ when to use + any constraints}}
```

Only include utils that were observed in the scan or confirmed in the interview. Don't invent.

**Anti-pattern**: Listing a utility that doesn't exist yet ("建议创建 `src/utils/dateUtils.ts`"). AGENTS.md documents current reality, not aspirations. If a utility should exist but doesn't, mention it in a "Known Follow-Ups" section or suggest it to the user separately.

---

## Section: 本文档的维护规则（必须包含）

<!-- This section is ALWAYS included as the final section of the generated AGENTS.md -->

```markdown
## 📌 本文档的维护规则

- AGENTS.md 中的每条规则必须能回答"违反它会导致什么具体后果"——无法回答的规则应删除
- 能被 lint / CI / 类型检查自动强制的规则不重复写入，除非需要解释 why
- 发现文档与代码不一致时，以代码为准，更新文档
- 新增公共组件/工具/约定时，评估是否需要同步更新本文档

<!-- last-verified: {{YYYY-MM-DD}} -->
```
