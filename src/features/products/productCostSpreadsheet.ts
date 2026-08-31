import type { ProjectedProductListRow } from '@/lib/localProjections';

const CSV_SEPARATOR = ';';
const CSV_NEWLINE = '\r\n';
const FORMULA_PREFIX = /^[=+\-@]/;

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  const safeText = FORMULA_PREFIX.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function formatCost(value: number | string | null | undefined): string {
  if (value == null || value === '') return '';
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return String(value);
  return numericValue.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function buildProductCostCsv(products: ProjectedProductListRow[]): string {
  const header = ['SKU', 'Produto', 'Unidade', 'Status', 'Custo unitário (R$)'];
  const rows = products.map((product) => [
    product.sku || product.item_code || '',
    product.nome || product.item_name || '',
    product.unidade || product.stock_uom || '',
    product.ativo === false ? 'Arquivado' : 'Ativo',
    formatCost(product.custo_unitario),
  ]);

  return `\uFEFF${[header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(CSV_SEPARATOR))
    .join(CSV_NEWLINE)}${CSV_NEWLINE}`;
}
