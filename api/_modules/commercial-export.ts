import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_http/types.js';
import {
  listClientsForExport,
  type ClientListOptions,
} from '../_infrastructure/db/repositories/client-repository.js';
import {
  listProductPricingForExport,
  listProductsForExport,
  type ProductListOptions,
  type ProductStatus,
} from '../_infrastructure/db/repositories/products-repository.js';
import {
  listSalesOrderItemsForExport,
  listSalesOrdersForExport,
  type SalesOrderListOptions,
} from '../_infrastructure/db/repositories/sales-orders-repository.js';
import {
  buildCsv,
  exportTimestamp,
  formatBrazilianDate,
  formatBrazilianDecimal,
  formatBrazilianDocument,
  formatBrazilianPhone,
  formatBrazilianPostalCode,
  formatSaoPauloDateTime,
  type CsvCell,
  type CsvColumn,
} from './commercial-export-csv.js';

const MAX_EXPORT_ROWS = 10_000;
const QUERY_LIMIT = MAX_EXPORT_ROWS + 1;

export const COMMERCIAL_EXPORT_RESOURCES = [
  'clients',
  'products',
  'product-pricing',
  'sales-orders',
  'sales-order-items',
] as const;

export type CommercialExportResource = (typeof COMMERCIAL_EXPORT_RESOURCES)[number];
export type CommercialExportRow = Record<string, CsvCell | Date>;

export interface CommercialExportLoadResult {
  resource: CommercialExportResource;
  rows: CommercialExportRow[];
}

export interface CommercialExportDependencies {
  load?: (
    resource: CommercialExportResource,
    query: Record<string, string | undefined>,
    now: Date
  ) => Promise<CommercialExportLoadResult>;
  now?: () => Date;
}

interface ExportDefinition {
  fileName: string;
  columns: readonly CsvColumn<CommercialExportRow>[];
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  Draft: 'Rascunho',
  'To Deliver and Bill': 'A entregar e faturar',
  'To Deliver': 'A entregar',
  'To Bill': 'A faturar',
  Completed: 'Concluído',
  Cancelled: 'Cancelado',
  Closed: 'Fechado',
};

function rowValue(row: CommercialExportRow, key: string): CsvCell {
  const value = row[key];
  return value instanceof Date ? value.toISOString() : value;
}

function rowText(row: CommercialExportRow, key: string): string {
  const value = rowValue(row, key);
  return value === null || value === undefined ? '' : String(value);
}

function rowDate(row: CommercialExportRow, key: string): string {
  return formatBrazilianDate(rowText(row, key));
}

function rowDateTime(row: CommercialExportRow, key: string): string {
  const value = row[key];
  return formatSaoPauloDateTime(value instanceof Date ? value : rowText(row, key));
}

function rowDecimal(row: CommercialExportRow, key: string, scale = 2): string {
  const value = rowValue(row, key);
  return formatBrazilianDecimal(
    typeof value === 'string' || typeof value === 'number' ? value : null,
    scale
  );
}

const CLIENT_COLUMNS: readonly CsvColumn<CommercialExportRow>[] = [
  { header: 'ID do cliente', value: (row) => rowValue(row, 'id') },
  { header: 'Nome', value: (row) => rowValue(row, 'nome') },
  { header: 'CPF/CNPJ', value: (row) => formatBrazilianDocument(rowText(row, 'documento')) },
  { header: 'E-mail', value: (row) => rowValue(row, 'email') },
  { header: 'Telefone', value: (row) => formatBrazilianPhone(rowText(row, 'telefone')) },
  { header: 'Endereço', value: (row) => rowValue(row, 'endereco') },
  { header: 'Número', value: (row) => rowValue(row, 'numero') },
  { header: 'Bairro', value: (row) => rowValue(row, 'bairro') },
  { header: 'Complemento', value: (row) => rowValue(row, 'complemento') },
  { header: 'Município', value: (row) => rowValue(row, 'municipio') },
  { header: 'UF', value: (row) => rowValue(row, 'uf') },
  { header: 'CEP', value: (row) => formatBrazilianPostalCode(rowText(row, 'cep')) },
  { header: 'Situação', value: (row) => row.arquivado === true ? 'Arquivado' : 'Ativo' },
  { header: 'Criado em', value: (row) => rowDateTime(row, 'createdAt') },
  { header: 'Atualizado em', value: (row) => rowDateTime(row, 'updatedAt') },
  { header: 'Arquivado em', value: (row) => rowDateTime(row, 'archivedAt') },
];

const PRODUCT_COLUMNS: readonly CsvColumn<CommercialExportRow>[] = [
  { header: 'SKU', value: (row) => rowValue(row, 'sku') },
  { header: 'Nome', value: (row) => rowValue(row, 'nome') },
  { header: 'Descrição', value: (row) => rowValue(row, 'descricao') },
  { header: 'Unidade', value: (row) => rowValue(row, 'unidade') },
  { header: 'Categoria', value: (row) => rowValue(row, 'categoria') },
  { header: 'Marca', value: (row) => rowValue(row, 'marca') },
  { header: 'Preço-base', value: (row) => rowDecimal(row, 'precoBase') },
  { header: 'Custo unitário', value: (row) => rowDecimal(row, 'custoUnitario') },
  { header: 'Situação', value: (row) => row.ativo === false ? 'Arquivado' : 'Ativo' },
  { header: 'Criado em', value: (row) => rowDateTime(row, 'criadoEm') },
  { header: 'Atualizado em', value: (row) => rowDateTime(row, 'atualizadoEm') },
  { header: 'Arquivado em', value: (row) => rowDateTime(row, 'arquivadoEm') },
];

const PRODUCT_PRICING_COLUMNS: readonly CsvColumn<CommercialExportRow>[] = [
  { header: 'SKU', value: (row) => rowValue(row, 'productSku') },
  { header: 'Produto', value: (row) => rowValue(row, 'productName') },
  { header: 'Quantidade mínima', value: (row) => rowDecimal(row, 'minimumQuantity', 3) },
  { header: 'Preço unitário', value: (row) => rowDecimal(row, 'unitPrice') },
  { header: 'Criado em', value: (row) => rowDateTime(row, 'criadoEm') },
  { header: 'Atualizado em', value: (row) => rowDateTime(row, 'atualizadoEm') },
];

const SALES_ORDER_COLUMNS: readonly CsvColumn<CommercialExportRow>[] = [
  { header: 'ID do pedido', value: (row) => rowValue(row, 'id') },
  { header: 'Número do pedido', value: (row) => rowValue(row, 'orderNumber') },
  { header: 'ID do orçamento', value: (row) => rowValue(row, 'quotationId') },
  { header: 'Número do orçamento', value: (row) => rowValue(row, 'quotationNumber') },
  { header: 'ID da revisão do orçamento', value: (row) => rowValue(row, 'quotationRevisionId') },
  { header: 'ID do cliente', value: (row) => rowValue(row, 'clientId') },
  { header: 'Cliente', value: (row) => rowValue(row, 'clientName') },
  { header: 'CPF/CNPJ do cliente', value: (row) => formatBrazilianDocument(rowText(row, 'clientDocument')) },
  { header: 'E-mail do cliente', value: (row) => rowValue(row, 'clientEmail') },
  { header: 'Telefone do cliente', value: (row) => formatBrazilianPhone(rowText(row, 'clientPhone')) },
  { header: 'Endereço do cliente', value: (row) => rowValue(row, 'clientAddress') },
  { header: 'Número do endereço', value: (row) => rowValue(row, 'clientAddressNumber') },
  { header: 'Bairro do cliente', value: (row) => rowValue(row, 'clientDistrict') },
  { header: 'Complemento do endereço', value: (row) => rowValue(row, 'clientAddressExtra') },
  { header: 'Município do cliente', value: (row) => rowValue(row, 'clientCity') },
  { header: 'UF do cliente', value: (row) => rowValue(row, 'clientState') },
  { header: 'CEP do cliente', value: (row) => formatBrazilianPostalCode(rowText(row, 'clientPostalCode')) },
  { header: 'Código do status', value: (row) => rowValue(row, 'status') },
  { header: 'Status', value: (row) => ORDER_STATUS_LABELS[rowText(row, 'status')] || rowText(row, 'status') },
  { header: 'Data da venda', value: (row) => rowDate(row, 'transactionDate') },
  { header: 'Data da entrega', value: (row) => rowDate(row, 'deliveryDate') },
  { header: 'Percentual entregue', value: (row) => rowDecimal(row, 'perDelivered') },
  { header: 'Percentual faturado', value: (row) => rowDecimal(row, 'perBilled') },
  { header: 'Subtotal', value: (row) => rowDecimal(row, 'subtotal') },
  { header: 'Total', value: (row) => rowDecimal(row, 'grandTotal') },
  { header: 'Criado em', value: (row) => rowDateTime(row, 'createdAt') },
  { header: 'Atualizado em', value: (row) => rowDateTime(row, 'updatedAt') },
];

const SALES_ORDER_ITEM_COLUMNS: readonly CsvColumn<CommercialExportRow>[] = [
  { header: 'ID do item', value: (row) => rowValue(row, 'id') },
  { header: 'ID do pedido', value: (row) => rowValue(row, 'salesOrderId') },
  { header: 'Número do pedido', value: (row) => rowValue(row, 'orderNumber') },
  { header: 'Posição', value: (row) => rowValue(row, 'position') },
  { header: 'SKU', value: (row) => rowValue(row, 'productSku') },
  { header: 'Produto', value: (row) => rowValue(row, 'productName') },
  { header: 'Unidade', value: (row) => rowValue(row, 'unit') },
  { header: 'Quantidade', value: (row) => rowDecimal(row, 'quantity', 3) },
  { header: 'Preço unitário', value: (row) => rowDecimal(row, 'unitPrice') },
  { header: 'Total da linha', value: (row) => rowDecimal(row, 'lineTotal') },
  { header: 'Custo unitário', value: (row) => rowDecimal(row, 'custoUnitario') },
];

const EXPORT_DEFINITIONS: Record<CommercialExportResource, ExportDefinition> = {
  clients: { fileName: 'clientes', columns: CLIENT_COLUMNS },
  products: { fileName: 'produtos', columns: PRODUCT_COLUMNS },
  'product-pricing': { fileName: 'faixas-de-preco', columns: PRODUCT_PRICING_COLUMNS },
  'sales-orders': { fileName: 'pedidos', columns: SALES_ORDER_COLUMNS },
  'sales-order-items': { fileName: 'itens-de-pedido', columns: SALES_ORDER_ITEM_COLUMNS },
};

function parseResource(value: string | undefined): CommercialExportResource | null {
  return COMMERCIAL_EXPORT_RESOURCES.find((resource) => resource === value) || null;
}

function productOptions(query: Record<string, string | undefined>): ProductListOptions {
  const status = (query.status || 'active').trim().toLowerCase();
  if (status !== 'active' && status !== 'archived' && status !== 'all') {
    throw Object.assign(new Error('Status inválido. Valores aceitos: active, archived, all.'), {
      statusCode: 400,
    });
  }
  return {
    status: status as ProductStatus,
    search: (query.search || '').trim() || undefined,
    categoria: (query.categoria || '').trim() || undefined,
    orderBy: (query.order_by || '').trim() || undefined,
  };
}

function clientOptions(query: Record<string, string | undefined>): ClientListOptions {
  const status = (query.status || 'active').trim().toLowerCase();
  if (status !== 'active' && status !== 'archived' && status !== 'all') {
    throw Object.assign(new Error('Status inválido. Valores aceitos: active, archived, all.'), {
      statusCode: 400,
    });
  }
  return {
    status,
    search: (query.search || query.q || '').trim() || undefined,
  };
}

function salesOrderOptions(query: Record<string, string | undefined>): SalesOrderListOptions {
  return {
    period: (query.period || '').trim().toLowerCase() || undefined,
    status: (query.status || '').trim() || undefined,
    search: (query.search || '').trim() || undefined,
    from: (query.from || '').trim() || undefined,
    to: (query.to || '').trim() || undefined,
  };
}

export async function loadCommercialExport(
  resource: CommercialExportResource,
  query: Record<string, string | undefined>,
  now: Date
): Promise<CommercialExportLoadResult> {
  switch (resource) {
    case 'clients':
      return { resource, rows: await listClientsForExport(clientOptions(query), QUERY_LIMIT) };
    case 'products':
      return { resource, rows: await listProductsForExport(productOptions(query), QUERY_LIMIT) };
    case 'product-pricing':
      return { resource, rows: await listProductPricingForExport(productOptions(query), QUERY_LIMIT) };
    case 'sales-orders':
      return { resource, rows: await listSalesOrdersForExport(salesOrderOptions(query), QUERY_LIMIT, now) };
    case 'sales-order-items':
      return { resource, rows: await listSalesOrderItemsForExport(salesOrderOptions(query), QUERY_LIMIT, now) };
  }
}

function errorResponse(statusCode: number, message: string): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ error: message }),
  };
}

export function createCommercialExportHandler(
  dependencies: CommercialExportDependencies = {}
): LegacyHandler {
  const load = dependencies.load || loadCommercialExport;
  const now = dependencies.now || (() => new Date());

  return async function commercialExportHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (event.httpMethod !== 'GET') return errorResponse(405, 'Método não permitido.');
    const resource = parseResource(event.queryStringParameters?.resource);
    if (!resource) return errorResponse(400, 'Tipo de exportação inválido.');

    try {
      const generatedAt = now();
      const result = await load(resource, event.queryStringParameters || {}, generatedAt);
      if (result.rows.length === 0) {
        return errorResponse(404, 'Nenhum registro encontrado para exportar.');
      }
      if (result.rows.length > MAX_EXPORT_ROWS) {
        return errorResponse(
          422,
          'A exportação excede 10 mil linhas. Restrinja os filtros e tente novamente.'
        );
      }

      const definition = EXPORT_DEFINITIONS[resource];
      const body = buildCsv(definition.columns, result.rows);
      const fileName = `${definition.fileName}-${exportTimestamp(generatedAt)}.csv`;
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${fileName}"`,
          'Content-Length': String(Buffer.byteLength(body, 'utf8')),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
        body,
      };
    } catch (error) {
      const candidate = error as { statusCode?: unknown };
      if (error instanceof Error && candidate.statusCode === 400) {
        return errorResponse(400, error.message);
      }
      console.error('[commercial-export]', error instanceof Error ? error.name : typeof error);
      return errorResponse(503, 'Não foi possível gerar a exportação. Tente novamente.');
    }
  };
}

export const handler = createCommercialExportHandler();
