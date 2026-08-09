import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { resolveParty } from '../../api/_functions/lib/customer-resolution.js';

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('resolveParty', () => {
  it('rejeita e-mail malformado antes de consultar o Frappe', async () => {
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      throw new Error('Frappe não deveria ser chamado.');
    }) as typeof fetch;

    await assert.rejects(
      resolveParty({
        nome: 'Cliente teste',
        email: 'email invalido',
        telefone: '',
        cnpj: '',
        origem: 'Google Ads',
        utmSourceExists: false,
      }),
      (error: { statusCode?: number; message?: string }) =>
        error.statusCode === 400 && error.message === 'E-mail inválido.',
    );
    assert.equal(requests, 0);
  });
});
