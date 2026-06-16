// tests/unit/whatsapp-flows.test.js
// Testes unitários para o módulo de fluxos WhatsApp:
// renderFlowTemplate, flowToSequencePayload, parseSampleImages, getFlowSummary,
// normalizeFlow, createId, loadWhatsappFlows.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WA_FLOWS,
  createId,
  normalizeFlow,
  loadWhatsappFlows,
  getFlowSummary,
  flowToSequencePayload,
  renderFlowTemplate,
  parseSampleImages,
  getSelectedFlowId,
  saveSelectedFlowId,
} from '../../src/lib/whatsappFlows.js';

// ── DEFAULT_WA_FLOWS ─────────────────────────────────────────────────────────

describe('DEFAULT_WA_FLOWS', () => {
  it('contém 2 fluxos padrão', () => {
    assert.equal(DEFAULT_WA_FLOWS.length, 2);
  });

  it('fluxo padrão "Já estou falando" tem texto + PDF', () => {
    const main = DEFAULT_WA_FLOWS[0];
    assert.equal(main.id, 'already-talking');
    assert.ok(main.steps.length >= 2);
    assert.ok(main.steps.some(s => s.type === 'text' && s.template.includes('(primeiro_nome)')));
    assert.ok(main.steps.some(s => s.type === 'document' && s.source === 'quotation_pdf'));
  });
});

// ── renderFlowTemplate ───────────────────────────────────────────────────────

describe('renderFlowTemplate()', () => {
  it('substitui (nome) pelo nome completo', () => {
    const result = renderFlowTemplate('Olá, (nome)!', { nome: 'João Silva' });
    assert.equal(result, 'Olá, João Silva!');
  });

  it('substitui (primeiro_nome) pelo primeiro nome', () => {
    const result = renderFlowTemplate('Oi, (primeiro_nome)!', { primeiro_nome: 'João' });
    assert.equal(result, 'Oi, João!');
  });

  it('fallback de (nome) para primeiro_nome quando nome ausente', () => {
    const result = renderFlowTemplate('(nome)', { primeiro_nome: 'Maria' });
    assert.equal(result, 'Maria');
  });

  it('fallback de (primeiro_nome) para nome quando primeiro_nome ausente', () => {
    const result = renderFlowTemplate('(primeiro_nome)', { nome: 'Maria Silva' });
    assert.equal(result, 'Maria Silva');
  });

  it('substitui (Saudacao) por saudação baseada em hora', () => {
    const result = renderFlowTemplate('(Saudacao)', {});
    assert.ok(
      ['Bom dia', 'Boa tarde', 'Boa noite'].includes(result),
      `esperado saudação, recebeu: "${result}"`,
    );
  });

  it('substitui (numero_pedido)', () => {
    const result = renderFlowTemplate('Pedido: (numero_pedido)', { numero_pedido: 'ORC-20261143' });
    assert.equal(result, 'Pedido: ORC-20261143');
  });

  it('substitui (link_orcamento)', () => {
    const result = renderFlowTemplate('Link: (link_orcamento)', {
      link_orcamento: 'https://aspen.app/view?q=ORC-001',
    });
    assert.equal(result, 'Link: https://aspen.app/view?q=ORC-001');
  });

  it('substitui (empresa)', () => {
    const result = renderFlowTemplate('(empresa)', { empresa: 'Aspen Estamparia' });
    assert.equal(result, 'Aspen Estamparia');
  });

  it('substitui (vendedora)', () => {
    const result = renderFlowTemplate('At.te, (vendedora)', { vendedora: 'Juliana' });
    assert.equal(result, 'At.te, Juliana');
  });

  it('substitui (produto_resumo)', () => {
    const result = renderFlowTemplate('Produto: (produto_resumo)', { produto_resumo: 'Cangas' });
    assert.equal(result, 'Produto: Cangas');
  });

  it('substitui múltiplas variáveis em um template', () => {
    const tmpl = '(Saudacao), (primeiro_nome)! Segue o orçamento (numero_pedido): (link_orcamento)';
    const ctx = {
      primeiro_nome: 'Ana',
      numero_pedido: 'ORC-001',
      link_orcamento: 'https://link',
    };
    const result = renderFlowTemplate(tmpl, ctx);
    assert.ok(result.includes('Ana'));
    assert.ok(result.includes('ORC-001'));
    assert.ok(result.includes('https://link'));
    assert.ok(!result.includes('(primeiro_nome)'));
  });

  it('deixa variáveis desconhecidas intactas', () => {
    const result = renderFlowTemplate('(variavel_inexistente)', {});
    assert.equal(result, '(variavel_inexistente)');
  });

  it('retorna string vazia para template null/undefined', () => {
    assert.equal(renderFlowTemplate(null, {}), '');
    assert.equal(renderFlowTemplate(undefined, {}), '');
  });
});

// ── parseSampleImages ────────────────────────────────────────────────────────

describe('parseSampleImages()', () => {
  it('parseia formato "categoria: url1, url2"', () => {
    const text = 'canga: https://a.jpg, https://b.jpg\nlenço: https://c.jpg';
    const result = parseSampleImages(text);
    assert.deepEqual(result, {
      canga: ['https://a.jpg', 'https://b.jpg'],
      lenço: ['https://c.jpg'],
    });
  });

  it('retorna objeto vazio para texto vazio', () => {
    assert.deepEqual(parseSampleImages(''), {});
    assert.deepEqual(parseSampleImages(null), {});
    assert.deepEqual(parseSampleImages(undefined), {});
  });

  it('ignora linhas sem ":"', () => {
    const text = 'linha_sem_colon\ncanga: https://a.jpg';
    const result = parseSampleImages(text);
    assert.deepEqual(result, { canga: ['https://a.jpg'] });
  });

  it('ignora categorias sem URLs', () => {
    const text = 'canga: ';
    const result = parseSampleImages(text);
    assert.deepEqual(result, {});
  });
});

// ── flowToSequencePayload ────────────────────────────────────────────────────

describe('flowToSequencePayload()', () => {
  it('already-talking tem delays baixos', () => {
    const payload = flowToSequencePayload(DEFAULT_WA_FLOWS[0]);
    assert.equal(payload.delay_min_ms, 1000);
    assert.equal(payload.delay_max_ms, 2000);
  });

  it('extrai vendor_name', () => {
    const payload = flowToSequencePayload(DEFAULT_WA_FLOWS[0]);
    assert.equal(payload.vendor_name, 'Juliana');
  });

  it('email-first-contact tem max_images_per_category', () => {
    const payload = flowToSequencePayload(DEFAULT_WA_FLOWS[1]);
    assert.equal(payload.max_images_per_category, 2);
  });

  it('filtra passos de texto vazios', () => {
    const flow = {
      ...DEFAULT_WA_FLOWS[0],
      steps: [
        { id: 's1', type: 'text', template: 'Olá' },
        { id: 's2', type: 'text', template: '   ' },
        { id: 's3', type: 'text', template: '' },
        { id: 's4', type: 'product_images' },
      ],
    };
    const payload = flowToSequencePayload(flow);
    assert.equal(payload.steps.length, 2); // s1 + s4 (product_images passa)
    assert.equal(payload.steps[0].template, 'Olá');
  });

  it('inclui product_images steps mesmo sem template', () => {
    const flow = {
      ...DEFAULT_WA_FLOWS[0],
      steps: [{ id: 's1', type: 'product_images' }],
    };
    const payload = flowToSequencePayload(flow);
    assert.equal(payload.steps.length, 1);
    assert.equal(payload.steps[0].type, 'product_images');
  });

  it('parses sample_images_text para objeto', () => {
    const flow = {
      ...DEFAULT_WA_FLOWS[0],
      sample_images_text: 'canga: https://img1.jpg',
      steps: [],
    };
    const payload = flowToSequencePayload(flow);
    assert.deepEqual(payload.sample_images, { canga: ['https://img1.jpg'] });
  });

  it('mantém document source=quotation_pdf como document step (PDF real)', () => {
    const flow = {
      ...DEFAULT_WA_FLOWS[0],
      steps: [
        { id: 's1', type: 'document', source: 'quotation_pdf', caption: 'PDF do orçamento' },
      ],
    };
    const payload = flowToSequencePayload(flow);
    assert.equal(payload.steps.length, 1);
    assert.equal(payload.steps[0].type, 'document');
    assert.equal(payload.steps[0].source, 'quotation_pdf');
  });
});

// ── getFlowSummary ───────────────────────────────────────────────────────────

describe('getFlowSummary()', () => {
  it('conta mensagens de texto com template preenchido', () => {
    const flow = {
      steps: [
        { type: 'text', template: 'Olá' },
        { type: 'text', template: 'Como vai?' },
        { type: 'text', template: '' },
        { type: 'text', template: '   ' },
      ],
    };
    assert.equal(getFlowSummary(flow), '2 mensagens');
  });

  it('inclui "mídia da biblioteca" quando há product_media/product_images', () => {
    const flow = {
      steps: [
        { type: 'text', template: 'Olá' },
        { type: 'product_images' },
      ],
    };
    assert.equal(getFlowSummary(flow), '1 mensagem + mídia da biblioteca');
  });

  it('retorna "vazio" para flow sem passos', () => {
    assert.equal(getFlowSummary({ steps: [] }), 'vazio');
    assert.equal(getFlowSummary(null), '');
  });
});

// ── normalizeFlow ────────────────────────────────────────────────────────────

describe('normalizeFlow()', () => {
  it('preenche campos ausentes com defaults', () => {
    const flow = normalizeFlow({ steps: [] }, 0);
    assert.ok(flow.id, 'deve ter id');
    assert.ok(flow.name, 'deve ter name');
    assert.equal(flow.delay_min_seconds, 1);
    assert.equal(flow.delay_max_seconds, 3);
    assert.equal(flow.max_images_per_category, 0);
    assert.equal(flow.default, false);
  });

  it('normaliza passos', () => {
    const flow = normalizeFlow({
      steps: [{ type: 'text', template: 'Oi' }],
    }, 0);
    assert.equal(flow.steps.length, 1);
    assert.equal(flow.steps[0].id, 'step-0');
    assert.equal(flow.steps[0].template, 'Oi');
  });

  it('preserva valores fornecidos', () => {
    const flow = normalizeFlow({
      id: 'custom-id',
      name: 'Custom',
      delay_min_seconds: 10,
      max_images_per_category: 5,
      steps: [],
    }, 0);
    assert.equal(flow.id, 'custom-id');
    assert.equal(flow.name, 'Custom');
    assert.equal(flow.delay_min_seconds, 10);
    assert.equal(flow.max_images_per_category, 5);
  });
});

// ── loadWhatsappFlows (sem localStorage) ─────────────────────────────────────

describe('loadWhatsappFlows()', () => {
  it('retorna defaults normalizados quando sem localStorage', () => {
    const flows = loadWhatsappFlows();
    assert.equal(flows.length, 2);
    assert.ok(flows[0].id);
    assert.ok(Array.isArray(flows[0].steps));
  });
});

// ── getSelectedFlowId ────────────────────────────────────────────────────────

describe('getSelectedFlowId()', () => {
  it('retorna primeiro ID quando sem localStorage', () => {
    const flows = loadWhatsappFlows();
    const id = getSelectedFlowId(flows);
    assert.equal(id, flows[0].id);
  });

  it('retorna null para lista vazia', () => {
    assert.equal(getSelectedFlowId([]), null);
  });
});

// ── saveSelectedFlowId (no-op em SSR) ────────────────────────────────────────

describe('saveSelectedFlowId()', () => {
  it('não lança erro em ambiente sem localStorage (Node)', () => {
    assert.doesNotThrow(() => saveSelectedFlowId('test-id'));
  });
});

// ── createId ─────────────────────────────────────────────────────────────────

describe('createId()', () => {
  it('cria ID com prefixo', () => {
    const id = createId('flow');
    assert.ok(id.startsWith('flow_'));
    assert.ok(id.length > 6);
  });

  it('cria IDs diferentes em chamadas consecutivas', () => {
    const id1 = createId();
    const id2 = createId();
    assert.notEqual(id1, id2);
  });
});
