import {
  formatQuotationClientName,
  formatQuotationCurrency,
  formatQuotationDate,
  formatQuotationPhone,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from './quotation-templates.js';
import {
  formatMoneyCents,
  parseScaledInteger,
  QUANTITY_SCALE,
  URGENT_DENOMINATOR,
  URGENT_NUMERATOR,
} from '../pricing-core.js';

export type ResolvedQuotationTemplate = QuotationTemplate;
export type PricingResolver = (
  pricing: unknown,
  quantity: string | number,
  urgent?: boolean,
) => { rate: string | number } | Promise<{ rate: string | number }>;

export interface DraftSnapshotDependencies {
  now?: () => Date;
  resolveTemplate: (key: string, versionId?: string) => Promise<ResolvedQuotationTemplate | null>;
  resolvePricing?: PricingResolver;
}

export interface DraftQuotationSnapshot {
  template: QuotationTemplate;
  viewModel: QuotationTemplateViewModel;
  authoritativeDraft: Record<string, unknown>;
  pricingDifferences: Array<{ path: string; expected: unknown; received: unknown }>;
}

export interface DraftPreviewItem {
  item_code: string;
  item_name: string;
  qty: number;
  rate: number;
  quantity_scaled: bigint;
  rate_cents: bigint;
  manual_rate: boolean;
}

export interface DraftPreviewInput {
  nome: string;
  email?: string | null;
  telefone?: string | null;
  cnpj?: string;
  endereco?: Record<string, unknown>;
  template_key?: string;
  business_number?: string;
  prazo_producao?: string;
  urgente: boolean;
  items: DraftPreviewItem[];
}

export class DraftPreviewInputError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message: string) {
    super(message);
    this.name = 'DraftPreviewInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDraftPreview(value: unknown): DraftPreviewInput {
  let payload: unknown;
  try {
    payload = value;
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
    let quantityScaled: bigint;
    let rateCents: bigint;
    try {
      quantityScaled = parseScaledInteger(qty, QUANTITY_SCALE, 'Quantidade do item');
      rateCents = parseScaledInteger(rate, 2, 'Preço do item');
    } catch {
      return [];
    }
    if (quantityScaled <= 0n) return [];
    return [
      {
        item_code: itemCode,
        item_name: String(value.item_name || '').trim(),
        qty,
        rate,
        quantity_scaled: quantityScaled,
        rate_cents: rateCents,
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
    business_number:
      extracted.business_number == null ? undefined : String(extracted.business_number).trim(),
    prazo_producao:
      extracted.prazo_producao == null ? undefined : String(extracted.prazo_producao).trim(),
    urgente: extracted.urgente === true,
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
): QuotationTemplateViewModel {
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
    name: formatQuotationClientName(extracted.nome),
    nome: formatQuotationClientName(extracted.nome),
    document: extracted.cnpj || '',
    documento: extracted.cnpj || '',
    email: extracted.email || '',
    phone: formatQuotationPhone(extracted.telefone),
    telefone: formatQuotationPhone(extracted.telefone),
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
  const quantityBase = 10n ** BigInt(QUANTITY_SCALE);
  let totalCents = 0n;
  const items = extracted.items.map((item, position) => {
    const appliedRateCents =
      extracted.urgente && !item.manual_rate
        ? (item.rate_cents * URGENT_NUMERATOR + URGENT_DENOMINATOR / 2n) /
          URGENT_DENOMINATOR
        : item.rate_cents;
    const lineTotalCents =
      (item.quantity_scaled * appliedRateCents + quantityBase / 2n) / quantityBase;
    totalCents += lineTotalCents;
    const suggestedUnitPrice = formatMoneyCents(item.rate_cents);
    const appliedUnitPrice = formatMoneyCents(appliedRateCents);
    const lineTotal = formatMoneyCents(lineTotalCents);
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
      suggested_unit_price: suggestedUnitPrice,
      preco_sugerido: suggestedUnitPrice,
      applied_unit_price: appliedUnitPrice,
      preco_aplicado: appliedUnitPrice,
      unit_price: appliedUnitPrice,
      line_total: lineTotal,
      total_linha: lineTotal,
      manual_rate: item.manual_rate,
      display: {
        unit_price: formatQuotationCurrency(appliedUnitPrice),
        line_total: formatQuotationCurrency(lineTotal),
      },
    };
  });
  const total = formatMoneyCents(totalCents);
  const terms = {
    pagamento: '',
    entrega: '',
    production_deadline: extracted.prazo_producao || '',
    observations: '',
  };
  const quoteDate = current.toISOString().slice(0, 10);
  const validity = validityDate.toISOString().slice(0, 10);
  return {
    quote_number: extracted.business_number || 'Pré-visualização',
    quotation_name: extracted.business_number || 'Pré-visualização',
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
    freight: '0.00',
    total,
    frete: '0.00',
    secoes: {
      prazo_producao: { value: extracted.prazo_producao || '' },
      pagamento: { body_html: '' },
      condicoes_gerais: { body_html: '' },
    },
    display: {
      quote_date: formatQuotationDate(current),
      validity_date: formatQuotationDate(validityDate),
      subtotal: formatQuotationCurrency(total),
      freight: formatQuotationCurrency('0.00'),
      total: formatQuotationCurrency(total),
    },
  };
}

export async function buildDraftQuotationSnapshot(
  input: unknown,
  dependencies: DraftSnapshotDependencies,
): Promise<DraftQuotationSnapshot> {
  const extracted = parseDraftPreview(input);
  const template = await dependencies.resolveTemplate(extracted.template_key || 'padrao');
  if (!template) throw new DraftPreviewInputError('Template do orçamento inválido.');
  const now = dependencies.now || (() => new Date());
  return {
    template,
    viewModel: draftPreviewViewModel(extracted, now()),
    authoritativeDraft: extracted as unknown as Record<string, unknown>,
    pricingDifferences: [],
  };
}
