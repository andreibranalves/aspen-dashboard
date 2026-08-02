import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

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
    pagamento: varchar('pagamento', { length: 500 }).notNull().default(''),
    entrega: varchar('entrega', { length: 500 }).notNull().default(''),
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
export const products = pgTable(
  'products',
  {
    sku: varchar('sku', { length: 120 }).primaryKey(),
    nome: varchar('nome', { length: 255 }).notNull(),
    descricao: varchar('descricao', { length: 4000 }).notNull().default(''),
    unidade: varchar('unidade', { length: 32 }).notNull().default('Und'),
    categoria: varchar('categoria', { length: 255 }),
    marca: varchar('marca', { length: 255 }),
    ativo: boolean('ativo').notNull().default(true),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp('atualizado_em', { withTimezone: true })
      .notNull()
      .defaultNow(),
    arquivadoEm: timestamp('arquivado_em', { withTimezone: true }),
  },
  (table) => [
    check(
      'products_sku_trimmed_check',
      sql`char_length(btrim(${table.sku})) > 0 AND btrim(${table.sku}) = ${table.sku}`
    ),
    check('products_nome_not_blank_check', sql`char_length(btrim(${table.nome})) > 0`),
    check('products_unidade_not_blank_check', sql`char_length(btrim(${table.unidade})) > 0`),
  ]
);

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
      sql`${table.documento} IS NULL OR char_length(${table.documento}) IN (11, 14)`,
    ),
    check(
      'clients_telefone_digits_check',
      sql`${table.telefone} IS NULL OR ${table.telefone} ~ '^[0-9]{10,15}$'`,
    ),
    check(
      'clients_email_lowercase_check',
      sql`${table.email} IS NULL OR ${table.email} = lower(${table.email})`,
    ),
    check(
      'clients_uf_uppercase_check',
      sql`${table.uf} IS NULL OR ${table.uf} = upper(${table.uf})`,
    ),
    check(
      'clients_cep_digits_check',
      sql`${table.cep} IS NULL OR ${table.cep} ~ '^[0-9]{8}$'`,
    ),
  ],
);
