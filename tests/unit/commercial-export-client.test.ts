import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  commercialExportOperatorMessage,
  commercialExportPath,
  downloadCommercialExport,
} from '../../src/lib/api/commercialExports.ts';

describe('commercial export client', () => {
  it('forwards only client filters and never the visible page', () => {
    assert.equal(
      commercialExportPath('clients', {
        search: 'Maria & Filhos',
        status: 'archived',
        page: 4,
        limit: 50,
      }),
      '/commercial-exports?resource=clients&search=Maria+%26+Filhos&status=archived'
    );
  });

  it('preserves product ordering for products and pricing tiers', () => {
    const filters = {
      search: 'Boné',
      status: 'all',
      order_by: 'item_name asc',
      page: 2,
    };
    assert.equal(
      commercialExportPath('products', filters),
      '/commercial-exports?resource=products&search=Bon%C3%A9&status=all&order_by=item_name+asc'
    );
    assert.equal(
      commercialExportPath('product-pricing', filters),
      '/commercial-exports?resource=product-pricing&search=Bon%C3%A9&status=all&order_by=item_name+asc'
    );
  });

  it('preserves the order period, status and search for orders and their items', () => {
    const filters = {
      period: '30d',
      status: 'Completed',
      search: 'PED-2026',
      limit: 100,
    };
    assert.equal(
      commercialExportPath('sales-orders', filters),
      '/commercial-exports?resource=sales-orders&period=30d&status=Completed&search=PED-2026'
    );
    assert.equal(
      commercialExportPath('sales-order-items', filters),
      '/commercial-exports?resource=sales-order-items&period=30d&status=Completed&search=PED-2026'
    );
  });

  it('maps English network failures to a Portuguese operator message', async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    try {
      await assert.rejects(
        () => downloadCommercialExport('products', {}),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /Não foi possível gerar a exportação/);
          return true;
        }
      );
      assert.equal(
        commercialExportOperatorMessage(new TypeError('Failed to fetch')),
        'Não foi possível gerar a exportação. Tente novamente.'
      );
      assert.equal(
        commercialExportOperatorMessage(new Error('Sessão expirada.')),
        'Sessão expirada.'
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
