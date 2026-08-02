import { eq } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from './client.js';
import { appSettings } from './schema.js';

export interface Settings {
  validade_dias: number;
  pagamento: string;
  entrega: string;
  frete_padrao: string;
  observacoes: string;
  template_padrao: string;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
});

/**
 * Application seam used by the HTTP handler. It intentionally does not leak
 * Drizzle types, making handler tests independent from database mechanics.
 */
export interface SettingsRepository {
  get(): Promise<Settings | null>;
  save(settings: Settings): Promise<Settings>;
}

type DatabaseProvider = () => AppDatabase;

function toSettings(row: typeof appSettings.$inferSelect): Settings {
  return {
    validade_dias: row.validadeDias,
    pagamento: row.pagamento,
    entrega: row.entrega,
    frete_padrao: row.fretePadrao,
    observacoes: row.observacoes,
    template_padrao: row.templatePadrao,
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

    async save(settings: Settings): Promise<Settings> {
      const db = getDb();
      const [row] = await db
        .insert(appSettings)
        .values({
          singletonId: 1,
          validadeDias: settings.validade_dias,
          pagamento: settings.pagamento,
          entrega: settings.entrega,
          fretePadrao: settings.frete_padrao,
          observacoes: settings.observacoes,
          templatePadrao: settings.template_padrao,
        })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: {
            validadeDias: settings.validade_dias,
            pagamento: settings.pagamento,
            entrega: settings.entrega,
            fretePadrao: settings.frete_padrao,
            observacoes: settings.observacoes,
            templatePadrao: settings.template_padrao,
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
