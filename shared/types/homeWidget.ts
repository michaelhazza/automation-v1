import { z } from 'zod';

export type HomeWidgetType = 'summary_card' | 'queue_card' | 'metric_card';
export type HomeWidgetRefreshPolicy = 'on_login' | 'every_5m' | 'on_demand';

export const HomeWidgetDeclarationSchema = z.object({
  type: z.enum(['summary_card', 'queue_card', 'metric_card']),
  titleTemplate: z.string(),
  bodyProviderSkill: z.string(),
  refreshPolicy: z.enum(['on_login', 'every_5m', 'on_demand']),
});
export type HomeWidgetDeclaration = z.infer<typeof HomeWidgetDeclarationSchema>;

// WidgetData is the runtime payload returned by the body-provider skill
export const SummaryCardDataSchema = z.object({
  widgetType: z.literal('summary_card'),
  title: z.string(),
  summary: z.string(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type SummaryCardData = z.infer<typeof SummaryCardDataSchema>;

export const QueueCardDataSchema = z.object({
  widgetType: z.literal('queue_card'),
  title: z.string(),
  count: z.number().int().nonnegative(),
  items: z.array(z.object({ id: z.string(), label: z.string() })),
  updatedAt: z.string().datetime({ offset: true }),
});
export type QueueCardData = z.infer<typeof QueueCardDataSchema>;

export const MetricCardDataSchema = z.object({
  widgetType: z.literal('metric_card'),
  title: z.string(),
  value: z.string(),
  unit: z.string().optional(),
  updatedAt: z.string().datetime({ offset: true }),
});
export type MetricCardData = z.infer<typeof MetricCardDataSchema>;

export const WidgetDataSchema = z.discriminatedUnion('widgetType', [
  SummaryCardDataSchema,
  QueueCardDataSchema,
  MetricCardDataSchema,
]);
export type WidgetData = z.infer<typeof WidgetDataSchema>;

export interface HomeWidget {
  agentId: string;
  agentName: string;
  declaration: HomeWidgetDeclaration;
  data: WidgetData | null;
  fetchedAt: string | null;
}
