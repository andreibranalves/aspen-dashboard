import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildProductCostCsv } from '../../src/features/products/productCostSpreadsheet.ts';

describe('product cost spreadsheet', () => {
  it('exports all columns with Brazilian formatting and an empty cost cell', () => {
    const csv = buildProductCostCsv([
      {
        sku: 'SKU-1',
        nome: 'Produto; "Especial"',
        unidade: 'pç',
        ativo: false,
        custo_unitario: '12.5',
      },
      { sku: 'SKU-2', nome: 'Sem custo', unidade: 'un' },
    ]);

    assert.equal(
      csv,
      '\uFEFF"SKU";"Produto";"Unidade";"Status";"Custo unitário (R$)"\r\n' +
        '"SKU-1";"Produto; ""Especial""";"pç";"Arquivado";"12,50"\r\n' +
        '"SKU-2";"Sem custo";"un";"Ativo";""\r\n'
    );
  });

  it('neutralizes spreadsheet formulas in product fields', () => {
    const csv = buildProductCostCsv([
      { sku: '=SKU-1', nome: '+Produto', unidade: '-un', custo_unitario: null },
    ]);

    assert.match(csv, /"'=SKU-1";"'\+Produto";"'-un";"Ativo";""/);
  });
});
