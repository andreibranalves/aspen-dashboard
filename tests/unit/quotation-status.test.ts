import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertQuotationTransition,
  canonicalQuotationStatus,
  isIssuedQuotationStatus,
} from '../../api/_lib/quotation-status.js';

test('enviado is a read alias for emitido', () => {
  assert.equal(canonicalQuotationStatus('enviado'), 'emitido');
  assert.equal(isIssuedQuotationStatus('enviado'), true);
});

test('new writes reject enviado', () => {
  assert.throws(
    () => assertQuotationTransition('rascunho', 'enviado'),
    /Estado comercial inválido/,
  );
});

test('perdido requires a reason', () => {
  assert.throws(
    () => assertQuotationTransition('emitido', 'perdido'),
    /motivo/i,
  );
  assert.doesNotThrow(() => assertQuotationTransition('emitido', 'perdido', 'Preço'));
});
