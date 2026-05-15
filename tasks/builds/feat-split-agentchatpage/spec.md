**Status:** draft
**Spec date:** 2026-05-15
**Author:** Michael
**Build slug:** feat-split-agentchatpage

# Split AgentChatPage along helper / typing-indicator seams

## Goals
- Decompose `client/src/pages/AgentChatPage.tsx` (741 LOC) by extracting the message-rendering helpers and TypingIndicator into `client/src/components/agent-chat/`.

## Non-goals
- Visual change. API change. New non-helper tests.

## Current structure
- 5 pure helpers: `renderAssistantContent`, `renderInlineMarkdown`, `renderBold`, `formatTime`, `formatConvDate`.
- 1 atom: `TypingIndicator`.
- Main `AgentChatPage` (175-741, ~566 LOC).

## Target structure
```
client/src/pages/AgentChatPage.tsx                ← host (~600 LOC target)
client/src/components/agent-chat/
  ├─ messageRender.tsx                            ← renderAssistantContent + renderInlineMarkdown + renderBold (JSX-emitting helpers)
  ├─ format.ts                                    ← formatTime, formatConvDate
  ├─ __tests__/format.test.ts                     ← Vitest covering format helpers
  └─ TypingIndicator.tsx
```

## Migration plan
1. `format.ts` + tests + `messageRender.tsx` + `TypingIndicator.tsx`.
2. Update host imports + sweep.

## Acceptance
- Host ≤ 620 LOC.
- All G1 gates green; format tests pass.
