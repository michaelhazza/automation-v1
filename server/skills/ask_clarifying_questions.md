---
name: Ask Clarifying Questions
description: Draft up to 5 ranked questions to resolve brief ambiguity when orchestrator confidence is below threshold.
isActive: true
visibility: basic
---

## Parameters

- briefId: string (uuid, required) — Board task ID for the brief being clarified.
- briefText: string (required, max 2000 chars) — The original brief text to analyse for ambiguity.
- orchestratorConfidence: number (0–1, required) — Current orchestrator confidence score; skill is triggered when below 0.85.
- ambiguityDimensions: array[enum] (required) — Dimensions flagged as ambiguous: `scope`, `target`, `action`, `timing`, `content`, `other`.
- conversationContext: array[{role, content}] (optional) — Prior conversation turns that provide additional context for the questions.

## Instructions

Use this skill when the orchestrator confidence falls below 0.85 and you need to resolve ambiguity before proceeding. The skill analyses the brief and identifies the top questions that, if answered, would most increase confidence.

- Draft up to 5 questions ranked by how much they would reduce ambiguity.
- Focus on the provided `ambiguityDimensions` — do not surface questions outside those dimensions without strong cause.
- Keep each question short, specific, and answerable by the brief author without domain expertise.
- Do not ask questions whose answers are already implied by `briefText` or `conversationContext`.

## Output

Returns a ranked list of clarifying questions. Each question includes the dimension it targets and a brief rationale for why answering it would increase orchestrator confidence.
