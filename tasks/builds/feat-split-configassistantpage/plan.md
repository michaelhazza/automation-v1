# Plan — feat-split-configassistantpage

Spec: `tasks/builds/feat-split-configassistantpage/spec.md`. Source: `client/src/pages/ConfigAssistantPage.tsx` (650 LOC).

Single chunk:
- `config-assistant/format.ts` (formatTime, formatConvDate, extractPlan) + tests
- `config-assistant/messageRender.tsx` (renderAssistantContent, renderInlineMarkdown, renderBold)
- `config-assistant/TypingIndicator.tsx`
- Update host imports

No `.js` suffixes on relative imports. Acknowledged duplication with `agent-chat/`; consolidation deferred.
