import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { readNewClientPrefill } from '../../src/features/customers/new-client-prefill.ts';

describe('new client prefill', () => {
  it('reads safe name and phone values from the hash query', () => {
    assert.deepEqual(
      readNewClientPrefill('#/leads/cliente/new?nome=Maria+Silva&telefone=5511999999999'),
      { nome: 'Maria Silva', telefone: '5511999999999' }
    );
  });

  it('ignores unrelated routes and control characters', () => {
    assert.deepEqual(
      readNewClientPrefill('#/leads/cliente/abc?nome=Maria%00&telefone=abc'),
      { nome: '', telefone: '' }
    );
  });
});
