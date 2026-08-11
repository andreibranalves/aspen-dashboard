// tests/unit/extract-rules.test.js
// Valida que DEFAULT_RULES contém os SKUs esperados para cada tipo de produto
// e que buildSystemPrompt produz o prompt correto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyOrderTemplate,
  DEFAULT_RULES,
  buildSystemPrompt,
} from '../../api/_functions/extract.js';

// ── DEFAULT_RULES — regras por tipo de produto ──────────────────────────────

describe('DEFAULT_RULES — cobertura de produtos', () => {
  it('Rule 0 — SKU Explícito (não expande)', () => {
    assert.ok(DEFAULT_RULES.includes('SKU Explícito'), 'deve conter Rule 0');
    assert.ok(DEFAULT_RULES.includes('CNG-SAL-70'), 'deve mencionar SKU explícito como exemplo');
  });

  it('Rule 1 — Quantidade mínima 30', () => {
    assert.ok(DEFAULT_RULES.includes('qtd < 30, usar 30'), 'deve conter regra de qtd mínima');
  });

  it('Lenços → comportamento base e variantes', () => {
    assert.ok(DEFAULT_RULES.includes('LNC-SED-70 + LNC-CSD-70'), 'lenços padrão');
    assert.ok(DEFAULT_RULES.includes('LNC-SED-LAS-70'), 'lenços com laser');
    assert.ok(DEFAULT_RULES.includes('LNC-SED-90'), 'lenço seda 90');
    assert.ok(DEFAULT_RULES.includes('LNC-CSD-90'), 'lenço crepe 90');
    assert.ok(DEFAULT_RULES.includes('"seda"'), 'lenço seda');
    assert.ok(DEFAULT_RULES.includes('"crepe"'), 'lenço crepe');
    assert.ok(DEFAULT_RULES.includes('"viscose"'), 'lenço viscose');
    assert.ok(DEFAULT_RULES.includes('"50cm"'), 'lenço 50cm');
    assert.ok(DEFAULT_RULES.includes('"70cm"'), 'lenço 70cm');
    assert.ok(DEFAULT_RULES.includes('"90cm"'), 'lenço 90cm');
    assert.ok(
      DEFAULT_RULES.includes('NUNCA deve ser confundida com tamanho'),
      'separar qtd de tamanho'
    );
  });

  it('Echarpes → ECH-SED + ECH-CSD', () => {
    assert.ok(DEFAULT_RULES.includes('ECH-SED') && DEFAULT_RULES.includes('ECH-CSD'), 'echarpes');
  });

  it('Chapéus → CHP-PAN + CHP-PNR + CHP-BAM', () => {
    assert.ok(DEFAULT_RULES.includes('CHP-PAN + CHP-PNR + CHP-BAM'), 'chapéus');
  });

  it('Cangas — comportamento base mantém faixas de quantidade', () => {
    assert.ok(DEFAULT_RULES.includes('CNG-SAL-70'), 'canga padrão 70');
    assert.ok(DEFAULT_RULES.includes('CNG-SAL-100'), 'canga padrão 100');
    assert.ok(DEFAULT_RULES.includes('CNG-VIS-70'), 'canga viscose 70');
    assert.ok(DEFAULT_RULES.includes('CNG-VIS-100'), 'canga viscose 100');
  });

  it('Cangas — respeita qualificador de material', () => {
    assert.ok(DEFAULT_RULES.includes('"salinas"'), 'canga salinas');
    assert.ok(DEFAULT_RULES.includes('"viscose"'), 'canga viscose');
    assert.ok(DEFAULT_RULES.includes('"laser"'), 'canga laser');
    assert.ok(DEFAULT_RULES.includes('"atoalhada"'), 'canga atoalhada');
    assert.ok(DEFAULT_RULES.includes('"140cm"'), 'canga 140cm');
    assert.ok(DEFAULT_RULES.includes('CNG-ATO-70'), 'canga atoalhada SKU');
  });

  it('Toalhas de Praia → TWL-210 + TWL-280', () => {
    assert.ok(DEFAULT_RULES.includes('TWL-210 + TWL-280'), 'toalhas de praia');
  });

  it('Toalhas de Banho → TBH-LEM + TBH-URC + TBH-IPA', () => {
    assert.ok(DEFAULT_RULES.includes('TBH-LEM + TBH-URC + TBH-IPA'), 'toalhas de banho');
  });

  it('Bonés — < 100 → BNE-TAC-VNL', () => {
    const boneLine = DEFAULT_RULES.split('\n').find((l) => l.includes('Bonés'))!;
    assert.ok(boneLine.includes('BNE-TAC-VNL'), 'boné abaixo de 100');
  });

  it('Bonés — ≥ 100 → BNE-TAC-SUB + BNE-BRI + BNE-PRE', () => {
    const boneLine = DEFAULT_RULES.split('\n').find((l) => l.includes('Bonés'))!;
    assert.ok(boneLine.includes('BNE-TAC-SUB'), 'boné acima de 100 — SUB');
    assert.ok(boneLine.includes('BNE-BRI'), 'boné acima de 100 — BRI');
    assert.ok(boneLine.includes('BNE-PRE'), 'boné acima de 100 — PRE');
  });

  it('Cachecóis → CHC-SOF-140 + CHC-LAA-COU', () => {
    assert.ok(DEFAULT_RULES.includes('CHC-SOF-140'), 'cachecol sof');
    assert.ok(DEFAULT_RULES.includes('CHC-LAA-COU'), 'cachecol lã couro');
  });

  it('Ecobags → ECO-30 + ECO-35 + ECO-50', () => {
    assert.ok(DEFAULT_RULES.includes('ECO-30 + ECO-35 + ECO-50'), 'ecobags');
  });

  it('Bolsas → BLS-CAP-POL', () => {
    assert.ok(DEFAULT_RULES.includes('BLS-CAP-POL'), 'bolsas');
  });

  it('Bandanas → BND-CRP-50 + BND-CRP-65', () => {
    assert.ok(DEFAULT_RULES.includes('BND-CRP-50 + BND-CRP-65'), 'bandanas');
  });

  it('Gravatas → GVT-POD', () => {
    assert.ok(DEFAULT_RULES.includes('GVT-POD'), 'gravatas');
  });

  it('Rule 4 — Múltiplas quantidades', () => {
    assert.ok(DEFAULT_RULES.includes('Múltiplas quantidades'), 'deve conter Rule 4');
    assert.ok(
      DEFAULT_RULES.includes('linhas separadas no MESMO objeto'),
      'deve instruir linhas separadas'
    );
  });

  it('Urgência — prazo < 15 dias → urgente=true', () => {
    assert.ok(DEFAULT_RULES.includes('urgente=true'), 'deve conter regra de urgência');
    assert.ok(DEFAULT_RULES.includes('prazo < 15'), 'deve conter limite de 15 dias');
  });
});

// ── buildSystemPrompt() ──────────────────────────────────────────────────────

describe('buildSystemPrompt()', () => {
  it('usa DEFAULT_RULES quando customRules é vazio', () => {
    const prompt = buildSystemPrompt('');
    assert.ok(prompt.includes('SKU Explícito'), 'deve conter Rule 0');
    assert.ok(prompt.includes('RETORNE APENAS JSON'), 'deve conter instrução JSON');
    assert.ok(prompt.includes('Bríndice'), 'deve conter regras de origem');
  });

  it('usa DEFAULT_RULES quando customRules é null/undefined', () => {
    const prompt1 = buildSystemPrompt(null);
    const prompt2 = buildSystemPrompt(undefined);
    assert.ok(prompt1.includes('SKU Explícito'));
    assert.ok(prompt2.includes('SKU Explícito'));
  });

  it('usa customRules quando fornecido (não vazio)', () => {
    const custom = 'Regra Custom: só aceitar pedidos acima de 100.';
    const prompt = buildSystemPrompt(custom);
    assert.ok(prompt.includes('Regra Custom'));
    assert.ok(!prompt.includes('SKU Explícito'), 'não deve conter regras padrão');
  });

  it('contém cabeçalho de sistema padrão', () => {
    const prompt = buildSystemPrompt('');
    assert.ok(prompt.startsWith('Você é um assistente de cotação da Aspen Estamparia'));
  });

  it('contém schema JSON de saída', () => {
    const prompt = buildSystemPrompt('');
    assert.ok(prompt.includes('"nome": "string"'), 'schema com nome');
    assert.ok(prompt.includes('"items": [{"item_code": "SKU", "qty": N}]'), 'schema com items');
  });

  it('adiciona instruções de merge quando existingItems é fornecido', () => {
    const prompt = buildSystemPrompt('', [{ item_code: 'CNG-VIS-70', qty: 100 }]);
    assert.ok(prompt.includes('COMPLEMENTANDO'), 'deve indicar modo complemento');
    assert.ok(prompt.includes('CNG-VIS-70'), 'deve listar item existente');
    assert.ok(prompt.includes('NÃO repita SKUs'), 'deve instruir a não repetir');
  });

  it('não adiciona instruções de merge quando existingItems está vazio', () => {
    const prompt1 = buildSystemPrompt('');
    const prompt2 = buildSystemPrompt('', []);
    assert.ok(!prompt1.includes('COMPLEMENTANDO'), 'sem existingItems');
    assert.ok(!prompt2.includes('COMPLEMENTANDO'), 'com array vazio');
  });

  it('adiciona instruções do template e lista SKUs autorizados', () => {
    const prompt = buildSystemPrompt('', undefined, {
      id: 'pack-id',
      name: 'Pack',
      items: [
        { sku: 'SKU-A', name: 'A', position: 0 },
        { sku: 'SKU-B', name: 'B', position: 1 },
      ],
    });
    assert.match(prompt, /TEMPLATE DE PEDIDO SELECIONADO: Pack/);
    assert.match(prompt, /- SKU-A[\s\S]*- SKU-B/);
    assert.match(prompt, /Ignore qualquer produto ou SKU mencionado no pedido/);
    assert.match(prompt, /Aplique cada quantidade a todos os SKUs autorizados/);
  });
});

describe('applyOrderTemplate()', () => {
  const template = {
    id: 'pack-id',
    name: 'Pack',
    archived: false,
    created_at: '2026-08-11T00:00:00.000Z',
    updated_at: '2026-08-11T00:00:00.000Z',
    items: [
      { sku: 'SKU-A', name: 'A', position: 0 },
      { sku: 'SKU-B', name: 'B', position: 1 },
    ],
  };

  it('expande quantidades únicas para todos os SKUs na mesma ordem', () => {
    const orders = [
      {
        nome: 'Andrei B.',
        email: 'andrei@gmail.com',
        telefone: '21999999999',
        urgente: false,
        origem: '',
        cnpj: null,
        endereco: {},
        items: [
          { item_code: 'IGNORAR', qty: 300 },
          { item_code: 'OUTRO', qty: 500 },
          { item_code: 'REPETIDO', qty: 300 },
        ],
      },
    ];

    assert.deepEqual(applyOrderTemplate(orders, template)[0].items, [
      { item_code: 'SKU-A', qty: 300 },
      { item_code: 'SKU-B', qty: 300 },
      { item_code: 'SKU-A', qty: 500 },
      { item_code: 'SKU-B', qty: 500 },
    ]);
  });

  it('aplica mínimo de 30 e aceita string numérica estrita', () => {
    const belowMinimum = applyOrderTemplate(
      [
        {
          nome: 'Cliente',
          items: [
            { item_code: 'IGNORAR', qty: 10 },
            { item_code: 'IGNORAR', qty: '45.5' as unknown as number },
          ],
        },
      ],
      template
    );
    assert.deepEqual(belowMinimum[0].items, [
      { item_code: 'SKU-A', qty: 30 },
      { item_code: 'SKU-B', qty: 30 },
      { item_code: 'SKU-A', qty: 45.5 },
      { item_code: 'SKU-B', qty: 45.5 },
    ]);
  });

  it('rejeita booleanos e valores malformados sem inventar quantidade', () => {
    const malformed: unknown[] = [true, false, null, '', '30un', [], {}, NaN, Infinity];
    for (const qty of malformed) {
      assert.throws(
        () =>
          applyOrderTemplate(
            [
              {
                nome: 'Cliente',
                items: [{ item_code: 'IGNORAR', qty: qty as number }],
              },
            ],
            template
          ),
        /Nenhuma quantidade válida identificada para o template/,
        `qty=${String(qty)}`
      );
    }
  });
});
