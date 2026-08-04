#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import postgres from 'postgres';

function fail(error) {
  const message = error instanceof Error ? error.message : '';
  const safeMessage = /^(Versão de template ausente|Revisões incompletas|Verificação pós-commit)/.test(message)
    ? message
    : 'Falha na migração de templates. Consulte os logs operacionais.';
  const kind = error instanceof Error ? error.name : typeof error;
  console.error(`[quotation-template-migration] failed (${kind})`);
  process.stderr.write(`${safeMessage}\n`);
  process.exitCode = 2;
}

async function migrate(databaseUrl) {
  const migration = await import('../api/_db/quotation-template-migration.js');
  const { acquireQuotationWriteLock } = await import('../api/_db/quotation-write-lock.js');
  const client = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 10, idle_timeout: 20 });
  const run = async (sql) => {
    await acquireQuotationWriteLock(sql);
    const plan = migration.templateSeedPlan();
    let models = 0;
    let versions = 0;
    for (const item of plan) {
      const id = `00000000-0000-4000-8000-${item.source_hash.slice(0, 12)}`;
      const rows = await sql`
        insert into quotation_templates (id, key, name, archived)
        values (${id}::uuid, ${item.key}, ${item.name}, false)
        on conflict (key) do update set name = excluded.name, archived = false, updated_at = now()
        returning id
      `;
      models += rows.length;
      const versionRows = await sql`
        insert into quotation_template_versions (id, template_id, version, source, source_hash)
        select ${id}::uuid, ${rows[0].id}::uuid, ${item.version}, ${item.source}, ${item.source_hash}
        where not exists (
          select 1 from quotation_template_versions
          where template_id = ${rows[0].id}::uuid and source_hash = ${item.source_hash}
        )
        returning id
      `;
      versions += versionRows.length;
    }

    const [settings] = await sql`select * from app_settings where singleton_id = 1`;
    if (settings) {
      const sections = migration.legacySettingsSections(settings);
      const existing = typeof settings.quotation_sections === 'string'
        ? JSON.parse(settings.quotation_sections)
        : settings.quotation_sections;
      const shouldSeedLegacySections = migration.isEmptyQuotationSections(existing);
      if (shouldSeedLegacySections) {
        await sql`update app_settings set quotation_sections = ${JSON.stringify(sections)}::jsonb where singleton_id = 1`;
      }
    }

    const revisions = await sql`select id, template_padrao, template_hash, pagamento, entrega, observacoes, prazo_producao, template_version_id, sections_snapshot from quote_revisions`;
    const alreadyComplete = revisions.filter((row) => row.template_version_id && row.sections_snapshot).length;
    const versionIds = await sql`select v.id, t.key, v.source_hash from quotation_template_versions v join quotation_templates t on t.id = v.template_id`;
    const versionsByKeyHash = new Map(versionIds.map((row) => [`${row.key}:${row.source_hash}`, row.id]));
    for (const revision of revisions) {
      const versionId = versionsByKeyHash.get(`${revision.template_padrao}:${revision.template_hash}`);
      if (!versionId) {
        throw new Error(`Versão de template ausente: chave ${revision.template_padrao}, hash ${revision.template_hash}.`);
      }
      const snapshot = revision.sections_snapshot || migration.snapshotFromLegacyRevision(revision);
      await sql`update quote_revisions set template_version_id = ${versionId}::uuid, sections_snapshot = ${JSON.stringify(snapshot)}::jsonb where id = ${revision.id}::uuid`;
    }
    const missing = await sql`select template_padrao, template_hash from quote_revisions where template_version_id is null or sections_snapshot is null`;
    if (missing.length) throw new Error(`Revisões incompletas: ${missing.map((row) => `${row.template_padrao}:${row.template_hash}`).join(', ')}`);
    const [configured] = await sql`select template_padrao from app_settings where singleton_id = 1`;
    const active = new Set(plan.map((item) => item.key));
    const defaultRepaired = Boolean(configured && !active.has(configured.template_padrao));
    if (defaultRepaired) await sql`update app_settings set template_padrao = 'padrao' where singleton_id = 1`;
    return { models, versions, revisions_backfilled: revisions.length - alreadyComplete, already_complete: alreadyComplete, default_repaired: defaultRepaired, missing_versions: 0, missing_snapshots: 0 };
  };
  try {
    const report = await client.begin(run);
    await client.begin(async (sql) => {
      await acquireQuotationWriteLock(sql);
      const [row] = await sql`select count(*)::int as count from quote_revisions where template_version_id is null or sections_snapshot is null`;
      if (row.count !== 0) throw new Error(`Verificação pós-commit encontrou ${row.count} revisão(ões) incompleta(s).`);
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  if (!process.env.DATABASE_URL) fail(new Error('DATABASE_URL é obrigatória para migrate:quotation-templates.'));
  else await migrate(process.env.DATABASE_URL).catch(fail);
}

export { migrate };
