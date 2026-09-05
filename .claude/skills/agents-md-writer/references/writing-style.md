# Writing Style for AGENTS.md

This document is read by AI coding assistants as a hard contract. The style must reflect that.

## Voice & tone

- **Imperative, not suggestive.** "使用 X" beats "建议使用 X". "禁止 Y" beats "尽量避免 Y".
- **Tiered enforcement vocabulary** — use these consistently so AI can parse priority:
  - **必须 / 禁止 / 强制** — red line. Violating it is a bug.
  - **优先 / 默认 / 统一使用** — strong default. Deviate only with explicit reason.
  - **推荐 / 建议** — preference. Use judgment.
  - **可选** — fine either way.
- **Short sentences.** Long sentences hide ambiguity. Break compound rules into bullets.
- **No filler.** No "在编写代码时，我们希望…" — just "代码必须…".

## Structure conventions

- **Headings carry semantics.** `## 最高优先级原则（红线）` / `## 强制规范` / `## 推荐做法` — let the heading itself signal enforcement level.
- **Tables for structured data** — tech stack, component props, file location maps. Tables compress better than prose for AI to scan.
- **Code blocks for layout examples** — directory trees, minimal usage snippets. Never paste full files.
- **Bullet lists for rules.** Each bullet = one enforceable rule. If a bullet has two unrelated rules, split it.

## The "why" requirement

Every red-line rule needs a one-clause **why**. Without it, AI will rules-lawyer edge cases — or worse, ignore the rule when it looks inconvenient.

**Bad** (no why):
> 禁止使用 `Number(id)` 转换 ID。

**Good** (with why):
> 禁止使用 `Number(id)`、`parseInt(id)`、`+id` 转换大整数 ID — JS `number` 精度只有 53 位，订单号 / 工单号会丢精度。后端按 string 返回的 ID 前端必须全链路按 string 传递。

**Why** clauses should be ≤ 25 字 and reference real consequences (precision loss, bundle bloat, security hole, prior incident). They're not academic justifications.

## Examples pattern

When showing how to apply a rule, give a minimal contrast:

```
// ❌ 历史写法
const id = Number(order.id);
fetchDetail({ id });

// ✅ 规范写法
fetchDetail({ id: order.id });  // 保持 string 全链路
```

Two short snippets beat one long one. Don't show full files.

## What to never include

- **Tutorials.** No "React 是什么", no "TypeScript 类型系统介绍". The audience already knows.
- **Wishlist features.** No "未来可能引入 Redux". The doc describes current reality.
- **Aspirational quality bars.** "代码应当优雅、可读、可维护" — meaningless. Replace with specific, checkable constraints.
- **Self-praise / marketing.** "本项目采用业界最佳实践" — delete.
- **Personal opinions without consequence.** "我们更喜欢函数式风格" — only include if it's actually enforced.

## Section ordering rationale

`AGENTS.md` is read top-down by AI on every task. Put the highest-leverage information first:

1. **Tech stack header** (1 line) — anchors all downstream advice.
2. **Core philosophy** (3-5 buckets) — sets the mindset.
3. **Red-line rules** — what AI must never do. Front-loaded so a quick read covers the most expensive mistakes.
4. **Tech stack details + structure** — reference material.
5. **Domain-specific rules** — components/styles (frontend), routes/DB (backend), etc.
6. **Checklists** — pre-commit and review.
7. **Shared utilities** — reusable helpers.

## Length target

- **Sweet spot: 300-500 lines.** Long enough to be specific, short enough to stay in context every task.
- **Hard ceiling: ~700 lines.** Past that, split into `docs/*.md` and reference from `AGENTS.md`.
- **Anti-pattern: 100 lines.** Probably means it's all generic platitudes. Specific projects have specific rules.

## Language

Match the user's working language. If existing docs are in Chinese, write in Chinese. If English, write in English. Don't mix unless the team's actual code comments mix (e.g. Chinese explanations + English identifiers — that's fine to mirror).

Identifier names (file paths, function names, component names) stay in their original casing regardless of prose language.

---

## Specificity test

Before including any rule, apply this filter:

**"Would this rule apply to ANY project using the same tech stack?"**

- If YES → it's generic knowledge, not a project constraint. **Delete it** unless the team has a specific reason to emphasize it (e.g. repeated violations, past incidents).
- If NO → it's project-specific. **Keep it.**

Examples of rules that FAIL the specificity test (should be deleted):
- "组件应高内聚低耦合" — applies to all component-based projects
- "使用 TypeScript 严格模式" — already in tsconfig, applies to all TS projects
- "Props 接口必须显式声明类型" — basic TypeScript, not a project convention
- "使用 useEffect 管理副作用" — basic React, not a project convention
- "API 调用需要错误处理" — universal programming practice

Examples of rules that PASS the specificity test (should be kept):
- "access_token 存储在内存（`window.__ACCESS_TOKEN__`），refresh_token 存储在 cookie，禁止使用 localStorage" — project-specific auth architecture
- "服务层使用 `export async function` 风格，不使用对象方法风格" — project-specific convention
- "3D 场景组件必须使用 `useFrame` 而非 `setInterval`" — specific to R3F projects with a known anti-pattern
- "禁止在页面 less 中手写 `padding-top` 解决导航栏遮挡 — 会与全局占位冲突" — project-specific gotcha

---

## Single source of truth

AGENTS.md should not repeat information that already lives in a canonical source:

| Information | Canonical source | AGENTS.md should... |
|-------------|-----------------|---------------------|
| Dependency versions | `package.json` / `pyproject.toml` | NOT list exact versions (they'll go stale) |
| TypeScript strictness | `tsconfig.json` | NOT repeat compiler flags |
| Lint rules | `.eslintrc` / `ruff.toml` | NOT repeat lint rules |
| Build commands | `package.json` scripts | Reference by name (`npm run build`), not redefine |
| Environment variables | `.env.example` | Only mention if there's a non-obvious convention |

**What AGENTS.md IS for**: conventions that cannot be expressed in config files — architectural decisions, naming conventions, "where does X go", "when to use Y vs Z", "why we chose this approach".

---

## Decay prevention

Some content types rot faster than others. Handle them accordingly:

| Content type | Decay speed | Strategy |
|-------------|-------------|----------|
| Architectural rules ("routes stay thin") | Slow | Safe to include |
| Directory structure | Medium | Include top-level only, skip file lists |
| Component/util inventories | Fast | Don't list — reference the directory instead |
| Version numbers | Very fast | Don't include; point to package.json |
| Code examples | Medium | Use simplified patterns, not full file copies |

**Rule of thumb**: If a piece of information would require updating AGENTS.md every time a PR merges, it shouldn't be in AGENTS.md.
