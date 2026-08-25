#!/usr/bin/env node

import postgres from 'postgres';

import { isDisposablePostgresUrl } from './test-postgres.mjs';

const VERIFICATION_CLIENT_ID = 'f3000000-0000-4000-8000-000000000001';
const VERIFICATION_QUOTATION_ID = 'f3000000-0000-4000-8000-000000000002';
const VERIFICATION_REVISION_ID = 'f3000000-0000-4000-8000-000000000003';
const VERIFICATION_BUSINESS_NUMBER = 'ORC-20990101';
const VERIFICATION_COMPANY_CONFIGURATION = {
  schema_version: 1,
  identity: {
    legal_name: 'CI Fixture LTDA',
    document: '12.345.678/0001-95',
  },
  banking: {
    bank_name: 'Banco CI',
    bank_code: '001',
    branch: '0001',
    account: '1-1',
    pix_key: 'ci-fixture@example.test',
  },
  contacts: {
    website: 'https://ci-fixture.example.test',
    phone: '(11) 99999-0000',
    email: 'ci-fixture@example.test',
    instagram: 'https://instagram.com/ci-fixture',
  },
};

export async function seedQuotationCompanyVerification(databaseUrl) {
  if (!isDisposablePostgresUrl(databaseUrl)) {
    throw new Error('O fixture exige um PostgreSQL local descartável.');
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO clients (id, nome)
        VALUES (${VERIFICATION_CLIENT_ID}::uuid, ${'CI fixture'})
        ON CONFLICT (id) DO NOTHING
      `;
      await tx`
        INSERT INTO quotations (id, business_number, client_id)
        VALUES (
          ${VERIFICATION_QUOTATION_ID}::uuid,
          ${VERIFICATION_BUSINESS_NUMBER},
          ${VERIFICATION_CLIENT_ID}::uuid
        )
        ON CONFLICT (id) DO NOTHING
      `;
      await tx`
        INSERT INTO app_settings (singleton_id, company_configuration)
        VALUES (1, ${JSON.stringify(VERIFICATION_COMPANY_CONFIGURATION)}::jsonb)
        ON CONFLICT (singleton_id) DO NOTHING
      `;
      await tx`
        INSERT INTO quote_revisions (
          id,
          quotation_id,
          version,
          validade_dias,
          company_snapshot,
          cliente_nome
        ) VALUES (
          ${VERIFICATION_REVISION_ID}::uuid,
          ${VERIFICATION_QUOTATION_ID}::uuid,
          1,
          15,
          ${JSON.stringify(VERIFICATION_COMPANY_CONFIGURATION)}::jsonb,
          ${'CI fixture'}
        )
        ON CONFLICT (id) DO NOTHING
      `;
    });

    const [counts] = await sql`
      SELECT
        (SELECT count(*)::integer FROM quote_revisions WHERE id = ${VERIFICATION_REVISION_ID}::uuid) AS revisions,
        (SELECT count(*)::integer FROM app_settings WHERE singleton_id = 1) AS settings
    `;
    const revisionCount = Number(counts?.revisions || 0);
    const settingsCount = Number(counts?.settings || 0);
    if (revisionCount < 1 || settingsCount < 1) {
      throw new Error('Fixture descartável de verificação não foi persistido.');
    }
    return { revisions: revisionCount, settings: settingsCount };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    process.stderr.write('TEST_DATABASE_URL é obrigatória para criar o fixture local.\n');
    process.exitCode = 2;
  } else {
    seedQuotationCompanyVerification(databaseUrl)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(() => {
        process.stderr.write('Falha ao criar o fixture local de verificação empresarial.\n');
        process.exitCode = 1;
      });
  }
}
