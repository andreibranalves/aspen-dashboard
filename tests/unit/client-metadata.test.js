// tests/unit/client-metadata.test.js
// Testes unitários para o módulo de metadados do cliente:
// LEAD_SOURCES, normalizeLeadSource, isValidLeadSource, onlyDigits,
// normalizeCnpj, isValidCnpj, normalizeAddressPayload,
// hasMinimumAddressForErp, buildAddressPayload.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LEAD_SOURCES,
  normalizeLeadSource,
  isValidLeadSource,
  onlyDigits,
  normalizeCnpj,
  isValidCnpj,
  normalizeAddressPayload,
  hasMinimumAddressForErp,
  buildAddressPayload,
} from '../../api/_functions/lib/client-metadata.js';

// ── LEAD_SOURCES ─────────────────────────────────────────────────────────────

describe('LEAD_SOURCES', () => {
  it('contém as 3 origens canônicas', () => {
    assert.ok(LEAD_SOURCES.includes('Google Ads'));
    assert.ok(LEAD_SOURCES.includes('Bríndice'));
    assert.ok(LEAD_SOURCES.includes('Cliente recorrente'));
    assert.equal(LEAD_SOURCES.length, 3);
  });
});

// ── normalizeLeadSource ──────────────────────────────────────────────────────

describe('normalizeLeadSource()', () => {
  it('retorna vazio para entrada vazia/null/undefined', () => {
    assert.equal(normalizeLeadSource(''), '');
    assert.equal(normalizeLeadSource(null), '');
    assert.equal(normalizeLeadSource(undefined), '');
    assert.equal(normalizeLeadSource('   '), '');
  });

  it('normaliza com case/accent insensitive', () => {
    assert.equal(normalizeLeadSource('google ads'), 'Google Ads');
    assert.equal(normalizeLeadSource('GOOGLE ADS'), 'Google Ads');
    assert.equal(normalizeLeadSource('brindice'), 'Bríndice');
    assert.equal(normalizeLeadSource('BRÍNDICE'), 'Bríndice');
    assert.equal(normalizeLeadSource('cliente recorrente'), 'Cliente recorrente');
  });

  it('retorna valor original se não for canônico', () => {
    assert.equal(normalizeLeadSource('Instagram'), 'Instagram');
  });
});

// ── isValidLeadSource ────────────────────────────────────────────────────────

describe('isValidLeadSource()', () => {
  it('retorna true para origens canônicas', () => {
    assert.equal(isValidLeadSource('Google Ads'), true);
    assert.equal(isValidLeadSource('Bríndice'), true);
    assert.equal(isValidLeadSource('Cliente recorrente'), true);
  });

  it('aceita case/accent insensitive', () => {
    assert.equal(isValidLeadSource('google ads'), true);
    assert.equal(isValidLeadSource('brindice'), true);
  });

  it('retorna false para origens desconhecidas', () => {
    assert.equal(isValidLeadSource('Instagram'), false);
    assert.equal(isValidLeadSource('WhatsApp'), false);
    assert.equal(isValidLeadSource(''), false);
  });
});

// ── onlyDigits ───────────────────────────────────────────────────────────────

describe('onlyDigits()', () => {
  it('remove tudo exceto dígitos', () => {
    assert.equal(onlyDigits('12.345.678/0001-90'), '12345678000190');
    assert.equal(onlyDigits('abc123def'), '123');
    assert.equal(onlyDigits(''), '');
    assert.equal(onlyDigits(null), '');
  });
});

// ── normalizeCnpj ────────────────────────────────────────────────────────────

describe('normalizeCnpj()', () => {
  it('extrai até 14 dígitos', () => {
    assert.equal(normalizeCnpj('12.345.678/0001-90'), '12345678000190');
    assert.equal(normalizeCnpj('12345678000190'), '12345678000190');
    assert.equal(normalizeCnpj(''), '');
  });

  it('trunca para 14 dígitos', () => {
    assert.equal(normalizeCnpj('12.345.678/0001-9012345'), '12345678000190');
  });
});

// ── isValidCnpj ──────────────────────────────────────────────────────────────

describe('isValidCnpj()', () => {
  it('retorna true para CNPJ vazio (opcional)', () => {
    assert.equal(isValidCnpj(''), true);
  });

  it('retorna true para CNPJ válido', () => {
    // CNPJ de teste: 11.222.333/0001-81
    // DV calculado: d1=8, d2=1
    assert.equal(isValidCnpj('11222333000181'), true);
  });

  it('retorna false para CNPJ com dígitos verificadores errados', () => {
    assert.equal(isValidCnpj('11222333000199'), false);
  });

  it('retorna false para CNPJ com todos dígitos iguais', () => {
    assert.equal(isValidCnpj('11111111111111'), false);
    assert.equal(isValidCnpj('00000000000000'), false);
  });

  it('retorna false para CNPJ com tamanho inválido', () => {
    assert.equal(isValidCnpj('123'), false);
    assert.equal(isValidCnpj('123456789012345'), false); // 15 dígitos
  });
});

// ── normalizeAddressPayload ──────────────────────────────────────────────────

describe('normalizeAddressPayload()', () => {
  it('retorna objeto vazio padronizado para null/undefined', () => {
    const empty = normalizeAddressPayload(null);
    assert.deepEqual(empty, {
      cep: '', logradouro: '', numero: '', complemento: '',
      bairro: '', cidade: '', uf: '',
    });
  });

  it('normaliza CEP (só dígitos)', () => {
    const result = normalizeAddressPayload({ cep: '22793-225' });
    assert.equal(result.cep, '22793225');
  });

  it('faz trim dos campos', () => {
    const result = normalizeAddressPayload({
      logradouro: '  Rua A  ',
      cidade: 'Rio de Janeiro',
    });
    assert.equal(result.logradouro, 'Rua A');
    assert.equal(result.cidade, 'Rio de Janeiro');
  });

  it('converte UF para maiúsculas', () => {
    const result = normalizeAddressPayload({ uf: 'rj' });
    assert.equal(result.uf, 'RJ');
  });
});

// ── hasMinimumAddressForErp ──────────────────────────────────────────────────

describe('hasMinimumAddressForErp()', () => {
  it('retorna true com logradouro + cidade', () => {
    assert.equal(hasMinimumAddressForErp({ logradouro: 'Rua A', cidade: 'Rio' }), true);
  });

  it('retorna true com numero + cidade', () => {
    assert.equal(hasMinimumAddressForErp({ numero: '123', cidade: 'Rio' }), true);
  });

  it('retorna false sem cidade', () => {
    assert.equal(hasMinimumAddressForErp({ logradouro: 'Rua A' }), false);
  });

  it('retorna false sem logradouro nem numero', () => {
    assert.equal(hasMinimumAddressForErp({ cidade: 'Rio' }), false);
  });

  it('retorna false para null/undefined', () => {
    assert.equal(hasMinimumAddressForErp(null), false);
    assert.equal(hasMinimumAddressForErp(undefined), false);
  });
});

// ── buildAddressPayload ──────────────────────────────────────────────────────

describe('buildAddressPayload()', () => {
  const baseOpts = {
    nomeCliente: 'João Silva',
    email: 'joao@example.com',
    telefone: '21980716785',
    entityType: 'Customer',
    entityId: 'CUST-001',
  };

  it('monta payload com campos obrigatórios (country, links, address_type)', () => {
    const payload = buildAddressPayload({
      address: { logradouro: 'Rua A', numero: '100', cidade: 'Rio', uf: 'RJ' },
      ...baseOpts,
    });
    assert.equal(payload.address_title, 'João Silva');
    assert.equal(payload.address_type, 'Billing');
    assert.equal(payload.address_line1, 'Rua A, 100');
    assert.equal(payload.city, 'Rio');
    assert.equal(payload.state, 'RJ');
    assert.equal(payload.country, 'Brazil');
    assert.equal(payload.links[0].link_doctype, 'Customer');
    assert.equal(payload.links[0].link_name, 'CUST-001');
  });

  it('inclui email e telefone quando fornecidos', () => {
    const payload = buildAddressPayload({
      address: { logradouro: 'Rua B', numero: '200', cidade: 'SP' },
      ...baseOpts,
    });
    assert.equal(payload.email_id, 'joao@example.com');
    assert.equal(payload.phone, '21980716785');
  });

  it('inclui bairro + complemento como address_line2', () => {
    const payload = buildAddressPayload({
      address: { logradouro: 'Rua C', bairro: 'Centro', complemento: 'Apto 301', cidade: 'BH' },
      ...baseOpts,
    });
    assert.equal(payload.address_line2, 'Centro - Apto 301');
  });

  it('não inclui address_line2 sem bairro nem complemento', () => {
    const payload = buildAddressPayload({
      address: { logradouro: 'Rua D', numero: '50', cidade: 'Recife' },
      ...baseOpts,
    });
    assert.equal(payload.address_line2, undefined);
  });

  it('inclui CEP como pincode quando fornecido', () => {
    const payload = buildAddressPayload({
      address: { logradouro: 'Rua E', numero: '10', cidade: 'Niterói', cep: '24020-050' },
      ...baseOpts,
    });
    assert.equal(payload.pincode, '24020050');
  });
});
