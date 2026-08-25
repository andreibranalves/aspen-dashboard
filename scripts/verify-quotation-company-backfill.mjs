#!/usr/bin/env node

import postgres from 'postgres';
import {
  assertQuotationCompanyBackfill,
  verifyQuotationCompanyBackfill as verifyRows,
} from '../api/_modules/quotation-company.js';

export async function verifyQuotationCompanyBackfill(
  databaseUrl,
  { requirePositive = false } = {}
) {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  try {
    const rows = await sql`
      select company_snapshot
      from quote_revisions
      order by id
    `;
    const snapshots = rows.map((row) => {
      if (typeof row.company_snapshot !== 'string') return row.company_snapshot;
      try {
        return JSON.parse(row.company_snapshot);
      } catch {
        return row.company_snapshot;
      }
    });
    const verification = verifyRows(snapshots);
    assertQuotationCompanyBackfill(verification);
    if (requirePositive && verification.total < 1) {
      throw new Error('A verificação empresarial exige um corpus positivo.');
    }
    return verification;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const databaseUrl = String(process.env.TEST_DATABASE_URL || '').trim();
  if (!databaseUrl) {
    process.stderr.write('TEST_DATABASE_URL é obrigatória para verificar o backfill local.\n');
    process.exitCode = 2;
  } else {
    verifyQuotationCompanyBackfill(databaseUrl, {
      requirePositive: process.env.REQUIRE_QUOTATION_COMPANY_BACKFILL === '1',
    })
      .then((verification) => process.stdout.write(`${JSON.stringify(verification)}\n`))
      .catch(() => {
        process.stderr.write('Falha ao verificar o backfill local da configuração empresarial.\n');
        process.exitCode = 1;
      });
  }
}
