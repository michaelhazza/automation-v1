**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-configassistantpage

# Split ConfigAssistantPage along helper / typing-indicator seams

## Goals
- Decompose `client/src/pages/ConfigAssistantPage.tsx` (650 LOC) by extracting the chat-rendering helpers (which duplicate AgentChatPage's helpers) into `client/src/components/config-assistant/`, plus the `extractPlan` helper.

## Non-goals
- Visual change. API change.

## Current structure
- 7 pure helpers: `renderAssistantContent`, `renderInlineMarkdown`, `renderBold`, `formatTime`, `formatConvDate`, `extractPlan`.
- 1 atom: `TypingIndicator`.
- Main `ConfigAssistantPage` (181-650, ~470 LOC).

## Target structure
```
client/src/pages/ConfigAssistantPage.tsx           ← host (~500 LOC target)
client/src/components/config-assistant/
  ├─ messageRender.tsx                              ← renderAssistantContent + renderInlineMarkdown + renderBold
  ├─ format.ts                                      ← formatTime, formatConvDate, extractPlan
  ├─ __tests__/format.test.ts                       ← Vitest covering format helpers + extractPlan
  └─ TypingIndicator.tsx
```

Note: these helpers are byte-equivalent duplicates of `client/src/components/agent-chat/*`. Cross-page consolidation deferred — see Deferred Items.

## Migration plan
Single chunk: extract all helpers + atom + tests. Update host imports.

## Deferred Items
- **Consolidate `agent-chat/` and `config-assistant/` shared chat helpers into a single `chat-shared/` folder.** Both share renderAssistantContent + renderInlineMarkdown + renderBold + TypingIndicator + formatTime + formatConvDate verbatim today. Deferring because the consolidation touches 2 callers and would benefit from a 3rd consumer (e.g. AgentRunChatPane) before being worth the rename cost. Tracked.

## Acceptance
- Host ≤ 520 LOC.
- All G1 gates green; format tests pass.
