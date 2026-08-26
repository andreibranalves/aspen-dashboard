import { randomUUID } from 'node:crypto';

import { quotationTemplateVersions, quotationTemplates } from '../../api/_infrastructure/db/schema.js';
import type { QuotationSectionsSnapshot } from '../../api/_modules/quotation-content.js';

/** Canonical sections snapshot for fixtures that seed revisions directly.
 * Sections are enabled with empty bodies — the same defaults a real save
 * persists when nothing was customized. */
export function fixtureSectionsSnapshot(
  overrides: {
    prazo_producao?: { value?: string; enabled?: boolean };
    pagamento?: { body?: string; enabled?: boolean };
    condicoes_gerais?: { body?: string; enabled?: boolean };
  } = {}
): QuotationSectionsSnapshot {
  const prazo = {
    enabled: overrides.prazo_producao?.enabled ?? true,
    title: 'Prazo de produção',
    value: overrides.prazo_producao?.value ?? '',
  };
  const pagamento = {
    enabled: overrides.pagamento?.enabled ?? true,
    title: 'Pagamento',
    body: overrides.pagamento?.body ?? '',
  };
  const condicoes = {
    enabled: overrides.condicoes_gerais?.enabled ?? true,
    title: 'Condições Gerais',
    body: overrides.condicoes_gerais?.body ?? '',
  };
  return {
    schema_version: 1,
    prazo_producao: { base: { ...prazo }, current: { ...prazo } },
    pagamento: { base: { ...pagamento }, current: { ...pagamento } },
    condicoes_gerais: { base: { ...condicoes }, current: { ...condicoes } },
  };
}

export const FIXTURE_TEMPLATE_HASH = 'f'.repeat(64);

export interface FixtureRevisionFields {
  templatePadrao: string;
  templateHash: string;
  templateVersionId: string;
  sectionsSnapshot: QuotationSectionsSnapshot;
}

/** Idempotently create one template + version pair and return the fields
 * quote_revisions requires after the legacy cutover (#79). Spread the result
 * into every revision insert in the fixture. */
export async function ensureFixtureTemplateVersion(db: {
  insert: (table: unknown) => { values: (v: unknown) => Promise<unknown[]> };
}): Promise<FixtureRevisionFields> {
  const key = `fixture-${randomUUID().slice(0, 8)}`;
  let model: any[] | undefined;
  [model] = await db
    .insert(quotationTemplates)
    .values({ id: randomUUID(), key, name: 'Fixture', archived: false })
    .returning();
  const [version] = await db
    .insert(quotationTemplateVersions)
    .values({
      id: randomUUID(),
      templateId: model.id,
      version: 1,
      source: '<html></html>',
      sourceHash: FIXTURE_TEMPLATE_HASH,
      contractVersion: 2,
    })
    .returning();
  return {
    templatePadrao: key,
    templateHash: FIXTURE_TEMPLATE_HASH,
    templateVersionId: version.id,
    sectionsSnapshot: fixtureSectionsSnapshot(),
  };
}
