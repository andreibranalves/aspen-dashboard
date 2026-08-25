#!/usr/bin/env node
// Cutover verification (#79): runs every committed migration plus the
// destructive consolidation 0026 against a DISPOSABLE loopback PostgreSQL
// container, then proves semantic equivalence of the consolidated snapshots.
//
// Safety rails: the script refuses any URL whose host is not loopback or whose
// database name does not look like a disposable test database. Personal data
// never reaches stdout — seeds are synthetic and output prints only counts,
// booleans and digests.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import postgres from 'postgres';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIZZLE_DIR = path.join(PROJECT_ROOT, 'drizzle');
const BREAKPOINT = /-->\s*statement-breakpoint/;
const MIGRATION_UNDER_TEST = '0026_quotation_legacy_cutover.sql';

function fail(message) {
  process.stderr.write(`FAIL ${message}\n`);
  process.exitCode = 1;
}

function assertDatabaseIsDisposable(rawUrl) {
  const url = new URL(rawUrl);
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  const looksDisposable = /test|ephemeral|tmp/i.test(url.pathname);
  if (!loopback || !looksDisposable) {
    throw new Error('A verificação exige um PostgreSQL descartável em loopback (ex.: container de teste).');
  }
}

function migrationFiles() {
  return readdirSync(DRIZZLE_DIR)
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
}

function statementsOf(fileName) {
  return readFileSync(path.join(DRIZZLE_DIR, fileName), 'utf8')
    .split(BREAKPOINT)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function digest(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/** Key-order-independent comparison: jsonb does not preserve object key order. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Legacy mirror -> canonical sections mapping, identical to the removed
 * `snapshotFromLegacyRevision` adapter. Used only to compute the expected
 * pre-consolidation projection for the equivalence check. */
export function legacyMirrorToSectionsSnapshot(revision) {
  const text = (value) => (value == null ? '' : String(value));
  const deadline = text(revision.prazo_producao ?? revision.prazoProducao);
  const parts = [];
  if (text(revision.entrega)) parts.push(`Prazo de entrega:\n${text(revision.entrega)}`);
  if (text(revision.observacoes)) parts.push(`Observações:\n${text(revision.observacoes)}`);
  const condicoesBody = parts.join('\n\n');
  const prazoSection = { enabled: Boolean(deadline), title: 'Prazo de produção', value: deadline };
  const pagamentoSection = { enabled: true, title: 'Pagamento', body: text(revision.pagamento) };
  const condicoesSection = { enabled: true, title: 'Condições Gerais', body: condicoesBody };
  return {
    schema_version: 1,
    prazo_producao: { base: structuredClone(prazoSection), current: structuredClone(prazoSection) },
    pagamento: { base: structuredClone(pagamentoSection), current: structuredClone(pagamentoSection) },
    condicoes_gerais: { base: structuredClone(condicoesSection), current: structuredClone(condicoesSection) },
  };
}

const SEEDS = [
  // Full legacy payload: entrega + observações combinadas, prazo visível.
  { pagamento: 'Pix em até 2x', entrega: '10 dias úteis', observacoes: 'Arte aprovada pelo cliente.', prazo_producao: '15 dias' },
  // Empty mirrors: defaults everywhere, prazo hidden.
  { pagamento: '', entrega: '', observacoes: '', prazo_producao: '' },
  // Only entrega present.
  { pagamento: '', entrega: '5 dias', observacoes: '', prazo_producao: '' },
];

// Synthetic v2 contract template used only by this verification; renders every
// canonical section behind its enabled flag so fragments prove visibility.
const VERIFY_TEMPLATE_SOURCE = `<!doctype html><html><body><p>{{client.name}}</p>{{display.total}}<p>{{quote_number}}</p>{{#each items}}<span>{{name}}</span>{{/each}}
{{#if secoes.prazo_producao.enabled}}<section id="prazo">{{secoes.prazo_producao.title}}:{{secoes.prazo_producao.value}}</section>{{/if}}
{{#if secoes.pagamento.enabled}}<section id="pagamento">{{secoes.pagamento.title}}:{{secoes.pagamento.body_html}}</section>{{/if}}
{{#if secoes.condicoes_gerais.enabled}}<section id="condicoes">{{secoes.condicoes_gerais.title}}:{{secoes.condicoes_gerais.body_html}}</section>{{/if}}
</body></html>`;

async function main() {
  const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('TEST_DATABASE_URL é obrigatória.');
  assertDatabaseIsDisposable(databaseUrl);

  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => {},
  });

  try {
    // Start from a clean disposable database so every committed migration runs.
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await sql.unsafe('CREATE SCHEMA public');

    const files = migrationFiles();
    for (const file of files.filter((name) => name !== MIGRATION_UNDER_TEST)) {
      await sql.begin(async (tx) => {
        for (const statement of statementsOf(file)) await tx.unsafe(statement);
      });
    }
    process.stdout.write(`migrations aplicadas até 0025: ${files.length - 1} arquivos\n`);

    // Seed synthetic legacy-shaped data (no personal data involved).
    const clientId = '00000000-0000-4000-8000-00000000c001';
    const templateId = '00000000-0000-4000-8000-00000000c002';
    const versionId = '00000000-0000-4000-8000-00000000c003';
    const verifyHash = createHash('sha256').update(VERIFY_TEMPLATE_SOURCE).digest('hex');

    await sql`
      INSERT INTO clients (id, nome, arquivado, created_at, updated_at, archived_at)
      VALUES (${clientId}, 'Cliente Sintetico Cutover', false, now(), now(), null)
    `;
    await sql`
      INSERT INTO quotation_templates (id, "key", name, archived)
      VALUES (${templateId}, 'cutover-verify', 'Cutover Verify', false)
      ON CONFLICT ("key") DO NOTHING
    `;
    const [templateRow] = await sql`SELECT id FROM quotation_templates WHERE "key" = 'cutover-verify'`;
    const [existingVersion] = await sql`
      SELECT id FROM quotation_template_versions
      WHERE template_id = ${templateRow.id} AND source_hash = ${verifyHash}
      LIMIT 1
    `;
    const resolvedVersionId = existingVersion?.id ?? versionId;
    if (!existingVersion) {
      const [{ maxVersion }] = await sql`
        SELECT COALESCE(MAX(version), 0) AS "maxVersion" FROM quotation_template_versions WHERE template_id = ${templateRow.id}
      `;
      await sql`
        INSERT INTO quotation_template_versions (id, template_id, version, source, source_hash, contract_version)
        VALUES (${resolvedVersionId}, ${templateRow.id}, ${maxVersion + 1}, ${VERIFY_TEMPLATE_SOURCE}, ${verifyHash}, 2)
      `;
    }
    for (const [index, seed] of SEEDS.entries()) {
      const quotationNumber = `ORC-2026${String(index + 1).padStart(4, '0')}`;
      const [quotation] = await sql`
        INSERT INTO quotations (id, business_number, client_id, status)
        VALUES (gen_random_uuid(), ${quotationNumber}, ${clientId}, 'emitido')
        RETURNING id
      `;
      await sql`
        INSERT INTO quote_revisions (
          id, quotation_id, version, status, validade_dias,
          pagamento, entrega, observacoes, prazo_producao,
          template_padrao, template_hash,
          company_snapshot, cliente_nome, frete_padrao, frete, subtotal, total
        ) VALUES (
          gen_random_uuid(), ${quotation.id}, 1, 'emitido', 15,
          ${seed.pagamento}, ${seed.entrega}, ${seed.observacoes}, ${seed.prazo_producao},
          'cutover-verify', ${verifyHash},
          '{"schema_version":1}'::jsonb, 'Cliente Sintetico Cutover', 0, 0, 0, 0
        )
      `;
    }

    // Pre-consolidation projection: what readers used to derive from mirrors.
    const legacyRows = await sql`
      SELECT pagamento, entrega, observacoes, prazo_producao FROM quote_revisions ORDER BY created_at
    `;
    const expectedSnapshots = legacyRows.map(legacyMirrorToSectionsSnapshot);

    // Apply the destructive consolidation under test.
    for (const statement of statementsOf(MIGRATION_UNDER_TEST)) {
      await sql.unsafe(statement);
    }
    process.stdout.write(`migration destrutiva ${MIGRATION_UNDER_TEST} executada\n`);

    // Equivalence: stored canonical snapshots must match the legacy projection.
    const consolidated = await sql`
      SELECT sections_snapshot FROM quote_revisions ORDER BY created_at
    `;
    let equivalents = 0;
    for (const [index, row] of consolidated.entries()) {
      const expected = expectedSnapshots[index];
      const received = row.sections_snapshot;
      if (digest(expected) !== digest({
        schema_version: received.schema_version,
        prazo_producao: received.prazo_producao,
        pagamento: received.pagamento,
        condicoes_gerais: received.condicoes_gerais,
      })) {
        // Field-level comparison keeps the error actionable without printing data.
        throw new Error(
          `Revisão consolidada divergente na semente ${index}: ` +
            JSON.stringify({
              prazoIgual: digest(expected.prazo_producao) === digest(received.prazo_producao),
              pagamentoIgual: digest(expected.pagamento) === digest(received.pagamento),
              condicoesIguais: digest(expected.condicoes_gerais) === digest(received.condicoes_gerais),
            })
        );
      }
      equivalents += 1;
    }

    // Every revision must have resolved its persisted template version.
    const unresolvedTemplates = await sql`
      SELECT count(*)::integer AS total FROM quote_revisions WHERE template_version_id IS NULL
    `;
    if ((unresolvedTemplates[0]?.total ?? 1) !== 0) throw new Error('template_version_id não resolvido.');
    const matchedVersions = await sql`
      SELECT count(*)::integer AS total
      FROM quote_revisions r
      JOIN quotation_template_versions v ON v.id = r.template_version_id
     WHERE v.source_hash = r.template_hash
    `;
    if ((matchedVersions[0]?.total ?? 0) !== SEEDS.length) {
      throw new Error('Versão resolvida não corresponde ao par chave/hash original.');
    }

    // Obsolete indexes/constraints over dropped columns: none may remain.
    const danglingReferences = await sql`
      SELECT count(*)::int AS total
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      LEFT JOIN pg_index i ON i.indrelid = c.oid AND a.attnum = ANY(i.indkey::int2[])
      WHERE c.relname IN ('quote_revisions', 'app_settings')
        AND a.attname IN ('pagamento', 'observacoes', 'prazo_producao', 'quotation_email_template')
        AND i.indexrelid IS NOT NULL
    `;
    if ((danglingReferences[0]?.total ?? 1) !== 0) throw new Error('Índice óbvio remanescente sobre coluna removida.');

    // Render smoke through the canonical document seam (post-consolidation).
    const { renderQuotationDocument } = await import(
      pathToFileURL(path.join(PROJECT_ROOT, 'api/_modules/quotation-document.js')).href
    );
    const { quotationTemplateFromVersion } = await import(
      pathToFileURL(path.join(PROJECT_ROOT, 'api/_modules/quotation-template-catalog.js')).href
    );
    const templateVersionRow = (await sql`
      SELECT v.id, v.version, v.source, v.source_hash AS "sourceHash", v.contract_version AS "contractVersion",
             t."key" || '' AS key, t.name FROM quotation_template_versions v
      JOIN quotation_templates t ON t.id = v.template_id WHERE v.id = ${resolvedVersionId}
    `)[0];
    const template = quotationTemplateFromVersion({ ...templateVersionRow, template: { key: 'cutover-verify', name: 'Cutover Verify' } });
    const revisionRows = await sql`SELECT * FROM quote_revisions ORDER BY created_at`;
    for (const [index, rawRevision] of revisionRows.entries()) {
      // Map the raw row into the Drizzle-shaped revision the seam consumes.
      const revision = {
        ...rawRevision,
        createdAt: rawRevision.created_at,
        validadeDias: rawRevision.validade_dias,
      };
      const html = renderQuotationDocument(
        {
          quotation: {
            id: revision.quotation_id,
            businessNumber: 'ORC-SYNTHETIC',
            clientId,
            status: 'emitido',
            createdAt: revision.createdAt,
            updatedAt: revision.createdAt,
          },
          revision,
          templateVersion: { ...templateVersionRow, template: { key: 'cutover-verify', name: 'Cutover Verify', archived: false } },
          sectionsSnapshot: revision.sections_snapshot,
          companySnapshot: revision.company_snapshot,
          items: [],
        },
        template
      ).html;
      const expectation = [
        { visible: true, fragment: 'Pagamento' },
        {
          visible: Boolean(SEEDS[index].prazo_producao),
          fragment: 'Prazo de produção',
        },
      ];
      for (const item of expectation) {
        if (item.visible !== html.includes(item.fragment)) {
          throw new Error(`Render pós-consolidação divergente na semente ${index}.`);
        }
      }
    }

    process.stdout.write(
      JSON.stringify({
        seeds: SEEDS.length,
        equivalentSnapshots: equivalents,
        templateVersionsResolved: matchedVersions[0]?.total ?? 0,
        obsoleteIndexesOverDroppedColumns: 0,
        rendersVerified: revisionRows.length,
      }) + '\n'
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    if (error instanceof Error && process.env.VERIFY_DEBUG) process.stderr.write(`${error.stack}\n`);
    fail(error instanceof Error ? error.message : String(error));
  });
}
