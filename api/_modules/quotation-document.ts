import type { QuotationTemplateSnapshot } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import type { DraftQuotationSnapshot } from './quotation-draft-snapshot.js';
import {
  formatQuotationClientName,
  formatQuotationCurrency,
  formatQuotationDate,
  formatQuotationPhone,
  formatQuotationQuantity,
  quotationTemplateFromVersion,
  renderQuotationTemplate,
  resolveQuotationTemplate,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from './quotation-template-catalog.js';
import {
  normalizeQuotationSections,
  toSafeMultilineHtml,
  toSafeRichTextHtml,
  type QuotationSectionsSettings,
} from './quotation-content.js';
import { normalizeQuotationCompanyConfiguration } from './quotation-company.js';
import { canonicalQuotationStatus } from './quotation-status.js';

export type QuotationDocumentSnapshot = QuotationTemplateSnapshot;
export type QuotationDocumentInput = QuotationTemplateSnapshot | DraftQuotationSnapshot;

export interface RenderedQuotationDocument {
  html: string;
  template: QuotationTemplate;
  viewModel: QuotationTemplateViewModel;
}

export type QuotationDocumentRenderer = (
  snapshot: QuotationDocumentInput,
  template?: QuotationTemplate
) => RenderedQuotationDocument;

function renderTemplateDocument(
  template: QuotationTemplate,
  viewModel: QuotationTemplateViewModel
): RenderedQuotationDocument {
  return {
    html: renderQuotationTemplate(template, viewModel),
    template,
    viewModel,
  };
}

function asDate(value: Date | string | null | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getTime());
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(0);
}

function dateOnly(value: Date | string): string {
  return asDate(value).toISOString().slice(0, 10);
}

function validityDate(createdAt: Date | string, days: number): Date {
  const result = asDate(createdAt);
  result.setUTCDate(result.getUTCDate() + Math.max(1, days));
  return result;
}

function nullable(value: unknown): string {
  return value == null ? '' : String(value);
}

const COMPARISON_BRACKETS = [
  { minimum: 30, label: '30 - 99' },
  { minimum: 100, label: '100 - 299' },
  { minimum: 300, label: '300 - 499' },
  { minimum: 500, label: '500 - 999' },
  { minimum: 1000, label: '1000+' },
] as const;

export type ComparisonItem = {
  item_code?: string | null;
  name: string;
  description: string;
  position: number;
  qty: string;
  tier_minimum: string;
  unit_price: string;
  display: { unit_price: string };
};

type ComparisonPrice = { display: string; available: boolean };

type ComparisonGroup = {
  position: number;
  name: string;
  description: string;
  prices: Map<number, ComparisonPrice>;
};

function comparisonMinimum(tier: string, quantity: string): number {
  const explicit = Number(tier);
  if (COMPARISON_BRACKETS.some((bracket) => bracket.minimum === explicit)) return explicit;
  const value = Number(quantity);
  if (value >= 1000) return 1000;
  if (value >= 500) return 500;
  if (value >= 300) return 300;
  if (value >= 100) return 100;
  return 30;
}

export function buildComparison(items: ComparisonItem[]) {
  const groups = new Map<string, ComparisonGroup>();
  const visible = new Set<number>();

  for (const item of items) {
    const minimum = comparisonMinimum(item.tier_minimum, item.qty);
    const key = `${item.item_code || item.name}\u0000${item.description}`;
    const group = groups.get(key) || {
      position: item.position,
      name: item.name,
      description: item.description,
      prices: new Map<number, ComparisonPrice>(),
    };
    visible.add(minimum);
    group.prices.set(minimum, {
      display: item.display.unit_price,
      available: Boolean(item.unit_price),
    });
    groups.set(key, group);
  }

  const brackets = COMPARISON_BRACKETS.filter((bracket) => visible.has(bracket.minimum));
  const products = [...groups.values()]
    .sort((left, right) => left.position - right.position)
    .map((group, index) => ({
      position: index + 1,
      name: group.name,
      description: group.description,
      prices: brackets.map(
        (bracket) => group.prices.get(bracket.minimum) || { display: '', available: false }
      ),
    }));

  return { brackets, products };
}

export function applyQuotationSectionPolicy(
  viewModel: QuotationTemplateViewModel,
  sections: QuotationSectionsSettings
): QuotationTemplateViewModel {
  const prazoVisible = sections.prazo_producao.enabled;
  const pagamentoVisible = sections.pagamento.enabled;
  const condicoesVisible = sections.condicoes_gerais.enabled;
  const productionDeadline = sections.prazo_producao.value ?? '';
  const renderSectionHtml = sections.rich_text ? toSafeRichTextHtml : toSafeMultilineHtml;
  const company = viewModel.company as Record<string, unknown> | undefined;
  const banking = company?.banking as Record<string, unknown> | undefined;
  const paymentText = sections.pagamento.body.replace(/<[^>]*>/g, ' ').toLocaleLowerCase('pt-BR');
  const repeatedBankingValues = banking
    ? Object.values(banking).filter(
        (value) => typeof value === 'string' && value.length >= 4 && paymentText.includes(value.toLocaleLowerCase('pt-BR'))
      ).length
    : 0;
  return {
    ...viewModel,
    ...(company && banking && repeatedBankingValues >= 2
      ? { company: { ...company, banking: Object.fromEntries(Object.keys(banking).map((key) => [key, ''])) } }
      : {}),
    display: {
      ...(viewModel.display as Record<string, unknown>),
      show_summary: sections.show_summary,
    },
    secoes: {
      prazo_producao: {
        enabled: prazoVisible,
        title: prazoVisible ? sections.prazo_producao.title : '',
        value: prazoVisible ? productionDeadline : '',
        value_html: prazoVisible ? renderSectionHtml(productionDeadline) : renderSectionHtml(''),
      },
      pagamento: {
        enabled: pagamentoVisible,
        title: pagamentoVisible ? sections.pagamento.title : '',
        body_html: pagamentoVisible
          ? renderSectionHtml(sections.pagamento.body)
          : renderSectionHtml(''),
      },
      condicoes_gerais: {
        enabled: condicoesVisible,
        title: condicoesVisible ? sections.condicoes_gerais.title : '',
        body_html: condicoesVisible
          ? renderSectionHtml(sections.condicoes_gerais.body)
          : renderSectionHtml(''),
      },
    },
    terms: {
      pagamento: pagamentoVisible ? sections.pagamento.body : '',
      // Entrega remains a first-class revision field; it flows in through the
      // incoming view model rather than a section snapshot.
      entrega: condicoesVisible ? entregaFromViewModel(viewModel) : '',
      production_deadline: prazoVisible ? productionDeadline : '',
      observations: condicoesVisible ? sections.condicoes_gerais.body : '',
    },
    terms_snapshot: {
      pagamento: pagamentoVisible ? sections.pagamento.body : '',
      entrega: condicoesVisible ? entregaFromViewModel(viewModel) : '',
      production_deadline: prazoVisible ? productionDeadline : '',
      observations: condicoesVisible ? sections.condicoes_gerais.body : '',
    },
  };
}

function entregaFromViewModel(viewModel: QuotationTemplateViewModel): string {
  const terms = viewModel.terms as { entrega?: string } | undefined;
  return terms?.entrega || '';
}

/** Convert the immutable snapshot into the only template-facing model. */
export function quotationSnapshotViewModel(
  snapshot: QuotationTemplateSnapshot
): QuotationTemplateViewModel {
  const { quotation, revision } = snapshot;
  // Each revision owns its own validity window. A copied revision can be
  // created after the quotation aggregate, so deriving this from the
  // aggregate's original createdAt would silently reuse the first revision's
  // deadline in newly issued PDFs.
  const validity = validityDate(revision.createdAt, revision.validadeDias);
  const items = snapshot.items
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((item) => {
      const sku = item.produtoSku || item.productSku;
      const quantity = nullable(item.quantidade);
      const suggested = nullable(item.precoSugerido);
      const applied = nullable(item.precoAplicado);
      const difference = nullable(item.diferencaPreco);
      const lineTotal = nullable(item.totalLinha);
      return {
        id: item.id,
        position: item.position,
        sku,
        item_code: sku,
        nome: item.produtoNome,
        name: item.produtoNome,
        descricao: item.produtoDescricao || '',
        description: item.produtoDescricao || '',
        unidade: item.produtoUnidade || '',
        unit: item.produtoUnidade || '',
        categoria: item.produtoCategoria || '',
        marca: item.produtoMarca || '',
        qty: quantity,
        quantidade: quantity,
        quantity: formatQuotationQuantity(quantity),
        price_source: item.precoFonte,
        preco_fonte: item.precoFonte,
        tier_minimum: nullable(item.precoMinimoFaixa),
        preco_minimo_faixa: nullable(item.precoMinimoFaixa),
        suggested_unit_price: suggested,
        preco_sugerido: suggested,
        applied_unit_price: applied,
        preco_aplicado: applied,
        unit_price: applied,
        price_difference: difference,
        diferenca_preco: difference,
        line_total: lineTotal,
        total_linha: lineTotal,
        manual_rate: Boolean(item.manualRate),
        display: {
          unit_price: formatQuotationCurrency(applied),
          line_total: formatQuotationCurrency(lineTotal),
        },
      };
    });
  const subtotal = nullable(revision.subtotal);
  const freight = nullable(revision.frete);
  const total = nullable(revision.total);
  const client = {
    id: quotation.clientId,
    name: formatQuotationClientName(revision.clienteNome),
    nome: formatQuotationClientName(revision.clienteNome),
    document: revision.clienteDocumento || '',
    documento: revision.clienteDocumento || '',
    email: revision.clienteEmail || '',
    phone: formatQuotationPhone(revision.clienteTelefone),
    telefone: formatQuotationPhone(revision.clienteTelefone),
    address: [
      revision.clienteEndereco,
      revision.clienteNumero,
      revision.clienteBairro,
      revision.clienteComplemento,
      revision.clienteMunicipio,
      revision.clienteUf,
      revision.clienteCep,
    ]
      .filter(Boolean)
      .join(', '),
    notes: revision.clienteNotas || '',
    notes_snapshot: revision.clienteNotas || '',
    endereco: revision.clienteEndereco || '',
    numero: revision.clienteNumero || '',
    bairro: revision.clienteBairro || '',
    complemento: revision.clienteComplemento || '',
    municipio: revision.clienteMunicipio || '',
    uf: revision.clienteUf || '',
    cep: revision.clienteCep || '',
  };
  const company = normalizeQuotationCompanyConfiguration(
    snapshot.companySnapshot || revision.companySnapshot,
  );
  const result: QuotationTemplateViewModel = {
    quote_number: quotation.businessNumber,
    quotation_name: quotation.businessNumber,
    quote_id: quotation.id,
    revision: revision.version,
    revision_number: revision.version,
    status: quotation.status === 'emitido' ? 'Enviado' : quotation.status,
    status_canonical: canonicalQuotationStatus(quotation.status ?? revision.status ?? 'emitido'),
    revision_status: canonicalQuotationStatus(revision.status ?? quotation.status ?? 'emitido'),
    quote_date: dateOnly(quotation.createdAt),
    date: dateOnly(quotation.createdAt),
    validity_date: validity.toISOString().slice(0, 10),
    validity: validity.toISOString().slice(0, 10),
    validity_days: revision.validadeDias,
    client,
    client_snapshot: client,
    company,
    items,
    items_snapshot: items,
    comparison: buildComparison(items),
    terms: {
      pagamento: '',
      entrega: revision.entrega,
      production_deadline: '',
      observations: '',
    },
    terms_snapshot: {
      pagamento: '',
      entrega: revision.entrega,
      production_deadline: '',
      observations: '',
    },
    subtotal,
    freight,
    total,
    frete: freight,
    display: {
      quote_date: formatQuotationDate(quotation.createdAt),
      validity_date: formatQuotationDate(validity),
      subtotal: formatQuotationCurrency(subtotal),
      freight: formatQuotationCurrency(freight),
      total: formatQuotationCurrency(total),
    },
  };

  const sectionsSnapshot = (snapshot.sectionsSnapshot || revision.sectionsSnapshot) as unknown as
    | Record<string, unknown>
    | undefined;
  if (!sectionsSnapshot || typeof sectionsSnapshot !== 'object') {
    throw new Error('Revisão do orçamento sem snapshot canônico de seções.');
  }
  const prazo = (sectionsSnapshot.prazo_producao || {}) as Record<string, unknown>;
  const prazoCurrent = (prazo.current || {}) as Record<string, unknown>;
  const productionDeadline = nullable(prazoCurrent.value);
  const pagto = (sectionsSnapshot.pagamento || {}) as Record<string, unknown>;
  const condicoes = (sectionsSnapshot.condicoes_gerais || {}) as Record<string, unknown>;
  const pagtoCurrent = (pagto.current || {}) as Record<string, unknown>;
  const condicoesCurrent = (condicoes.current || {}) as Record<string, unknown>;
  const sections = normalizeQuotationSections({
    show_summary: sectionsSnapshot.show_summary !== false,
    rich_text: sectionsSnapshot.rich_text === true,
    prazo_producao: {
      enabled: prazoCurrent.enabled === true,
      title: String(prazoCurrent.title || 'Prazo de produção'),
      value: productionDeadline,
    },
    pagamento: {
      enabled: pagtoCurrent.enabled === true,
      title: String(pagtoCurrent.title || 'Pagamento'),
      body: String(pagtoCurrent.body || ''),
    },
    condicoes_gerais: {
      enabled: condicoesCurrent.enabled === true,
      title: String(condicoesCurrent.title || 'Condições Gerais'),
      body: String(condicoesCurrent.body || ''),
    },
  });
  return applyQuotationSectionPolicy(result, sections);
}

/**
 * Render the immutable revision snapshot with the exact template selected for it.
 * A caller may provide the resolved template explicitly; otherwise the stored
 * version is preferred and legacy revisions use their stored key/hash pair.
 */
function isDraftQuotationDocument(
  snapshot: QuotationDocumentInput
): snapshot is DraftQuotationSnapshot {
  return 'viewModel' in snapshot && 'template' in snapshot && !('quotation' in snapshot);
}

export const renderQuotationDocument: QuotationDocumentRenderer = (snapshot, exactTemplate) => {
  if (isDraftQuotationDocument(snapshot)) {
    return renderTemplateDocument(exactTemplate || snapshot.template, snapshot.viewModel);
  }
  const template =
    exactTemplate ||
    (snapshot.templateVersion
      ? quotationTemplateFromVersion(snapshot.templateVersion)
      : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash));
  return renderTemplateDocument(template, quotationSnapshotViewModel(snapshot));
};
