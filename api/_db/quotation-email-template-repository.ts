import { eq } from 'drizzle-orm';

import {
  DEFAULT_QUOTATION_EMAIL_TEMPLATE,
  validateQuotationEmailTemplate,
  type QuotationEmailTemplate,
} from '../_lib/quotation-email-template.js';
import { getDatabase, type AppDatabase } from './client.js';
import { appSettings } from './schema.js';

export interface QuotationEmailTemplateRepository {
  get(): Promise<QuotationEmailTemplate>;
  save(template: QuotationEmailTemplate): Promise<QuotationEmailTemplate>;
}

type DatabaseProvider = () => AppDatabase;

function normalized(value: unknown): QuotationEmailTemplate {
  const result = validateQuotationEmailTemplate(value);
  if (!result.ok) throw new Error('Modelo de e-mail armazenado inválido.');
  return result.value;
}

export function createPostgresQuotationEmailTemplateRepository(
  getDb: DatabaseProvider = getDatabase,
): QuotationEmailTemplateRepository {
  return {
    async get() {
      const [row] = await getDb()
        .select({ template: appSettings.quotationEmailTemplate })
        .from(appSettings)
        .where(eq(appSettings.singletonId, 1))
        .limit(1);
      return row ? normalized(row.template) : { ...DEFAULT_QUOTATION_EMAIL_TEMPLATE };
    },
    async save(template) {
      const value = normalized(template);
      const [row] = await getDb()
        .insert(appSettings)
        .values({ singletonId: 1, quotationEmailTemplate: value })
        .onConflictDoUpdate({
          target: appSettings.singletonId,
          set: { quotationEmailTemplate: value },
        })
        .returning({ template: appSettings.quotationEmailTemplate });
      if (!row) throw new Error('Modelo de e-mail não foi salvo.');
      return normalized(row.template);
    },
  };
}
