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

function dateOnlyToUtcMillis(isoDate: string): number {
  if (typeof isoDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new Error('A data civil deve estar no formato AAAA-MM-DD.');
  }
  const [year, month, day] = isoDate.split('-').map(Number);
  const millis = Date.UTC(year, month - 1, day);
  if (civilDateFromUtcMillis(millis) !== isoDate) {
    throw new Error('A data civil é inválida.');
  }
  return millis;
}

export function addCalendarDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return civilDateFromUtcMillis(Date.UTC(year, month - 1, day + days));
}

/** Adds Monday-to-Friday calendar days without applying holiday rules. */
export function addBusinessDays(isoDate: string, businessDays: number): string {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new Error('A quantidade de dias úteis é inválida.');
  }
  let millis = dateOnlyToUtcMillis(isoDate);
  let remaining = businessDays;
  while (remaining > 0) {
    millis += 24 * 60 * 60 * 1000;
    const weekday = new Date(millis).getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return civilDateFromUtcMillis(millis);
}

const FIXED_NATIONAL_HOLIDAYS = new Set([
  '01-01',
  '04-21',
  '05-01',
  '09-07',
  '10-12',
  '11-02',
  '11-15',
  '11-20',
  '12-25',
]);

function easterSundayMillis(year: number): number {
  // Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

/**
 * Production calendar: Monday to Friday, minus fixed national holidays and
 * Good Friday. Carnival and Corpus Christi count as business days.
 */
export function isProductionBusinessDay(isoDate: string): boolean {
  const millis = dateOnlyToUtcMillis(isoDate);
  const weekday = new Date(millis).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  if (FIXED_NATIONAL_HOLIDAYS.has(isoDate.slice(5))) return false;
  const goodFriday = easterSundayMillis(Number(isoDate.slice(0, 4))) - 2 * 24 * 60 * 60 * 1000;
  return millis !== goodFriday;
}

export function addProductionBusinessDays(isoDate: string, businessDays: number): string {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) {
    throw new Error('A quantidade de dias úteis é inválida.');
  }
  let current = civilDateFromUtcMillis(dateOnlyToUtcMillis(isoDate));
  let remaining = businessDays;
  while (remaining > 0) {
    current = addCalendarDays(current, 1);
    if (isProductionBusinessDay(current)) remaining -= 1;
  }
  return current;
}

/** Production business days in (start, end]; zero when end is not after start. */
export function productionBusinessDaysBetween(start: string, end: string): number {
  dateOnlyToUtcMillis(start);
  dateOnlyToUtcMillis(end);
  let count = 0;
  let current = start;
  while (current < end) {
    current = addCalendarDays(current, 1);
    if (isProductionBusinessDay(current)) count += 1;
  }
  return count;
}

export function calendarDaysBetween(start: string, end: string): number {
  return Math.round((dateOnlyToUtcMillis(end) - dateOnlyToUtcMillis(start)) / (24 * 60 * 60 * 1000));
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
