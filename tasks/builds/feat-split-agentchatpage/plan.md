# Plan — feat-split-agentchatpage

Spec: `tasks/builds/feat-split-agentchatpage/spec.md`. Source: `client/src/pages/AgentChatPage.tsx` (741 LOC).

Single chunk:
1. `agent-chat/format.ts` (formatTime, formatConvDate) + tests + `messageRender.tsx` (renderAssistantContent + renderInlineMarkdown + renderBold) + `TypingIndicator.tsx`. Update host imports.

No `.js` suffixes on relative imports.
