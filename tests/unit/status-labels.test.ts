import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeQuotationStatus,
  quotationStatusLabel,
  quotationStatusBadgeKey,
} from '../../src/lib/statusLabels.ts';

test('status desconhecido não vira rascunho', () => {
  assert.equal(normalizeQuotationStatus('qualquer-status-novo'), 'unknown');
  assert.equal(normalizeQuotationStatus('foo'), 'unknown');
  assert.equal(normalizeQuotationStatus(''), 'unknown');
});

test('status desconhecido renderiza Status desconhecido', () => {
  assert.equal(quotationStatusLabel('qualquer-status-novo'), 'Status desconhecido');
  assert.notEqual(quotationStatusLabel('foo'), 'Rascunho');
});

test('badge de status desconhecido é neutro (Draft)', () => {
  assert.equal(quotationStatusBadgeKey('qualquer-status-novo'), 'Draft');
});

test('estados válidos continuam mapeando normalmente', () => {
  assert.equal(quotationStatusLabel('rascunho'), 'Rascunho');
  assert.equal(quotationStatusLabel('draft'), 'Rascunho');
  assert.equal(quotationStatusLabel('enviado'), 'Emitido');
  assert.equal(quotationStatusLabel('expired'), 'Expirado');
});
