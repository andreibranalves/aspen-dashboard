import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatLeadText, normalizeWhatsappPhone } from '../../api/_functions/whatsapp-leads.js';

describe('whatsapp-leads helpers', () => {
  it('normaliza telefone vindo de remoteJid', () => {
    assert.equal(normalizeWhatsappPhone('5511999999999@s.whatsapp.net'), '5511999999999');
    assert.equal(normalizeWhatsappPhone('(11) 99999-9999'), '5511999999999');
  });

  it('formata texto para preencher textarea sem disparar extração', () => {
    const text = formatLeadText({
      nome: 'João Silva',
      email: 'joao@example.com',
      telefone: '5511999999999',
      produto: 'canga',
      quantidade: 100,
    });

    assert.equal(text, [
      'Nome: João Silva',
      'E-mail: joao@example.com',
      'Telefone: 5511999999999',
      'Pedido: canga — 100 un',
    ].join('\n'));
  });

  it('mantém campos vazios quando dados não existem', () => {
    const text = formatLeadText({ nome: '', email: '', telefone: '5511988887777' });

    assert.equal(text, [
      'Nome:',
      'E-mail:',
      'Telefone: 5511988887777',
      'Pedido:',
    ].join('\n'));
  });
});
