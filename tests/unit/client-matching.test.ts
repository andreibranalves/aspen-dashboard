import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientIdentityKey,
  lookupDraftClients,
  matchDraftClients,
  type ClientCandidate,
  type ClientSearchPage,
} from '../../src/features/quotations/clientMatching.ts';

const ana: ClientCandidate = {
  id: 'client-ana', nome: 'Ana Silva', empresa: 'Acme',
  email: 'ana@example.test', telefone: '+55 (11) 99999-0000',
};
const page = (data: ClientCandidate[], current = 1, total = 1): ClientSearchPage => ({
  data, pagination: { page: current, total_pages: total },
});

test('matches normalized email and name without creating a customer', () => {
  assert.equal(matchDraftClients({ nome: '  ANA  SILVA ', email: ' ANA@EXAMPLE.TEST ' }, [ana]).automatic?.id, ana.id);
});

test('matches formatted Brazilian phone with or without country code', () => {
  assert.equal(matchDraftClients({ nome: ana.nome, telefone: '(11) 99999-0000' }, [ana]).automatic?.id, ana.id);
});

test('preserves DDD 55 instead of stripping local digits', () => {
  const client = { ...ana, telefone: '+55 55 99999-0000' };
  assert.equal(matchDraftClients({ nome: ana.nome, telefone: '(55) 99999-0000' }, [client]).automatic?.id, ana.id);
  assert.equal(matchDraftClients({ nome: ana.nome, telefone: '99999-0000' }, [client]).automatic, null);
});

test('normalizes a formatted document', () => {
  const client = { ...ana, documento: '12345678000190' };
  assert.equal(matchDraftClients({ nome: ana.nome, cnpj: '12.345.678/0001-90' }, [client]).automatic?.id, ana.id);
});

test('same name alone is a suggestion requiring explicit selection', () => {
  const result = matchDraftClients({ nome: 'Ana Silva' }, [ana]);
  assert.equal(result.automatic, null);
  assert.equal(result.matches.length, 1);
  assert.equal(result.canCreateNew, true);
});

test('same phone with a different name never links automatically or permits another duplicate', () => {
  const result = matchDraftClients({ nome: 'Bruno', telefone: ana.telefone }, [ana]);
  assert.equal(result.automatic, null);
  assert.equal(result.matches[0].conflicting, true);
  assert.equal(result.canCreateNew, false);
});

test('email and phone pointing to different clients require a choice', () => {
  const other = { ...ana, id: 'other', email: 'other@example.test', telefone: '11988887777' };
  const result = matchDraftClients({ nome: ana.nome, email: ana.email, telefone: other.telefone }, [ana, other]);
  assert.equal(result.matches.length, 2);
  assert.equal(result.automatic, null);
  assert.equal(result.canCreateNew, false);
});

test('document disagreement prevents automatic association by email', () => {
  const result = matchDraftClients({ nome: ana.nome, email: ana.email, cnpj: '12345678000190' }, [{ ...ana, documento: '98765432000100' }]);
  assert.equal(result.automatic, null);
  assert.equal(result.matches[0].conflicting, true);
});

test('company disagreement requires confirmation', () => {
  assert.equal(matchDraftClients({ nome: ana.nome, email: ana.email, empresa: 'Outra empresa' }, [ana]).automatic, null);
});

test('archived matches do not create another client or reactivate automatically', () => {
  const result = matchDraftClients({ nome: ana.nome, email: ana.email }, [{ ...ana, arquivado: true }]);
  assert.equal(result.automatic, null);
  assert.equal(result.canCreateNew, false);
  assert.equal(result.matches[0].archived, true);
});

test('empty identity fields never match one another', () => {
  const result = matchDraftClients({}, [{ id: 'empty' }]);
  assert.equal(result.matches.length, 0);
  assert.equal(result.automatic, null);
});

test('repeated search hits for the same ID are not ambiguous', () => {
  const result = matchDraftClients({ email: ana.email }, [ana, ana, ana]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.automatic?.id, ana.id);
});

test('identity key invalidates a previously checked identity after editing', () => {
  assert.notEqual(clientIdentityKey(ana), clientIdentityKey({ ...ana, telefone: '11988887777' }));
});

test('reads all search pages before selecting a unique match', async () => {
  const calls: number[] = [];
  const result = await lookupDraftClients({ email: ana.email }, async (_term, number) => {
    calls.push(number);
    return number === 1 ? page([], 1, 2) : page([ana], 2, 2);
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.automatic?.id, ana.id);
});

test('a later page with another exact match prevents automatic selection', async () => {
  const result = await lookupDraftClients({ email: ana.email }, async (_term, number) =>
    page(number === 1 ? [ana] : [{ ...ana, id: 'duplicate' }], number, 2));
  assert.equal(result.matches.length, 2);
  assert.equal(result.automatic, null);
  assert.equal(result.canCreateNew, false);
});

test('searches email and telephone independently to detect conflicting matches', async () => {
  const calls: string[] = [];
  const other = { ...ana, id: 'other', email: 'other@example.test', telefone: '11988887777' };
  const result = await lookupDraftClients({ email: ana.email, telefone: other.telefone }, async (term) => {
    calls.push(term);
    return page(term === ana.email ? [ana] : [other]);
  });
  assert.deepEqual(calls.sort(), ['11988887777', 'ana@example.test']);
  assert.equal(result.automatic, null);
  assert.equal(result.matches.length, 2);
});

test('failed lookup cannot be interpreted as a new customer', async () => {
  await assert.rejects(lookupDraftClients({ email: ana.email }, async () => { throw new Error('offline'); }));
});

test('incomplete pagination fails closed', async () => {
  await assert.rejects(lookupDraftClients({ email: ana.email }, async () => page([ana], 9, 10)));
  await assert.rejects(lookupDraftClients({ email: ana.email }, async () => page([ana], 1, 100)));
});

test('late response for an edited draft is rejected', async () => {
  let current = true;
  await assert.rejects(lookupDraftClients({ email: ana.email }, async () => {
    current = false;
    return page([ana]);
  }, () => current));
});

test('confirmed empty search allows a new customer', async () => {
  const result = await lookupDraftClients({ nome: 'Cliente novo', email: 'novo@example.test' }, async () => page([], 1, 0));
  assert.equal(result.matches.length, 0);
  assert.equal(result.automatic, null);
  assert.equal(result.canCreateNew, true);
});
