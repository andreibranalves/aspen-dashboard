import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
    status: varchar('status', { length: 32 }).notNull().default('rascunho'),
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
      sql`${table.status} IN ('rascunho', 'enviado', 'aprovado', 'perdido')`
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
    status: varchar('status', { length: 32 }).notNull().default('rascunho'),
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
      'quote_revisions_status_check',
      sql`${table.status} IN ('rascunho', 'enviado', 'aprovado', 'perdido')`
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

/** Per-run tracking for Frappe CRM migrations.  Every apply creates one row;
 * dry-run manifests are computed in-memory only.
 */
export const frappeMigrationRuns = pgTable(
  'frappe_migration_runs',
  {
    id: uuid('id').primaryKey(),
    provider: varchar('provider', { length: 80 }).notNull().default('frappe'),
    mode: varchar('mode', { length: 20 }).notNull(),
    sourceSnapshotAt: timestamp('source_snapshot_at', { withTimezone: true }).notNull(),
    manifestHash: varchar('manifest_hash', { length: 64 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check('frappe_migration_runs_mode_check', sql`${table.mode} IN ('dry-run', 'apply')`),
    check(
      'frappe_migration_runs_status_check',
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`
    ),
    check(
      'frappe_migration_runs_manifest_hash_check',
      sql`${table.manifestHash} ~ '^[0-9a-f]{64}$'`
    ),
  ]
);

/** Per-entity-type batch progress within a migration run.  Each entity group
 * (produtos, faixas, clientes, orcamentos, documentos) gets one batch row
 * that tracks processing status, checkpoint count and attempt count for
 * resume-after-failure.
 */
export const frappeMigrationBatches = pgTable(
  'frappe_migration_batches',
  {
    id: uuid('id').primaryKey(),
    runId: uuid('run_id')
      .notNull()
      .references(() => frappeMigrationRuns.id, { onDelete: 'cascade' }),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    checkpoint: integer('checkpoint').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('frappe_migration_batches_run_entity_unique').on(
      table.runId,
      table.entityType
    ),
    check(
      'frappe_migration_batches_entity_type_check',
      sql`${table.entityType} IN ('produtos', 'faixas', 'clientes', 'orcamentos', 'documentos')`
    ),
    check(
      'frappe_migration_batches_status_check',
      sql`${table.status} IN ('pending', 'running', 'completed', 'failed')`
    ),
  ]
);

/** Immutable-ish lineage for records imported from Frappe.  A source document
 * is unique regardless of the entity it currently maps to, which lets a Lead
 * and a Customer retain their independent ERP identifiers while sharing one
 * local client key.  The raw payload is intentionally kept as JSONB for
 * audit/replay; canonicalHash is the only value used for idempotency checks.
 */
export const frappeImportLineage = pgTable(
  'frappe_import_lineage',
  {
    sourceDoctype: varchar('source_doctype', { length: 80 }).notNull(),
    sourceId: varchar('source_id', { length: 255 }).notNull(),
    entityType: varchar('entity_type', { length: 32 }).notNull(),
    localKey: varchar('local_key', { length: 255 }).notNull(),
    canonicalHash: varchar('canonical_hash', { length: 64 }).notNull(),
    /** Raw Frappe document for audit/replay.  Intentionally JSONB; must
     * NEVER be serialized in reports, manifests, logs or API responses.
     * Retention policy: keep for the lifetime of the lineage row; purge
     * when lineage is archived. */
    legacyPayload: jsonb('legacy_payload').$type<Record<string, unknown>>().notNull(),
    /** FK to the migration run that created/updated this lineage entry. */
    migrationRunId: uuid('migration_run_id').references(
      () => frappeMigrationRuns.id
    ),
    /** Last-modified timestamp reported by the Frappe source document. */
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    /** When this lineage entry was first written or last updated locally. */
    importedAt: timestamp('imported_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.sourceDoctype, table.sourceId],
      name: 'frappe_import_lineage_pkey',
    }),
    index('frappe_import_lineage_local_key_idx').on(table.localKey),
    index('frappe_import_lineage_entity_local_idx').on(table.entityType, table.localKey),
    index('frappe_import_lineage_hash_idx').on(table.canonicalHash),
    index('frappe_import_lineage_run_idx').on(table.migrationRunId),
    check(
      'frappe_import_lineage_source_doctype_check',
      sql`char_length(btrim(${table.sourceDoctype})) > 0`
    ),
    check('frappe_import_lineage_source_id_check', sql`char_length(btrim(${table.sourceId})) > 0`),
    check(
      'frappe_import_lineage_entity_type_check',
      sql`${table.entityType} IN ('produto', 'faixa', 'cliente', 'orcamento')`
    ),
    check('frappe_import_lineage_local_key_check', sql`char_length(btrim(${table.localKey})) > 0`),
    check('frappe_import_lineage_hash_check', sql`${table.canonicalHash} ~ '^[0-9a-f]{64}$'`),
  ]
);

// Singular aliases make repository/tests that speak in domain terms concise
// without changing the SQL table names used by migrations.
export const quoteSequence = quoteSequences;
export const quotation = quotations;
export const quoteRevision = quoteRevisions;
export const quoteRevisionItem = quoteRevisionItems;
export const frappeLineage = frappeImportLineage;
export const frappeMigrationRun = frappeMigrationRuns;
export const frappeMigrationBatch = frappeMigrationBatches;
