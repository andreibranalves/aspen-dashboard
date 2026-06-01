// tests/unit/extract-rules.test.js
// Valida que DEFAULT_RULES contém os SKUs esperados para cada tipo de produto
// e que buildSystemPrompt produz o prompt correto.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_RULES, buildSystemPrompt } from '../../api/_functions/extract.js';

// ── DEFAULT_RULES — regras por tipo de produto ──────────────────────────────

describe('DEFAULT_RULES — cobertura de produtos', () => {
  it('Rule 0 — SKU Explícito (não expande)', () => {
    assert.ok(DEFAULT_RULES.includes('SKU Explícito'), 'deve conter Rule 0');
    assert.ok(DEFAULT_RULES.includes('CNG-SAL-70'), 'deve mencionar SKU explícito como exemplo');
  });

  it('Rule 1 — Quantidade mínima 30', () => {
    assert.ok(DEFAULT_RULES.includes('qtd < 30, usar 30'), 'deve conter regra de qtd mínima');
  });

  it('Lenços → LNC-SED-70 + LNC-CSD-70', () => {
    assert.ok(DEFAULT_RULES.includes('LNC-SED-70 + LNC-CSD-70'), 'lenços padrão');
    assert.ok(DEFAULT_RULES.includes('LNC-SED-LAS-70'), 'lenços com laser');
  });

  it('Echarpes → ECH-SED + ECH-CSD', () => {
    assert.ok(DEFAULT_RULES.includes('ECH-SED') && DEFAULT_RULES.includes('ECH-CSD'), 'echarpes');
  });

  it('Chapéus → CHP-PAN + CHP-PNR + CHP-BAM', () => {
    assert.ok(DEFAULT_RULES.includes('CHP-PAN + CHP-PNR + CHP-BAM'), 'chapéus');
  });

  it('Cangas — < 100 → CNG-SAL-70 + CNG-SAL-100', () => {
    const cangaLine = DEFAULT_RULES.split('\n').find(l => l.includes('Cangas'));
    assert.ok(cangaLine.includes('CNG-SAL-70'), 'canga padrão 70');
    assert.ok(cangaLine.includes('CNG-SAL-100'), 'canga padrão 100');
  });

  it('Cangas — ≥ 100 → + CNG-VIS-70 + CNG-VIS-100', () => {
    const cangaLine = DEFAULT_RULES.split('\n').find(l => l.includes('Cangas'));
    assert.ok(cangaLine.includes('CNG-VIS-70'), 'canga viscose 70');
    assert.ok(cangaLine.includes('CNG-VIS-100'), 'canga viscose 100');
  });

  it('Toalhas de Praia → TWL-210 + TWL-280', () => {
    assert.ok(DEFAULT_RULES.includes('TWL-210 + TWL-280'), 'toalhas de praia');
  });

  it('Toalhas de Banho → TBH-LEM + TBH-URC + TBH-IPA', () => {
    assert.ok(DEFAULT_RULES.includes('TBH-LEM + TBH-URC + TBH-IPA'), 'toalhas de banho');
  });

  it('Bonés — < 100 → BNE-TAC-VNL', () => {
    const boneLine = DEFAULT_RULES.split('\n').find(l => l.includes('Bonés'));
    assert.ok(boneLine.includes('BNE-TAC-VNL'), 'boné abaixo de 100');
  });

  it('Bonés — ≥ 100 → BNE-TAC-SUB + BNE-BRI + BNE-PRE', () => {
    const boneLine = DEFAULT_RULES.split('\n').find(l => l.includes('Bonés'));
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
    assert.ok(DEFAULT_RULES.includes('linhas separadas no MESMO objeto'), 'deve instruir linhas separadas');
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
});
