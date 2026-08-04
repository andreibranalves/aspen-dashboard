import { asc, desc, eq, or } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import {
  quotationTemplateVersions,
  quotationTemplates,
  quoteRevisionItems,
  quoteRevisions,
  quotations,
} from './schema.js';
import {
  formatQuotationCurrency,
  formatQuotationDate,
  resolveQuotationTemplate,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from '../_functions/lib/quotation-templates.js';
import { toSafeMultilineHtml } from './quotation-content.js';

type DatabaseProvider = () => AppDatabase;
type QuoteDatabase = AppDatabase;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class QuotationTemplateSnapshotRepositoryError extends Error {
  readonly expose = false;

  constructor(
    message = 'Não foi possível consultar o orçamento para visualização.',
    readonly statusCode = 503
  ) {
    super(message);
    this.name = 'QuotationTemplateSnapshotRepositoryError';
  }
}

export interface QuotationTemplateSnapshot {
  quotation: typeof quotations.$inferSelect;
  revision: typeof quoteRevisions.$inferSelect;
  templateVersion:
    | (typeof quotationTemplateVersions.$inferSelect & {
        template?: typeof quotationTemplates.$inferSelect;
      })
    | null;
  sectionsSnapshot: typeof quoteRevisions.$inferSelect.sectionsSnapshot;
  items: (typeof quoteRevisionItems.$inferSelect)[];
}

function quoteWhere(id: string) {
  return UUID_PATTERN.test(id)
    ? or(eq(quotations.id, id), eq(quotations.businessNumber, id))
    : eq(quotations.businessNumber, id);
}

/**
 * Load only the immutable quotation envelope, revision and item snapshots.
 * This repository intentionally never joins clients, products, pricing tiers,
 * or settings so a rendered historical quote cannot change when live records
 * are edited.
 */
export async function readQuotationTemplateSnapshot(
  db: QuoteDatabase,
  id: string,
  templateVersionId?: string
): Promise<QuotationTemplateSnapshot | null> {
  let [quotation] = await db.select().from(quotations).where(quoteWhere(id)).limit(1);
  let targetRevisionId: string | undefined;
  if (!quotation && UUID_PATTERN.test(id)) {
    const [revision] = await db
      .select()
      .from(quoteRevisions)
      .where(eq(quoteRevisions.id, id))
      .limit(1);
    if (revision) {
      targetRevisionId = revision.id;
      [quotation] = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, revision.quotationId))
        .limit(1);
    }
  }
  if (!quotation) return null;
  const [revision] = await db
    .select()
    .from(quoteRevisions)
    .where(
      targetRevisionId
        ? eq(quoteRevisions.id, targetRevisionId)
        : eq(quoteRevisions.quotationId, quotation.id)
    )
    .orderBy(desc(quoteRevisions.version))
    .limit(1);
  if (!revision) return null;

  let templateVersion = revision.templateVersionId
    ? (
        await db
          .select({ version: quotationTemplateVersions, model: quotationTemplates })
          .from(quotationTemplateVersions)
          .innerJoin(quotationTemplates, eq(quotationTemplates.id, quotationTemplateVersions.templateId))
          .where(eq(quotationTemplateVersions.id, revision.templateVersionId))
          .limit(1)
      ).map(({ version, model }) => ({ ...version, template: model }))[0] || null
    : null;
  if (templateVersionId !== undefined) {
    if (revision.status !== 'rascunho') {
      throw new QuotationTemplateSnapshotRepositoryError(
        'A versão do template só pode ser alterada em rascunhos.',
        409
      );
    }
    const [selected] = await db
      .select({ version: quotationTemplateVersions, model: quotationTemplates })
      .from(quotationTemplateVersions)
      .innerJoin(quotationTemplates, eq(quotationTemplates.id, quotationTemplateVersions.templateId))
      .where(eq(quotationTemplateVersions.id, templateVersionId))
      .limit(1);
    if (!selected || selected.model.archived) {
      throw new QuotationTemplateSnapshotRepositoryError('Template do orçamento inválido.', 400);
    }
    templateVersion = { ...selected.version, template: selected.model };
  }
  if (!templateVersion && !revision.templateVersionId) {
    console.warn(
      `[quotation-template-repository] legacy revision ${revision.id} uses static template compatibility fallback`
    );
  }
  const items = await db
    .select()
    .from(quoteRevisionItems)
    .where(eq(quoteRevisionItems.revisionId, revision.id))
    .orderBy(asc(quoteRevisionItems.position));
  return {
    quotation,
    revision,
    templateVersion,
    sectionsSnapshot: revision.sectionsSnapshot,
    items,
  };
}

export function createQuotationTemplateRepository(getDb: DatabaseProvider = getDatabase) {
  return {
    async get(id: string, templateVersionId?: string): Promise<QuotationTemplateSnapshot | null> {
      const normalized = String(id || '').trim();
      if (!normalized) return null;
      try {
        return await readQuotationTemplateSnapshot(getDb(), normalized, templateVersionId);
      } catch (error) {
        if (error instanceof QuotationTemplateSnapshotRepositoryError) throw error;
        console.error(
          `[quotation-template-repository] read failed (${error instanceof Error ? error.name : typeof error})`
        );
        throw new QuotationTemplateSnapshotRepositoryError();
      }
    },
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

/** Convert the immutable database snapshot into the template-facing model. */
export function quotationSnapshotViewModel(
  snapshot: QuotationTemplateSnapshot
): QuotationTemplateViewModel {
  const { quotation, revision } = snapshot;
  // Each revision owns its own validity window.  A copied revision can be
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
        quantity,
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
    name: revision.clienteNome,
    nome: revision.clienteNome,
    document: revision.clienteDocumento || '',
    documento: revision.clienteDocumento || '',
    email: revision.clienteEmail || '',
    phone: revision.clienteTelefone || '',
    telefone: revision.clienteTelefone || '',
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
  const result: QuotationTemplateViewModel = {
    quote_number: quotation.businessNumber,
    quotation_name: quotation.businessNumber,
    quote_id: quotation.id,
    revision: revision.version,
    revision_number: revision.version,
    status: quotation.status,
    status_canonical: quotation.status,
    revision_status: revision.status,
    quote_date: dateOnly(quotation.createdAt),
    date: dateOnly(quotation.createdAt),
    validity_date: validity.toISOString().slice(0, 10),
    validity: validity.toISOString().slice(0, 10),
    validity_days: revision.validadeDias,
    client,
    client_snapshot: client,
    items,
    items_snapshot: items,
    terms: {
      pagamento: revision.pagamento,
      entrega: revision.entrega,
      production_deadline: revision.prazoProducao,
      observations: revision.observacoes,
    },
    terms_snapshot: {
      pagamento: revision.pagamento,
      entrega: revision.entrega,
      production_deadline: revision.prazoProducao,
      observations: revision.observacoes,
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
  if (sectionsSnapshot && typeof sectionsSnapshot === 'object') {
    const prazo = (sectionsSnapshot.prazo_producao || {}) as Record<string, unknown>;
    const pagto = (sectionsSnapshot.pagamento || {}) as Record<string, unknown>;
    const condicoes = (sectionsSnapshot.condicoes_gerais || {}) as Record<string, unknown>;
    const prazoCurrent = (prazo.current || {}) as Record<string, unknown>;
    const pagtoCurrent = (pagto.current || {}) as Record<string, unknown>;
    const condicoesCurrent = (condicoes.current || {}) as Record<string, unknown>;
    result.secoes = {
      prazo_producao: {
        value: prazoCurrent.enabled ? nullable(revision.prazoProducao) : '',
      },
      pagamento: {
        body_html: pagtoCurrent.enabled
          ? toSafeMultilineHtml(String(pagtoCurrent.body || ''))
          : toSafeMultilineHtml(''),
      },
      condicoes_gerais: {
        body_html: condicoesCurrent.enabled
          ? toSafeMultilineHtml(String(condicoesCurrent.body || ''))
          : toSafeMultilineHtml(''),
      },
    };
  }

  return result;
}
