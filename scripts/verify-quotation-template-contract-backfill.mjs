#!/usr/bin/env node

import postgres from 'postgres';
import {
  assertQuotationTemplateContractBackfill,
  verifyQuotationTemplateContractBackfill as verifyRows,
} from '../api/_modules/quotation-template-contract.js';

export async function verifyQuotationTemplateContractBackfill(databaseUrl) {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
  });
  try {
    const rows = await sql`
      select source, source_hash, contract_version
      from quotation_template_versions
      order by id
    `;
    const verification = verifyRows(
      rows.map((row) => ({
        source: row.source,
        sourceHash: row.source_hash,
        contractVersion: row.contract_version,
      }))
    );
    assertQuotationTemplateContractBackfill(verification);
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
    verifyQuotationTemplateContractBackfill(databaseUrl)
      .then((verification) => process.stdout.write(`${JSON.stringify(verification)}\n`))
      .catch(() => {
        process.stderr.write('Falha ao verificar o backfill local de contratos de templates.\n');
        process.exitCode = 1;
      });
  }
}
