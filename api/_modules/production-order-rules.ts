import { addBusinessDays, countBusinessDays } from '../_shared/calendar-sao-paulo.js';

export const PRODUCTION_STAGES = [
  'aguardando entrada', 'aguardando arte', 'em produção', 'pronto', 'entregue',
] as const;
export type ProductionStage = (typeof PRODUCTION_STAGES)[number];

export function productionDueDate(artApprovedDate: string | null, days: number, override: string | null): string | null {
  return override || (artApprovedDate ? addBusinessDays(artApprovedDate, days, true) : null);
}

export function productionAlert(
  stage: ProductionStage,
  artApprovedDate: string | null,
  dueDate: string | null,
  today: string,
): 'atrasado' | 'em risco' | null {
  if (!artApprovedDate || !dueDate || stage === 'pronto' || stage === 'entregue') return null;
  if (today > dueDate) return 'atrasado';
  const total = countBusinessDays(artApprovedDate, dueDate);
  if (total <= 0) return null;
  return countBusinessDays(artApprovedDate, today) >= Math.ceil(total * 0.75) ? 'em risco' : null;
}

export function calendarDaysSince(start: string, today: string): number {
  return Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}
