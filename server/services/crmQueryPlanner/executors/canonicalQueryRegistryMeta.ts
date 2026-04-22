// Pure registry metadata — aliases, allowedFields, requiredCapabilities.
// No DB imports. Tested in canonicalQueryRegistry.test.ts.
// canonicalQueryRegistry.ts binds handlers and freezes the full registry.

import type {
  PrimaryEntity,
  QueryFilter,
} from '../../../../shared/types/crmQueryPlanner.js';

export interface RegistryEntryMeta {
  key: string;
  primaryEntity: PrimaryEntity;
  aliases: readonly string[];
  requiredCapabilities: readonly string[];
  description: string;
  allowedFields: Record<string, {
    operators: readonly QueryFilter['operator'][];
    projectable: boolean;
    sortable: boolean;
  }>;
}

export const REGISTRY_META: Record<string, RegistryEntryMeta> = {
  'contacts.inactive_over_days': {
    key: 'contacts.inactive_over_days',
    primaryEntity: 'contacts',
    aliases: ['stale contacts', 'contacts no activity', 'contacts without activity'],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Contacts with no activity since N days ago',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'] as const, projectable: true,  sortable: true  },
      id:        { operators: ['eq', 'in'] as const,                          projectable: true,  sortable: false },
      firstName: { operators: ['eq', 'contains'] as const,                    projectable: true,  sortable: true  },
      lastName:  { operators: ['eq', 'contains'] as const,                    projectable: true,  sortable: true  },
      email:     { operators: ['eq', 'contains'] as const,                    projectable: true,  sortable: false },
      tags:      { operators: ['in', 'contains'] as const,                    projectable: true,  sortable: false },
    },
  },
  'accounts.at_risk_band': {
    key: 'accounts.at_risk_band',
    primaryEntity: 'contacts',
    aliases: ['at risk accounts', 'churn risk', 'accounts likely churn', 'red accounts', 'yellow accounts'],
    requiredCapabilities: ['canonical.contacts.read', 'clientpulse.health_snapshots.read'],
    description: 'ClientPulse health band rollup (green/yellow/red)',
    allowedFields: {
      band:  { operators: ['eq'] as const, projectable: false, sortable: false },
      score: { operators: ['lt', 'lte', 'gt', 'gte', 'between'] as const, projectable: true, sortable: true },
    },
  },
  'opportunities.pipeline_velocity': {
    key: 'opportunities.pipeline_velocity',
    primaryEntity: 'opportunities',
    aliases: ['pipeline velocity', 'deal velocity', 'stage velocity', 'how fast deals moving'],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stage velocity metrics over a time window',
    allowedFields: {
      stageEnteredAt: { operators: ['gte', 'lte', 'between'] as const, projectable: true, sortable: true },
      stage:          { operators: ['eq', 'in'] as const,               projectable: true, sortable: true },
    },
  },
  'opportunities.stale_over_days': {
    key: 'opportunities.stale_over_days',
    primaryEntity: 'opportunities',
    aliases: ['stale opportunities', 'stuck deals', 'deals stuck stage', 'deals no movement'],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Opportunities in a stage beyond N days',
    allowedFields: {
      updatedAt: { operators: ['lt', 'lte', 'gt', 'gte', 'between'] as const, projectable: true, sortable: true },
      stage:     { operators: ['eq', 'in'] as const,                          projectable: true, sortable: true },
      value:     { operators: ['gt', 'gte', 'lt', 'lte'] as const,           projectable: true, sortable: true },
    },
  },
  'appointments.upcoming': {
    key: 'appointments.upcoming',
    primaryEntity: 'appointments',
    aliases: ['upcoming appointments', 'next appointments', 'future appointments', 'scheduled meetings'],
    requiredCapabilities: ['canonical.appointments.read'],
    description: 'Standard appointment list within a window',
    allowedFields: {
      startTime: { operators: ['gte', 'lte', 'between'] as const, projectable: true, sortable: true },
    },
  },
  'contacts.count_by_tag': {
    key: 'contacts.count_by_tag',
    primaryEntity: 'contacts',
    aliases: ['contacts tag', 'count contacts tag', 'tag breakdown', 'contacts per tag'],
    requiredCapabilities: ['canonical.contacts.read'],
    description: 'Tag-partitioned contact counts',
    allowedFields: {
      tags: { operators: ['in', 'contains'] as const, projectable: true, sortable: false },
    },
  },
  'opportunities.count_by_stage': {
    key: 'opportunities.count_by_stage',
    primaryEntity: 'opportunities',
    aliases: ['opportunities stage', 'deals stage', 'pipeline stage', 'stage breakdown'],
    requiredCapabilities: ['canonical.opportunities.read'],
    description: 'Stage-partitioned opportunity counts',
    allowedFields: {
      stage:  { operators: ['eq', 'in'] as const, projectable: true, sortable: true },
      status: { operators: ['eq'] as const,        projectable: true, sortable: false },
    },
  },
  'revenue.trend_over_range': {
    key: 'revenue.trend_over_range',
    primaryEntity: 'revenue',
    aliases: ['revenue trend', 'revenue time', 'revenue month', 'revenue history'],
    requiredCapabilities: ['canonical.revenue.read'],
    description: 'Revenue aggregation over a date range',
    allowedFields: {
      transactionDate: { operators: ['gte', 'lte', 'between'] as const, projectable: true, sortable: true },
      amount:          { operators: ['gt', 'gte', 'lt', 'lte'] as const, projectable: true, sortable: true },
      type:            { operators: ['eq', 'in'] as const,               projectable: true, sortable: false },
    },
  },
};
