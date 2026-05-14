# Stub: Trust Verification Layer contract alignment

**Trigger to activate:** When the bench / scorecard surfaces next need to be operator-visible OR when a real trust-verification operator workflow surfaces a divergence.

**Scope (one paragraph).** Resolve the structural divergence between TVL's bench, scorecard, and runtime-check contracts shipped in PR #275. Consolidate the deferred items: TVL-DG-2 / DG-4 / DG-5 / DG-6 / DG-7 / DG-8 / DG-9, TVL-AM-1 / AM-2, AR-TVL-2 / AR-TVL-4. Single consolidation pass, not 11 piecemeal fixes — alignment touches `tasks/builds/trust-verification-layer/spec.md` plus the implementation under `server/services/trustVerification*`.

**Origin:** Trust Verification Layer follow-ups in legacy `tasks/todo.md`.
