const UTF8_BOM = '\uFEFF';
const CSV_SEPARATOR = ';';
const CSV_LINE_ENDING = '\r\n';
const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

export type CsvCell = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => CsvCell;
}

function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '""';
  const text = String(value);
  const safe = typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function buildCsv<Row>(columns: readonly CsvColumn<Row>[], rows: readonly Row[]): string {
  const header = columns.map((column) => csvCell(column.header)).join(CSV_SEPARATOR);
  const body = rows.map((row) =>
    columns.map((column) => csvCell(column.value(row))).join(CSV_SEPARATOR)
  );
  return UTF8_BOM + [header, ...body].join(CSV_LINE_ENDING) + CSV_LINE_ENDING;
}

function digits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function formatBrazilianDocument(value: string | null | undefined): string {
  const normalized = digits(value);
  if (normalized.length === 11) {
    return normalized.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }
  if (normalized.length === 14) {
    return normalized.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  return normalized;
}

function localBrazilianPhone(value: string): string {
  if (value.length === 10) return value.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  if (value.length === 11) return value.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  return value;
}

export function formatBrazilianPhone(value: string | null | undefined): string {
  const normalized = digits(value);
  if ((normalized.length === 12 || normalized.length === 13) && normalized.startsWith('55')) {
    return `+55 ${localBrazilianPhone(normalized.slice(2))}`;
  }
  return localBrazilianPhone(normalized);
}

export function formatBrazilianPostalCode(value: string | null | undefined): string {
  const normalized = digits(value);
  return normalized.length === 8 ? normalized.replace(/^(\d{5})(\d{3})$/, '$1-$2') : normalized;
}

export function formatBrazilianDecimal(
  value: string | number | null | undefined,
  scale = 2
): string {
  if (value === null || value === undefined || value === '') return '';
  const normalized = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return normalized;
  const fraction = (match[3] || '').padEnd(scale, '0').slice(0, scale);
  return scale > 0 ? `${match[1]}${match[2]},${fraction}` : `${match[1]}${match[2]}`;
}

export function formatBrazilianDate(value: string | null | undefined): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function saoPauloParts(value: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]));
}

export function formatSaoPauloDateTime(value: Date | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const parts = saoPauloParts(date);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function exportTimestamp(value: Date): string {
  const parts = saoPauloParts(value);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}
