/**
 * Canonical organisation / subaccount UUIDs for ad-hoc test fixtures.
 *
 * Use these whenever an integration or service-unit test needs a stable
 * org / subaccount id but doesn't load the full fixture set from
 * server/services/__tests__/fixtures/loadFixtures.ts.
 *
 * Before this file existed, every test invented its own UUID — usually
 * `00000000-0000-0000-0000-000000000001` for the org and `…000002` for
 * the subaccount, but with enough drift across files (different shapes,
 * different positions) that grepping for cross-tenant leak bugs was
 * slow and error-prone. Centralising the literals also makes it
 * unambiguous in RLS / cross-tenant tests which id is "tenant A".
 *
 * Values mirror the de facto convention already in use across the test
 * suite — they are NOT changing; this file just gives them a single name.
 *
 * Use the FIXTURE_* constants from loadFixtures.ts when you want a fully
 * seeded org with linked agents, tasks, etc. Use these CANONICAL_* ids
 * when you just need a stable scalar.
 */

export const CANONICAL_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const CANONICAL_SUBACCOUNT_ID = '00000000-0000-0000-0000-000000000002';
