import { eq } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { appSettings } from '../schema.js';
import {
  DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  normalizeQuotationCompanyConfiguration,
  type QuotationCompanyConfiguration,
} from '../../../_modules/quotation-company.js';
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
  empresa: QuotationCompanyConfiguration;
  settings_version: number;
}

export type SettingsInput = Omit<
  Settings,
  'template_padrao' | 'entrega' | 'empresa' | 'settings_version'
> & {
  entrega?: string;
  template_padrao?: string;
  empresa?: QuotationCompanyConfiguration;
  settings_version?: number;
};

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  secoes: DEFAULT_QUOTATION_SECTIONS,
  empresa: DEFAULT_QUOTATION_COMPANY_CONFIGURATION,
  settings_version: 1,
});

export class SettingsConflictError extends Error {
  readonly statusCode = 409;
  readonly expose = true;

  constructor(
    message = 'As configurações foram alteradas por outro usuário. Recarregue antes de salvar.'
  ) {
    super(message);
    this.name = 'SettingsConflictError';
  }
}

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
  const secoes = normalizeQuotationSections(row.quotationSections);
  const empresa = normalizeQuotationCompanyConfiguration(row.companyConfiguration);
  return {
    validade_dias: row.validadeDias,
    pagamento: secoes.pagamento.body,
    entrega: row.entrega,
    frete_padrao: row.fretePadrao,
    observacoes: secoes.condicoes_gerais.body,
    template_padrao: row.templatePadrao,
    secoes,
    empresa,
    settings_version: row.settingsVersion,
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
      return db.transaction(async (tx) => {
        const [claimedInitialRow] = await tx
          .insert(appSettings)
          .values({ singletonId: 1 })
          .onConflictDoNothing({ target: appSettings.singletonId })
          .returning({ singletonId: appSettings.singletonId });
        const [current] = await tx
          .select()
          .from(appSettings)
          .where(eq(appSettings.singletonId, 1))
          .for('update')
          .limit(1);
        const isInitialRow = Boolean(claimedInitialRow);
        const currentForMerge = isInitialRow ? undefined : current;
        const requestedVersion = settings.settings_version;
        if (
          requestedVersion !== undefined &&
          (!Number.isInteger(requestedVersion) || requestedVersion < 1)
        ) {
          throw new SettingsConflictError(
            'Versão das configurações inválida. Recarregue antes de salvar.'
          );
        }
        if (currentForMerge && settings.empresa !== undefined && requestedVersion === undefined) {
          throw new SettingsConflictError(
            'Informe a versão das configurações antes de atualizar os dados empresariais.'
          );
        }
        if (
          currentForMerge &&
          requestedVersion !== undefined &&
          requestedVersion !== currentForMerge.settingsVersion
        ) {
          throw new SettingsConflictError();
        }
        if (isInitialRow && requestedVersion !== undefined && requestedVersion !== 1) {
          throw new SettingsConflictError();
        }

        const secoes = settings.secoes;
        const empresa = normalizeQuotationCompanyConfiguration(
          settings.empresa,
          currentForMerge?.companyConfiguration
            ? normalizeQuotationCompanyConfiguration(currentForMerge.companyConfiguration)
            : DEFAULT_QUOTATION_COMPANY_CONFIGURATION
        );
        const settingsVersion = isInitialRow ? 2 : (currentForMerge?.settingsVersion || 0) + 1;
        const [row] = await tx
          .insert(appSettings)
          .values({
            singletonId: 1,
            validadeDias: settings.validade_dias,
            entrega: settings.entrega ?? currentForMerge?.entrega ?? '',
            fretePadrao: settings.frete_padrao,
            quotationSections: secoes,
            companyConfiguration: empresa,
            templatePadrao: settings.template_padrao ?? currentForMerge?.templatePadrao ?? 'padrao',
            settingsVersion,
          })
          .onConflictDoUpdate({
            target: appSettings.singletonId,
            set: {
              validadeDias: settings.validade_dias,
              entrega: settings.entrega ?? currentForMerge?.entrega ?? '',
              fretePadrao: settings.frete_padrao,
              quotationSections: secoes,
              companyConfiguration: empresa,
              settingsVersion,
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
      });
    },
  };
}
