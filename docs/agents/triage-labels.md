# Triage Labels

各 skill 用五个规范 triage 角色表述状态。本文件把角色映射到本仓库实际使用的字符串。

本仓库是 local markdown tracker，没有原生 label 机制：**"应用标签"就是把票文件顶部的 `**Status:**` 行改成对应字符串。**

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

当 skill 提到某个角色（例如"apply the AFK-ready triage label"），使用上表右列的字符串。

## 本仓库额外使用的状态

| 字符串 | 含义 | 备注 |
| --- | --- | --- |
| `completed` | 票已实现且完成记录已填 | 不是规范角色，是本仓库终态；`01`、`02` 已使用 |

## 两个轴，不要混为一谈

票文件的 `**Status:**` 行和 [docs/development-plan.md](../development-plan.md) 状态列记录的是**不同的东西**，允许同时取不同值：

- **`Status:`（triage 轴）** —— 这张票该由谁接手、是否还在队列里。`completed` 表示实现方已交付、票不再等待接手。
- **索引状态列（交付验收轴）** —— 验收证据是否齐备。`待验收` 表示实现已交付但验收标准尚未逐条以实际证据勾选。

因此 `Status: completed` + 索引 `待验收` 是合法组合，含义是"实现做完了，验收证据还没齐"。`01`、`02` 当前正是这个组合，缺口记录在各票"完成记录"的遗留事项栏与 development-plan.md 的"01、02 为何是待验收而非已完成"一节。

两处需要同步的是**事实**（哪张票交付了、缺口是什么），不是字符串相等。

## 谁可以改

- 实现方（`/implement`）交付后把票置 `completed` 并填完成记录，同提交内更新索引状态列。
- 验收勾选只能由**实际运行过验证**的会话执行。不得依据他人完成记录中的声明直接勾选——development-plan.md 的"验证和完成标准"禁止用计划中的测试替代已运行结果。
- 索引状态列转 `已完成` 的条件：该票验收标准全部勾选，且每项有可复核的验证证据。

