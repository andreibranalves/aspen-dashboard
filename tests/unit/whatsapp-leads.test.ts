import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  findConvertedQuotation,
  formatLeadText,
  getWhatsappLeadQuality,
  isLikelyAttendantName,
  normalizeLeadEmail,
  normalizeWhatsappPhone,
  prioritizeWhatsappLeads,
  resolveWhatsappDisplayName,
  shouldIncludeWhatsappLead,
} from '../../api/_functions/whatsapp-leads.js';

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

    assert.equal(
      text,
      [
        'Nome: João Silva',
        'E-mail: joao@example.com',
        'Telefone: 11999999999',
        'Pedido: canga — 100 un',
      ].join('\n')
    );
  });

  it('mantém campos vazios quando dados não existem', () => {
    const text = formatLeadText({ nome: '', email: '', telefone: '5511988887777' });

    assert.equal(text, ['Nome:', 'E-mail:', 'Telefone: 11988887777', 'Pedido:'].join('\n'));
  });

  it('retorna as 5 conversas mais recentes, sem priorizar por orçamento', () => {
    const leads = [
      { id: 'orcado-antigo', timestamp: 100, hasQuotation: true },
      { id: 'sem-email-novo', timestamp: 900, hasQuotation: false },
      { id: 'orcado-novo', timestamp: 800, hasQuotation: true },
      { id: 'pronto-meio', timestamp: 700, hasQuotation: false },
      { id: 'sem-nome', timestamp: 600, hasQuotation: false },
      { id: 'sem-telefone', timestamp: 500, hasQuotation: false },
      { id: 'antigo', timestamp: 400, hasQuotation: false },
    ];

    assert.deepEqual(
      prioritizeWhatsappLeads(leads).map((lead) => lead.id),
      ['sem-email-novo', 'orcado-novo', 'pronto-meio', 'sem-nome', 'sem-telefone']
    );
  });

  it('deduplica conversas pelo mesmo telefone mantendo a mais completa', () => {
    const leads = [
      {
        id: 'lid-sem-email',
        remoteJid: 'lid-sem-email',
        nome: 'Almir',
        telefone: '5516992433731',
        email: '',
        quotationId: 'ORC-20261702',
        timestamp: 1000,
      },
      {
        id: 'phone-com-email',
        remoteJid: '5516992433731@s.whatsapp.net',
        nome: 'Almir',
        telefone: '5516992433731',
        email: 'aatonello@hotmail.com',
        quotationId: 'ORC-20261702',
        timestamp: 900,
      },
    ];

    const [lead] = prioritizeWhatsappLeads(leads);

    assert.equal(prioritizeWhatsappLeads(leads).length, 1);
    assert.equal(lead.telefone, '5516992433731');
    assert.equal(lead.email, 'aatonello@hotmail.com');
    assert.equal(lead.quotationId, 'ORC-20261702');
    assert.equal(lead.timestamp, 1000);
  });

  it('usa o primeiro e-mail quando a conversa contém mais de um', () => {
    assert.equal(
      normalizeLeadEmail('financeiro@difratellirv.com.br e katia.souza@difratellirv.com.br'),
      'financeiro@difratellirv.com.br'
    );
  });

  it('marca qualidade do lead com pronto, orçamento ou campos faltantes', () => {
    assert.deepEqual(
      getWhatsappLeadQuality({
        nome: 'Difratelli Rio Verde Go',
        email: 'financeiro@difratellirv.com.br',
        telefone: '556499735283',
      }),
      { isReady: true, missingFields: [], statusLabel: 'Pronto para gerar' }
    );
    assert.deepEqual(
      getWhatsappLeadQuality({ nome: 'Karine', email: '', telefone: '554288025687' }),
      { isReady: false, missingFields: ['email'], statusLabel: 'Sem e-mail' }
    );
    assert.deepEqual(getWhatsappLeadQuality({ nome: '', email: '', telefone: '' }), {
      isReady: false,
      missingFields: ['nome', 'email', 'telefone'],
      statusLabel: 'Sem nome, e-mail e telefone',
    });
  });

  it('usa o nome do WhatsApp quando nome inferido pela IA está vazio', () => {
    assert.equal(
      resolveWhatsappDisplayName({ nome: '' }, { pushName: 'Dra Mahiara Liell' }, '554799632052'),
      'Dra Mahiara Liell'
    );
  });

  it('encontra o orçamento convertido por telefone, e-mail ou nome', () => {
    const converted = {
      phones: new Map([['4799632052', 'ORC-20261234']]),
      emails: new Map([['dra@example.com', 'ORC-20261235']]),
      names: new Map([['dra mahiara liell', 'ORC-20261236']]),
    };

    assert.equal(findConvertedQuotation({ telefone: '554799632052' }, converted), 'ORC-20261234');
    assert.equal(findConvertedQuotation({ email: 'DRA@example.com' }, converted), 'ORC-20261235');
    assert.equal(findConvertedQuotation({ nome: 'Dra Mahiara Liell' }, converted), 'ORC-20261236');
    assert.equal(findConvertedQuotation({ telefone: '5511999999999' }, converted), '');
  });

  it('inclui apenas leads com nome, e-mail e telefone real', () => {
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: 'Dra Mahiara Liell',
        email: 'dramahiara@gmail.com',
        telefone: '554799632052',
      }),
      true
    );
    assert.equal(
      shouldIncludeWhatsappLead({ nome: 'Dra Mahiara Liell', email: '', telefone: '554799632052' }),
      false
    );
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: '',
        email: 'dramahiara@gmail.com',
        telefone: '554799632052',
      }),
      false
    );
    assert.equal(
      shouldIncludeWhatsappLead({
        nome: 'Kátia',
        email: 'katia@example.com',
        telefone: '254881025777751',
      }),
      false
    );
  });

  it('identifica nome de atendente que só aparece no lado Aspen da conversa', () => {
    const normalized = [
      { fromMe: false, text: 'Olá, gostaria de um orçamento' },
      { fromMe: true, text: 'Claro! Meu nome é Juliana, vou te ajudar' },
      { fromMe: false, text: 'Meu nome é Viviane Correa' },
      { fromMe: true, text: 'Certo Viviane, qual seu email?' },
      { fromMe: false, text: 'viviane@email.com' },
    ];
    // "Juliana" aparece apenas nas mensagens Aspen (fromMe: true) → atendente
    assert.equal(isLikelyAttendantName('Juliana', normalized), true);
    // "Viviane" aparece no lado Cliente (fromMe: false) → cliente legítimo
    assert.equal(isLikelyAttendantName('Viviane', normalized), false);
    // Nome vazio ou curto demais → ignora
    assert.equal(isLikelyAttendantName('', normalized), false);
    assert.equal(isLikelyAttendantName('Jo', normalized), false);
  });
});
