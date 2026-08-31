import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildCsv,
  exportTimestamp,
  formatBrazilianDate,
  formatBrazilianDecimal,
  formatBrazilianDocument,
  formatBrazilianPhone,
  formatBrazilianPostalCode,
  formatSaoPauloDateTime,
} from '../../api/_modules/commercial-export-csv.js';

describe('commercial export CSV', () => {
  it('writes an Excel-compatible UTF-8 document and neutralizes formula cells', () => {
    const csv = buildCsv(
      [
        { header: 'Nome', value: (row: { name: string; note: string | null }) => row.name },
        { header: 'Descrição', value: (row: { name: string; note: string | null }) => row.note },
      ],
      [
        { name: '=SOMA(1;1)', note: 'Linha 1\n"Linha 2"' },
        { name: '  @comando', note: null },
        { name: '\n=HYPERLINK("https://example.test")', note: null },
      ]
    );

    assert.equal(
      csv,
      '\uFEFF"Nome";"Descrição"\r\n' +
        '"\'=SOMA(1;1)";"Linha 1\n""Linha 2"""\r\n' +
        '"\'  @comando";""\r\n' +
        '"\'\n=HYPERLINK(""https://example.test"")";""\r\n'
    );
  });

  it('formats Brazilian identifiers without losing leading zeroes', () => {
    assert.equal(formatBrazilianDocument('01234567890'), '012.345.678-90');
    assert.equal(formatBrazilianDocument('01234567000189'), '01.234.567/0001-89');
    assert.equal(formatBrazilianPhone('1133334444'), '(11) 3333-4444');
    assert.equal(formatBrazilianPhone('11999998888'), '(11) 99999-8888');
    assert.equal(formatBrazilianPhone('5511999998888'), '+55 (11) 99999-8888');
    assert.equal(formatBrazilianPostalCode('01234567'), '01234-567');
  });

  it('formats stored decimals, dates and São Paulo timestamps for Excel pt-BR', () => {
    assert.equal(formatBrazilianDecimal('1234.50'), '1234,50');
    assert.equal(formatBrazilianDecimal('2.125', 3), '2,125');
    assert.equal(formatBrazilianDate('2026-08-31'), '31/08/2026');
    assert.equal(formatSaoPauloDateTime('2026-08-31T18:30:00.000Z'), '31/08/2026 15:30:00');
    assert.equal(exportTimestamp(new Date('2026-08-31T18:30:00.000Z')), '2026-08-31-153000');
  });
});
