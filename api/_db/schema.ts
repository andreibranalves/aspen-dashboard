import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  timestamp,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  DEFAULT_QUOTATION_SECTIONS,
  type QuotationSectionsSettings,
  type QuotationSectionsSnapshot,
} from './quotation-content.js';
import type { QuotationStatus } from '../_lib/quotation-status.js';

/**
 * Global dashboard settings live in one deliberate singleton row. Keeping the
 * singleton at the database boundary prevents competing serverless instances
 * from creating separate "default" configurations.
 */
export const appSettings = pgTable(
  'app_settings',
  {
    singletonId: integer('singleton_id').primaryKey().default(1),
    validadeDias: integer('validade_dias').notNull().default(15),
    pagamento: varchar('pagamento', { length: 4000 }).notNull().default(''),
    entrega: varchar('entrega', { length: 500 }).notNull().default(''),
    quotationSections: jsonb('quotation_sections')
      .$type<QuotationSectionsSettings>()
      .notNull()
      .default(DEFAULT_QUOTATION_SECTIONS),
    // Keep currency exact all the way through PostgreSQL. Drizzle's default
    // numeric mode maps this column to a string instead of a JavaScript float.
    fretePadrao: numeric('frete_padrao', { precision: 14, scale: 2 }).notNull().default('0.00'),
    observacoes: varchar('observacoes', { length: 4000 }).notNull().default(''),
    templatePadrao: varchar('template_padrao', { length: 120 }).notNull().default('padrao'),
  },
  (table) => [
    check('app_settings_singleton_id_check', sql`${table.singletonId} = 1`),
    check('app_settings_validade_dias_check', sql`${table.validadeDias} BETWEEN 1 AND 365`),
    check('app_settings_frete_padrao_check', sql`${table.fretePadrao} >= 0`),
    check(
      'app_settings_template_padrao_not_blank_check',
      sql`char_length(btrim(${table.templatePadrao})) > 0`
    ),
  ]
);

/**
 * First-party product catalog. SKU is deliberately the immutable primary key:
 * integrations can safely retain it as an external identifier while the
 * mutable display fields stay in PostgreSQL. `ativo = false` is an archive,
 * never a physical delete.
 */
export const quotationTemplates = pgTable(
  'quotation_templates',
  {
    id: uuid('id').primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('quotation_templates_key_unique').on(table.key)]
);

export const quotationTemplateVersions = pgTable(
  'quotation_template_versions',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => quotationTemplates.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    sourceHash: varchar('source_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotation_template_versions_template_version_unique').on(
      table.templateId,
      table.version
    ),
    uniqueIndex('quotation_template_versions_template_hash_unique').on(
      table.templateId,
      table.sourceHash
    ),
  ]
);

export const products = pgTable(
  'products',
  {
    sku: varchar('sku', { length: 120 }).primaryKey(),
    nome: varchar('nome', { length: 255 }).notNull(),
    descricao: varchar('descricao', { length: 4000 }).notNull().default(''),
    unidade: varchar('unidade', { length: 32 }).notNull().default('Und'),
    categoria: varchar('categoria', { length: 255 }),
    marca: varchar('marca', { length: 255 }),
    // Currency is kept as PostgreSQL numeric (and therefore a Drizzle string)
    // so the pricing resolver never has to trust a binary floating point value.
    precoBase: numeric('preco_base', { precision: 14, scale: 2 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
  },
  (table) => [
    check(
      'products_sku_trimmed_check',
      sql`char_length(btrim(${table.sku})) > 0 AND btrim(${table.sku}) = ${table.sku}`
    ),
    check('products_nome_not_blank_check', sql`char_length(btrim(${table.nome})) > 0`),
    check('products_unidade_not_blank_check', sql`char_length(btrim(${table.unidade})) > 0`),
    check(
      'products_preco_base_positive_check',
      sql`${table.precoBase} IS NULL OR ${table.precoBase} > 0`
    ),
  ]
);

/**
 * Dynamic product quantity tiers.  The composite primary key is also the
 * database invariant that prevents two prices for the same SKU and minimum
 * quantity.  Quantity uses an explicit three-decimal scale so fractional
 * quantities round-trip as strings without becoming the source of truth in
 * JavaScript.
 */
export const orderTemplates = pgTable(
  'order_templates',
  {
    id: uuid('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('order_templates_name_not_blank_check', sql`char_length(btrim(${table.name})) > 0`),
    uniqueIndex('order_templates_active_name_unique')
      .on(sql`lower(btrim(${table.name}))`)
      .where(sql`${table.archived} = false`),
  ]
);

export const orderTemplateItems = pgTable(
  'order_template_items',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => orderTemplates.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 120 })
      .notNull()
      .references(() => products.sku, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.templateId, table.sku],
      name: 'order_template_items_pkey',
    }),
    uniqueIndex('order_template_items_position_unique').on(table.templateId, table.position),
    check('order_template_items_position_non_negative_check', sql`${table.position} >= 0`),
  ]
);

export const productPricingTiers = pgTable(
  'product_pricing_tiers',
  {
    productSku: varchar('product_sku', { length: 120 })
      .notNull()
      .references(() => products.sku, { onDelete: 'cascade' }),
    minimumQuantity: numeric('minimum_quantity', { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 14, scale: 2 }).notNull(),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.productSku, table.minimumQuantity],
      name: 'product_pricing_tiers_pkey',
    }),
    check(
      'product_pricing_tiers_minimum_quantity_positive_check',
      sql`${table.minimumQuantity} > 0`
    ),
    check('product_pricing_tiers_unit_price_positive_check', sql`${table.unitPrice} > 0`),
  ]
);

// Singular alias keeps the repository API pleasant while retaining an
// explicit table name in the migration and database catalog.
export const productPricing = productPricingTiers;

/**
 * Unified first-party client records.  The application owns UUID creation so
 * retries and repository tests observe the exact identifier that is inserted;
 * PostgreSQL is intentionally not the source of truth for this value.
 */
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey(),
    nome: varchar('nome', { length: 200 }).notNull(),
    documento: varchar('documento', { length: 14 }),
    email: varchar('email', { length: 254 }),
    telefone: varchar('telefone', { length: 15 }),
    notes: varchar('notes', { length: 4000 }),
    endereco: varchar('endereco', { length: 255 }),
    numero: varchar('numero', { length: 30 }),
    bairro: varchar('bairro', { length: 120 }),
    complemento: varchar('complemento', { length: 120 }),
    municipio: varchar('municipio', { length: 120 }),
    uf: varchar('uf', { length: 2 }),
    cep: varchar('cep', { length: 8 }),
    arquivado: boolean('arquivado').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('clients_documento_unique')
      .on(table.documento)
      .where(sql`${table.documento} IS NOT NULL`),
    index('clients_active_updated_idx').on(table.arquivado, table.updatedAt),
    check('clients_nome_not_blank_check', sql`char_length(btrim(${table.nome})) > 0`),
    check(
      'clients_documento_length_check',
      sql`${table.documento} IS NULL OR char_length(${table.documento}) IN (11, 14)`
    ),
    check(
      'clients_telefone_digits_check',
      sql`${table.telefone} IS NULL OR ${table.telefone} ~ '^[0-9]{10,15}$'`
    ),
    check(
      'clients_email_lowercase_check',
      sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`
    ),
    check(
      'clients_uf_uppercase_check',
      sql`${table.uf} IS NULL OR ${table.uf} = upper(${table.uf})`
    ),
    check('clients_cep_digits_check', sql`${table.cep} IS NULL OR ${table.cep} ~ '^[0-9]{8}$'`),
  ]
);

/**
 * Per-year business-number counters for first-party quotation drafts.  The
 * repository increments `lastNumber` with an atomic upsert while the quote
 * transaction is open, so a rolled-back draft also rolls back its reservation.
 */
export const quoteSequences = pgTable(
  'quote_sequences',
  {
    year: integer('year').primaryKey(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (table) => [
    check('quote_sequences_year_check', sql`${table.year} BETWEEN 2000 AND 9999`),
    check(
      'quote_sequences_last_number_check',
      sql`${table.lastNumber} >= 0 AND ${table.lastNumber} <= 9999`
    ),
  ]
);

/** First-party quotation aggregate.  The business number is the public name;
 * UUIDs remain stable application-created identifiers for future revisions. */
export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id').primaryKey(),
    businessNumber: varchar('business_number', { length: 16 }).notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    status: varchar('status', { length: 32 }).$type<QuotationStatus>().notNull().default('rascunho'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    lossReason: text('loss_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotations_business_number_unique').on(table.businessNumber),
    index('quotations_client_created_idx').on(table.clientId, table.createdAt),
    check(
      'quotations_business_number_format_check',
      sql`${table.businessNumber} ~ '^ORC-[0-9]{8}$'`
    ),
    check(
      'quotations_status_check',
      sql`${table.status} IN ('rascunho', 'emitido', 'aprovado', 'perdido')`
    ),
    check(
      'quotations_loss_reason_check',
      sql`((${table.status} = 'perdido' AND ${table.lossReason} IS NOT NULL AND btrim(${table.lossReason}) <> '') OR (${table.status} <> 'perdido' AND ${table.lossReason} IS NULL))`
    ),
  ]
);

/** Immutable revision header/snapshots.  Revision one is the only revision
 * created by this rollout; later issues can append versions without mutating
 * the historical client/settings values stored here. */
export const quoteRevisions = pgTable(
  'quote_revisions',
  {
    id: uuid('id').primaryKey(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    status: varchar('status', { length: 32 }).$type<QuotationStatus>().notNull().default('rascunho'),
    statusOriginal: varchar('status_original', { length: 64 }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    orderLinkage: varchar('order_linkage', { length: 32 }),
    orderPending: boolean('order_pending').notNull().default(false),
    validadeDias: integer('validade_dias').notNull(),
    pagamento: varchar('pagamento', { length: 4000 }).notNull().default(''),
    entrega: varchar('entrega', { length: 500 }).notNull().default(''),
    templateVersionId: uuid('template_version_id').references(() => quotationTemplateVersions.id),
    sectionsSnapshot: jsonb('sections_snapshot').$type<QuotationSectionsSnapshot>(),
    fretePadrao: numeric('frete_padrao', { precision: 20, scale: 2 }).notNull().default('0.00'),
    frete: numeric('frete', { precision: 20, scale: 2 }).notNull().default('0.00'),
    observacoes: varchar('observacoes', { length: 4000 }).notNull().default(''),
    prazoProducao: varchar('prazo_producao', { length: 500 }).notNull().default(''),
    templatePadrao: varchar('template_padrao', { length: 120 }).notNull().default('padrao'),
    templateHash: varchar('template_hash', { length: 64 })
      .notNull()
      .default('ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e'),
    clienteNome: varchar('cliente_nome', { length: 200 }).notNull(),
    clienteDocumento: varchar('cliente_documento', { length: 14 }),
    clienteEmail: varchar('cliente_email', { length: 254 }),
    clienteTelefone: varchar('cliente_telefone', { length: 15 }),
    clienteEndereco: varchar('cliente_endereco', { length: 255 }),
    clienteNumero: varchar('cliente_numero', { length: 30 }),
    clienteBairro: varchar('cliente_bairro', { length: 120 }),
    clienteComplemento: varchar('cliente_complemento', { length: 120 }),
    clienteMunicipio: varchar('cliente_municipio', { length: 120 }),
    clienteUf: varchar('cliente_uf', { length: 2 }),
    clienteCep: varchar('cliente_cep', { length: 8 }),
    clienteNotas: varchar('cliente_notas', { length: 4000 }),
    subtotal: numeric('subtotal', { precision: 20, scale: 2 }).notNull().default('0.00'),
    total: numeric('total', { precision: 20, scale: 2 }).notNull().default('0.00'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quote_revisions_quotation_version_unique').on(table.quotationId, table.version),
    uniqueIndex('quote_revisions_one_draft_per_quotation_unique')
      .on(table.quotationId)
      .where(sql`${table.status} = 'rascunho'`),
    index('quote_revisions_quotation_idx').on(table.quotationId, table.version),
    check('quote_revisions_version_positive_check', sql`${table.version} > 0`),
    check('quote_revisions_validade_dias_check', sql`${table.validadeDias} BETWEEN 1 AND 365`),
    check('quote_revisions_frete_padrao_check', sql`${table.fretePadrao} >= 0`),
    check('quote_revisions_frete_check', sql`${table.frete} >= 0`),
    check('quote_revisions_subtotal_check', sql`${table.subtotal} >= 0`),
    check('quote_revisions_total_check', sql`${table.total} >= 0`),
    check('quote_revisions_template_hash_check', sql`${table.templateHash} ~ '^[0-9a-f]{64}$'`),
    check(
      'quote_revisions_order_linkage_check',
      sql`${table.orderLinkage} IS NULL OR ${table.orderLinkage} IN ('ordered', 'completed', 'closed')`
    ),
    check(
      'quote_revisions_status_check',
      sql`${table.status} IN ('rascunho', 'emitido', 'aprovado', 'perdido')`
    ),
  ]
);

export const quotationIssueRequests = pgTable(
  'quotation_issue_requests',
  {
    id: uuid('id').primaryKey(),
    idempotencyKey: uuid('idempotency_key').notNull().unique(),
    fingerprint: text('fingerprint').notNull(),
    state: text('state').notNull(),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    publicError: text('public_error'),
    quotationId: uuid('quotation_id').references(() => quotations.id),
    revisionId: uuid('revision_id').references(() => quoteRevisions.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'quotation_issue_requests_state_check',
      sql`${table.state} IN ('processing', 'retryable', 'completed')`
    ),
  ]
);

export const quotationDeliveries = pgTable(
  'quotation_deliveries',
  {
    id: uuid('id').primaryKey(),
    revisionId: uuid('revision_id').notNull().unique().references(() => quoteRevisions.id),
    phone: text('phone').notNull(),
    flowId: text('flow_id').notNull(),
    state: text('state').notNull(),
    providerAcceptanceId: text('provider_acceptance_id'),
    publicError: text('public_error'),
    diagnosticsExpiresAt: timestamp('diagnostics_expires_at', { withTimezone: true }),
    resumableUntil: timestamp('resumable_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'quotation_deliveries_state_check',
      sql`${table.state} IN ('pending', 'transporting', 'accepted_partial', 'completed', 'retryable', 'reconciling')`
    ),
  ]
);

/** Product and price snapshots for one revision.  The product FK deliberately
 * uses PostgreSQL's default NO ACTION behavior so history cannot disappear
 * when a catalog row is archived or deleted in a future migration. */
export const quoteRevisionItems = pgTable(
  'quote_revision_items',
  {
    id: uuid('id').primaryKey(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    productSku: varchar('product_sku', { length: 120 })
      .notNull()
      .references(() => products.sku),
    quantidade: numeric('quantidade', { precision: 14, scale: 3 }).notNull(),
    produtoSku: varchar('produto_sku', { length: 120 }).notNull(),
    produtoNome: varchar('produto_nome', { length: 255 }).notNull(),
    produtoDescricao: varchar('produto_descricao', { length: 4000 }).notNull().default(''),
    produtoUnidade: varchar('produto_unidade', { length: 32 }).notNull().default('Und'),
    produtoCategoria: varchar('produto_categoria', { length: 255 }),
    produtoMarca: varchar('produto_marca', { length: 255 }),
    notas: varchar('notas', { length: 4000 }),
    precoFonte: varchar('preco_fonte', { length: 32 }).notNull(),
    precoMinimoFaixa: numeric('preco_minimo_faixa', { precision: 14, scale: 3 }),
    precoSugerido: numeric('preco_sugerido', { precision: 20, scale: 2 }).notNull(),
    precoAplicado: numeric('preco_aplicado', { precision: 20, scale: 2 }).notNull(),
    diferencaPreco: numeric('diferenca_preco', { precision: 20, scale: 2 })
      .notNull()
      .default('0.00'),
    totalLinha: numeric('total_linha', { precision: 20, scale: 2 }).notNull(),
    manualRate: boolean('manual_rate').notNull().default(false),
  },
  (table) => [
    uniqueIndex('quote_revision_items_revision_position_unique').on(
      table.revisionId,
      table.position
    ),
    index('quote_revision_items_product_idx').on(table.productSku),
    check('quote_revision_items_position_check', sql`${table.position} >= 0`),
    check('quote_revision_items_quantity_check', sql`${table.quantidade} > 0`),
    check(
      'quote_revision_items_prices_check',
      sql`${table.precoSugerido} > 0 AND ${table.precoAplicado} > 0`
    ),
    check('quote_revision_items_total_check', sql`${table.totalLinha} >= 0`),
  ]
);

export const quoteLeads = pgTable(
  'quote_leads',
  {
    id: uuid('id').primaryKey(),
    identityKey: varchar('identity_key', { length: 512 }).notNull(),
    nome: varchar('nome', { length: 200 }),
    email: varchar('email', { length: 254 }),
    telefone: varchar('telefone', { length: 15 }),
    pedidoTexto: varchar('pedido_texto', { length: 4000 }),
    source: varchar('source', { length: 80 }).notNull().default('typebot'),
    sourceDetail: varchar('source_detail', { length: 255 }),
    externalId: varchar('external_id', { length: 255 }),
    empresa: varchar('empresa', { length: 255 }),
    produto: varchar('produto', { length: 255 }),
    quantidade: varchar('quantidade', { length: 255 }),
    finalidade: varchar('finalidade', { length: 255 }),
    prazo: varchar('prazo', { length: 255 }),
    arte: varchar('arte', { length: 255 }),
    attribution: jsonb('attribution').$type<Record<string, unknown>>(),
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    status: varchar('status', { length: 16 }).notNull().default('new'),
    quotationId: uuid('quotation_id').references(() => quotations.id),
    crmDealId: uuid('crm_deal_id').references((): AnyPgColumn => crmDeals.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quote_leads_identity_key_unique').on(table.identityKey),
    check(
      'quote_leads_identity_key_not_blank_check',
      sql`char_length(btrim(${table.identityKey})) > 0`
    ),
    check(
      'quote_leads_email_lowercase_check',
      sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`
    ),
    check(
      'quote_leads_telefone_digits_check',
      sql`${table.telefone} IS NULL OR ${table.telefone} ~ '^[0-9]{10,15}$'`
    ),
    check(
      'quote_leads_status_check',
      sql`${table.status} IN ('new', 'incomplete', 'ready', 'reviewing', 'converted', 'discarded')`
    ),
  ]
);

export const crmDeals = pgTable(
  'crm_deals',
  {
    id: uuid('id').primaryKey(),
    quoteLeadId: uuid('quote_lead_id').references((): AnyPgColumn => quoteLeads.id),
    clientId: uuid('client_id').references(() => clients.id),
    quotationId: uuid('quotation_id').references(() => quotations.id),
    nome: varchar('nome', { length: 200 }).notNull(),
    email: varchar('email', { length: 254 }),
    telefone: varchar('telefone', { length: 15 }),
    status: varchar('status', { length: 32 }).notNull().default('Novo Lead'),
    followUpStage: integer('follow_up_stage').notNull().default(0),
    nextStep: varchar('next_step', { length: 500 }),
    lostReason: varchar('lost_reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('crm_deals_status_updated_idx').on(table.status, table.updatedAt),
    uniqueIndex('crm_deals_active_quotation_unique')
      .on(table.quotationId)
      .where(sql`${table.quotationId} IS NOT NULL AND ${table.status} <> 'Perdido'`),
    check('crm_deals_nome_not_blank_check', sql`char_length(btrim(${table.nome})) > 0`),
    check(
      'crm_deals_email_lowercase_check',
      sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`
    ),
    check(
      'crm_deals_telefone_digits_check',
      sql`${table.telefone} IS NULL OR ${table.telefone} ~ '^[0-9]{10,15}$'`
    ),
    check('crm_deals_follow_up_stage_check', sql`${table.followUpStage} >= 0`),
    check(
      'crm_deals_status_check',
      sql`${table.status} IN ('Novo Lead', 'Contato Feito', 'Orcamento Enviado', 'Em Negociacao', 'Arte Aprovada', 'Pedido Fechado', 'Perdido')`
    ),
  ]
);

export const salesOrderSequences = pgTable(
  'sales_order_sequences',
  {
    year: integer('year').primaryKey(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (table) => [
    check('sales_order_sequences_year_check', sql`${table.year} BETWEEN 2000 AND 9999`),
    check(
      'sales_order_sequences_last_number_check',
      sql`${table.lastNumber} >= 0 AND ${table.lastNumber} <= 9999`
    ),
  ]
);

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey(),
    orderNumber: varchar('order_number', { length: 32 }).notNull(),
    quotationId: uuid('quotation_id').references(() => quotations.id),
    quotationRevisionId: uuid('quotation_revision_id').references(() => quoteRevisions.id),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id),
    status: varchar('status', { length: 32 }).notNull().default('Draft'),
    transactionDate: date('transaction_date').notNull(),
    deliveryDate: date('delivery_date'),
    perDelivered: numeric('per_delivered', { precision: 5, scale: 2 }).notNull().default('0.00'),
    perBilled: numeric('per_billed', { precision: 5, scale: 2 }).notNull().default('0.00'),
    subtotal: numeric('subtotal', { precision: 20, scale: 2 }).notNull(),
    grandTotal: numeric('grand_total', { precision: 20, scale: 2 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_orders_order_number_unique').on(table.orderNumber),
    uniqueIndex('sales_orders_active_quotation_unique')
      .on(table.quotationId)
      .where(sql`${table.quotationId} IS NOT NULL AND ${table.status} <> 'Cancelled'`),
    index('sales_orders_status_transaction_date_idx').on(table.status, table.transactionDate),
    index('sales_orders_client_transaction_date_idx').on(table.clientId, table.transactionDate),
    check(
      'sales_orders_order_number_format_check',
      sql`${table.orderNumber} ~ '^PED-[0-9]{4}-[0-9]{4}$'`
    ),
    check(
      'sales_orders_status_check',
      sql`${table.status} IN ('Draft', 'To Deliver and Bill', 'To Deliver', 'To Bill', 'Completed', 'Cancelled', 'Closed')`
    ),
    check(
      'sales_orders_per_delivered_check',
      sql`${table.perDelivered} BETWEEN 0 AND 100`
    ),
    check('sales_orders_per_billed_check', sql`${table.perBilled} BETWEEN 0 AND 100`),
    check('sales_orders_subtotal_check', sql`${table.subtotal} >= 0`),
    check('sales_orders_grand_total_check', sql`${table.grandTotal} >= 0`),
  ]
);

export const salesOrderItems = pgTable(
  'sales_order_items',
  {
    id: uuid('id').primaryKey(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    productSku: varchar('product_sku', { length: 120 })
      .notNull()
      .references(() => products.sku),
    productName: varchar('product_name', { length: 255 }).notNull(),
    unit: varchar('unit', { length: 32 }).notNull(),
    quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull(),
    unitPrice: numeric('unit_price', { precision: 20, scale: 2 }).notNull(),
    lineTotal: numeric('line_total', { precision: 20, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex('sales_order_items_order_position_unique').on(table.salesOrderId, table.position),
    index('sales_order_items_product_idx').on(table.productSku),
    check('sales_order_items_position_check', sql`${table.position} >= 0`),
    check('sales_order_items_quantity_check', sql`${table.quantity} > 0`),
    check('sales_order_items_unit_price_check', sql`${table.unitPrice} >= 0`),
    check('sales_order_items_line_total_check', sql`${table.lineTotal} >= 0`),
  ]
);

export const productActivityEvents = pgTable(
  'product_activity_events',
  {
    id: uuid('id').primaryKey(),
    productSku: varchar('product_sku', { length: 120 })
      .notNull()
      .references(() => products.sku),
    tipo: varchar('tipo', { length: 16 }).notNull(),
    texto: varchar('texto', { length: 1000 }).notNull(),
    referenceId: varchar('reference_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('product_activity_events_sku_created_idx').on(table.productSku, table.createdAt),
    check(
      'product_activity_events_tipo_check',
      sql`${table.tipo} IN ('produto', 'preco', 'orcamento', 'pedido')`
    ),
    check(
      'product_activity_events_texto_not_blank_check',
      sql`char_length(btrim(${table.texto})) > 0`
    ),
  ]
);


// Singular aliases make repository/tests that speak in domain terms concise
// without changing the SQL table names used by migrations.
export const quoteSequence = quoteSequences;
export const quotation = quotations;
export const quoteRevision = quoteRevisions;
export const quoteRevisionItem = quoteRevisionItems;
