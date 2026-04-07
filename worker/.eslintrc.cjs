/**
 * Worker ESLint config — enforces the T8 / T14 single-purpose connection
 * boundary documented in worker/src/persistence/integrationConnections.ts.
 *
 * Spec: docs/reporting-agent-paywall-workflow-spec.md §6.6.2 (T8).
 *
 * Rule rationale: the worker is a privileged component (it has DB access
 * and the ENCRYPTION_KEY equivalent via connectionTokenService). To prevent
 * any future contributor from bypassing the tenant-isolated single-purpose
 * fetch path, this config bans direct imports of the integrationConnections
 * Drizzle table object anywhere outside worker/src/persistence/.
 *
 * If you need a new connection type at runtime, add a sibling
 * single-purpose function (getSlackConnectionForRun, getOpenAiConnectionForRun)
 * to worker/src/persistence/integrationConnections.ts — never import the
 * raw table.
 */

/* eslint-env node */
module.exports = {
  root: false,
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '../../../server/db/schema/integrationConnections',
            message:
              'Worker code must not import the integrationConnections table directly. ' +
              'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
              'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
          },
          {
            name: '../../../server/db/schema/integrationConnections.js',
            message:
              'Worker code must not import the integrationConnections table directly. ' +
              'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
              'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
          },
          {
            name: '../../server/db/schema/integrationConnections',
            message:
              'Worker code must not import the integrationConnections table directly. ' +
              'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
              'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
          },
          {
            name: '../../server/db/schema/integrationConnections.js',
            message:
              'Worker code must not import the integrationConnections table directly. ' +
              'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
              'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
          },
        ],
        patterns: [
          {
            group: ['**/server/db/schema/integrationConnections', '**/server/db/schema/integrationConnections.js'],
            message:
              'Worker code must not import the integrationConnections table directly. ' +
              'Use getWebLoginConnectionForRun() in worker/src/persistence/integrationConnections.ts. ' +
              'Spec: T8 / docs/reporting-agent-paywall-workflow-spec.md §6.6.2.',
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // The persistence module is the single permitted importer.
      files: ['src/persistence/integrationConnections.ts'],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
};
