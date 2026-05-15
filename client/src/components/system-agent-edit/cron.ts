/** Parse a simple cron like "30 9,13,17,21 * * *" or "0 9 * * *" → {hour,minute,interval} */
export function parseCron(cron: string | null | undefined): { hour: number; minute: number; interval: number } {
  if (!cron) return { hour: 9, minute: 0, interval: 0 };
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 2) return { hour: 9, minute: 0, interval: 0 };
  const minute = parseInt(parts[0]);
  const hourPart = parts[1];
  if (isNaN(minute)) return { hour: 9, minute: 0, interval: 0 };
  // Handle "9,13,17,21" or "9"
  const hours = hourPart.split(',').map(Number).filter(h => !isNaN(h));
  if (hours.length === 0) return { hour: 9, minute: 0, interval: 0 };
  const startHour = hours[0];
  const interval = hours.length > 1 ? hours[1] - hours[0] : 24;
  return { hour: startHour, minute: isNaN(minute) ? 0 : minute, interval };
}

/** Generate cron from friendly fields. Returns null if interval is 0 (disabled). */
export function buildCron(hour: number, minute: number, intervalHours: number): string | null {
  if (intervalHours === 0) return null;
  if (intervalHours >= 24) return `${minute} ${hour} * * *`;
  const hours: number[] = [];
  for (let h = hour; h < 24; h += intervalHours) hours.push(h);
  return `${minute} ${hours.join(',')} * * *`;
}
