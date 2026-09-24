import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
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
  time,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  DEFAULT_QUOTATION_SECTIONS,
  type QuotationSectionsSettings,
  type QuotationSectionsSnapshot,
} from '../../_modules/quotation-content.js';
import type { RenderedQuotationEmail } from '../../_modules/quotation-email-renderer.js';
import {
  DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  type QuotationCompanyConfiguration,
} from '../../_modules/quotation-company.js';
import type { QuotationStatus } from '../../_modules/quotation-status.js';

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
    entrega: varchar('entrega', { length: 500 }).notNull().default(''),
    // Canonical source for the payment/general-conditions sections.
    quotationSections: jsonb('quotation_sections')
      .$type<QuotationSectionsSettings>()
      .notNull()
      .default(DEFAULT_QUOTATION_SECTIONS),
    companyConfiguration: jsonb('company_configuration')
      .$type<QuotationCompanyConfiguration>()
      .notNull()
      .default(DEFAULT_QUOTATION_COMPANY_CONFIGURATION),
    // Keep currency exact all the way through PostgreSQL. Drizzle's default
    // numeric mode maps this column to a string instead of a JavaScript float.
    fretePadrao: numeric('frete_padrao', { precision: 14, scale: 2 }).notNull().default('0.00'),
    aliquota: numeric('aliquota', { precision: 5, scale: 2 }).notNull().default('4.00'),
    templatePadrao: varchar('template_padrao', { length: 120 }).notNull().default('padrao'),
    settingsVersion: integer('settings_version').notNull().default(1),
  },
  (table) => [
    check('app_settings_singleton_id_check', sql`${table.singletonId} = 1`),
    check('app_settings_validade_dias_check', sql`${table.validadeDias} BETWEEN 1 AND 365`),
    check('app_settings_frete_padrao_check', sql`${table.fretePadrao} >= 0`),
    check(
      'app_settings_aliquota_check',
      sql`${table.aliquota} >= 0 AND ${table.aliquota} <= 100`
    ),
    check(
      'app_settings_template_padrao_not_blank_check',
      sql`char_length(btrim(${table.templatePadrao})) > 0`
    ),
    check('app_settings_settings_version_positive_check', sql`${table.settingsVersion} > 0`),
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
    contractVersion: integer('contract_version').notNull().default(1),
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
    check(
      'quotation_template_versions_contract_version_check',
      sql`${table.contractVersion} IN (1, 2)`
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
    custoUnitario: numeric('custo_unitario', { precision: 14, scale: 2 }),
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
    check(
      'products_custo_unitario_nonnegative_check',
      sql`${table.custoUnitario} IS NULL OR ${table.custoUnitario} >= 0`
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
    empresa: varchar('empresa', { length: 200 }),
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
    quoteLeadId: uuid('quote_lead_id').references((): AnyPgColumn => quoteLeads.id, {
      onDelete: 'restrict',
    }),
    // The demand this proposal belongs to. A proposal has exactly one
    // opportunity; an opportunity can accumulate several alternative
    // proposals. Nullable so proposals created by older flows stay valid and
    // an unlinked proposal never invents a demand.
    opportunityId: uuid('opportunity_id').references((): AnyPgColumn => crmDeals.id, {
      onDelete: 'set null',
    }),
    // Stable client-generated creation key. A retry that loses the first
    // response replays the original quotation instead of creating another one.
    // Nullable so every legacy consumer without a key keeps working.
    creationRequestId: uuid('creation_request_id'),
    // Canonical digest of the content that produced this quotation. A different
    // payload reusing the same key is a conflict, never a silent replay.
    creationFingerprint: text('creation_fingerprint'),
    status: varchar('status', { length: 32 }).$type<QuotationStatus>().notNull().default('rascunho'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    lossReason: text('loss_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotations_business_number_unique').on(table.businessNumber),
    index('quotations_client_created_idx').on(table.clientId, table.createdAt),
    index('quotations_quote_lead_id_idx')
      .on(table.quoteLeadId)
      .where(sql`${table.quoteLeadId} IS NOT NULL`),
    index('quotations_opportunity_id_idx')
      .on(table.opportunityId)
      .where(sql`${table.opportunityId} IS NOT NULL`),
    uniqueIndex('quotations_creation_request_unique')
      .on(table.creationRequestId)
      .where(sql`${table.creationRequestId} IS NOT NULL`),
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
    entrega: varchar('entrega', { length: 500 }).notNull().default(''),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => quotationTemplateVersions.id),
    // Canonical commercial sections; sole authority after the legacy cutover.
    sectionsSnapshot: jsonb('sections_snapshot').$type<QuotationSectionsSnapshot>().notNull(),
    companySnapshot: jsonb('company_snapshot')
      .$type<QuotationCompanyConfiguration>()
      .notNull(),
    fretePadrao: numeric('frete_padrao', { precision: 20, scale: 2 }).notNull().default('0.00'),
    frete: numeric('frete', { precision: 20, scale: 2 }).notNull().default('0.00'),
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
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id),
    phone: text('phone').notNull(),
    flowId: text('flow_id').notNull(),
    flowName: text('flow_name').notNull(),
    state: text('state').notNull(),
    providerAcceptanceId: text('provider_acceptance_id'),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    reconciliationDeadline: timestamp('reconciliation_deadline', { withTimezone: true }),
    publicError: text('public_error'),
    completionSource: text('completion_source'),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    diagnosticsExpiresAt: timestamp('diagnostics_expires_at', { withTimezone: true }),
    resumableUntil: timestamp('resumable_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    // Durable rotation cursor for acceptance follow-up reconciliation. Bumped on
    // every projection attempt so a persistently failing or timed-out candidate
    // moves to the tail of the next slice instead of starving later work. Kept
    // separate from `updated_at` so it never shifts the resolution deadline.
    followUpProjectionAttemptedAt: timestamp('follow_up_projection_attempted_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('quotation_deliveries_revision_flow_unique').on(table.revisionId, table.flowId),
    index('quotation_deliveries_due_idx').on(table.state, table.nextAttemptAt),
    index('quotation_deliveries_follow_up_projection_idx').on(
      table.state,
      table.followUpProjectionAttemptedAt
    ),
    check(
      'quotation_deliveries_state_check',
      sql`${table.state} IN ('queued', 'processing', 'provider_accepted', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'failed')`
    ),
    check(
      'quotation_deliveries_completion_source_check',
      sql`${table.completionSource} IS NULL OR ${table.completionSource} IN ('provider_receipt', 'operator', 'legacy_provider_ack')`
    ),
  ]
);

export const quotationDeliverySteps = pgTable(
  'quotation_delivery_steps',
  {
    id: uuid('id').primaryKey(),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => quotationDeliveries.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    type: text('type').notNull(),
    payloadSnapshot: jsonb('payload_snapshot').notNull(),
    state: text('state').notNull(),
    providerMessageId: text('provider_message_id').unique(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    reconciliationDeadline: timestamp('reconciliation_deadline', { withTimezone: true }),
    publicError: text('public_error'),
    // Transport failure class of the last attempt. `failed` only ever holds a
    // pre-transport class (`ambiguous` is routed to reconciliation instead), so
    // this is the durable proof that a re-send of the same revision cannot
    // duplicate a message the provider may already have accepted.
    failureKind: text('failure_kind'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('quotation_delivery_steps_delivery_position_unique').on(
      table.deliveryId,
      table.position
    ),
    index('quotation_delivery_steps_due_idx').on(table.state, table.nextAttemptAt),
    check(
      'quotation_delivery_steps_state_check',
      sql`${table.state} IN ('queued', 'sending', 'server_ack', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'read', 'failed')`
    ),
    check(
      'quotation_delivery_steps_failure_kind_check',
      sql`${table.failureKind} IS NULL OR ${table.failureKind} IN ('transient_pre_transport', 'permanent_pre_transport', 'ambiguous')`
    ),
  ]
);

/**
 * Durable result of the latest scheduled delivery worker invocation. One row
 * per worker is overwritten after each success or failure; delivery processing
 * never reads it.
 */
export const quotationDeliveryWorkerRuns = pgTable('quotation_delivery_worker_runs', {
  worker: text('worker').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  processed: integer('processed').notNull(),
  remaining: boolean('remaining').notNull(),
});

/**
 * Durable result of the latest operator-message sweep, recorded apart from the
 * quotation batch in the same tick (RNF-04). Dispatch never reads it.
 */
export const whatsappMessageSweepRuns = pgTable(
  'whatsapp_message_sweep_runs',
  {
    worker: text('worker').primaryKey(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
    result: varchar('result', { length: 16 }).notNull(),
    requeued: integer('requeued').notNull().default(0),
    toReview: integer('to_review').notNull().default(0),
    dispatched: integer('dispatched').notNull().default(0),
  },
  (table) => [
    check('whatsapp_message_sweep_runs_result_check', sql`${table.result} IN ('success', 'failure')`),
  ]
);

/**
 * Durable inbox for Evolution delivery receipts (MESSAGES_UPDATE). A receipt
 * can reach the webhook before `markAccepted` persisted the provider message id
 * on the step; without this inbox the receipt would be dropped. Rows are
 * inserted idempotently per (provider message id, status) and applied later,
 * monotonically, when the id becomes correlated.
 */
export const evolutionReceiptInbox = pgTable(
  'evolution_receipt_inbox',
  {
    id: uuid('id').primaryKey(),
    providerMessageId: text('provider_message_id').notNull(),
    status: text('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('evolution_receipt_inbox_event_unique').on(
      table.providerMessageId,
      table.status
    ),
    index('evolution_receipt_inbox_pending_idx')
      .on(table.providerMessageId)
      .where(sql`${table.appliedAt} IS NULL`),
    index('evolution_receipt_inbox_received_idx').on(table.receivedAt),
    check(
      'evolution_receipt_inbox_status_check',
      sql`${table.status} IN ('ERROR', 'PENDING', 'SERVER_ACK', 'DELIVERY_ACK', 'READ', 'PLAYED')`
    ),
  ]
);

export const quotationEmailDeliveries = pgTable(
  'quotation_email_deliveries',
  {
    id: uuid('id').primaryKey(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'cascade' }),
    recipient: varchar('recipient', { length: 254 }).notNull(),
    publicToken: text('public_token'),
    state: text('state').notNull(),
    providerEmailId: text('provider_email_id').unique(),
    publicError: text('public_error'),
    templateSnapshot: jsonb('template_snapshot').$type<RenderedQuotationEmail>(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'quotation_email_deliveries_state_check',
      sql`${table.state} IN ('pending', 'accepted', 'failed')`
    ),
    check(
      'quotation_email_deliveries_public_token_check',
      sql`(${table.state} = 'pending' AND btrim(${table.publicToken}) <> '') OR (${table.state} IN ('accepted', 'failed') AND ${table.publicToken} IS NULL)`
    ),
    check(
      'quotation_email_deliveries_template_snapshot_check',
      sql`(${table.state} = 'pending' AND ${table.templateSnapshot} IS NOT NULL) OR (${table.state} IN ('accepted', 'failed') AND ${table.templateSnapshot} IS NULL)`,
    ),
    index('quotation_email_deliveries_revision_state_accepted_idx').on(
      table.revisionId,
      table.state,
      table.acceptedAt
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
    // Stable identity of the admitted demand, separate from the contact and
    // from `external_id` (transport/conversation retry association). When two
    // independently supplied demands share a conversation or phone, distinct
    // `demand_id` values keep them apart instead of fusing into one lead.
    demandId: varchar('demand_id', { length: 255 }),
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
    // The explicit demand identity is looked up on every WhatsApp pre-quote
    // retry; the partial index keeps that lookup off a sequential scan.
    index('quote_leads_demand_id_idx')
      .on(table.source, table.demandId)
      .where(sql`${table.demandId} IS NOT NULL`),
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

export type CrmPipelineStageRole = 'new' | 'issued' | 'won' | 'lost';

export const crmPipelineStages = pgTable(
  'crm_pipeline_stages',
  {
    key: varchar('key', { length: 32 }).primaryKey(),
    name: varchar('name', { length: 80 }).notNull(),
    position: integer('position').notNull(),
    role: varchar('role', { length: 16 }).$type<CrmPipelineStageRole>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('crm_pipeline_stages_name_lower_unique').on(sql`lower(${table.name})`),
    uniqueIndex('crm_pipeline_stages_role_unique').on(table.role),
    check('crm_pipeline_stages_key_not_blank_check', sql`char_length(btrim(${table.key})) > 0`),
    check('crm_pipeline_stages_name_not_blank_check', sql`char_length(btrim(${table.name})) > 0`),
    check('crm_pipeline_stages_position_check', sql`${table.position} >= 0`),
    check(
      'crm_pipeline_stages_role_check',
      sql`${table.role} IS NULL OR ${table.role} IN ('new', 'issued', 'won', 'lost')`
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
    status: varchar('status', { length: 32 })
      .notNull()
      .default('Novo Lead')
      .references(() => crmPipelineStages.key),
    followUpStage: integer('follow_up_stage').notNull().default(0),
    nextStep: varchar('next_step', { length: 500 }),
    demandSummary: varchar('demand_summary', { length: 4000 }),
    isUrgent: boolean('is_urgent').notNull().default(false),
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
  ]
);

export const MANUAL_CONTACT_RESULT_CODES = [
  'follow_up_agreed',
  'interested',
  'not_interested',
  'no_response',
  'awaiting_information',
  'wrong_contact',
  'other',
] as const;
export type ManualContactResultCode = (typeof MANUAL_CONTACT_RESULT_CODES)[number];

/**
 * Primary next action of a commercial opportunity. An opportunity keeps at
 * most one active action; terminal rows stay as immutable history so a
 * replaced action is still auditable.
 *
 * `opportunity_id` references the demand it belongs to with `ON DELETE
 * RESTRICT`. Existing flows do remove opportunities (client removal and beta
 * cleanup), so the database blocks the removal while any action row exists
 * instead of cascading the history away or leaving an orphan identifier
 * behind. The application turns that conflict into a Portuguese message and
 * the surrounding transaction rolls back as a whole.
 */
export const opportunityNextActions = pgTable(
  'opportunity_next_actions',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => crmDeals.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    reasonCode: varchar('reason_code', { length: 32 }).notNull(),
    origin: varchar('origin', { length: 16 }).notNull(),
    state: varchar('state', { length: 16 }).notNull().default('active'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    // `due_at` remains the sortable instant and compatibility seam. These
    // fields retain the operator's civil scheduling choice, including a
    // date-only action that must not become overdue during that date.
    dueDate: date('due_date'),
    dueTime: time('due_time'),
    scheduleType: varchar('schedule_type', { length: 16 }).notNull().default('timed'),
    version: integer('version').notNull().default(1),
    actor: varchar('actor', { length: 128 }).notNull().default('legacy-system'),
    reason: varchar('reason', { length: 500 }).notNull().default('legacy action'),
    transitionActor: varchar('transition_actor', { length: 128 }),
    transitionAt: timestamp('transition_at', { withTimezone: true }),
    transitionOrigin: varchar('transition_origin', { length: 16 }),
    transitionReason: varchar('transition_reason', { length: 500 }),
    replacedById: uuid('replaced_by_id'),
    continuityCommandId: varchar('continuity_command_id', { length: 255 }),
    continuityCommandFingerprint: varchar('continuity_command_fingerprint', { length: 64 }),
    continuityType: varchar('continuity_type', { length: 16 }),
    associationClientId: uuid('association_client_id').references(() => clients.id, {
      onDelete: 'restrict',
    }),
    associationPhone: varchar('association_phone', { length: 15 }),
    associationProviderMessageId: varchar('association_provider_message_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('opportunity_next_actions_active_unique')
      .on(table.opportunityId)
      .where(sql`${table.state} = 'active'`),
    index('opportunity_next_actions_state_due_idx').on(table.state, table.dueAt),
    index('opportunity_next_actions_opportunity_idx').on(table.opportunityId),
    check(
      'opportunity_next_actions_kind_check',
      sql`${table.kind} IN ('first_contact', 'internal', 'customer_contact', 'agreed_commitment', 'review')`
    ),
    check(
      'opportunity_next_actions_origin_check',
      sql`${table.origin} IN ('manual', 'automatic', 'event')`
    ),
    check(
      'opportunity_next_actions_state_check',
      sql`${table.state} IN ('active', 'suspended', 'completed', 'cancelled', 'superseded')`
    ),
    check(
      'opportunity_next_actions_reason_not_blank_check',
      sql`char_length(btrim(${table.reasonCode})) > 0`
    ),
    check(
      'opportunity_next_actions_schedule_type_check',
      sql`${table.scheduleType} IN ('date_only', 'timed')`
    ),
    check('opportunity_next_actions_version_check', sql`${table.version} > 0`),
    check(
      'opportunity_next_actions_date_only_check',
      sql`${table.scheduleType} <> 'date_only' OR (${table.dueDate} IS NOT NULL AND ${table.dueTime} IS NULL)`
    ),
    check(
      'opportunity_next_actions_transition_reason_check',
      sql`${table.transitionReason} IS NULL OR char_length(btrim(${table.transitionReason})) > 0`
    ),
    check(
      'opportunity_next_actions_transition_origin_check',
      sql`${table.transitionOrigin} IS NULL OR ${table.transitionOrigin} IN ('manual', 'automatic', 'event')`
    ),
    uniqueIndex('opportunity_next_actions_continuity_command_unique')
      .on(table.continuityCommandId)
      .where(sql`${table.continuityCommandId} IS NOT NULL`),
    check(
      'opportunity_next_actions_continuity_fingerprint_check',
      sql`(${table.continuityCommandId} IS NULL AND ${table.continuityCommandFingerprint} IS NULL AND ${table.continuityType} IS NULL) OR (${table.continuityCommandId} IS NOT NULL AND char_length(btrim(${table.continuityCommandId})) > 0 AND ${table.continuityCommandFingerprint} ~ '^[0-9a-f]{64}$' AND ${table.continuityType} IN ('new_cycle', 'manual_date'))`
    ),
    check(
      'opportunity_next_actions_continuity_type_check',
      sql`${table.continuityType} IS NULL OR ${table.continuityType} IN ('new_cycle', 'manual_date')`
    ),
    check(
      'opportunity_next_actions_association_phone_check',
      sql`${table.associationPhone} IS NULL OR ${table.associationPhone} ~ '^[0-9]{10,15}$'`,
    ),
    check(
      'opportunity_next_actions_association_context_check',
      sql`(${table.associationClientId} IS NULL AND ${table.associationPhone} IS NULL AND ${table.associationProviderMessageId} IS NULL) OR (${table.associationPhone} IS NOT NULL AND char_length(btrim(${table.associationPhone})) > 0 AND ${table.associationProviderMessageId} IS NOT NULL AND char_length(btrim(${table.associationProviderMessageId})) > 0)`,
    ),
  ]
);

/**
 * The first provider-confirmed proposal delivery starts one commercial cycle
 * for an opportunity. Keeping that fact separate from the action preserves
 * the receipt source even when an operator later replaces the action.
 */
export const opportunityDeliveryAnchors = pgTable(
  'opportunity_delivery_anchors',
  {
    opportunityId: uuid('opportunity_id')
      .primaryKey()
      .references(() => crmDeals.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'restrict' }),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'restrict' }),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => quotationDeliveries.id, { onDelete: 'restrict' }),
    receiptAt: timestamp('receipt_at', { withTimezone: true }).notNull(),
    createdActionId: uuid('created_action_id').references(() => opportunityNextActions.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('opportunity_delivery_anchors_delivery_unique').on(table.deliveryId),
    uniqueIndex('opportunity_delivery_anchors_action_unique')
      .on(table.createdActionId)
      .where(sql`${table.createdActionId} IS NOT NULL`),
    index('opportunity_delivery_anchors_quotation_idx').on(table.quotationId),
  ]
);

/**
 * Immutable operator statements about commercial contacts.  This is not a
 * provider event: it records what the operator declared happened and keeps
 * the command key/fingerprint needed to make retries safe.
 */
export const manualContactEvents = pgTable(
  'manual_contact_events',
  {
    id: uuid('id').primaryKey(),
    commandId: varchar('command_id', { length: 255 }).notNull(),
    commandFingerprint: varchar('command_fingerprint', { length: 64 }).notNull(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => crmDeals.id, { onDelete: 'restrict' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => opportunityNextActions.id, { onDelete: 'restrict' }),
    contactType: varchar('contact_type', { length: 32 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    note: text('note'),
    resultCode: varchar('result_code', { length: 32 }).$type<ManualContactResultCode>().notNull(),
    countsAsFollowUp: boolean('counts_as_follow_up').notNull().default(false),
    source: varchar('source', { length: 32 }).notNull().default('operator_statement'),
    actor: varchar('actor', { length: 128 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    continuationType: varchar('continuation_type', { length: 16 }).notNull(),
    successorActionId: uuid('successor_action_id').references(() => opportunityNextActions.id, {
      onDelete: 'restrict',
    }),
    closeReason: varchar('close_reason', { length: 500 }),
    resultVersion: integer('result_version').notNull(),
    closed: boolean('closed').notNull().default(false),
  },
  (table) => [
    uniqueIndex('manual_contact_events_command_id_unique').on(table.commandId),
    index('manual_contact_events_opportunity_created_idx').on(table.opportunityId, table.createdAt),
    index('manual_contact_events_action_idx').on(table.actionId),
    check(
      'manual_contact_events_command_id_not_blank_check',
      sql`char_length(btrim(${table.commandId})) > 0`
    ),
    check(
      'manual_contact_events_command_fingerprint_check',
      sql`${table.commandFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'manual_contact_events_contact_type_check',
      sql`${table.contactType} IN ('phone_call', 'external_conversation')`
    ),
    check(
      'manual_contact_events_result_code_check',
      sql`${table.resultCode} IN ('follow_up_agreed', 'interested', 'not_interested', 'no_response', 'awaiting_information', 'wrong_contact', 'other')`
    ),
    check(
      'manual_contact_events_source_check',
      sql`${table.source} = 'operator_statement'`
    ),
    check(
      'manual_contact_events_continuation_check',
      sql`${table.continuationType} IN ('successor', 'wait', 'close')`
    ),
    check(
      'manual_contact_events_continuation_consistency_check',
      sql`(
        (${table.continuationType} IN ('successor', 'wait') AND ${table.successorActionId} IS NOT NULL AND ${table.closeReason} IS NULL AND ${table.closed} = false)
        OR (${table.continuationType} = 'close' AND ${table.successorActionId} IS NULL AND char_length(btrim(${table.closeReason})) > 0 AND ${table.closed} = true)
      )`
    ),
    check('manual_contact_events_note_length_check', sql`${table.note} IS NULL OR char_length(${table.note}) <= 4000`),
    check('manual_contact_events_result_version_check', sql`${table.resultVersion} > 0`),
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
    dueDateOverride: date('due_date_override'),
    productionStage: varchar('production_stage', { length: 32 }).notNull().default('aguardando entrada'),
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).notNull().defaultNow(),
    productionDays: integer('production_days').notNull().default(20),
    artApprovedDate: date('art_approved_date'),
    entryReceivedDate: date('entry_received_date'),
    entryReceivedAmount: numeric('entry_received_amount', { precision: 20, scale: 2 }),
    balanceReceivedDate: date('balance_received_date'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    undoToken: uuid('undo_token'),
    undoUntil: timestamp('undo_until', { withTimezone: true }),
    undoSnapshot: jsonb('undo_snapshot').$type<Record<string, unknown>>(),
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
    check('sales_orders_production_stage_check', sql`${table.productionStage} IN ('aguardando entrada', 'aguardando arte', 'em produção', 'pronto', 'entregue')`),
    check('sales_orders_production_days_check', sql`${table.productionDays} BETWEEN 1 AND 365`),
    check('sales_orders_entry_amount_check', sql`${table.entryReceivedAmount} IS NULL OR ${table.entryReceivedAmount} BETWEEN 0 AND ${table.grandTotal}`),
  ]
);

export const salesOrderNotes = pgTable('sales_order_notes', {
  id: uuid('id').primaryKey(),
  salesOrderId: uuid('sales_order_id').notNull().references(() => salesOrders.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 16 }).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('sales_order_notes_order_created_idx').on(table.salesOrderId, table.createdAt),
  check('sales_order_notes_kind_check', sql`${table.kind} IN ('note', 'stage')`),
]);

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
    custoUnitario: numeric('custo_unitario', { precision: 14, scale: 2 }),
  },
  (table) => [
    uniqueIndex('sales_order_items_order_position_unique').on(table.salesOrderId, table.position),
    index('sales_order_items_product_idx').on(table.productSku),
    check('sales_order_items_position_check', sql`${table.position} >= 0`),
    check('sales_order_items_quantity_check', sql`${table.quantity} > 0`),
    check('sales_order_items_unit_price_check', sql`${table.unitPrice} >= 0`),
    check('sales_order_items_line_total_check', sql`${table.lineTotal} >= 0`),
    check(
      'sales_order_items_custo_unitario_nonnegative_check',
      sql`${table.custoUnitario} IS NULL OR ${table.custoUnitario} >= 0`
    ),
  ]
);

export const salesOrderOfflineExports = pgTable(
  'sales_order_offline_exports',
  {
    id: uuid('id').primaryKey(),
    salesOrderId: uuid('sales_order_id')
      .notNull()
      .references(() => salesOrders.id, { onDelete: 'restrict' }),
    quoteLeadId: uuid('quote_lead_id')
      .notNull()
      .references(() => quoteLeads.id, { onDelete: 'restrict' }),
    originSource: varchar('origin_source', { length: 80 }).notNull(),
    eventType: varchar('event_type', { length: 32 }).notNull().default('pedido_iniciado'),
    destinationAccountId: varchar('destination_account_id', { length: 64 }).notNull(),
    destinationActionId: varchar('destination_action_id', { length: 64 }).notNull(),
    transactionId: varchar('transaction_id', { length: 255 }).notNull(),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull(),
    conversionValue: numeric('conversion_value', { precision: 20, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('BRL'),
    eventSource: varchar('event_source', { length: 16 }).notNull().default('OTHER'),
    adIdentifierType: varchar('ad_identifier_type', { length: 8 }).notNull(),
    adIdentifier: varchar('ad_identifier', { length: 500 }).notNull(),
    consentEvidence: jsonb('consent_evidence').$type<Record<string, unknown>>().notNull(),
    payloadFingerprint: varchar('payload_fingerprint', { length: 64 }).notNull(),
    state: varchar('state', { length: 32 }).notNull().default('prepared'),
    reviewReason: varchar('review_reason', { length: 64 }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sales_order_offline_exports_identity_unique').on(
      table.salesOrderId,
      table.eventType,
      table.destinationAccountId,
      table.destinationActionId
    ),
    index('sales_order_offline_exports_state_due_idx').on(table.state, table.nextAttemptAt),
    check('sales_order_offline_exports_event_type_check', sql`${table.eventType} = 'pedido_iniciado'`),
    check(
      'sales_order_offline_exports_destination_check',
      sql`char_length(btrim(${table.destinationAccountId})) > 0 AND char_length(btrim(${table.destinationActionId})) > 0`
    ),
    check(
      'sales_order_offline_exports_transaction_id_check',
      sql`${table.transactionId} = 'aspen-pedido-iniciado:' || ${table.salesOrderId}::text`
    ),
    check('sales_order_offline_exports_conversion_value_check', sql`${table.conversionValue} > 0`),
    check('sales_order_offline_exports_currency_check', sql`${table.currency} = 'BRL'`),
    check('sales_order_offline_exports_event_source_check', sql`${table.eventSource} = 'OTHER'`),
    check(
      'sales_order_offline_exports_identifier_type_check',
      sql`${table.adIdentifierType} IN ('gclid', 'wbraid', 'gbraid')`
    ),
    check(
      'sales_order_offline_exports_identifier_check',
      sql`char_length(btrim(${table.adIdentifier})) > 0`
    ),
    check(
      'sales_order_offline_exports_consent_check',
      sql`jsonb_typeof(${table.consentEvidence}) = 'object'`
    ),
    check(
      'sales_order_offline_exports_fingerprint_check',
      sql`${table.payloadFingerprint} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'sales_order_offline_exports_state_check',
      sql`${table.state} IN ('prepared', 'sending', 'accepted_pending_diagnostic', 'processed', 'failed', 'needs_review')`
    ),
    check(
      'sales_order_offline_exports_review_reason_check',
      sql`(
        (${table.state} = 'needs_review' AND ${table.reviewReason} IS NOT NULL AND ${table.reviewReason} IN (
          'consent_review_required', 'result_unknown', 'diagnostic_partial_success',
          'lease_expired_after_transport', 'cancellation_after_attempt',
          'correction_after_attempt', 'substitution_after_attempt'
        ))
        OR (${table.state} <> 'needs_review' AND ${table.reviewReason} IS NULL)
      )`
    ),
    check(
      'sales_order_offline_exports_lease_check',
      sql`(${table.leaseToken} IS NULL AND ${table.leaseUntil} IS NULL) OR (${table.leaseToken} IS NOT NULL AND ${table.leaseUntil} IS NOT NULL)`
    ),
  ]
);

export const salesOrderOfflineExportAttempts = pgTable(
  'sales_order_offline_export_attempts',
  {
    id: uuid('id').primaryKey(),
    exportId: uuid('export_id')
      .notNull()
      .references(() => salesOrderOfflineExports.id, { onDelete: 'restrict' }),
    attemptNo: integer('attempt_no').notNull(),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    attemptState: varchar('attempt_state', { length: 24 }).notNull().default('started'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    requestId: varchar('request_id', { length: 255 }),
    httpStatus: integer('http_status'),
    errorCode: varchar('error_code', { length: 128 }),
    errorDetail: varchar('error_detail', { length: 1000 }),
    fieldWarnings: jsonb('field_warnings').$type<unknown[]>(),
    diagnosticStatus: varchar('diagnostic_status', { length: 24 }),
    diagnosticCheckedAt: timestamp('diagnostic_checked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('sales_order_offline_export_attempts_identity_unique').on(
      table.exportId,
      table.attemptNo
    ),
    index('sales_order_offline_export_attempts_request_idx')
      .on(table.requestId)
      .where(sql`${table.requestId} IS NOT NULL`),
    check('sales_order_offline_export_attempts_no_check', sql`${table.attemptNo} > 0`),
    check(
      'sales_order_offline_export_attempts_state_check',
      sql`${table.attemptState} IN ('started', 'accepted', 'failed', 'unknown')`
    ),
    check(
      'sales_order_offline_export_attempts_finished_check',
      sql`(${table.attemptState} = 'started' AND ${table.finishedAt} IS NULL) OR (${table.attemptState} <> 'started' AND ${table.finishedAt} IS NOT NULL)`
    ),
    check(
      'sales_order_offline_export_attempts_http_status_check',
      sql`${table.httpStatus} IS NULL OR ${table.httpStatus} BETWEEN 100 AND 599`
    ),
    check(
      'sales_order_offline_export_attempts_warnings_check',
      sql`${table.fieldWarnings} IS NULL OR jsonb_typeof(${table.fieldWarnings}) = 'array'`
    ),
    check(
      'sales_order_offline_export_attempts_diagnostic_check',
      sql`${table.diagnosticStatus} IS NULL OR ${table.diagnosticStatus} IN ('processing', 'success', 'partial_success', 'failure')`
    ),
    check(
      'sales_order_offline_export_attempts_diagnostic_pair_check',
      sql`(${table.diagnosticStatus} IS NULL AND ${table.diagnosticCheckedAt} IS NULL) OR (${table.diagnosticStatus} IS NOT NULL AND ${table.diagnosticCheckedAt} IS NOT NULL)`
    ),
  ]
);

export const adSpendMonths = pgTable(
  'ad_spend_months',
  {
    yearMonth: varchar('year_month', { length: 7 }).primaryKey(),
    metaSpend: numeric('meta_spend', { precision: 14, scale: 2 }).notNull().default('0.00'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'ad_spend_months_year_month_check',
      sql`${table.yearMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`
    ),
    check('ad_spend_months_meta_spend_check', sql`${table.metaSpend} >= 0`),
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

export const WHATSAPP_IDENTITY_STATUSES = [
  'verified',
  'derived',
  'unresolved',
  'conflict',
] as const;

export const FOLLOW_UP_STATES = [
  'approved',
  'processing',
  'sent',
  'cancelled',
  'dismissed',
  'needs_review',
  'failed',
] as const;

export const FOLLOW_UP_CLOSED_REASONS = [
  'already_handled',
  'do_not_contact',
  'no_continuity',
  'wrong_contact',
  'other',
  'before_tracking_start',
  'newer_delivery_in_flight',
  'delivery_incomplete',
  'missing_provider_receipt',
  'quotation_not_issued',
  'crm_not_eligible',
  'client_archived',
  'identity_unresolved',
  'contact_blocked',
  'inbound_after_anchor',
  'outbound_after_anchor',
  'already_attempted',
  'provider_rejected',
  'rate_limited',
  'transport_ambiguous',
  'lease_expired_after_transport',
] as const;

export const WHATSAPP_CONTACT_BLOCK_REASONS = ['do_not_contact'] as const;
export const FOLLOW_UP_INGESTION_BLOCK_REASONS = ['unparsed_upsert'] as const;

/**
 * One row per Evolution conversation. Stores monotonic inbound/outbound
 * watermarks and optional contact blocks. Message bodies are never persisted.
 */
export const whatsappClientLinks = pgTable('whatsapp_client_links', {
  accountId: varchar('account_id', { length: 64 }).notNull(),
  conversationId: varchar('conversation_id', { length: 64 }).notNull(),
  clientId: uuid('client_id').notNull().references(() => clients.id, { onDelete: 'cascade' }),
  version: uuid('version').notNull(),
  observedPhone: varchar('observed_phone', { length: 15 }),
  clientPhone: varchar('client_phone', { length: 15 }),
  source: varchar('source', { length: 32 }).notNull().default('operator'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.accountId, table.conversationId] }),
  index('whatsapp_client_links_client_idx').on(table.clientId),
]);

export const whatsappContactActivity = pgTable(
  'whatsapp_contact_activity',
  {
    id: uuid('id').primaryKey(),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastInboundProviderMessageId: varchar('last_inbound_provider_message_id', { length: 255 }),
    lastOutboundAt: timestamp('last_outbound_at', { withTimezone: true }),
    lastOutboundProviderMessageId: varchar('last_outbound_provider_message_id', { length: 255 }),
    canonicalPhone: varchar('canonical_phone', { length: 15 }),
    identityStatus: varchar('identity_status', { length: 16 }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockReason: varchar('block_reason', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex('whatsapp_contact_activity_instance_conversation_unique').on(
      table.instance,
      table.providerConversationId
    ),
    index('whatsapp_contact_activity_instance_phone_idx').on(
      table.instance,
      table.canonicalPhone
    ),
    check(
      'whatsapp_contact_activity_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`
    ),
    check(
      'whatsapp_contact_activity_conversation_not_blank_check',
      sql`char_length(btrim(${table.providerConversationId})) > 0`
    ),
    check(
      'whatsapp_contact_activity_identity_status_check',
      sql`${table.identityStatus} IS NULL OR ${table.identityStatus} IN ('verified', 'derived', 'unresolved', 'conflict')`
    ),
    check(
      'whatsapp_contact_activity_block_reason_check',
      sql`(${table.blockedAt} IS NULL AND ${table.blockReason} IS NULL) OR (${table.blockedAt} IS NOT NULL AND ${table.blockReason} IN ('do_not_contact'))`
    ),
  ]
);

export const commercialInboundEvents = pgTable(
  'commercial_inbound_events',
  {
    id: uuid('id').primaryKey(),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 255 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }),
    canonicalPhone: varchar('canonical_phone', { length: 15 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('commercial_inbound_events_provider_message_unique').on(
      table.instance,
      table.providerMessageId,
    ),
    check(
      'commercial_inbound_events_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`,
    ),
    check(
      'commercial_inbound_events_message_not_blank_check',
      sql`char_length(btrim(${table.providerMessageId})) > 0`,
    ),
    check(
      'commercial_inbound_events_conversation_not_blank_check',
      sql`${table.providerConversationId} IS NULL OR char_length(btrim(${table.providerConversationId})) > 0`,
    ),
    check(
      'commercial_inbound_events_phone_check',
      sql`${table.canonicalPhone} IS NULL OR ${table.canonicalPhone} ~ '^[0-9]{10,15}$'`,
    ),
  ],
);

/**
 * Per-instance ingestion watermark. An unparsed recognized UPSERT blocks the
 * instance until that same event key parses fully.
 */
export const whatsappContactBlockEvents = pgTable(
  'whatsapp_contact_block_events',
  {
    id: uuid('id').primaryKey(),
    instance: varchar('instance', { length: 120 }).notNull(),
    canonicalPhone: varchar('canonical_phone', { length: 15 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }),
    eventType: varchar('event_type', { length: 16 }).notNull(),
    actor: varchar('actor', { length: 120 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('whatsapp_contact_block_events_phone_occurred_idx').on(
      table.instance,
      table.canonicalPhone,
      table.occurredAt,
    ),
    check(
      'whatsapp_contact_block_events_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`,
    ),
    check(
      'whatsapp_contact_block_events_phone_check',
      sql`${table.canonicalPhone} ~ '^[0-9]{10,15}$'`,
    ),
    check(
      'whatsapp_contact_block_events_event_type_check',
      sql`${table.eventType} IN ('blocked', 'unblocked')`,
    ),
    check(
      'whatsapp_contact_block_events_actor_not_blank_check',
      sql`char_length(btrim(${table.actor})) > 0`,
    ),
    check(
      'whatsapp_contact_block_events_reason_not_blank_check',
      sql`char_length(btrim(${table.reason})) > 0`,
    ),
  ],
);

export const whatsappFollowUpIngestionHealth = pgTable(
  'whatsapp_follow_up_ingestion_health',
  {
    instance: varchar('instance', { length: 120 }).primaryKey(),
    lastUpsertAt: timestamp('last_upsert_at', { withTimezone: true }),
    lastUpsertEventKey: varchar('last_upsert_event_key', { length: 255 }),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    blockReason: varchar('block_reason', { length: 32 }),
    blockedEventKey: varchar('blocked_event_key', { length: 255 }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'whatsapp_follow_up_ingestion_health_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`
    ),
    check(
      'whatsapp_follow_up_ingestion_health_block_check',
      sql`(
        ${table.blockedAt} IS NULL
        AND ${table.blockReason} IS NULL
        AND ${table.blockedEventKey} IS NULL
      ) OR (
        ${table.blockedAt} IS NOT NULL
        AND ${table.blockReason} IN ('unparsed_upsert')
        AND char_length(btrim(${table.blockedEventKey})) > 0
      )`
    ),
  ]
);

/**
 * One durable current follow-up attempt per quotation. Completed attempts are
 * copied to quotationFollowUpAttemptHistory before this row is reused for the
 * next attempt or cycle.
 */
export const quotationFollowUps = pgTable(
  'quotation_follow_ups',
  {
    id: uuid('id').primaryKey(),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => quotationDeliveries.id),
    cycleNumber: integer('cycle_number').notNull().default(1),
    attemptNumber: integer('attempt_number').notNull().default(1),
    sourceActionId: uuid('source_action_id').references(() => opportunityNextActions.id, {
      onDelete: 'restrict',
    }),
    approvedOpportunityId: uuid('approved_opportunity_id').references(() => crmDeals.id, {
      onDelete: 'restrict',
    }),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    canonicalPhone: varchar('canonical_phone', { length: 15 }).notNull(),
    eligibilityVersion: varchar('eligibility_version', { length: 64 }),
    messageSnapshot: varchar('message_snapshot', { length: 4000 }),
    state: varchar('state', { length: 20 }).notNull(),
    closedReason: varchar('closed_reason', { length: 64 }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    transportStartedAt: timestamp('transport_started_at', { withTimezone: true }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    firstProviderReceiptAt: timestamp('first_provider_receipt_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    // This unique index is the rollout seam used by the previous app's
    // `ON CONFLICT (quotation_id)` statements. Keep it for the entire expand
    // release while history lives in a separate table.
    uniqueIndex('quotation_follow_ups_quotation_id_unique').on(table.quotationId),
    uniqueIndex('quotation_follow_ups_provider_message_id_unique')
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    uniqueIndex('quotation_follow_ups_approved_opportunity_unique')
      .on(table.approvedOpportunityId)
      .where(
        sql`${table.approvedOpportunityId} IS NOT NULL AND ${table.state} IN ('approved', 'processing')`
      ),
    index('quotation_follow_ups_state_due_idx').on(table.state, table.dueAt),
    index('quotation_follow_ups_source_action_idx').on(table.sourceActionId),
    check('quotation_follow_ups_cycle_number_check', sql`${table.cycleNumber} > 0`),
    check(
      'quotation_follow_ups_attempt_number_check',
      sql`${table.attemptNumber} IN (1, 2)`,
    ),
    check(
      'quotation_follow_ups_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`
    ),
    check(
      'quotation_follow_ups_conversation_not_blank_check',
      sql`char_length(btrim(${table.providerConversationId})) > 0`
    ),
    check(
      'quotation_follow_ups_phone_not_blank_check',
      sql`(
        ${table.canonicalPhone} ~ '^[0-9]{10,15}$'
        OR (
          char_length(btrim(${table.canonicalPhone})) = 0
          AND lower(right(btrim(${table.providerConversationId}), 4)) = '@lid'
        )
      )`
    ),
    check(
      'quotation_follow_ups_eligibility_version_check',
      sql`${table.eligibilityVersion} IS NULL OR ${table.eligibilityVersion} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      'quotation_follow_ups_message_not_blank_check',
      sql`${table.messageSnapshot} IS NULL OR char_length(btrim(${table.messageSnapshot})) > 0`
    ),
    check(
      'quotation_follow_ups_state_check',
      sql`${table.state} IN ('awaiting_receipt', 'waiting', 'ready', 'held', 'approved', 'processing', 'sent', 'cancelled', 'dismissed', 'needs_review', 'failed')`
    ),
    check(
      'quotation_follow_ups_closed_reason_check',
      sql`${table.closedReason} IS NULL OR ${table.closedReason} IN (
        'already_handled',
        'do_not_contact',
        'no_continuity',
        'wrong_contact',
        'other',
        'before_tracking_start',
        'newer_delivery_in_flight',
        'delivery_incomplete',
        'missing_provider_receipt',
        'quotation_not_issued',
        'crm_not_eligible',
        'client_archived',
        'identity_unresolved',
        'contact_blocked',
        'inbound_after_anchor',
        'outbound_after_anchor',
        'already_attempted',
        'provider_rejected',
        'rate_limited',
        'transport_ambiguous',
        'lease_expired_after_transport',
        'instance_changed'
      )`
    ),
    check(
      'quotation_follow_ups_closed_consistency_check',
      sql`(
        ${table.state} IN ('awaiting_receipt', 'waiting', 'ready', 'held')
        AND ${table.closedReason} IS NULL
        AND ${table.closedAt} IS NULL
      ) OR (
        ${table.state} IN ('approved', 'processing')
        AND ${table.closedReason} IS NULL
        AND ${table.closedAt} IS NULL
      ) OR (
        ${table.state} IN ('sent', 'cancelled', 'dismissed', 'needs_review', 'failed')
        AND ${table.closedAt} IS NOT NULL
        AND (
          ${table.state} = 'sent'
          OR ${table.closedReason} IS NOT NULL
        )
      )`
    ),
  ]
);

/**
 * Immutable commercial audit of a confirmed follow-up attempt. The current
 * queue row is deliberately not referenced with a foreign key: it is reused
 * for the next attempt, while this record must survive that reuse. The
 * opportunity/cycle/attempt identity is the durable idempotency boundary.
 */
export const quotationFollowUpAttemptHistory = pgTable(
  'quotation_follow_up_attempt_history',
  {
    id: uuid('id').primaryKey(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => crmDeals.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'restrict' }),
    followUpId: uuid('follow_up_id').notNull(),
    cycleNumber: integer('cycle_number').notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    revisionId: uuid('revision_id')
      .notNull()
      .references(() => quoteRevisions.id, { onDelete: 'restrict' }),
    deliveryId: uuid('delivery_id')
      .notNull()
      .references(() => quotationDeliveries.id, { onDelete: 'restrict' }),
    sourceActionId: uuid('source_action_id').references(() => opportunityNextActions.id, {
      onDelete: 'restrict',
    }),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    canonicalPhone: varchar('canonical_phone', { length: 15 }).notNull(),
    eligibilityVersion: varchar('eligibility_version', { length: 64 }),
    messageSnapshot: varchar('message_snapshot', { length: 4000 }),
    state: varchar('state', { length: 20 }).notNull(),
    closedReason: varchar('closed_reason', { length: 64 }),
    leaseToken: uuid('lease_token'),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    transportStartedAt: timestamp('transport_started_at', { withTimezone: true }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    firstProviderReceiptAt: timestamp('first_provider_receipt_at', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    confirmationSource: varchar('confirmation_source', { length: 16 }).notNull(),
    confirmationCommandId: varchar('confirmation_command_id', { length: 255 }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotation_follow_up_attempt_history_opportunity_cycle_attempt_unique').on(
      table.opportunityId,
      table.cycleNumber,
      table.attemptNumber,
    ),
    uniqueIndex('quotation_follow_up_attempt_history_provider_message_unique')
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    index('quotation_follow_up_attempt_history_quotation_idx').on(
      table.quotationId,
      table.confirmedAt,
    ),
    check(
      'quotation_follow_up_attempt_history_cycle_number_check',
      sql`${table.cycleNumber} > 0`,
    ),
    check(
      'quotation_follow_up_attempt_history_attempt_number_check',
      sql`${table.attemptNumber} IN (1, 2)`,
    ),
    check(
      'quotation_follow_up_attempt_history_confirmation_source_check',
      sql`${table.confirmationSource} IN ('worker', 'manual')`,
    ),
    check(
      'quotation_follow_up_attempt_history_state_check',
      sql`${table.state} IN ('sent', 'manual')`,
    ),
    check(
      'quotation_follow_up_attempt_history_provider_message_check',
      sql`(${table.confirmationSource} = 'worker' AND char_length(btrim(${table.providerMessageId})) > 0) OR (${table.confirmationSource} = 'manual' AND ${table.providerMessageId} IS NULL)`,
    ),
  ],
);


/**
 * Attendance history (M1a). PostgreSQL is the source of truth for WhatsApp
 * conversations; `revision` is a per-conversation monotonic counter bumped
 * under the conversation row lock, so incremental reads never skip a commit.
 */
export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey(),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    canonicalPhone: varchar('canonical_phone', { length: 15 }),
    identityStatus: varchar('identity_status', { length: 16 }).notNull(),
    identitySource: varchar('identity_source', { length: 40 }),
    identityConfidence: varchar('identity_confidence', { length: 8 }),
    identityVersion: integer('identity_version').notNull().default(1),
    displayName: varchar('display_name', { length: 255 }),
    status: varchar('status', { length: 24 }).notNull().default('open'),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    readRevision: bigint('read_revision', { mode: 'number' }).notNull().default(0),
    unreadCount: integer('unread_count').notNull().default(0),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    lastMessagePreview: varchar('last_message_preview', { length: 280 }),
    lastMessageDirection: varchar('last_message_direction', { length: 8 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('whatsapp_conversations_provider_unique').on(
      table.instance,
      table.providerConversationId,
    ),
    index('whatsapp_conversations_activity_idx').on(
      sql`${table.lastMessageAt} DESC NULLS LAST`,
      sql`${table.id} DESC`,
    ),
    check(
      'whatsapp_conversations_instance_not_blank_check',
      sql`char_length(btrim(${table.instance})) > 0`,
    ),
    check(
      'whatsapp_conversations_provider_not_blank_check',
      sql`char_length(btrim(${table.providerConversationId})) > 0`,
    ),
    check(
      'whatsapp_conversations_phone_check',
      sql`${table.canonicalPhone} IS NULL OR ${table.canonicalPhone} ~ '^[0-9]{10,15}$'`,
    ),
    check(
      'whatsapp_conversations_identity_status_check',
      sql`${table.identityStatus} IN ('verified', 'derived', 'unresolved', 'conflict')`,
    ),
    check(
      'whatsapp_conversations_identity_confidence_check',
      sql`${table.identityConfidence} IS NULL OR ${table.identityConfidence} IN ('high', 'medium', 'low')`,
    ),
    check('whatsapp_conversations_identity_version_check', sql`${table.identityVersion} > 0`),
    check(
      'whatsapp_conversations_status_check',
      sql`${table.status} IN ('open', 'waiting_customer', 'closed', 'ignored')`,
    ),
    check(
      'whatsapp_conversations_revision_check',
      sql`${table.revision} >= 0 AND ${table.readRevision} >= 0 AND ${table.readRevision} <= ${table.revision}`,
    ),
    check('whatsapp_conversations_unread_check', sql`${table.unreadCount} >= 0`),
    check(
      'whatsapp_conversations_direction_check',
      sql`${table.lastMessageDirection} IS NULL OR ${table.lastMessageDirection} IN ('inbound', 'outbound')`,
    ),
  ],
);

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: 'restrict' }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    direction: varchar('direction', { length: 8 }).notNull(),
    messageType: varchar('message_type', { length: 16 }).notNull(),
    body: text('body'),
    origin: varchar('origin', { length: 16 }).notNull(),
    providerTimestamp: timestamp('provider_timestamp', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    createdRevision: bigint('created_revision', { mode: 'number' }).notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    deliveryStatus: varchar('delivery_status', { length: 16 }),
    /** Set on an echo row merged into the operator message it duplicated. */
    supersededBy: uuid('superseded_by'),
  },
  (table) => [
    uniqueIndex('whatsapp_messages_provider_unique').on(
      table.conversationId,
      table.providerMessageId,
    ),
    index('whatsapp_messages_timeline_idx').on(
      table.conversationId,
      sql`${table.providerTimestamp} DESC`,
      sql`${table.id} DESC`,
    ),
    index('whatsapp_messages_revision_idx').on(table.conversationId, table.revision),
    index('whatsapp_messages_provider_lookup_idx')
      .on(table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    check(
      'whatsapp_messages_delivery_status_check',
      sql`${table.deliveryStatus} IS NULL OR ${table.deliveryStatus} IN ('server_ack', 'delivered', 'read', 'error')`,
    ),
    check(
      'whatsapp_messages_provider_not_blank_check',
      sql`${table.providerMessageId} IS NULL OR char_length(btrim(${table.providerMessageId})) > 0`,
    ),
    check('whatsapp_messages_direction_check', sql`${table.direction} IN ('inbound', 'outbound')`),
    check(
      'whatsapp_messages_type_check',
      sql`${table.messageType} IN ('text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contact', 'unsupported')`,
    ),
    check(
      'whatsapp_messages_origin_check',
      sql`${table.origin} IN ('live', 'backfill', 'operator', 'quotation')`,
    ),
    check(
      'whatsapp_messages_body_length_check',
      sql`${table.body} IS NULL OR char_length(${table.body}) <= 65536`,
    ),
    check(
      'whatsapp_messages_revision_check',
      sql`${table.createdRevision} > 0 AND ${table.revision} >= ${table.createdRevision}`,
    ),
  ],
);


/**
 * Durable pending effects of one received message (contact activity and
 * follow-up projection). A row stays pending until both effects are applied,
 * so a failed webhook or a later worker tick can resume without repeating the
 * message itself.
 */
export const whatsappWebhookEffects = pgTable(
  'whatsapp_webhook_effects',
  {
    id: uuid('id').primaryKey(),
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    providerMessageId: varchar('provider_message_id', { length: 255 }).notNull(),
    fromMe: boolean('from_me').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    identityStatus: varchar('identity_status', { length: 16 }).notNull(),
    canonicalPhone: varchar('canonical_phone', { length: 15 }),
    activityDoneAt: timestamp('activity_done_at', { withTimezone: true }),
    followUpDoneAt: timestamp('follow_up_done_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastFailure: varchar('last_failure', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('whatsapp_webhook_effects_message_unique').on(
      table.instance,
      table.providerConversationId,
      table.providerMessageId,
    ),
    index('whatsapp_webhook_effects_pending_idx')
      .on(table.nextAttemptAt, table.occurredAt)
      .where(sql`${table.activityDoneAt} IS NULL OR ${table.followUpDoneAt} IS NULL`),
    check(
      'whatsapp_webhook_effects_identity_status_check',
      sql`${table.identityStatus} IN ('verified', 'derived', 'unresolved', 'conflict')`,
    ),
    check(
      'whatsapp_webhook_effects_phone_check',
      sql`${table.canonicalPhone} IS NULL OR ${table.canonicalPhone} ~ '^[0-9]{10,15}$'`,
    ),
    check('whatsapp_webhook_effects_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'whatsapp_webhook_effects_failure_check',
      sql`${table.lastFailure} IS NULL OR ${table.lastFailure} IN ('activity_failed', 'follow_up_failed')`,
    ),
  ],
);


/**
 * Resumable backfill of the attendance history from the Evolution instance,
 * one row per provider conversation. `gap` declares that the provider did not
 * return the complete history; nothing is fabricated to fill it.
 */
export const whatsappBackfillProgress = pgTable(
  'whatsapp_backfill_progress',
  {
    instance: varchar('instance', { length: 120 }).notNull(),
    providerConversationId: varchar('provider_conversation_id', { length: 255 }).notNull(),
    state: varchar('state', { length: 16 }).notNull().default('pending'),
    nextPage: integer('next_page').notNull().default(1),
    pagesTotal: integer('pages_total'),
    messagesSeen: integer('messages_seen').notNull().default(0),
    messagesInserted: integer('messages_inserted').notNull().default(0),
    gapReason: varchar('gap_reason', { length: 32 }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'whatsapp_backfill_progress_pkey',
      columns: [table.instance, table.providerConversationId],
    }),
    index('whatsapp_backfill_progress_state_idx').on(table.instance, table.state),
    check(
      'whatsapp_backfill_progress_state_check',
      sql`${table.state} IN ('pending', 'done', 'gap')`,
    ),
    check(
      'whatsapp_backfill_progress_counts_check',
      sql`${table.nextPage} > 0 AND ${table.messagesSeen} >= 0 AND ${table.messagesInserted} >= 0 AND (${table.pagesTotal} IS NULL OR ${table.pagesTotal} > 0)`,
    ),
    check(
      'whatsapp_backfill_progress_gap_check',
      sql`(${table.state} = 'gap') = (${table.gapReason} IS NOT NULL)`,
    ),
  ],
);


/**
 * Operator replies (M1b). The intent is committed before any transport; the
 * lease plus `transport_started_at` decide whether a stuck send may be retried
 * (never started) or must go to review (possibly sent).
 */
export const whatsappMessageAttachments = pgTable(
  'whatsapp_message_attachments',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id').notNull().references(() => whatsappConversations.id, { onDelete: 'restrict' }),
    messageId: uuid('message_id').references(() => whatsappMessages.id, { onDelete: 'restrict' }),
    mediaType: varchar('media_type', { length: 16 }).notNull(),
    mimeType: varchar('mime_type', { length: 64 }).notNull(),
    fileName: varchar('file_name', { length: 128 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    contentBase64: text('content_base64').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('whatsapp_message_attachments_conversation_idx').on(table.conversationId),
    uniqueIndex('whatsapp_message_attachments_message_unique').on(table.messageId),
    check('whatsapp_message_attachments_type_check', sql`${table.mediaType} IN ('image', 'document')`),
    check('whatsapp_message_attachments_size_check', sql`${table.sizeBytes} > 0 AND ${table.sizeBytes} <= 3145728`),
  ],
);

export const whatsappMessageOutbox = pgTable(
  'whatsapp_message_outbox',
  {
    id: uuid('id').primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => whatsappMessages.id, { onDelete: 'restrict' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: 'restrict' }),
    clientRequestId: uuid('client_request_id').notNull(),
    attachmentId: uuid('attachment_id').references(() => whatsappMessageAttachments.id, { onDelete: 'restrict' }),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    destinationPhone: varchar('destination_phone', { length: 15 }).notNull(),
    identityVersion: integer('identity_version').notNull(),
    body: text('body').notNull(),
    state: varchar('state', { length: 24 }).notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    transportStartedAt: timestamp('transport_started_at', { withTimezone: true }),
    providerMessageId: varchar('provider_message_id', { length: 255 }),
    failureCode: varchar('failure_code', { length: 64 }),
    resolution: varchar('resolution', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('whatsapp_message_outbox_request_unique').on(table.clientRequestId),
    uniqueIndex('whatsapp_message_outbox_message_unique').on(table.messageId),
    index('whatsapp_message_outbox_due_idx').on(table.state, table.nextAttemptAt),
    check(
      'whatsapp_message_outbox_state_check',
      sql`${table.state} IN ('queued', 'dispatching', 'provider_accepted', 'retry_scheduled', 'failed', 'needs_review', 'cancelled')`,
    ),
    check('whatsapp_message_outbox_phone_check', sql`${table.destinationPhone} ~ '^[0-9]{10,15}$'`),
    check(
      'whatsapp_message_outbox_body_check',
      sql`char_length(btrim(${table.body})) > 0 AND char_length(${table.body}) <= 4000`,
    ),
    check('whatsapp_message_outbox_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'whatsapp_message_outbox_lease_check',
      sql`(${table.state} = 'dispatching') = (${table.leaseToken} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`,
    ),
    check(
      'whatsapp_message_outbox_resolution_check',
      sql`${table.resolution} IS NULL OR ${table.resolution} IN ('confirmed_sent', 'confirmed_not_sent')`,
    ),
  ],
);


// Singular aliases make repository/tests that speak in domain terms concise
// without changing the SQL table names used by migrations.
export const quoteSequence = quoteSequences;
export const quotation = quotations;
export const quoteRevision = quoteRevisions;
export const quoteRevisionItem = quoteRevisionItems;
