import { eq } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { appSettings } from '../schema.js';
import {
  DEFAULT_QUOTATION_SECTIONS,
  normalizeQuotationSections,
  type QuotationSectionsSettings,
} from '../../../_modules/quotation-content.js';

export interface Settings {
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  observacoes: string;
  template_padrao: string;
  secoes: QuotationSectionsSettings;
}

export type SettingsInput = Omit<Settings, 'template_padrao' | 'entrega'> & {
  entrega?: string;
  template_padrao?: string;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  secoes: DEFAULT_QUOTATION_SECTIONS,
});

/**
 * Application seam used by the HTTP handler. It intentionally does not leak
 * Drizzle types, making handler tests independent from database mechanics.
 */
export interface SettingsRepository {
  get(): Promise<Settings | null>;
  save(settings: SettingsInput): Promise<Settings>;
}

type DatabaseProvider = () => AppDatabase;

function toSettings(row: typeof appSettings.$inferSelect): Settings {
  const secoes = normalizeQuotationSections(row.quotationSections, row);
  return {
    validade_dias: row.validadeDias,
    pagamento: secoes.pagamento.body,
    entrega: row.entrega,
    frete_padrao: row.fretePadrao,
    observacoes: secoes.condicoes_gerais.body,
    template_padrao: row.templatePadrao,
    secoes,
  };
}

/**
 * PostgreSQL implementation of SettingsRepository. The provider is evaluated
 * only when a request uses the repository, which keeps module import safe in
 * test and build environments that intentionally have no DATABASE_URL.
 */
export function createPostgresSettingsRepository(
  getDb: DatabaseProvider = getDatabase
): SettingsRepository {
  return {
    async get(): Promise<Settings | null> {
      const db = getDb();
      const [row] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);

      return row ? toSettings(row) : null;
    },

    async save(settings: SettingsInput): Promise<Settings> {
      const db = getDb();
      const [current] = await db
        .select()
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);
      const secoes = settings.secoes;
      const [row] = await db
        .insert(appSettings)
        .values({
          singletonId: 1,
          validadeDias: settings.validade_dias,
          pagamento: secoes.pagamento.body,
          entrega: settings.entrega ?? current?.entrega ?? '',
          fretePadrao: settings.frete_padrao,
          observacoes: secoes.condicoes_gerais.body,
          quotationSections: secoes,
          templatePadrao: settings.template_padrao ?? current?.templatePadrao ?? 'padrao',
        })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: {
            validadeDias: settings.validade_dias,
            pagamento: secoes.pagamento.body,
            entrega: settings.entrega ?? current?.entrega ?? '',
            fretePadrao: settings.frete_padrao,
            observacoes: secoes.condicoes_gerais.body,
            quotationSections: secoes,
            ...(settings.template_padrao === undefined
              ? {}
              : { templatePadrao: settings.template_padrao }),
          },
        })
        .returning();

      if (!row) {
        throw new Error('Não foi possível salvar as configurações.');
      }

      return toSettings(row);
    },
  };
}
