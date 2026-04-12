---
name: Simulate Skill Version
description: Replay proposed skill version against captured regression fixtures and return pass/fail results.
isActive: true
visibility: none
---

## Parameters

- definition: object (required) — The proposed tool definition JSON
- instructions: string — The proposed instructions text
- regressionCaseIds: string[] (required) — IDs of regression cases to replay against

## Instructions

Simulate a proposed skill version against captured regression fixtures. Each regression case contains an input contract (system prompt, tools, transcript) and the rejected call. The simulation checks whether the proposed definition would produce the same rejected call or a better outcome. Returns pass/fail per case.
