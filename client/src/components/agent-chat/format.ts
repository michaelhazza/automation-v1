// PAGE-SPLITS-T1 (audit 2026-05-15): formatTime and formatConvDate moved to
// `client/src/lib/dateFormat.ts` so the same helpers are not duplicated across
// agent-chat and config-assistant. Re-exporting here preserves the existing
// import surface for downstream callers without a sweeping rename.
export { formatTime, formatConvDate } from '../../lib/dateFormat';
