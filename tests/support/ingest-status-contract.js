// Contract between the site ingestion result and its HTTP status. Keeping the
// mapping in one place lets the integrated HTTP -> PostgreSQL -> UI test assert
// the exact status instead of accepting any 2xx, and lets a unit test prove the
// assertion is sensitive to an inverted handler.
export const CREATED_INGEST_STATUS = 201;
export const DEDUPLICATED_INGEST_STATUS = 200;

export function expectedIngestStatus(result) {
  if (result === 'created') return CREATED_INGEST_STATUS;
  if (result === 'deduplicated') return DEDUPLICATED_INGEST_STATUS;
  throw new Error(`resultado de ingestão desconhecido: ${String(result)}`);
}

export function assertIngestStatus(responseStatus, result) {
  const expected = expectedIngestStatus(result);
  if (responseStatus !== expected) {
    throw new Error(
      `status HTTP ${responseStatus} não corresponde a result=${result} (esperado ${expected}).`
    );
  }
  return expected;
}
