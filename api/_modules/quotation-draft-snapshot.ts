import {
  formatQuotationClientName,
  formatQuotationCurrency,
  formatQuotationDate,
  formatQuotationPhone,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from './quotation-template-catalog.js';
import {
  normalizeQuotationCompanyConfiguration,
  type QuotationCompanyConfiguration,
} from './quotation-company.js';
import {
  formatMoneyCents,
  parseScaledInteger,
  QUANTITY_SCALE,
  URGENT_DENOMINATOR,
  URGENT_NUMERATOR,
} from './pricing-core.js';
import { applyQuotationSectionPolicy } from './quotation-document.js';
import {
  normalizeQuotationSections,
  withQuotationProductionDeadline,
  type QuotationSectionsSettings,
} from './quotation-content.js';

export type ResolvedQuotationTemplate = QuotationTemplate;
export type PricingResolver = (
  pricing: unknown,
  quantity: string | number,
  urgent?: boolean,
) => { rate: string | number } | Promise<{ rate: string | number }>;

export interface DraftSnapshotSettings {
  validade_dias?: number;
  pagamento?: string;
  entrega?: string;
  frete_padrao?: string;
  observacoes?: string;
  template_padrao?: string;
  secoes?: QuotationSectionsSettings;
  empresa?: QuotationCompanyConfiguration;
}

export interface DraftSnapshotDependencies {
  now?: () => Date;
  resolveTemplate: (key: string, versionId?: string) => Promise<ResolvedQuotationTemplate | null>;
  resolvePricing?: PricingResolver;
  resolveSettings?: () => Promise<DraftSnapshotSettings | null>;
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
  template_version_id?: string;
  business_number?: string;
  prazo_producao?: string;
  pagamento?: string;
  entrega?: string;
  observacoes?: string;
  frete?: string;
  validade_dias?: number;
  secoes?: unknown;
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
  const optionalText = (key: string): string | undefined => {
    const value = extracted[key];
    if (value == null) return undefined;
    const normalized = String(value).trim();
    if (normalized.length > 4000) throw new DraftPreviewInputError(`${key} excede o limite permitido.`);
    return normalized || undefined;
  };
  const validityDays = extracted.validade_dias == null ? undefined : Number(extracted.validade_dias);
  if (validityDays !== undefined && (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 365)) {
    throw new DraftPreviewInputError('Validade deve ser um número inteiro entre 1 e 365 dias.');
  }
  let freight: string | undefined;
  if (extracted.frete != null && String(extracted.frete).trim()) {
    try { freight = formatMoneyCents(parseScaledInteger(extracted.frete, 2, 'Frete')); }
    catch { throw new DraftPreviewInputError('Frete deve ser um valor decimal válido.'); }
  }

  return {
    nome,
    email: extracted.email == null ? null : String(extracted.email).trim(),
    telefone: extracted.telefone == null ? null : String(extracted.telefone).trim(),
    cnpj: extracted.cnpj == null ? undefined : String(extracted.cnpj).trim(),
    endereco: isRecord(extracted.endereco) ? extracted.endereco : undefined,
    template_key:
      typeof extracted.template_key === 'string' ? extracted.template_key.trim() : undefined,
    template_version_id:
      typeof extracted.template_version_id === 'string'
        ? extracted.template_version_id.trim()
        : undefined,
    business_number:
      extracted.business_number == null ? undefined : String(extracted.business_number).trim(),
    prazo_producao:
      extracted.prazo_producao == null ? undefined : String(extracted.prazo_producao).trim(),
    pagamento: optionalText('pagamento'),
    entrega: optionalText('entrega'),
    observacoes: optionalText('observacoes'),
    frete: freight,
    validade_dias: validityDays,
    secoes: extracted.secoes,
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

function draftSettingsWithLegacyOverrides(
  source: QuotationSectionsSettings | undefined,
  legacy: { pagamento?: string; observacoes?: string }
): QuotationSectionsSettings | undefined {
  if (!source) return undefined;
  return {
    ...source,
    pagamento: {
      ...source.pagamento,
      ...(legacy.pagamento === undefined ? {} : { body: legacy.pagamento }),
    },
    condicoes_gerais: {
      ...source.condicoes_gerais,
      ...(legacy.observacoes === undefined ? {} : { body: legacy.observacoes }),
    },
  };
}

function normalizeDraftSections(
  source: unknown,
  legacy: { pagamento?: string; entrega?: string; observacoes?: string; prazoProducao?: string }
): QuotationSectionsSettings {
  let settings = source;
  if (isRecord(source)) {
    const keys = ['prazo_producao', 'pagamento', 'condicoes_gerais'] as const;
    const snapshotLike = keys.some((key) => {
      const section = source[key];
      return isRecord(section) && ('base' in section || 'current' in section);
    });
    if (snapshotLike) {
      const current = Object.fromEntries(
        keys.map((key) => {
          const section = source[key];
          if (!isRecord(section) || !isRecord(section.current)) {
            throw new DraftPreviewInputError('Snapshot de seções do orçamento inválido.');
          }
          return [key, section.current];
        })
      );
      settings = { schema_version: source.schema_version, ...current };
    }
  }
  try {
    const normalized = normalizeQuotationSections(settings, legacy);
    return normalized.prazo_producao.value === undefined
      ? withQuotationProductionDeadline(normalized, legacy.prazoProducao)
      : normalized;
  } catch (error) {
    throw new DraftPreviewInputError(
      error instanceof Error ? error.message : 'Seções do orçamento inválidas.'
    );
  }
}

function draftPreviewViewModel(
  extracted: DraftPreviewInput,
  now: Date,
  company: QuotationCompanyConfiguration | undefined,
): QuotationTemplateViewModel {
  const current = Number.isNaN(now.getTime()) ? new Date() : now;
  const validityDays = extracted.validade_dias || 15;
  const validityDate = new Date(current.getTime());
  validityDate.setUTCDate(validityDate.getUTCDate() + validityDays);
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
  const subtotal = formatMoneyCents(totalCents);
  const freight = extracted.frete || '0.00';
  const freightCents = parseScaledInteger(freight, 2, 'Frete');
  const total = formatMoneyCents(totalCents + freightCents);
  const terms = {
    pagamento: extracted.pagamento || '',
    entrega: extracted.entrega || '',
    production_deadline: extracted.prazo_producao || '',
    observations: extracted.observacoes || '',
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
    validity_days: validityDays,
    client,
    client_snapshot: client,
    company: normalizeQuotationCompanyConfiguration(company),
    items,
    items_snapshot: items,
    comparison: { brackets: [], products: [] },
    terms,
    terms_snapshot: terms,
    subtotal,
    freight,
    total,
    frete: freight,
    display: {
      quote_date: formatQuotationDate(current),
      validity_date: formatQuotationDate(validityDate),
      subtotal: formatQuotationCurrency(subtotal),
      freight: formatQuotationCurrency(freight),
      total: formatQuotationCurrency(total),
    },
  };
}

export async function buildDraftQuotationSnapshot(
  input: unknown,
  dependencies: DraftSnapshotDependencies,
): Promise<DraftQuotationSnapshot> {
  const extracted = parseDraftPreview(input);
  const settings = dependencies.resolveSettings ? await dependencies.resolveSettings() : null;
  if (settings) {
    extracted.template_key ||= settings.template_padrao || undefined;
    extracted.pagamento ||= settings.pagamento || undefined;
    extracted.entrega ||= settings.entrega || undefined;
    extracted.observacoes ||= settings.observacoes || undefined;
    extracted.frete ||= settings.frete_padrao || undefined;
    extracted.validade_dias ||= settings.validade_dias;
  }
  const pricingDifferences: DraftQuotationSnapshot['pricingDifferences'] = [];
  if (dependencies.resolvePricing) {
    for (const item of extracted.items) {
      let resolved: { rate: string | number };
      try {
        resolved = await dependencies.resolvePricing(item, item.qty, extracted.urgente && !item.manual_rate);
      } catch (error) {
        if (error instanceof DraftPreviewInputError) throw error;
        throw new DraftPreviewInputError(`Preço indisponível para o produto "${item.item_code}".`);
      }
      let expected: bigint;
      let received: bigint;
      try {
        expected = parseScaledInteger(resolved.rate, 2, 'Preço do produto');
        received = parseScaledInteger(item.rate, 2, 'Preço do item');
      } catch {
        throw new DraftPreviewInputError(`Preço indisponível para o produto "${item.item_code}".`);
      }
      if (expected <= 0n) throw new DraftPreviewInputError(`Preço indisponível para o produto "${item.item_code}".`);
      if (!item.manual_rate && expected !== received) {
        pricingDifferences.push({ path: `items.${item.item_code}.rate`, expected: Number(expected) / 100, received: Number(received) / 100 });
        throw new DraftPreviewInputError(`O preço do produto "${item.item_code}" foi atualizado. Atualize o orçamento e tente novamente.`);
      }
      if (item.manual_rate) continue;
      item.rate = Number(expected) / 100;
    }
  }
  const template = await dependencies.resolveTemplate(
    extracted.template_key || 'padrao',
    extracted.template_version_id,
  );
  if (!template) throw new DraftPreviewInputError('Template do orçamento inválido.');
  const sections = normalizeDraftSections(
    extracted.secoes !== undefined
      ? extracted.secoes
      : draftSettingsWithLegacyOverrides(settings?.secoes, {
          pagamento: extracted.pagamento,
          observacoes: extracted.observacoes,
        }),
    {
      pagamento: extracted.pagamento,
      entrega: extracted.entrega,
      observacoes: extracted.observacoes,
      prazoProducao: extracted.prazo_producao,
    }
  );
  const now = dependencies.now || (() => new Date());
  const viewModel = applyQuotationSectionPolicy(
    draftPreviewViewModel(extracted, now(), settings?.empresa),
    sections,
    {
      entrega: extracted.entrega,
      prazoProducao: extracted.prazo_producao,
    },
  );
  return {
    template,
    viewModel,
    authoritativeDraft: extracted as unknown as Record<string, unknown>,
    pricingDifferences,
  };
}
