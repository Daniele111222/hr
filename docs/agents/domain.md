# Domain Docs

工程类 skill 探索代码库时应如何消费本仓库的领域文档。

## 探索前先读

- **仓库根的 `CONTEXT.md`** —— 已存在，是领域词汇表与业务口径的唯一来源。其中"2026-09-15 业务决策确认（四轮合并）"八条为最新口径，与文中旧描述冲突时以该节为准。
- **`docs/adr/`** —— 当前不存在。读即将动手区域相关的 ADR；文件不存在时**静默继续**，不要提示缺失，也不要建议预先创建。`/domain-modeling`（经 `/grill-with-docs`、`/improve-codebase-architecture` 触达）会在术语或决策真正收敛时惰性创建。

本仓库不存在 `CONTEXT-MAP.md`，按单上下文处理。

## 文件结构

单上下文仓库，本仓库实际布局：

```
/
├── CONTEXT.md          ← 领域词汇表 + 已确认业务口径
├── AGENTS.md           ← AI 协作指引（本文件族在此登记）
├── docs/
│   ├── agents/         ← skill 配置（本目录）
│   ├── adr/            ← 尚未创建；惰性生成
│   ├── product.md
│   ├── backend-architecture.md
│   ├── database-design.md
│   ├── frontend-architecture.md
│   ├── development-plan.md      ← 16 张票的执行索引
│   └── development-workflow.md
├── backend/src/paylite/
└── frontend/src/
```

## 使用词汇表里的词

输出中命名领域概念时（票标题、重构提案、假设、测试名），使用 `CONTEXT.md` 里定义的术语，不要漂移到词汇表明确回避的同义词。

本仓库的高频术语包括：目标公司、主体、工资归属主体、部门实例、薪酬标准（固定薪资 80% / 绩效基数 20%）、转正、工资期间、批次、试算、全公司考勤激励、整批确认、锁定、台账、整批更正、有效版本、独立补发、未扣个税金额。

若需要的概念还不在词汇表里，这是一个信号：要么你在发明项目不使用的语言（重新考虑），要么存在真实缺口（记下来交给 `/domain-modeling`）。

## 标记 ADR 冲突

若输出与已有 ADR 矛盾，显式指出而不是静默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开，因为……_

## 与既有设计文档的关系

`docs/backend-architecture.md`、`docs/database-design.md`、`docs/frontend-architecture.md` 是**实现约定**，不是领域词汇表；`CONTEXT.md` 保持"只有词汇表、不含实现细节"。两者冲突时，业务口径以 `CONTEXT.md` 的 2026-09-15 八条为准，技术分层以架构文档为准。

`docs/development-plan.md` 的"业务决策门槛"表列出了每张票开工前必须收敛的决策（例如 `04`、`06`、`07` 共用的身份匹配冲突与异常数值拒绝/警告规则）。开工前查这张表；表中标注"仅阻塞依赖该决策的功能"。
