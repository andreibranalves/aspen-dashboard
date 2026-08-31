export const SAO_PAULO_TIMEZONE = 'America/Sao_Paulo';

export const DASHBOARD_PERIODS = [
  'today',
  '7d',
  '30d',
  '90d',
  'month',
  'last_month',
] as const;

export type DashboardPeriodKind = (typeof DASHBOARD_PERIODS)[number];

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function civilDateFromUtcMillis(millis: number): string {
  const date = new Date(millis);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return civilDateFromUtcMillis(Date.UTC(year, month - 1, day + days));
}

export function calendarDateInSaoPaulo(
  now: Date,
  timeZone = SAO_PAULO_TIMEZONE
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) {
    throw new Error('Não foi possível resolver a data de São Paulo.');
  }
  return `${year}-${month}-${day}`;
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 8)}01`;
}

export function yearMonthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function isCalendarMonthPeriod(period: string | undefined): boolean {
  const normalized = (period || '').trim().toLowerCase();
  return normalized === 'month' || normalized === 'last_month';
}

export function lastMonthRange(isoDate: string): { start: string; end: string } {
  const startOfCurrent = monthStart(isoDate);
  return {
    start: monthStart(addCalendarDays(startOfCurrent, -1)),
    end: addCalendarDays(startOfCurrent, -1),
  };
}

export function resolveNamedPeriod(
  period: string | undefined,
  now: Date
): { start: string; end: string } | null {
  const today = calendarDateInSaoPaulo(now);
  switch ((period || '').trim().toLowerCase()) {
    case 'today':
      return { start: today, end: today };
    case '7d':
      return { start: addCalendarDays(today, -7), end: today };
    case '30d':
      return { start: addCalendarDays(today, -30), end: today };
    case '90d':
      return { start: addCalendarDays(today, -90), end: today };
    case 'month':
      return { start: monthStart(today), end: today };
    case 'last_month':
      return lastMonthRange(today);
    default:
      return null;
  }
}
