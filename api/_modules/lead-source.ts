/** Acquisition channels the operator picks when creating a proposal. Mirrors
 * `LEAD_SOURCES` in `src/lib/clientMetadata.ts`. */
export const LEAD_SOURCE_VALUES = ['Google Ads', 'Bríndice', 'Cliente recorrente', 'WhatsApp'] as const;

export type LeadSourceValue = (typeof LEAD_SOURCE_VALUES)[number];

const foldKey = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Canonical channel for a known value, accent- and case-insensitive; anything
 * else (blank, free text) is null so the dashboard never sees a stray category. */
export function normalizeLeadSource(value: unknown): LeadSourceValue | null {
  if (typeof value !== 'string') return null;
  const key = foldKey(value);
  return LEAD_SOURCE_VALUES.find((source) => foldKey(source) === key) ?? null;
}
