import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, fmtPhone, capitalize, formatDate } from '../../src/lib/formatters.ts';

describe('formatBRL', () => {
  it('formats integer with BRL', () => {
    assert.equal(formatBRL(1455.3), 'R$ 1.455,30');
  });

  it('returns zero for invalid input', () => {
    assert.equal(formatBRL('abc'), 'R$ 0,00');
  });
});

describe('fmtPhone', () => {
  it('formats 11-digit mobile', () => {
    assert.equal(fmtPhone('11999998888'), '(11) 99999-8888');
  });

  it('returns empty for empty input', () => {
    assert.equal(fmtPhone(''), '');
  });
});

describe('capitalize', () => {
  it('capitalizes each word', () => {
    assert.equal(capitalize('joão silva'), 'João Silva');
  });
});

describe('formatDate', () => {
  it('formats ISO date to pt-BR', () => {
    assert.equal(formatDate('2024-05-20'), '20/05/2024');
  });
});
