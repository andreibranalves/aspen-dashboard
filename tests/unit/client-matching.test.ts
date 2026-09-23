import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyClientMatch,
  clientNamesMatch,
  foldClientText,
  maskClientDocument,
  normalizeClientMatchInput,
  CLIENT_MATCH_MAX_PAGE,
  CLIENT_MATCH_PAGE_SIZE,
  ClientMatchInputError,
  type ClientMatchRecord,
} from '../../api/_modules/client-matching.js';

const CPF = '52998224725';
const CNPJ = '11222333000181';

function record(overrides: Partial<ClientMatchRecord> & { id: string }): ClientMatchRecord {
  return {
    nome: 'Cliente',
    empresa: null,
    documento: null,
    email: null,
    telefone: null,
    arquivado: false,
    ...overrides,
  };
}

function classify(payload: unknown, records: ClientMatchRecord[] = []) {
  return classifyClientMatch(normalizeClientMatchInput(payload), records);
}

test('normalização: e-mail sem espaços externos e em minúsculas', () => {
  const input = normalizeClientMatchInput({ email: '  Ana.SILVA@Example.COM  ' });
  assert.equal(input.email, 'ana.silva@example.com');
});

test('normalização: telefone pela representação de dígitos, número completo', () => {
  const input = normalizeClientMatchInput({ telefone: '+55 (11) 98765-4321' });
  assert.equal(input.telefone, '5511987654321');
});

test('normalização: documento canônico sem máscara', () => {
  const input = normalizeClientMatchInput({ cnpj: '11.222.333/0001-81' });
  assert.equal(input.documento, CNPJ);
});

test('normalização: documento com dígito verificador inválido é entrada inválida', () => {
  assert.throws(() => normalizeClientMatchInput({ cnpj: '11.222.333/0001-99' }), ClientMatchInputError);
  assert.throws(() => normalizeClientMatchInput({ cnpj: '111.111.111-11' }), ClientMatchInputError);
});

test('normalização: documento com quantidade de dígitos inválida é entrada inválida', () => {
  assert.throws(() => normalizeClientMatchInput({ cnpj: '123456789' }), ClientMatchInputError);
});

test('normalização: e-mail inválido não vira campo vazio', () => {
  assert.throws(() => normalizeClientMatchInput({ email: 'sem-arroba' }), ClientMatchInputError);
});

test('normalização: termo textual só existe com três caracteres úteis', () => {
  assert.deepEqual(normalizeClientMatchInput({ nome: '  Ab ' }).textTerms, []);
  assert.deepEqual(normalizeClientMatchInput({ nome: ' Ana ' }).textTerms, ['Ana']);
  assert.deepEqual(normalizeClientMatchInput({ empresa: '  Acme   Ltda ' }).textTerms, ['Acme Ltda']);
  assert.deepEqual(
    normalizeClientMatchInput({ nome: 'Acme', empresa: 'Acme' }).textTerms,
    ['Acme'],
    'o mesmo termo não é buscado duas vezes'
  );
});

test('normalização: page ausente ou inválido equivale a 1, com teto', () => {
  assert.equal(normalizeClientMatchInput({}).page, 1);
  assert.equal(normalizeClientMatchInput({ page: 0 }).page, 1);
  assert.equal(normalizeClientMatchInput({ page: -3 }).page, 1);
  assert.equal(normalizeClientMatchInput({ page: 2.5 }).page, 1);
  assert.equal(normalizeClientMatchInput({ page: 'abc' }).page, 1);
  assert.equal(normalizeClientMatchInput({ page: 1e9 }).page, CLIENT_MATCH_MAX_PAGE);
});

test('dobra de texto ignora caixa, acentos e espaços repetidos', () => {
  assert.equal(foldClientText('  José   DA  Silva '), 'jose da silva');
  assert.equal(foldClientText('Ácme Ltda'), 'acme ltda');
  assert.equal(foldClientText(null), '');
});

test('nomes: palavras inteiras, nunca substring', () => {
  assert.equal(clientNamesMatch('Carla', 'Carla Souza'), true);
  assert.equal(clientNamesMatch('JOSÉ SILVA', 'José da Silva'), true);
  assert.equal(clientNamesMatch('Andrei B.', 'Andrei Brandão'), true);
  assert.equal(clientNamesMatch('Andrei', 'Andreia'), false);
  assert.equal(clientNamesMatch('Carla Lima', 'Carla Souza'), false);
  assert.equal(clientNamesMatch('de', 'Maria de Souza'), false);
  assert.equal(clientNamesMatch('', 'Ana'), false);
});

test('classificação: CNPJ igual reutiliza o cadastro ativo', () => {
  const response = classify({ cnpj: CNPJ }, [record({ id: 'a', documento: CNPJ })]);
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'a');
  assert.deepEqual(response.candidates[0].matched_by, ['documento']);
});

test('classificação: nome e e-mail (caixa e espaços diferentes) reutilizam o cadastro', () => {
  const response = classify({ nome: 'Ana', email: '  ANA@example.com ' }, [
    record({ id: 'a', nome: 'Ana Souza', email: 'ana@example.com' }),
  ]);
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'a');
  assert.deepEqual(response.candidates[0].matched_by, ['email', 'nome']);
});

test('classificação: nome e telefone (máscara diferente) reutilizam o cadastro', () => {
  const response = classify({ nome: 'Ana Souza', telefone: '(11) 98765-4321' }, [
    record({ id: 'a', nome: 'Ana Souza', telefone: '11987654321' }),
  ]);
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'a');
});

test('classificação: e-mail e telefone iguais vinculam mesmo com o nome escrito de outro jeito', () => {
  const response = classify(
    { nome: 'Dea', email: 'ana@example.com', telefone: '11987654321' },
    [record({ id: 'a', nome: 'Andrea Lima', email: 'ana@example.com', telefone: '11987654321' })]
  );
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'a');
});

test('classificação: um único campo em comum não é identidade (duas Carlas)', () => {
  const response = classify(
    { nome: 'Carla', email: 'carla@nova.com', telefone: '21999990000' },
    [
      record({ id: 'a', nome: 'Carla Souza', email: 'carla@souza.com', telefone: '21911112222' }),
      record({ id: 'b', nome: 'Carla Lima', email: 'lima@example.com' }),
    ]
  );
  assert.equal(response.status, 'not_found');
  assert.equal(response.total_candidates, 0);
});

test('classificação: e-mail de outro nome é identificador em uso, para escolher ou confirmar', () => {
  const response = classify({ nome: 'Carla Lima', email: 'familia@example.com' }, [
    record({ id: 'a', nome: 'Carla Souza', email: 'familia@example.com' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'identifier_in_use');
  assert.deepEqual(response.candidates.map((candidate) => candidate.matched_by), [['email']]);
});

test('classificação: só um identificador sem nome também pede confirmação', () => {
  const response = classify({ telefone: '(11) 98765-4321' }, [
    record({ id: 'a', telefone: '11987654321' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'identifier_in_use');
  assert.equal(response.matched_client_id, null);
});

test('classificação: nome igual sem identificador informado sugere, sem vincular', () => {
  const response = classify({ nome: 'José da Silva' }, [
    record({ id: 'a', nome: 'JOSE DA SILVA' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'weak_matches_only');
  assert.equal(response.matched_client_id, null);
  assert.deepEqual(response.candidates.map((candidate) => candidate.matched_by), [['nome']]);
});

test('classificação: nome não casa por substring', () => {
  const response = classify({ nome: 'Andrei', email: 'andrei@example.com' }, [
    record({ id: 'a', nome: 'Andreia', email: 'outra@example.com' }),
  ]);
  assert.equal(response.status, 'not_found');
});

test('classificação: e-mail aponta para A e telefone para B, sem nome, pede escolha ou confirmação', () => {
  const response = classify({ email: 'ana@example.com', telefone: '11987654321' }, [
    record({ id: 'a', email: 'ana@example.com' }),
    record({ id: 'b', telefone: '11987654321' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'identifier_in_use');
  assert.equal(response.candidates.length, 2);
});

test('classificação: candidato forte com identificador divergente exige revisão', () => {
  const response = classify({ nome: 'Ana', telefone: '11987654321', cnpj: '11444777000161' }, [
    record({ id: 'a', nome: 'Ana', telefone: '11987654321', documento: CNPJ }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'identifier_conflict');
});

test('classificação: campo ausente de um lado não é divergência', () => {
  const response = classify({ nome: 'Ana', telefone: '11987654321', cnpj: CNPJ }, [
    record({ id: 'a', nome: 'Ana', telefone: '11987654321' }),
  ]);
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'a');
});

test('classificação: mais de um cadastro ativo forte exige escolha', () => {
  const response = classify({ nome: 'Ana', telefone: '11987654321' }, [
    record({ id: 'a', telefone: '11987654321', nome: 'Ana' }),
    record({ id: 'b', telefone: '11987654321', nome: 'Ana Souza' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'multiple_matches');
  assert.equal(response.total_candidates, 2);
});

test('classificação: correspondência forte só arquivada bloqueia o vínculo automático', () => {
  const response = classify({ cnpj: CNPJ }, [
    record({ id: 'a', documento: CNPJ, arquivado: true }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'archived_match');
  assert.equal(response.matched_client_id, null);
  assert.equal(response.candidates[0].arquivado, true);
});

test('classificação: cadastro ativo exato vincula mesmo com duplicados arquivados', () => {
  const input = { nome: 'andrei', email: 'andrei@gmail.com', telefone: '21980716785' };
  const response = classify(input, [
    record({ id: 'x1', nome: 'Andrei', email: 'andrei@gmail.com', telefone: '21980716785', arquivado: true }),
    record({ id: 'x2', nome: 'andrei', email: 'andrei@gmail.com', telefone: '21980716785', arquivado: true }),
    record({ id: 'ok', nome: 'andrei', email: 'andrei@gmail.com', telefone: '21980716785' }),
    record({ id: 'fraco', nome: 'Outro', email: 'andrei@gmail.com' }),
  ]);
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'ok');
  assert.deepEqual(response.candidates.map((candidate) => candidate.id), ['ok']);
});

test('classificação: sem correspondência e com identificador forte é novo cliente', () => {
  const response = classify({ cnpj: CNPJ }, [record({ id: 'a', nome: 'Outro' })]);
  assert.equal(response.status, 'not_found');
  assert.equal(response.total_candidates, 0);
});

test('classificação: sem dado pesquisável retorna insufficient sem candidatos', () => {
  assert.equal(classify({ nome: 'Ab' }, [record({ id: 'a', nome: 'Ab' })]).status, 'insufficient');
  assert.equal(classify({}).status, 'insufficient');
  assert.equal(classify({ nome: '   ' }).status, 'insufficient');
});

test('classificação: vazio nunca corresponde a vazio', () => {
  const response = classify({ nome: 'Ana' }, [
    record({ id: 'a', nome: 'Ana', documento: null, email: null, telefone: null }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'weak_matches_only');
});

test('classificação: candidato encontrado por empresa é sugestão, não vínculo', () => {
  const response = classify({ empresa: 'Acme Ltda' }, [
    record({ id: 'a', nome: 'Fulano', empresa: 'Ácme  LTDA' }),
  ]);
  assert.equal(response.status, 'review');
  assert.equal(response.reason, 'weak_matches_only');
  assert.deepEqual(response.candidates[0].matched_by, ['empresa']);
});

test('classificação: sugestões são descartadas quando existe correspondência forte', () => {
  const response = classify({ nome: 'Ana', cnpj: CNPJ }, [
    record({ id: 'a', nome: 'Ana Souza', documento: CNPJ }),
    record({ id: 'b', nome: 'Ana Silva' }),
  ]);
  assert.equal(response.status, 'matched');
  assert.deepEqual(response.candidates.map((candidate) => candidate.id), ['a']);
  assert.equal(response.total_candidates, 1);
});

test('classificação: a decisão usa o conjunto completo, não a página exibida', () => {
  const records = Array.from({ length: CLIENT_MATCH_PAGE_SIZE + 2 }, (_, index) =>
    record({ id: `id-${index}`, telefone: '11987654321' })
  );
  const first = classifyClientMatch(
    normalizeClientMatchInput({ telefone: '11987654321', page: 1 }),
    records
  );
  assert.equal(first.status, 'review');
  assert.equal(first.reason, 'identifier_in_use');
  assert.equal(first.candidates.length, CLIENT_MATCH_PAGE_SIZE);
  assert.equal(first.total_candidates, records.length);
  assert.equal(first.has_more, true);

  const second = classifyClientMatch(
    normalizeClientMatchInput({ telefone: '11987654321', page: 2 }),
    records
  );
  assert.equal(second.status, 'review');
  assert.equal(second.candidates.length, 2);
  assert.equal(second.has_more, false);

  const beyond = classifyClientMatch(
    normalizeClientMatchInput({ telefone: '11987654321', page: 99 }),
    records
  );
  assert.equal(beyond.candidates.length, 0);
  assert.equal(beyond.total_candidates, records.length);
  assert.equal(beyond.has_more, false);
});

test('classificação: correspondência única fora da primeira página continua vinculando', () => {
  const records = [
    ...Array.from({ length: CLIENT_MATCH_PAGE_SIZE + 3 }, (_, index) =>
      record({ id: `id-${index}`, nome: `Zebra ${index}` })
    ),
    record({ id: 'alvo', nome: 'Alvo', telefone: '11987654321' }),
  ];
  const response = classifyClientMatch(
    normalizeClientMatchInput({ nome: 'Alvo', telefone: '11987654321', page: 1 }),
    records
  );
  assert.equal(response.status, 'matched');
  assert.equal(response.matched_client_id, 'alvo');
});

test('classificação: documento do candidato vai mascarado', () => {
  const response = classify({ cnpj: CNPJ }, [record({ id: 'a', documento: CNPJ })]);
  assert.equal(response.candidates[0].documento, '**.***.***/****-81');
  assert.ok(!JSON.stringify(response).includes(CNPJ));
  assert.equal(maskClientDocument(CPF), '***.***.***-25');
  assert.equal(maskClientDocument(null), null);
  assert.equal(maskClientDocument('1234'), '**34');
});

test('classificação: a ordem dos candidatos é estável e alfabética', () => {
  const forward = classify({ telefone: '11987654321' }, [
    record({ id: 'b', nome: 'Beto', telefone: '11987654321' }),
    record({ id: 'a', nome: 'Álvaro', telefone: '11987654321' }),
    record({ id: 'c', nome: 'Carla', telefone: '11987654321' }),
  ]);
  const backward = classify({ telefone: '11987654321' }, [
    record({ id: 'c', nome: 'Carla', telefone: '11987654321' }),
    record({ id: 'a', nome: 'Álvaro', telefone: '11987654321' }),
    record({ id: 'b', nome: 'Beto', telefone: '11987654321' }),
  ]);
  const ids = (response: { candidates: Array<{ id: string }> }) =>
    response.candidates.map((candidate) => candidate.id);
  assert.deepEqual(ids(forward), ids(backward));
  assert.deepEqual(ids(forward), ['a', 'b', 'c']);
});

test('classificação: cadastro repetido na leitura é deduplicado por id', () => {
  const duplicated = record({ id: 'a', telefone: '11987654321' });
  const response = classify({ telefone: '11987654321' }, [duplicated, duplicated]);
  assert.equal(response.total_candidates, 1);
});
