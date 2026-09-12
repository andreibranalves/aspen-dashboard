import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREATED_INGEST_STATUS,
  DEDUPLICATED_INGEST_STATUS,
  assertIngestStatus,
  expectedIngestStatus,
} from '../../tests/support/ingest-status-contract.js';

test('site ingestion maps created -> 201 and deduplicated -> 200', () => {
  assert.equal(CREATED_INGEST_STATUS, 201);
  assert.equal(DEDUPLICATED_INGEST_STATUS, 200);
  assert.equal(expectedIngestStatus('created'), 201);
  assert.equal(expectedIngestStatus('deduplicated'), 200);
});

test('the integrated status assertion is sensitive to inverted status codes', () => {
  assert.doesNotThrow(() => assertIngestStatus(201, 'created'));
  assert.doesNotThrow(() => assertIngestStatus(200, 'deduplicated'));
  assert.throws(() => assertIngestStatus(200, 'created'), /esperado 201/);
  assert.throws(() => assertIngestStatus(201, 'deduplicated'), /esperado 200/);
  assert.throws(() => expectedIngestStatus('unexpected'), /desconhecido/);
});
