import type { FunctionEvent, FunctionResult, LegacyHandler } from '../_lib/types.js';
import { getDatabase } from '../_db/client.js';
import { readCurrentQuotationTemplateVersion } from '../_db/quotation-template-library-repository.js';
import {
  createQuotationTemplateRepository,
  quotationSnapshotViewModel,
  QuotationTemplateSnapshotRepositoryError,
} from '../_db/quotation-template-repository.js';
import {
  formatQuotationCurrency,
  formatQuotationDate,
  quotationTemplateFromVersion,
  QuotationTemplateResolutionError,
  renderQuotationTemplate,
  resolveQuotationTemplate,
  type QuotationTemplate,
} from './lib/quotation-templates.js';
import { renderQuotationPdfHtml } from './lib/quotation-pdf-renderer.js';
import { isValidPdfBuffer } from './lib/quotation-document-storage.js';
import { isCoreReadEnabled } from './orcamento-mode.js';

interface DraftPreviewItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  manual_rate: boolean;
}

interface DraftPreviewInput {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string;
  endereco?: Record<string, unknown>;
  template_key?: string;
  prazo_producao?: string;
  items: DraftPreviewItem[];
}

class DraftPreviewInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'DraftPreviewInputError';
  }
}

export interface QuotationPreviewDependencies {
  repository?: {
    get(
      id: string,
      templateVersionId?: string
    ): ReturnType<ReturnType<typeof createQuotationTemplateRepository>['get']>;
  };
  renderPdf?: (html: string) => Promise<Buffer>;
  resolveDraftTemplate?: (key: string) => Promise<QuotationTemplate | null>;
  now?: () => Date;
}

const HTML_SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDraftPreview(event: FunctionEvent): DraftPreviewInput {
  let payload: unknown;
  try {
    const encoded = new URLSearchParams(event.body || '').get('payload');
    if (!encoded) throw new Error('missing payload');
    payload = JSON.parse(encoded);
  } catch {
    throw new DraftPreviewInputError('Payload de visualização inválido.');
  }

  if (!isRecord(payload) || !isRecord(payload.extracted)) {
    throw new DraftPreviewInputError('Payload de visualização inválido.');
  }
  const extracted = payload.extracted;
  const nome = String(extracted.nome || '').trim();
  if (!nome) throw new DraftPreviewInputError('Informe o nome do cliente antes de visualizar.');

  const items = (Array.isArray(extracted.items) ? extracted.items : []).flatMap((value) => {
    if (!isRecord(value)) return [];
    const itemCode = String(value.item_code || '').trim();
    const qty = value.qty;
    const rate = value.rate;
    if (
      !itemCode ||
      typeof qty !== 'number' ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      typeof rate !== 'number' ||
      !Number.isFinite(rate) ||
      rate < 0
    ) {
      return [];
    }
    return [
      {
        item_code: itemCode,
        item_name: String(value.item_name || '').trim(),
        qty,
        rate,
        manual_rate: value.manual_rate === true,
      },
    ];
  });
  if (items.length === 0) {
    throw new DraftPreviewInputError('Adicione ao menos um item válido antes de visualizar.');
  }

  return {
    nome,
    email: extracted.email == null ? null : String(extracted.email).trim(),
    telefone: extracted.telefone == null ? null : String(extracted.telefone).trim(),
    cnpj: extracted.cnpj == null ? undefined : String(extracted.cnpj).trim(),
    endereco: isRecord(extracted.endereco) ? extracted.endereco : undefined,
    template_key:
      typeof extracted.template_key === 'string' ? extracted.template_key.trim() : undefined,
    prazo_producao:
      extracted.prazo_producao == null ? undefined : String(extracted.prazo_producao).trim(),
    items,
  };
}

function addressValue(address: Record<string, unknown> | undefined, ...keys: string[]): string {
  if (!address) return '';
  for (const key of keys) {
    const value = address[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

function draftPreviewViewModel(
  extracted: DraftPreviewInput,
  now: Date
): Record<string, unknown> {
  const current = Number.isNaN(now.getTime()) ? new Date() : now;
  const validityDate = new Date(current.getTime());
  validityDate.setUTCDate(validityDate.getUTCDate() + 15);
  const address = extracted.endereco;
  const addressParts = [
    addressValue(address, 'logradouro', 'endereco', 'address'),
    addressValue(address, 'numero'),
    addressValue(address, 'complemento'),
    addressValue(address, 'bairro'),
    addressValue(address, 'cidade', 'municipio'),
    addressValue(address, 'uf'),
    addressValue(address, 'cep'),
  ].filter(Boolean);
  const client = {
    id: 'preview-client',
    name: extracted.nome,
    nome: extracted.nome,
    document: extracted.cnpj || '',
    documento: extracted.cnpj || '',
    email: extracted.email || '',
    phone: extracted.telefone || '',
    telefone: extracted.telefone || '',
    address: addressParts.join(', '),
    notes: '',
    notes_snapshot: '',
    endereco: addressValue(address, 'logradouro', 'endereco', 'address'),
    numero: addressValue(address, 'numero'),
    bairro: addressValue(address, 'bairro'),
    complemento: addressValue(address, 'complemento'),
    municipio: addressValue(address, 'cidade', 'municipio'),
    uf: addressValue(address, 'uf'),
    cep: addressValue(address, 'cep'),
  };
  const items = extracted.items.map((item, position) => {
    const lineTotal = item.qty * item.rate;
    return {
      id: `preview-${position + 1}`,
      position,
      sku: item.item_code,
      item_code: item.item_code,
      nome: item.item_name || item.item_code,
      name: item.item_name || item.item_code,
      descricao: '',
      description: '',
      unidade: '',
      unit: '',
      qty: item.qty,
      quantidade: item.qty,
      quantity: String(item.qty),
      suggested_unit_price: item.rate,
      preco_sugerido: item.rate,
      applied_unit_price: item.rate,
      preco_aplicado: item.rate,
      unit_price: item.rate,
      line_total: lineTotal,
      total_linha: lineTotal,
      manual_rate: item.manual_rate,
      display: {
        unit_price: formatQuotationCurrency(item.rate),
        line_total: formatQuotationCurrency(lineTotal),
      },
    };
  });
  const total = items.reduce((sum, item) => sum + Number(item.line_total), 0);
  const terms = {
    pagamento: '',
    entrega: '',
    production_deadline: extracted.prazo_producao || '',
    observations: '',
  };
  const quoteDate = current.toISOString().slice(0, 10);
  const validity = validityDate.toISOString().slice(0, 10);
  return {
    quote_number: 'Pré-visualização',
    quotation_name: 'Pré-visualização',
    quote_id: 'preview',
    revision: 1,
    revision_number: 1,
    status: 'rascunho',
    status_canonical: 'rascunho',
    revision_status: 'rascunho',
    quote_date: quoteDate,
    date: quoteDate,
    validity_date: validity,
    validity,
    validity_days: 15,
    client,
    client_snapshot: client,
    items,
    items_snapshot: items,
    comparison: { brackets: [], products: [] },
    terms,
    terms_snapshot: terms,
    subtotal: total,
    freight: 0,
    total,
    frete: 0,
    secoes: {
      prazo_producao: { value: extracted.prazo_producao || '' },
      pagamento: { body_html: '' },
      condicoes_gerais: { body_html: '' },
    },
    display: {
      quote_date: formatQuotationDate(current),
      validity_date: formatQuotationDate(validityDate),
      subtotal: formatQuotationCurrency(total),
      freight: formatQuotationCurrency(0),
      total: formatQuotationCurrency(total),
    },
  };
}

async function resolveCurrentDraftTemplate(key: string): Promise<QuotationTemplate | null> {
  const selected = await readCurrentQuotationTemplateVersion(getDatabase(), key);
  if (!selected) return null;
  return quotationTemplateFromVersion({
    source: selected.version.source,
    sourceHash: selected.version.sourceHash,
    template: { key: selected.model.key, name: selected.model.name },
  });
}

function json(statusCode: number, payload: Record<string, unknown>): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function safeError(error: unknown): FunctionResult {
  if (
    error instanceof DraftPreviewInputError ||
    error instanceof QuotationTemplateSnapshotRepositoryError ||
    error instanceof QuotationTemplateResolutionError
  ) {
    return json(error.statusCode, { error: error.message });
  }
  console.error(
    `[quotation-preview] failed (${error instanceof Error ? error.name : typeof error})`
  );
  return json(503, {
    error: 'Não foi possível gerar a visualização do orçamento. Tente novamente.',
  });
}

export function createQuotationPreviewHandler(
  dependencies: QuotationPreviewDependencies = {}
): LegacyHandler {
  const repository = dependencies.repository || createQuotationTemplateRepository();
  const renderPdf = dependencies.renderPdf || renderQuotationPdfHtml;
  const resolveDraftTemplate = dependencies.resolveDraftTemplate || resolveCurrentDraftTemplate;
  const now = dependencies.now || (() => new Date());
  return async function quotationPreviewHandler(event: FunctionEvent): Promise<FunctionResult> {
    if (!isCoreReadEnabled()) return json(404, { error: 'Endpoint não encontrado.' });
    if (event.httpMethod === 'POST') {
      try {
        const extracted = parseDraftPreview(event);
        const template = await resolveDraftTemplate(extracted.template_key || 'padrao');
        if (!template) return json(400, { error: 'Template do orçamento inválido.' });
        const html = renderQuotationTemplate(template, draftPreviewViewModel(extracted, now()));
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...HTML_SECURITY_HEADERS,
            'X-Quotation-Template-Key': template.key,
            'X-Quotation-Template-Version': 'preview',
            'X-Quotation-Template-Hash': template.hash,
          },
          body: html,
        };
      } catch (error) {
        return safeError(error);
      }
    }
    if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });
    const query = event.queryStringParameters || {};
    const id = String(query.id || '').trim();
    if (!id) return json(400, { error: 'ID do orçamento não informado.' });
    if (query.template !== undefined || query.template_key !== undefined) {
      return json(400, { error: 'Sobrescrita de template não permitida.' });
    }
    const selectedVersionId =
      query.template_version_id === undefined
        ? undefined
        : String(query.template_version_id).trim();
    const asPdf = query.format === 'pdf';
    try {
      const snapshot = await repository.get(id, selectedVersionId);
      if (!snapshot) return json(404, { error: 'Orçamento não encontrado.' });
      const template = snapshot.templateVersion
        ? quotationTemplateFromVersion(snapshot.templateVersion)
        : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash);
      const html = renderQuotationTemplate(template, quotationSnapshotViewModel(snapshot));
      if (asPdf) {
        let pdf: Buffer;
        try {
          pdf = await renderPdf(html);
        } catch (error) {
          console.error(
            `[quotation-preview] pdf render failed (${error instanceof Error ? error.name : typeof error})`
          );
          return json(503, {
            error: 'Não foi possível gerar o PDF do orçamento. Tente novamente.',
          });
        }
        if (!Buffer.isBuffer(pdf) || !isValidPdfBuffer(pdf)) {
          return json(503, { error: 'O gerador retornou um PDF inválido. Tente novamente.' });
        }
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="${snapshot.quotation.businessNumber}.pdf"`,
            'Content-Length': String(pdf.length),
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Document-Revision': snapshot.revision.id,
            'X-Quotation-Template-Key': template.key,
            'X-Quotation-Template-Version': snapshot.templateVersion
              ? String(snapshot.templateVersion.version)
              : 'legacy',
            'X-Quotation-Template-Hash': template.hash,
          },
          body: pdf.toString('base64'),
          isBase64Encoded: true,
        };
      }
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...HTML_SECURITY_HEADERS,
          'X-Quotation-Template-Key': template.key,
          'X-Quotation-Template-Version': snapshot.templateVersion
            ? String(snapshot.templateVersion.version)
            : 'legacy',
          'X-Quotation-Template-Hash': template.hash,
        },
        body: html,
      };
    } catch (error) {
      return safeError(error);
    }
  };
}

export const handler = createQuotationPreviewHandler();
export const quotationPreviewHandler = handler;
