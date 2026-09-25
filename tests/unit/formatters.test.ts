import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  capitalize,
  fmtPhone,
  formatBRL,
  formatDate,
  formatDateTime,
  formatDecimalBR,
  formatPercent,
  fromApiDecimal,
  parseDecimalBR,
  toApiDecimal,
  whatsappContactUrl,
} from '../../src/lib/formatting/formatters.ts';

describe('whatsappContactUrl', () => {
  it('adds Brazil country code to local numbers without inventing a ninth digit', () => {
    assert.equal(whatsappContactUrl('(47) 9123-4567'), 'https://wa.me/554791234567');
    assert.equal(whatsappContactUrl('47991234567'), 'https://wa.me/5547991234567');
    assert.equal(whatsappContactUrl('(55) 9123-4567'), 'https://wa.me/555591234567');
  });

  it('preserves country codes already supplied', () => {
    assert.equal(whatsappContactUrl('554791234567'), 'https://wa.me/554791234567');
    assert.equal(whatsappContactUrl('+55 (47) 9123-4567'), 'https://wa.me/554791234567');
    assert.equal(whatsappContactUrl('+1 202 555 0123'), 'https://wa.me/12025550123');
    assert.equal(whatsappContactUrl('+47 912 34 567'), 'https://wa.me/4791234567');
  });

  it('does not create a destination for an empty phone', () => {
    assert.equal(whatsappContactUrl(null), '');
  });
});

describe('formatBRL', () => {
  it('formats integer with BRL', () => {
    assert.equal(formatBRL(1455.3), 'R$\u00a01.455,30');
  });

  it('returns zero for invalid input', () => {
    assert.equal(formatBRL('abc'), 'R$\u00a00,00');
  });

  it('keeps the sign before the symbol', () => {
    assert.equal(formatBRL(-1234.5), '-R$\u00a01.234,50');
  });
});

describe('formatDecimalBR', () => {
  it('groups thousands with dots and uses a decimal comma', () => {
    assert.equal(formatDecimalBR(1234567.891), '1.234.567,89');
    assert.equal(formatDecimalBR(0), '0,00');
    assert.equal(formatDecimalBR(4, 0), '4');
  });
});

describe('parseDecimalBR', () => {
  it('reads pt-BR input', () => {
    assert.equal(parseDecimalBR('1.234,56'), 1234.56);
    assert.equal(parseDecimalBR('R$ 45,9'), 45.9);
    assert.equal(parseDecimalBR('1.000'), 1000);
  });

  it('accepts a dot decimal when there is no comma', () => {
    assert.equal(parseDecimalBR('12.90'), 12.9);
    assert.equal(parseDecimalBR('0.5'), 0.5);
  });

  it('returns null for empty or invalid input', () => {
    assert.equal(parseDecimalBR(''), null);
    assert.equal(parseDecimalBR('abc'), null);
    assert.equal(parseDecimalBR(','), null);
  });
});

describe('toApiDecimal / fromApiDecimal', () => {
  it('round-trips the API decimal format', () => {
    assert.equal(toApiDecimal(12.5), '12.50');
    assert.equal(fromApiDecimal('4.00'), 4);
    assert.equal(fromApiDecimal(''), null);
    assert.equal(fromApiDecimal('abc'), null);
  });
});

describe('formatPercent', () => {
  it('formats with a comma and an optional sign', () => {
    assert.equal(formatPercent(12.345), '12,3%');
    assert.equal(formatPercent(12.5, { signed: true }), '+12,5%');
    assert.equal(formatPercent(-18.9, { signed: true }), '-18,9%');
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
  it('formats a civil ISO date without shifting it by timezone', () => {
    assert.equal(formatDate('2024-05-20'), '20/05/2024');
  });

  it('formats timestamps in America/Sao_Paulo', () => {
    assert.equal(formatDate('2024-05-20T02:00:00.000Z'), '19/05/2024');
  });

  it('keeps invalid civil dates unchanged', () => {
    assert.equal(formatDate('2024-02-31'), '2024-02-31');
  });
});

describe('formatDateTime', () => {
  it('formats timestamps with Brazilian notation in America/Sao_Paulo', () => {
    assert.equal(formatDateTime('2026-08-20T12:00:00.000Z'), '20/08/2026, 09:00');
  });

  it('formats timestamps in America/Sao_Paulo', () => {
    assert.equal(formatDateTime('2026-08-31T10:00:00.000Z'), '31/08/2026, 07:00');
  });

  it('returns an empty value for absent or invalid timestamps', () => {
    assert.equal(formatDateTime(undefined), '');
    assert.equal(formatDateTime('invalid'), '');
  });
});
