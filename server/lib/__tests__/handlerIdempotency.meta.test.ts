import { describe, expect, test } from 'vitest';
import { JOB_CONFIG } from '../../config/jobConfig.js';
import type { IdempotencyContract } from '../../config/jobConfig.js';
import { HANDLER_REGISTRY } from './handlerRegistryFixture.js';
import { JOB_PAYLOAD_FIXTURES } from './jobPayloadFixtures.js';

// ---------------------------------------------------------------------------
// MC7 — Handler idempotency meta-test (spec §6.1)
//
// Verifies structural integrity of the handler registry against JOB_CONFIG:
//   Step 1 — every JobName in JOB_CONFIG is present in HANDLER_REGISTRY
//   Step 2 — every HANDLER_REGISTRY entry has a non-null registrationSite
//   Step 3 — every HANDLER_REGISTRY entry has an idempotencyContract in JOB_CONFIG
//   Step 4 — every handler_tested entry has a non-empty comparesTables array
//   Step 5 — every handler_tested entry has a payload fixture in JOB_PAYLOAD_FIXTURES
//   Step 6 — per-handler double-fire equivalence (deferred: handler=null in v1;
//             asserted structurally that handler is null and registrationSite is present)
//
// The handler registry is hand-maintained against JOB_CONFIG.
// The verify-handler-registry-fixture.sh gate enforces bidirectional set-equality
// at CI time; this test asserts the contract shape locally.
// ---------------------------------------------------------------------------

const JOB_NAMES = Object.keys(JOB_CONFIG) as Array<keyof typeof JOB_CONFIG>;

describe('MC7 — handler registry structural integrity', () => {
  test('step 1: every JOB_CONFIG key is present in HANDLER_REGISTRY', () => {
    const missing: string[] = [];
    for (const name of JOB_NAMES) {
      if (!(name in HANDLER_REGISTRY)) {
        missing.push(name);
      }
    }
    expect(missing, `Missing from HANDLER_REGISTRY: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('step 1 (reverse): every HANDLER_REGISTRY key is present in JOB_CONFIG', () => {
    const registryKeys = Object.keys(HANDLER_REGISTRY);
    const missing: string[] = [];
    for (const name of registryKeys) {
      if (!(name in JOB_CONFIG)) {
        missing.push(name);
      }
    }
    expect(missing, `HANDLER_REGISTRY has keys absent from JOB_CONFIG: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('step 2: every HANDLER_REGISTRY entry has a non-empty registrationSite', () => {
    const broken: string[] = [];
    for (const [name, entry] of Object.entries(HANDLER_REGISTRY)) {
      if (!entry.registrationSite || entry.registrationSite.trim() === '') {
        broken.push(name);
      }
    }
    expect(broken, `Empty registrationSite: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('step 3: every HANDLER_REGISTRY key has an idempotencyContract in JOB_CONFIG', () => {
    const missing: string[] = [];
    for (const name of Object.keys(HANDLER_REGISTRY) as Array<keyof typeof JOB_CONFIG>) {
      const config = JOB_CONFIG[name];
      if (!config || !('idempotencyContract' in config) || config.idempotencyContract === undefined) {
        missing.push(name);
      }
    }
    expect(missing, `Missing idempotencyContract: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('step 4: every handler_tested entry has a non-empty comparesTables array', () => {
    const broken: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'handler_tested') {
        if (!contract.comparesTables || contract.comparesTables.length === 0) {
          broken.push(name);
        }
      }
    }
    expect(broken, `handler_tested entries with empty comparesTables: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('step 5: every handler_tested entry has a payload fixture in JOB_PAYLOAD_FIXTURES', () => {
    const missing: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'handler_tested') {
        if (!(name in JOB_PAYLOAD_FIXTURES)) {
          missing.push(name);
        }
      }
    }
    expect(missing, `handler_tested entries with no payload fixture: ${missing.join(', ')}`).toHaveLength(0);
  });

  test('step 5 (send_only / external_consumer): non-handler verdicts do not require payload fixtures', () => {
    // Structural assertion only — send_only and external_consumer entries
    // may optionally have fixtures but are not required to.
    const nonHandlerVerdicts = ['send_only', 'external_consumer', 'exempt'] as const;
    const unexpected: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if ((nonHandlerVerdicts as readonly string[]).includes(contract.verdict)) {
        // Any fixture entry for non-handler queues is informational, not structural.
        // No assertion needed — just confirm the registry entry exists.
        if (!(name in HANDLER_REGISTRY)) {
          unexpected.push(name);
        }
      }
    }
    expect(unexpected, `Non-handler queues missing from HANDLER_REGISTRY: ${unexpected.join(', ')}`).toHaveLength(0);
  });

  test('step 6: handler_tested entries with handler=null are flagged (wiring deferred to integration phase)', () => {
    // In v1, all handlers are null — the fixture documents registration sites only.
    // This test pins that state so a future build that wires real handlers
    // can replace null with the actual function and this assertion becomes the
    // "handler is wired" gate.
    const notYetWired: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'handler_tested') {
        const entry = HANDLER_REGISTRY[name];
        if (entry.handler === null) {
          notYetWired.push(name);
        }
      }
    }
    // Not an error in v1 — all handlers are null by design (registrationSite is the contract).
    // The count is pinned so drift is detectable.
    expect(notYetWired.length).toBeGreaterThan(0);
  });

  test('send_only entries have required lifecycle fields', () => {
    const broken: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'send_only') {
        if (!contract.tracking || !contract.addedAt || !contract.lifecycleState) {
          broken.push(name);
        }
        if (contract.lifecycleState === 'transitional' && !contract.reviewBy) {
          broken.push(`${name} (transitional missing reviewBy)`);
        }
        if (contract.lifecycleState === 'permanent' && !contract.consumer) {
          broken.push(`${name} (permanent missing consumer)`);
        }
      }
    }
    expect(broken, `send_only entries with missing required fields: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('external_consumer entries have required fields', () => {
    const broken: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'external_consumer') {
        if (!contract.consumer || !contract.idempotencyOwner) {
          broken.push(name);
        }
      }
    }
    expect(broken, `external_consumer entries with missing required fields: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('exempt entries have required fields', () => {
    const broken: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'exempt') {
        if (!contract.reason || !contract.owner || !contract.reviewBy) {
          broken.push(name);
        }
      }
    }
    expect(broken, `exempt entries with missing required fields: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('HANDLER_REGISTRY and JOB_CONFIG have the same key count', () => {
    const jobCount = JOB_NAMES.length;
    const registryCount = Object.keys(HANDLER_REGISTRY).length;
    expect(registryCount, `JOB_CONFIG has ${jobCount} entries but HANDLER_REGISTRY has ${registryCount}`).toBe(jobCount);
  });
});

// ---------------------------------------------------------------------------
// MC7 — step 6 double-fire equivalence (Wave 5 Session K REQ #36)
//
// Closes the spec §6.1 equivalence contract: when a handler_tested job is
// fired twice with the same payload, the second fire must NOT mutate the
// tables declared in `comparesTables` beyond the first fire's terminal
// state. In v1 every entry in HANDLER_REGISTRY has `handler: null`
// (registrationSite-only contract), so this suite executes the assertion
// only against wired handlers. When the integration phase wires handlers
// to functions, this suite begins exercising the real double-fire path
// without needing structural changes.
//
// Skip-gate posture (matches handoffDurability.integration.test.ts §1):
//   - All handlers null → suite runs but every assertion short-circuits
//     via wiredHandlers.length === 0; the test pins the "no handlers
//     wired yet" state.
//   - NODE_ENV !== 'integration' → DB-touching path is skipped; the
//     structural shape is still asserted so the contract stays compiled.
// ---------------------------------------------------------------------------

describe('MC7 — step 6: double-fire equivalence (handler_tested verdicts)', () => {
  const INTEGRATION = process.env.NODE_ENV === 'integration';

  const wiredHandlers = Object.entries(HANDLER_REGISTRY).filter(
    ([, entry]) => entry.handler !== null,
  );

  test('every handler_tested entry declares the comparesTables it would touch', () => {
    const broken: string[] = [];
    for (const name of JOB_NAMES) {
      const contract: IdempotencyContract = JOB_CONFIG[name].idempotencyContract;
      if (contract.verdict === 'handler_tested') {
        if (!Array.isArray(contract.comparesTables) || contract.comparesTables.length === 0) {
          broken.push(name);
        }
      }
    }
    expect(broken, `handler_tested entries without comparesTables: ${broken.join(', ')}`).toHaveLength(0);
  });

  test('when wired, the double-fire pattern asserts table-state equivalence between fires', async () => {
    if (wiredHandlers.length === 0) {
      // v1 state: every handler is null. Pin the structural intent so that a
      // future build that wires handlers triggers the actual double-fire below.
      expect(wiredHandlers.length).toBe(0);
      return;
    }

    if (!INTEGRATION) {
      // Wired handlers exist but DB integration mode is off — assert the
      // structural contract only (compile-time intent).
      for (const [name, entry] of wiredHandlers) {
        const contract = JOB_CONFIG[name as keyof typeof JOB_CONFIG].idempotencyContract;
        expect(entry.handler).not.toBeNull();
        expect(contract.verdict).toBe('handler_tested');
      }
      return;
    }

    // Integration path — fire each wired handler twice with the fixture payload
    // and assert the comparesTables row-set is identical after both fires.
    //
    // KNOWN LIMITATION (pr-reviewer 2026-05-16 should-fix #5): the per-table
    // snapshot below uses a bare COUNT(*) and an array of row IDs scoped to
    // the test fixture's organisation. A future integration build wiring real
    // handlers MUST also (a) set the per-tx organisationId GUC before each
    // fire so RLS policies engage as in production, and (b) extend the
    // snapshot to include a content hash (not just row IDs) so a handler that
    // mutates row contents without changing the row count is still detected.
    // Today the suite short-circuits when wiredHandlers.length === 0, so the
    // limitation is forward-looking — pinned here so the next author sees it.
    const { db } = await import('../../db/index.js');
    const testOrgId = process.env.HANDLER_DOUBLE_FIRE_TEST_ORG_ID ?? null;
    for (const [name, entry] of wiredHandlers) {
      const contract = JOB_CONFIG[name as keyof typeof JOB_CONFIG].idempotencyContract;
      if (contract.verdict !== 'handler_tested') continue;
      if (typeof entry.handler !== 'function') continue;
      const fixture = (JOB_PAYLOAD_FIXTURES as Record<string, unknown>)[name];
      expect(fixture, `payload fixture missing for ${name}`).toBeDefined();
      const tables: readonly string[] = contract.comparesTables ?? [];

      async function snapshot(): Promise<string> {
        const parts: string[] = [];
        for (const table of tables) {
          if (!/^[a-z][a-z0-9_]*$/.test(table)) {
            throw new Error(`unsafe table name in comparesTables: ${table}`);
          }
          const sqlText = testOrgId
            ? `SELECT id::text AS id FROM ${table} WHERE organisation_id = '${testOrgId}' ORDER BY id ASC`
            : `SELECT id::text AS id FROM ${table} ORDER BY id ASC`;
          const rows = (await db.execute(sqlText as never)) as unknown as Array<{ id: string }>;
          parts.push(`${table}=[${rows.map((r) => r.id).join(',')}]`);
        }
        return parts.join('|');
      }

      const before = await snapshot();
      await entry.handler!(fixture as never);
      const afterFirst = await snapshot();
      await entry.handler!(fixture as never);
      const afterSecond = await snapshot();

      expect(afterSecond, `double-fire mutated comparesTables for ${name}`).toBe(afterFirst);
      // sanity: at least one fire should be observable (otherwise the test
      // is vacuous and the handler may not be wired correctly).
      expect(before === afterFirst && afterFirst === afterSecond).toBe(false);
    }
  });
});
