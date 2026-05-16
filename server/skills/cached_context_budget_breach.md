---
name: Cached Context Budget Breach
description: "[INTERNAL] Operator review gate when a cached-context assembly exceeds budget. Not LLM-callable."
isActive: false
visibility: none
---

Internal registry entry. This is an operator review signal, not a callable skill — handler dispatch flows through the cached-context review path, not `SKILL_HANDLERS`. The action registry at `server/config/actionRegistry/**` is the source of truth. Stub satisfies the skill-md-vs-registry parity audit (W4AA-DEBT-1).
