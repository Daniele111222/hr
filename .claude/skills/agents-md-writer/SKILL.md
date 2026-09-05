---
name: agents-md-writer
description: Generate, refresh, or maintain a project-specific AGENTS.md / CLAUDE.md / AI collaboration guide for an existing codebase. Use when the user asks for "给 AI 看的项目规范", "AI 协作规范", "Cursor / Claude Code / Codex 项目指引", "把这些约定写进 AGENTS.md", or similar assistant-facing development rules. The skill captures verified tech stack, directory conventions, red-line rules, shared utilities, and review checklists as enforceable constraints. It supports frontend web, H5/mobile web, backend services, fullstack apps, CLIs, libraries, native mobile apps, and monorepos. Do not use for ordinary end-user README files, API reference docs, or generic style guides unless the target audience is AI coding assistants.
---

# AGENTS.md Writer

This skill produces a project-tailored `AGENTS.md` — a document AI coding assistants read first, written as enforceable constraints rather than tutorial prose. The reference example this skill was built from is an H5 React project, but the structure generalizes to backend services, CLIs, libraries, and native apps.

The output you produce should feel like a contract the AI must honor, not a friendly onboarding doc. For codebases where the first failure mode is "AI edits the wrong layer or misses the right entry point", the contract should start with a compact project knowledge map: task-to-path lookup, symbol/code map, verified commands, and known follow-ups. Navigation helps the AI land in the right files; red lines tell it how to behave once it gets there.

---

## Workflow

Follow these phases in order. Don't skip the scan — guessing at conventions produces generic docs that the user will reject.

### Phase 1 — Scan the project

Read the actual code before asking questions. The user picked "auto-scan + clarify gaps" — respect that by coming to the interview prepared.

Inspect (in parallel where possible):

- **Manifest files** — `package.json`, `pnpm-workspace.yaml`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`, `*.csproj`. Read dependencies + scripts + workspaces.
- **Config files** — `tsconfig.json`, `vite.config.*`, `next.config.*`, `webpack.config.*`, `tailwind.config.*`, `.eslintrc*`, `.prettierrc*`, `postcss.config.*`, `babel.config.*`, `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `Dockerfile`, `docker-compose.yml`, `.env.example`.
- **Top-level directory structure** — `Glob` for `src/**`, `app/**`, `pages/**`, `components/**`, `services/**`, `service/**`, `hooks/**`, `utils/**`, `lib/**`, `api/**`, `controllers/**`, `routes/**`, `models/**`, `migrations/**`, `tests/**`, `__tests__/**`, `e2e/**`, `docs/**`. Note: don't dump full trees into context — sample 1-2 representative subfolders.
- **Existing docs** — `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`. If `AGENTS.md` already exists, treat this as a refresh and preserve the user's intent.
- **Representative source files** — pick **3-5 files** across different layers (page, component, service, hook, util) to confirm actual code style. 1 file is never enough to distinguish convention from coincidence.
- **Git history** — run `git log --oneline -20` and `git log --diff-filter=M --name-only --pretty=format: -20 | sort | uniq -c | sort -rn | head -10` to identify recently active files and hotspots. Frequently modified files reveal pain points.

**Convention signals to observe** (check these explicitly in the sampled files):

| Signal | What to look for |
|--------|-----------------|
| Task routing | Which folders/files are the correct first stop for auth, routing, API, models, tests, config, UI shell, etc.? |
| Stable symbols | Which root app/router/store/service symbols are useful anchors for future AI edits? |
| Import order | Is there a consistent grouping? (React → 3rd-party → internal → types → styles) |
| Error handling | try-catch in components? Error boundaries? Service-level error wrapping? |
| State management | Which store library? How is auth state actually stored? (memory / localStorage / cookie) |
| Naming | File naming (PascalCase / camelCase / kebab-case)? Export style (named / default)? |
| Request pattern | Object methods (`authService.login`) or standalone functions (`export async function login`)? |
| Type definitions | Co-located with service? Separate `types/` folder? Inline? |
| Test pattern | Where do tests live? What's the naming convention? What's tested? |

**Fact verification rule**: Every file path, utility name, or code pattern you later write into AGENTS.md must have been confirmed to exist during this scan. If you didn't see it, don't write it.

Output of this phase: an internal mental model of project type, tech stack, layering, naming conventions, and any obvious style choices the user is already enforcing. Plus a list of verified facts (paths, patterns, tools) you can reference in the draft.

Also capture a **navigation fact set** when the project has more than one meaningful layer or entry point:

- 5-10 task routes: "If task is X, start in path Y".
- 3-8 stable code anchors: symbol, type, file, role.
- Verified command groups: dev, build, test, lint, services.
- Known TODOs/follow-ups that were explicitly present in code/docs.

Do not invent these. A short verified map is better than a complete-looking map that contains one false path.

### Phase 2 — Classify the project

Pick the closest archetype — this drives which reference templates you load:

| Archetype | Signals |
|---|---|
| `frontend-web` | React/Vue/Svelte/Angular + Vite/Next/Nuxt + browser target |
| `frontend-h5` | `frontend-web` + `postcss-px-to-viewport` / vant / react-vant / `viewport` meta + mobile UA hints |
| `backend-service` | Express/Nest/Fastify/Koa/FastAPI/Django/Flask/Spring/Gin/Echo/Rails/.NET — has controllers or routers, no UI |
| `fullstack` | Next.js app router + API routes, Remix, Nuxt server routes, or monorepo with both |
| `mobile-native` | React Native, Flutter, SwiftUI, Kotlin Android, Expo |
| `cli-or-library` | Single entry binary or published npm/pypi package — no app shell |
| `monorepo` | Workspaces present — apply per-package archetypes |

If the project genuinely spans two archetypes (e.g. fullstack), compose sections from both reference files rather than forcing one label.

After classification, read the matching reference file(s) from `references/`:

- `references/template-base.md` — always read; contains universal sections.
- `references/template-frontend-web.md` — frontend web specifics.
- `references/template-frontend-h5.md` — H5 mobile additions.
- `references/template-backend.md` — service/API layer specifics.
- `references/template-mobile-native.md` — native app specifics.
- `references/template-cli-library.md` — packaged tool specifics.
- `references/writing-style.md` — read this every time; it governs tone and structure.
- `references/example-h5-react.md` — optional worked example; read only when you need to see how the templates compose for a real H5 project. Never paste from it verbatim.

### Phase 3 — Interview to fill gaps

After scanning you'll know the *what* (tech stack, layout) but not the *why* (team conventions, pain points, red-lines). Ask targeted questions — never blanket-questionnaire the user.

Batch related questions when the environment supports structured user input (max 4 at a time, ideally 2-3). If not, ask concise plain-text questions directly. Group by theme so the user can answer in one pass.

Topics to cover (only ask what scanning didn't already answer):

1. **Project background** — what does it do, who's the team, what's the rough quality / collaboration situation? (e.g. multi-developer, mixed history, frequent iteration).
2. **Red-line rules** — what must AI *never* do? Common categories:
   - Tech stack lock-in (no new UI libraries, no new state libraries)
   - How to treat legacy code (leave alone? rewrite to new spec? incremental?)
   - Type/data hard rules (e.g. no `any`, big-integer IDs must stay string, time fields must use central formatter)
   - Service/API layer rules (where requests live, which wrapper to use)
   - Public-component sync rules (do edits to shared components require doc updates?)
3. **Directory & naming conventions** — anything non-obvious that scanning missed (e.g. `src/service/` vs `src/services/`, business-domain folder grouping, page-level vs global hooks).
4. **Style / UI conventions** *(frontend only)* — CSS Module vs global, design tokens, theming, responsive strategy.
5. **Shared utilities to call out** — date formatters, text truncation, ID handling, request wrapper, error reporter — anything the team wants AI to reuse instead of reinventing.
6. **Review checklist priorities** — what does the team look at first in code review? (Types, perf, error handling, accessibility, security…)
7. **Pain points & historical lessons** — the highest-value questions for producing a useful AGENTS.md:
   - "AI 过去生成代码最常犯什么错误？"（直接转化为红线规则）
   - "哪些规则你觉得需要但经常被违反？"（反映真实痛点而非理想规范）
   - "项目当前最痛苦的技术债是什么？AI 应该如何对待它？"（决定历史代码处理策略）
   - "有没有曾经因为某个错误导致线上事故的案例？"（转化为最高优先级红线）

Skip topics that don't apply. A library project doesn't need NavHeader rules; a backend doesn't need viewport adaptation.

### Phase 4 — Draft the AGENTS.md

Compose the document by selecting and adapting sections from the reference templates. The skeleton below is the recommended order — drop sections that don't apply, don't invent ones that the project doesn't need.

Before choosing the long contract skeleton, evaluate whether the project benefits from a **knowledge-map-first architecture**:

| Use this structure when... | Prefer the stricter contract-first structure when... |
|---|---|
| The repo is multi-layer, monorepo, fullstack, or has multiple task entry points | The repo is small and most work starts in the same few files |
| Future AI sessions need to find the right folder quickly | The main risk is violating hard architectural rules |
| Existing AGENTS.md is concise and already works as a task index | Existing AGENTS.md is vague, generic, or lacks enforceable constraints |
| The user asks for a project knowledge base / 项目知识库 | The user asks for red lines, collaboration rules, or strict AI constraints |

If both apply, compose them: put the navigation map immediately after the header, then the highest-priority red lines. This gives AI a fast landing zone without weakening constraints.

```
# {{Project Name}} — AI 开发规范 / AGENTS.md

**技术栈**: {{tech list}}
**项目类型**: {{archetype}}

## OVERVIEW / 项目概览
  (1-3 lines: what it is, architecture, standout capabilities)

## WHERE TO LOOK / 任务入口
  (task → verified path → note table)

## CODE MAP / 代码锚点
  (symbol → type → verified file:line → role table)

## 🎯 核心开发理念
  (3-5 capability buckets tailored to archetype — see writing-style.md)

## ⚠️ 项目背景与最高优先级原则
  ### 项目现状
  ### 最高优先级原则（红线）
    1. 技术栈强制对齐
    2. 历史代码处理原则
    3. 类型与数据规范（强制）
    4. 服务/数据层规范（强制）
    5. 文档同步规范（强制）

## 🛠 技术栈与项目结构
  ### 核心技术栈（表格）
  ### 目录结构（树）

## 📋 {{frontend: 组件与样式规范 | backend: 接口与领域规范 | etc.}}

## ✅ 检查与验证机制
  ### 代码提交前检查清单
  ### 代码审查关注点（架构/性能/体验 或 架构/性能/安全）

## 🔧 公共工具与约定
  (project-specific shared utilities)

## COMMANDS / 常用命令
  (only commands verified in package scripts, pyproject, README, or existing docs)

## KNOWN FOLLOW-UPS / 已知后续事项
  (only TODOs or gaps observed in code/docs; do not turn wishes into facts)
```

Follow `references/writing-style.md` strictly while drafting — it covers tone, the imperative voice, when to use 强制/禁止 vs 优先/推荐, and how to format examples.

**Critical writing rules** (also in writing-style.md, but worth repeating):

- Write for AI as the primary reader. Use unambiguous, enforceable phrasings. "禁止 X" / "必须 Y" / "优先 Z" beats "建议考虑 Y".
- Every red-line rule needs a **why** — one short clause explaining the reason. Without it, AI will rules-lawyer edge cases. Example: "禁止使用 `Number(id)` — JS number 精度只有 53 位，大整数 ID 会丢精度".
- Show paths verbatim with the project's actual casing. `src/service/` and `src/services/` are not interchangeable.
- Tables for tech stack and props. Bullet lists for rules. Code blocks for layout examples and minimal usage snippets — never paste large file contents.
- Don't fabricate file paths, util names, or component names. If something wasn't observed in the scan and wasn't confirmed in the interview, leave it out.
- Output language matches the user's working language (default 中文 if the existing docs and conversation are in Chinese).

### Phase 5 — Fact-check the draft

Before showing the user, verify every claim in the draft:

1. **Path verification** — every file path mentioned in the document (e.g. `src/services/api.ts`, `src/utils/dateUtils.ts`) must be confirmed to exist via `Glob` or `Read`. If a path doesn't exist, remove the reference or ask the user.

2. **Code pattern verification** — if the document says "使用 Zustand persist 持久化状态", confirm the actual store file uses `persist`. If it says "Axios 实例注入 Bearer token", confirm the interceptor code matches. Mismatches between AGENTS.md and reality are worse than having no AGENTS.md.

3. **Navigation-map verification** — for every `WHERE TO LOOK` or `CODE MAP` row, confirm the path exists and the symbol/role is still accurate. Prefer fewer rows over stale inventories. If a line number is likely to churn, omit it unless the user asked for exact anchors.

4. **Redundancy check** — for each rule, ask: "Is this already enforced by a tool (ESLint rule, tsconfig flag, CI check)?" If yes, either:
   - Remove it (the tool already prevents violations), or
   - Keep it but mark: "（已由 `{{tool}}` 强制，此处记录供理解上下文）"

5. **Specificity check** — for each rule, ask: "Would this rule apply to ANY project using the same tech stack?" If yes, it's generic and should be removed unless the project has a specific reason to emphasize it (e.g. the team has repeatedly violated it).

6. **Example verification** — code examples in the document must come from actual project files (simplified if needed), not from templates or imagination.

### Phase 6 — Show and revise

Write the file to the project root as `AGENTS.md` (or whatever name the user picked — `CLAUDE.md`, `docs/ai-guidelines.md`, etc.).

Then summarize in 2-3 lines: which sections you included, which optional sections you skipped and why, and ask if anything needs adjustment. Don't dump the full doc back into chat — the user can read the file.

If the user requests changes, edit in place rather than regenerating from scratch.

### Phase 7 — Maintenance strategy

Before finishing, add these maintenance mechanisms to the document:

1. **Timestamp** — add at the very end of the file:
   ```
   <!-- last-verified: YYYY-MM-DD -->
   ```
   This signals to future AI sessions when the doc was last confirmed accurate.

2. **Decay-prone content warning** — if the document contains version numbers, component inventories, or file path lists, add a comment near them:
   ```
   <!-- ⚠️ 易过时内容：版本号/路径变更时需同步更新 -->
   ```

3. **Meta-rule** — include this as the final red-line rule in the document:
   ```
   ### 本文档的维护规则
   - AGENTS.md 中的每条规则必须能回答"违反它会导致什么具体后果"——无法回答的规则应删除
   - 能被 lint/CI/类型检查自动强制的规则不重复写入，除非需要解释 why
   - 发现文档与代码不一致时，以代码为准，更新文档
   ```

4. **Advise the user** — in your summary message, mention:
   - Which sections are most likely to go stale (version numbers, component lists)
   - Suggest a cadence for review (e.g. "建议每月或每次大重构后重新验证一次")
   - If the project has CI, suggest adding a reminder or a lightweight check

---

## Common pitfalls to avoid

- **Generic prose.** "Components should be well-designed" is useless. "组件 Props 接口必须明确声明，禁止用 `any` 占位；行内 props 超过 5 个时拆 `props` 对象" is enforceable.
- **Overreach from a single example.** One H5 reference doesn't mean every project gets NavHeader rules. Cut sections aggressively.
- **Inventing conventions the team doesn't actually follow.** If you didn't observe it and didn't confirm it, don't write it as a rule.
- **Writing onboarding content.** This document is a constraint contract for AI, not a tutorial. Don't explain what React is. Don't explain what TypeScript does.
- **Forgetting the why.** A red-line without a why is a future bug report. Always give one short reason.
- **One giant file.** If the project genuinely needs more than ~600 lines of guidance, split: keep `AGENTS.md` lean and reference `docs/common-components.md`, `docs/api-conventions.md`, etc.
- **Phantom references.** Never mention a file path, utility, or component that you haven't verified exists. "必须使用 `src/utils/dateUtils.ts`" is harmful if that file doesn't exist — AI will hallucinate an implementation or error out.
- **Repeating tool-enforced rules.** If `tsconfig.json` already sets `"noUnusedLocals": true`, writing "禁止未使用变量" in AGENTS.md is redundant noise. Only document rules that tools cannot enforce.
- **Template-filling without adaptation.** If a section from the reference template doesn't have project-specific content to fill, delete the section entirely. An empty section filled with generic advice is worse than no section.

---

## When this skill should NOT trigger

- The user wants a README for end users → that's `README.md`, different audience.
- The user wants API documentation → that's OpenAPI / Swagger / generated docs.
- The user wants commit message conventions only → that's a small `CONTRIBUTING.md` addition, not a full AGENTS.md.
- The user wants Claude Code settings (hooks, permissions) → use the `update-config` skill instead.

If in doubt, ask once before scanning.
