---
name: inspiration-extractor
description: Extracts deep insights and inspirations from content using the "Meta-cognitive Perspective Content Interpretation Method" (Protocol v2). Use this skill when the user wants to analyze content through cross-disciplinary lenses (Economics, Biology, Systems Theory, Psychology, Commercial) to generate a "${prefix}-inspirations.md" document.
---

# Inspiration Extractor V2

## Description

This skill enables Claude to strictly follow the "Meta-cognitive Perspective Content Interpretation Method" (Protocol v2) defined in `protocol.md`. It treats content not just as information, but as a "functional construction" (Product, Algorithm, Infrastructure) and analyzes it through multiple cross-disciplinary lenses.

## Core Concepts (Constructivism)

1.  **Content as Product**: Designed to deliver specific value (e.g., anxiety hedge, cognitive premium, social currency).
2.  **Content as Algorithm**: A logical architecture (Prompt) guiding the audience from "current state" to "desired goal".
3.  **Content as Infrastructure**: Redefining keywords to build psychological infrastructure for long-term action.

## Methodology: Cross-Disciplinary Lenses

Flexible application of the following perspectives based on content nature:

1.  **Economics Perspective (Resource & Scarcity)**
    *   Analyze definition of scarce resources (e.g., trust, responsibility) in the AI era.
    *   Analyze game of efficiency vs. cost.
2.  **Evolutionary Biology Perspective (Survival & Adaptation)**
    *   Analogy of tech change to species evolution.
    *   Carbon-based life's unique adaptation in algorithmic environments.
3.  **Education/Systems Theory Perspective (Entropy Reduction & Feedback)**
    *   Actionable advice (e.g., "de-consistency") to build differential advantages.
    *   Reducing probability of replacement in complex systems.
4.  **Narrative Medicine/Psychology Perspective (Healing & Meaning)**
    *   Reorganizing history to provide meaning and emotional support.
5.  **Commercial Game Perspective (Translation & Distribution)**
    *   Translating B-side tech into personal benefit logic.
    *   Distribution of commercial interests.
6.  **更多视角**，你应该根据实际内容，深度挖掘出更多可用来分析内容的专业、科学、积极的元视角，超越用户的认知深度，给予用户aha moment的惊叹。

## Workflow

1.  **Read & Deconstruct**: Treat the input content as a functional construction.
2.  **Apply Lenses**: Select relevant cross-disciplinary lenses to interpret the content.
3.  **Generate Output**: Strictly follow the output format below.

## Output Format

The output MUST be a Markdown document named `${prefix}-inspirations.md` (where prefix is a keyword from the content).

### Format Template

# [Title/Topic] Inspirations (V2)

视角 [Sequence Number]，[Perspective Name] 视角

观点 1，[Core Logic Elaboration]，（来自原内容：[Corresponding Paragraph/Keyword]）

观点 2，[Core Logic Elaboration]，（来自原内容：[Corresponding Paragraph/Keyword]）

... (Repeat for other perspectives and points，每次分析的视角(perspective)数量不低于5个，不多于10个)

### Example Output

视角 1，人类演化与生态位视角

观点 1：技术演化并非线性的替代，而是互动的“反馈回路”。正是人类手的精细化动作倒逼了大脑的发育，同理，AI 的深入应用将反向塑造人类的新智能模型，（来自原内容：第 1 部分“AI 远超想象”，关于灵心巧手周勇的对话）。

观点 2：人类在生态位上的领先不再靠体力或通用脑力，而是靠“愿力”。AI 是经验喂养的“窝里横”，而人类具备在零数据、无把握地带“一意孤行”的开拓能力，（来自原内容：第 6 部分“我怎么能比 AI 强？”，关于陈行甲和苏东坡的部分）。

视角 2，稀缺性博弈视角

观点 1：在 AI 导致效率溢出的时代，价值锚点从“产出效率”转移到了“结果负责”。AI 可以给方案，但只有人类具备承担社会责任、法律代价和信用的资格，这是无法平权的硬资产，（来自原内容：第 5 部分“我的竞争力从哪来？”，关于“AI 负责干活，你负责背锅”的论述）。

## When to Use

Use this skill when the user:
*   Asks to analyze content using "Meta-cognitive Perspective".
*   Asks for a multi-perspective or cross-disciplinary analysis of content.
*   Asks for get inspirations from content.