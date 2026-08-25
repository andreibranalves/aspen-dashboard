import { createHash } from 'node:crypto';

import type { QuotationTemplateContractVersion } from './quotation-template-catalog.js';

export interface QuotationTemplateContractBackfillRow {
  source: string;
  sourceHash: string;
  contractVersion: unknown;
}

export interface QuotationTemplateContractBackfillVerification {
  total: number;
  historical_v1: number;
  v2: number;
  invalid_contract_versions: number;
  source_hash_mismatches: number;
}

function sourceHash(source: string): string {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

/**
 * Existing rows have immutable pre-contract rendering behavior and therefore
 * are classified as historical v1 by the additive metadata backfill.
 */
export function historicalQuotationTemplateContractVersion(): 1 {
  return 1;
}

/**
 * Verify only aggregate metadata and immutable source identity. The result is
 * safe for operational logs because it never includes template source, client
 * data, or row identifiers.
 */
export function verifyQuotationTemplateContractBackfill(
  rows: readonly QuotationTemplateContractBackfillRow[]
): QuotationTemplateContractBackfillVerification {
  let historicalV1 = 0;
  let v2 = 0;
  let invalidContractVersions = 0;
  let sourceHashMismatches = 0;

  for (const row of rows) {
    if (row.contractVersion === 1) historicalV1 += 1;
    else if (row.contractVersion === 2) v2 += 1;
    else invalidContractVersions += 1;
    if (sourceHash(row.source) !== row.sourceHash) sourceHashMismatches += 1;
  }

  return {
    total: rows.length,
    historical_v1: historicalV1,
    v2,
    invalid_contract_versions: invalidContractVersions,
    source_hash_mismatches: sourceHashMismatches,
  };
}

export function assertQuotationTemplateContractBackfill(
  verification: QuotationTemplateContractBackfillVerification
): void {
  if (verification.invalid_contract_versions !== 0) {
    throw new Error('Backfill de contrato de templates contém versões inválidas.');
  }
  if (verification.source_hash_mismatches !== 0) {
    throw new Error('Backfill de contrato de templates alterou identidade de fonte.');
  }
}

export type { QuotationTemplateContractVersion };
