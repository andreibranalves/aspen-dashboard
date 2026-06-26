const ERPNEXT_BASE = 'https://aspenestamparia.l.frappe.cloud';

export const DEFAULT_PRINT_FORMAT = 'Aspen 1.0';
export const SIMPLE_PRINT_FORMAT = 'Aspen Simples';
const ITEM_THRESHOLD = 4;

export const PRINT_FORMATS: Record<string, { value: string; label: string }> = {
  standard: {
    value: 'Aspen 1.0',
    label: 'Tabela padrão',
  },
  comparison: {
    value: 'Aspen 1.1',
    label: 'Tabela comparativo',
  },
  simple: {
    value: 'Aspen Simples',
    label: 'Aspen Simples',
  },
};

export function normalizePrintFormat(value: unknown): string {
  const raw = String(value || '').trim();
  if (PRINT_FORMATS[raw]) return PRINT_FORMATS[raw].value;
  const match = Object.values(PRINT_FORMATS).find((format) => format.value === raw);
  return match?.value || DEFAULT_PRINT_FORMAT;
}

export function getPrintFormatLabel(value: unknown): string {
  const printFormat = normalizePrintFormat(value);
  const match = Object.values(PRINT_FORMATS).find((format) => format.value === printFormat);
  return match?.label || PRINT_FORMATS.standard.label;
}

export function shouldIncludePrintFormatParam(value: unknown): boolean {
  return normalizePrintFormat(value) !== DEFAULT_PRINT_FORMAT;
}

/**
 * Determine which print format to use for a quotation.
 * Rules:
 *   - If explicitFormat is provided, use it (normalized).
 *   - If ≤ ITEM_THRESHOLD items → "Aspen Simples"
 *   - Otherwise → "Aspen 1.0"
 */
export async function resolvePrintFormat(
  quotationId: string,
  explicitFormat?: string
): Promise<string> {
  if (explicitFormat) {
    console.log(`[resolvePrintFormat] ${quotationId} → explicit: "${explicitFormat}"`);
    return normalizePrintFormat(explicitFormat);
  }

  const token = process.env.ERPNEXT_TOKEN;
  try {
    const res = await fetch(
      `${ERPNEXT_BASE}/api/resource/Quotation/${encodeURIComponent(quotationId)}`,
      { headers: { Authorization: `token ${token}` } }
    );
    if (!res.ok) {
      console.warn(
        `[resolvePrintFormat] ${quotationId} → fetch failed (${res.status}), falling back to "${DEFAULT_PRINT_FORMAT}"`
      );
      return DEFAULT_PRINT_FORMAT;
    }
    const data = (await res.json()) as Record<string, unknown>;
    const doc = data.data as Record<string, unknown> | undefined;
    const items = doc?.items as Array<unknown> | undefined;
    const itemCount = items?.length || 0;
    const format = itemCount <= ITEM_THRESHOLD ? SIMPLE_PRINT_FORMAT : DEFAULT_PRINT_FORMAT;
    console.log(`[resolvePrintFormat] ${quotationId} → ${itemCount} items → "${format}"`);
    return format;
  } catch (err) {
    console.error(`[resolvePrintFormat] ${quotationId} → error: ${(err as Error).message}`);
    return DEFAULT_PRINT_FORMAT;
  }
}
