import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatBRL, fmtPhone, capitalize, formatDate } from '../../src/lib/formatting/formatters.ts';

describe('formatBRL', () => {
  it('formats integer with BRL', () => {
    assert.equal(formatBRL(1455.3), 'R$\u00a01.455,30');
  });

  it('returns zero for invalid input', () => {
    assert.equal(formatBRL('abc'), 'R$\u00a00,00');
  });
});

describe('fmtPhone', () => {
  it('formats 11-digit mobile', () => {
    assert.equal(fmtPhone('11999998888'), '(11) 99999-8888');
  });

  it('formats canonical brazilian mobile with 55 prefix without showing the prefix', () => {
    assert.equal(fmtPhone('5511999998888'), '(11) 99999-8888');
  });

  it('formats canonical brazilian landline with 55 prefix without treating 55 as DDD', () => {
    assert.equal(fmtPhone('557788152565'), '(77) 8815-2565');
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
