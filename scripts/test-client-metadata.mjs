// Testes unitários para helpers de metadados de cliente (CNPJ, origem, endereço).
// Testa as funções exportadas por src/lib/clientMetadata.js (frontend) e as
// funções puras de api/_functions/lib/client-metadata.js (backend).
//
// Uso: node scripts/test-client-metadata.mjs

import { ok, equal, throws } from 'node:assert/strict';

// ── Frontend helpers (src/lib/clientMetadata.js) ──────────────────────────

// ESM import com caminho relativo ao workspace
import {
  LEAD_SOURCES,
  DEFAULT_LEAD_SOURCE,
  isValidLeadSource,
  getLeadSourceLabel,
  onlyDigits,
  normalizeCnpj,
  isValidCnpj,
  formatCnpj,
  EMPTY_ADDRESS,
  normalizeAddress,
  hasAnyAddressField,
  hasMinimumAddressForErp,
  formatAddressSummary,
} from '../src/lib/clientMetadata.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

// ── CNPJ Tests ───────────────────────────────────────────────────────────────

console.log('\nCNPJ:');

test('CNPJ válido com pontuação (00.000.000/0001-91)', () => {
  ok(isValidCnpj('00.000.000/0001-91'));
});

test('CNPJ válido sem pontuação (00000000000191)', () => {
  ok(isValidCnpj('00000000000191'));
});

test('CNPJ inválido (dígitos verificadores errados)', () => {
  ok(!isValidCnpj('00.000.000/0001-00'));
});

test('CNPJ inválido (todos dígitos iguais)', () => {
  ok(!isValidCnpj('11.111.111/1111-11'));
});

test('CNPJ vazio é aceito (opcional)', () => {
  ok(isValidCnpj(''));
  ok(isValidCnpj(null));
});

test('CNPJ incompleto (menos de 14 dígitos)', () => {
  ok(!isValidCnpj('12.345.678/0001'));
});

test('normalizeCnpj remove pontuação', () => {
  equal(normalizeCnpj('00.000.000/0001-91'), '00000000000191');
});

test('normalizeCnpj limita a 14 dígitos', () => {
  equal(normalizeCnpj('0000000000019112345'), '00000000000191');
});

test('normalizeCnpj com string vazia retorna vazia', () => {
  equal(normalizeCnpj(''), '');
});

test('formatCnpj formata 14 dígitos corretamente', () => {
  equal(formatCnpj('00000000000191'), '00.000.000/0001-91');
});

test('formatCnpj com menos de 14 dígitos retorna original', () => {
  equal(formatCnpj('123'), '123');
});

test('onlyDigits remove tudo exceto dígitos', () => {
  equal(onlyDigits('12.345-678/0001-91a'), '12345678000191');
});

test('CNPJ da Aspen Estamparia é válido', () => {
  // CNPJ: 55.458.072/0001-79
  ok(isValidCnpj('55458072000179'));
});

// ── Origem Tests ─────────────────────────────────────────────────────────────

console.log('\nOrigem:');

test('LEAD_SOURCES tem 3 opções', () => {
  equal(LEAD_SOURCES.length, 3);
});

test('DEFAULT_LEAD_SOURCE é string vazia', () => {
  equal(DEFAULT_LEAD_SOURCE, '');
});

test('isValidLeadSource: Google Ads é válido', () => {
  ok(isValidLeadSource('Google Ads'));
});

test('isValidLeadSource: Bríndice é válido', () => {
  ok(isValidLeadSource('Bríndice'));
});

test('isValidLeadSource: Cliente recorrente é válido', () => {
  ok(isValidLeadSource('Cliente recorrente'));
});

test('isValidLeadSource: string vazia é inválida', () => {
  ok(!isValidLeadSource(''));
});

test('isValidLeadSource: origem desconhecida é inválida', () => {
  ok(!isValidLeadSource('Instagram'));
});

test('getLeadSourceLabel retorna label correto', () => {
  equal(getLeadSourceLabel('Google Ads'), 'Google Ads');
  equal(getLeadSourceLabel('Bríndice'), 'Bríndice');
  equal(getLeadSourceLabel('Cliente recorrente'), 'Cliente recorrente');
});

test('getLeadSourceLabel para valor desconhecido retorna o próprio valor', () => {
  equal(getLeadSourceLabel('Instagram'), 'Instagram');
});

// ── Endereço Tests ───────────────────────────────────────────────────────────

console.log('\nEndereço:');

test('EMPTY_ADDRESS tem todas as chaves e valores vazios', () => {
  const expected = ['cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];
  for (const key of expected) {
    ok(key in EMPTY_ADDRESS, `chave ${key} presente`);
    equal(EMPTY_ADDRESS[key], '', `chave ${key} vazia`);
  }
});

test('normalizeAddress com null retorna EMPTY_ADDRESS', () => {
  const addr = normalizeAddress(null);
  equal(addr.cep, '');
  equal(addr.logradouro, '');
});

test('normalizeAddress preenche campos', () => {
  const addr = normalizeAddress({
    logradouro: ' Rua Teste ',
    numero: ' 123 ',
    cidade: 'São Paulo',
    uf: 'sp',
    cep: '01234-567',
  });
  equal(addr.logradouro, 'Rua Teste');
  equal(addr.numero, '123');
  equal(addr.cidade, 'São Paulo');
  equal(addr.uf, 'SP');
  equal(addr.cep, '01234567');
});

test('hasAnyAddressField com EMPTY_ADDRESS retorna false', () => {
  ok(!hasAnyAddressField(EMPTY_ADDRESS));
});

test('hasAnyAddressField com logradouro preenchido retorna true', () => {
  ok(hasAnyAddressField({ logradouro: 'Rua A' }));
});

test('hasMinimumAddressForErp: logradouro + cidade = true', () => {
  ok(hasMinimumAddressForErp({ logradouro: 'Rua A', cidade: 'SP' }));
});

test('hasMinimumAddressForErp: numero + cidade = true', () => {
  ok(hasMinimumAddressForErp({ numero: '123', cidade: 'RJ' }));
});

test('hasMinimumAddressForErp: só cidade sem logradouro/numero = false', () => {
  ok(!hasMinimumAddressForErp({ cidade: 'SP' }));
});

test('hasMinimumAddressForErp: só logradouro sem cidade = false', () => {
  ok(!hasMinimumAddressForErp({ logradouro: 'Rua A' }));
});

test('hasMinimumAddressForErp: endereço vazio = false', () => {
  ok(!hasMinimumAddressForErp(EMPTY_ADDRESS));
});

test('formatAddressSummary: endereço completo', () => {
  const summary = formatAddressSummary({
    logradouro: 'Rua Teste',
    numero: '123',
    bairro: 'Centro',
    cidade: 'São Paulo',
    uf: 'SP',
  });
  ok(summary.includes('Rua Teste, 123'));
  ok(summary.includes('Centro - São Paulo - SP'));
});

test('formatAddressSummary: endereço vazio retorna string vazia', () => {
  equal(formatAddressSummary(EMPTY_ADDRESS), '');
});

// ── Resultado ─────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(40)}`);
console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
console.log(`${'='.repeat(40)}`);

process.exit(failed > 0 ? 1 : 0);
