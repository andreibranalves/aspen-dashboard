// @ts-check
import { expect, test } from '@playwright/test';

const PRODUCT = {
  sku: 'NOVO-001',
  nome: 'Produto do novo orçamento',
  pricing_available: true,
};
const PRODUCT_B = {
  sku: 'NOVO-002',
  nome: 'Segundo produto do novo orçamento',
  pricing_available: true,
};

const TEMPLATES = {
  templates: [
    { key: 'padrao', name: 'Padrão Aspen', is_default: true },
    { key: 'minimalista', name: 'Minimalista', is_default: false },
  ],
  default_key: 'padrao',
};

function order(nome, itemCode = PRODUCT.sku) {
  return {
    nome,
    email: `${nome.toLowerCase().replaceAll(' ', '.')}@example.test`,
    telefone: '5511999990000',
    origem: 'Google Ads',
    items: [{ item_code: itemCode, item_name: PRODUCT.nome, qty: 10 }],
  };
}

async function mockSharedApis(page, extractHandler, {
  pricingHandler,
  productData = [PRODUCT],
  orderTemplateData = [],
} = {}) {
  const unexpectedApiRequests = [];
  await page.route('**/api/**', (route) => {
    if (!new globalThis.URL(route.request().url()).pathname.startsWith('/api/')) return route.fallback();
    unexpectedApiRequests.push({ method: route.request().method(), url: route.request().url() });
    return route.abort();
  });
  await page.route('**/api/quotation-templates**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(TEMPLATES),
  }));
  await page.route('**/api/order-templates**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: orderTemplateData }),
  }));
  await page.route('**/api/communication-flows**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ flows: [] }),
  }));
  await page.route('**/api/products**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: productData }),
  }));
  await page.route('**/api/pricing-lookup**', pricingHandler || ((route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true, items: [{ item_code: PRODUCT.sku, rate: '12.50' }] }),
  })));
  await page.route('**/api/quotations**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ data: {} }),
  }));
  await page.route('**/api/extract', extractHandler);
  return { unexpectedApiRequests };
}

test.describe('Novo orçamento unificado @quotations', () => {
  test('aliases iniciam no modo correspondente sem rota paralela', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));

    await page.goto('/#/auto');
    await expect(page.getByRole('tab', { name: 'Da conversa' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/#/manual');
    await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
    await page.goto('/#/novo-orcamento');
    await expect(page.getByRole('tab', { name: 'Da conversa' })).toHaveAttribute('aria-selected', 'true');
  });

  test('preserva os campos e o preço manual ao alternar entre Manual e Da conversa', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));

    await page.goto('/#/novo-orcamento');
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByLabel('Nome do cliente').fill('Cliente alternância');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await expect(page.getByText(PRODUCT.nome)).toBeVisible();
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await page.getByLabel(`Quantidade de ${PRODUCT.sku}`).fill('7');
    await page.getByLabel(`Preço unitário de ${PRODUCT.sku}`).fill('19.75');
    await page.getByLabel('Prazo de produção').fill('10 dias');
    await page.getByLabel('Observações do orçamento').fill('Condição negociada');

    await page.getByRole('tab', { name: 'Da conversa' }).click();
    await expect(page.getByText(/Resultados \(1\)/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cliente Alternância' })).toBeVisible();

    await page.getByRole('tab', { name: 'Manual' }).click();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('Cliente alternância');
    await expect(page.getByLabel(`Quantidade de ${PRODUCT.sku}`)).toHaveValue('7');
    await expect(page.getByLabel(`Preço unitário de ${PRODUCT.sku}`)).toHaveValue('19.75');
    await expect(page.getByLabel('Prazo de produção')).toHaveValue('10 dias');
    await expect(page.getByLabel('Observações do orçamento')).toHaveValue('Condição negociada');
  });

  test('mantém a extração por imagem e isola resultado novo ou falha do trabalho ativo', async ({ page }) => {
    let extractionCount = 0;
    const requests = [];
    await mockSharedApis(page, async (route) => {
      extractionCount += 1;
      requests.push(route.request().postDataJSON());
      if (extractionCount === 3) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'falha controlada' }) });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ orders: [order(extractionCount === 1 ? 'Cliente imagem' : 'Cliente novo')] }),
      });
    });

    await page.goto('/#/novo-orcamento');
    await page.locator('#new-quotation-image').setInputFiles({
      name: 'pedido.png',
      mimeType: 'image/png',
      buffer: globalThis.Buffer.from('imagem fictícia'),
    });
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByText(/Resultados \(1\)/)).toBeVisible();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].imageBase64).toBeTruthy();

    await page.getByLabel('Mensagem do cliente para extração').fill('novo pedido');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByText('Novo resultado para revisão (1/1)', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cliente Imagem' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Cliente novo');

    await page.getByLabel('Mensagem do cliente para extração').fill('falha posterior');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByRole('alert').getByText('Não foi possível extrair os pedidos. Tente novamente.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cliente Imagem' })).toBeVisible();
    await expect(page.getByLabel('Nome', { exact: true })).toHaveValue('Cliente novo');
  });

  test('identifica o draft ativo quando a conversa produz múltiplos pedidos', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [order('Cliente um'), order('Cliente dois')] }),
    }));

    await page.goto('/#/auto');
    await page.getByLabel('Mensagem do cliente para extração').fill('dois pedidos');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByText(/Resultados \(2\)/)).toBeVisible();
    await expect(page.getByLabel('Rascunho ativo')).toHaveValue('0');
    await page.getByLabel('Rascunho ativo').selectOption('1');
    await expect(page.getByText(/ativo: Cliente dois/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cliente dois' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cliente um' })).toHaveCount(0);
  });

  test('restaura o rascunho manual do localStorage ao recarregar', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));

    await page.goto('/#/manual');
    await page.getByLabel('Nome do cliente').fill('Cliente persistido');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await expect.poll(() => page.evaluate(() => Boolean(globalThis.localStorage.getItem('aspen_manual_draft')))).toBe(true);
    await page.reload();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('Cliente persistido');
    await expect(page.getByLabel('Origem *')).toHaveValue('Google Ads');
  });

  test('preserva a origem e os IDs do prefill do CRM no payload manual', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));
    await page.addInitScript(() => globalThis.sessionStorage.setItem('aspen_quotation_origin_prefill', JSON.stringify({
      quoteLeadId: 'lead-ficticio',
      crmDealId: 'deal-ficticio',
      leadName: 'Cliente CRM',
      email: 'crm@example.test',
      telefone: '5511999990000',
      source: 'site_form',
    })));
    let payload;
    await page.route('**/api/orcamento', async (route) => {
      payload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ quotation_id: 'ORC-FICTICIO', quote_id: 'quote-ficticio', revision_id: 'revision-ficticia' }),
      });
    });

    await page.goto('/#/manual?quoteLeadId=lead-ficticio&crmDealId=deal-ficticio');
    await expect(page.getByText('Origem: Formulário do site', { exact: true })).toBeVisible();
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect.poll(() => payload).toBeTruthy();
    expect(payload.extracted.quote_lead_id).toBe('lead-ficticio');
    expect(payload.extracted.crm_deal_id).toBe('deal-ficticio');
  });

  test('recalcula apenas preços automáticos ao mudar quantidade e urgência', async ({ page }) => {
    const pricingRequests = [];
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }), {
      productData: [PRODUCT, PRODUCT_B],
      pricingHandler: async (route) => {
        const body = route.request().postDataJSON();
        pricingRequests.push(body);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            items: body.items.map((item) => ({ item_code: item.item_code, rate: body.urgent ? 30 : item.qty === 50 ? 20 : 12 })),
          }),
        });
      },
    });

    await page.goto('/#/manual');
    await page.getByLabel('Nome do cliente').fill('Cliente preço');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    const productSearch = page.getByLabel('Buscar produto para adicionar ao orçamento');
    await productSearch.fill(PRODUCT.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await productSearch.fill(PRODUCT_B.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT_B.sku} ao orçamento` }).click();

    await page.getByLabel(`Quantidade de ${PRODUCT.sku}`).fill('50');
    await expect(page.getByLabel(`Preço unitário de ${PRODUCT.sku}`)).toHaveValue('20');
    await page.getByLabel(`Preço unitário de ${PRODUCT_B.sku}`).fill('99');
    await page.getByLabel('Pedido urgente').check();
    await expect(page.getByLabel(`Preço unitário de ${PRODUCT.sku}`)).toHaveValue('30');
    await expect(page.getByLabel(`Preço unitário de ${PRODUCT_B.sku}`)).toHaveValue('99');
    expect(pricingRequests.at(-1).urgent).toBe(true);
    expect(pricingRequests.at(-1).items.map((item) => item.item_code)).toEqual([PRODUCT.sku]);
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('compartilha o save entre Salvar e Emitir e não duplica o POST', async ({ page }) => {
    let releaseSave;
    const saveGate = new Promise((resolve) => { releaseSave = resolve; });
    let saveRequests = 0;
    let issueRequests = 0;
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));
    await page.route('**/api/orcamento', async (route) => {
      saveRequests += 1;
      await saveGate;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ quotation_uuid: 'quotation-race', quotation_id: 'ORC-RACE', revision_id: 'revision-race', concurrency_token: 'token-race' }),
      });
    });
    await page.route('**/api/quotation-issues', async (route) => {
      issueRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ quotationId: 'quotation-race', businessNumber: 'ORC-RACE', revisionId: 'revision-race', revisionNumber: 1, status: 'emitido', issuedAt: '2026-09-08T00:00:00.000Z', validUntil: '2026-09-23', pdfUrl: '/api/quotation-preview?id=quotation-race&format=pdf' }),
      });
    });

    await page.goto('/#/manual');
    await page.getByLabel('Nome do cliente').fill('Cliente corrida');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).click();
    await expect.poll(() => saveRequests).toBe(1);
    expect(issueRequests).toBe(0);
    releaseSave();
    await expect.poll(() => issueRequests).toBe(1);
    await expect.poll(() => page.url()).toContain('#/quotations/quotation-race');
    expect(saveRequests).toBe(1);
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('ignora duplo clique de emissão com um único save e issue', async ({ page }) => {
    let saveRequests = 0;
    let issueRequests = 0;
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));
    await page.route('**/api/orcamento', async (route) => {
      saveRequests += 1;
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ quotation_uuid: 'quotation-double', quotation_id: 'ORC-DOUBLE', revision_id: 'revision-double', concurrency_token: 'token-double' }) });
    });
    await page.route('**/api/quotation-issues', async (route) => {
      issueRequests += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ quotationId: 'quotation-double', businessNumber: 'ORC-DOUBLE', revisionId: 'revision-double', revisionNumber: 1, status: 'emitido', issuedAt: '2026-09-08T00:00:00.000Z', validUntil: '2026-09-23', pdfUrl: '/api/quotation-preview?id=quotation-double&format=pdf' }) });
    });
    await page.goto('/#/manual');
    await page.getByLabel('Nome do cliente').fill('Cliente duplo');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await page.getByRole('button', { name: 'Emitir orçamento', exact: true }).dblclick({ force: true });
    await expect.poll(() => saveRequests).toBe(1);
    await expect.poll(() => issueRequests).toBe(1);
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('rejeita resposta de save sem token de concorrência', async ({ page }) => {
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));
    await page.route('**/api/orcamento', (route) => route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ quotation_uuid: 'quotation-no-token', quotation_id: 'ORC-NO-TOKEN', revision_id: 'revision-no-token' }),
    }));
    await page.goto('/#/manual');
    await page.getByLabel('Nome do cliente').fill('Cliente sem token');
    await page.getByLabel('Origem *').selectOption('Google Ads');
    await page.getByLabel('Buscar produto para adicionar ao orçamento').fill(PRODUCT.sku);
    await page.getByRole('button', { name: `Adicionar ${PRODUCT.sku} ao orçamento` }).click();
    await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
    await expect(page.getByRole('alert').getByText('Não foi possível salvar o rascunho. Tente novamente.', { exact: true })).toBeVisible();
    expect(page.url()).toContain('#/manual');
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('mantém irmãos pendentes, fila nova e ativo ao aplicar ou descartar', async ({ page }) => {
    let extractionCount = 0;
    const { unexpectedApiRequests } = await mockSharedApis(page, async (route) => {
      extractionCount += 1;
      const orders = extractionCount === 1
        ? [order('Cliente ativo')]
        : extractionCount === 2
          ? [order('Pendente um'), order('Pendente dois')]
          : [order('Pendente três')];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders }) });
    });
    await page.goto('/#/novo-orcamento');
    const input = page.getByLabel('Mensagem do cliente para extração');
    await input.fill('ativo');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByRole('heading', { name: 'Cliente ativo' })).toBeVisible();
    await input.fill('pendentes');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByText('Novo resultado para revisão (2/2)', { exact: true })).toBeVisible();
    await input.fill('mais um');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByText('Novo resultado para revisão (3/3)', { exact: true })).toBeVisible();

    const pendingCards = page.getByText(/Novo resultado para revisão \(/).locator('..');
    await pendingCards.nth(0).getByRole('button', { name: 'Aplicar ao orçamento ativo' }).click();
    await expect(page.getByText('Novo resultado para revisão (2/2)', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pendente um' })).toBeVisible();
    await page.getByLabel('Rascunho ativo').selectOption('0');
    await expect(page.getByRole('heading', { name: 'Cliente ativo' })).toBeVisible();
    await page.getByText('Novo resultado para revisão (2/2)', { exact: true }).locator('..').getByRole('button', { name: 'Descartar resultado' }).click();
    await expect(page.getByText('Novo resultado para revisão (1/1)', { exact: true })).toBeVisible();
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('preserva um rascunho salvo ao alternar sem editar', async ({ page }) => {
    const savedDraft = {
      index: 0,
      original: { nome: 'Cliente salvo' },
      edited: {
        nome: 'Cliente salvo', email: 'salvo@example.test', telefone: '5511999990000', urgente: false,
        origem: 'Google Ads', cnpj: '', prazo_producao: '', endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
        items: [{ item_code: PRODUCT.sku, item_name: PRODUCT.nome, qty: 10, rate: 12, _rateManual: false }], template_key: 'padrao',
      },
      approved: false, discarded: false,
      saved: { quotationId: 'quotation-saved', businessNumber: 'ORC-SAVED', revisionId: 'revision-saved', concurrencyToken: 'token-saved' },
    };
    await page.addInitScript((draft) => globalThis.sessionStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [draft] })), savedDraft);
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) }));
    await page.goto('/#/novo-orcamento');
    await page.getByRole('tab', { name: 'Manual' }).click();
    await page.getByRole('tab', { name: 'Da conversa' }).click();
    await expect(page.getByText('Rascunho salvo. Continue a revisão ou emita o orçamento.')).toBeVisible();
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('encaminha draft já emitido ao detalhe canônico ao tentar alternar', async ({ page }) => {
    const issuedDraft = {
      index: 0,
      original: { nome: 'Cliente emitido' },
      edited: {
        nome: 'Cliente emitido', email: 'emitido@example.test', telefone: '5511999990000', urgente: false,
        origem: 'Google Ads', cnpj: '', prazo_producao: '', endereco: { cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' },
        items: [{ item_code: PRODUCT.sku, item_name: PRODUCT.nome, qty: 10, rate: 12, _rateManual: false }], template_key: 'padrao',
      },
      approved: false, discarded: false,
      issueIdempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
      issue: { quotationId: 'quotation-issued', businessNumber: 'ORC-ISSUED', revisionId: 'revision-issued', revisionNumber: 1, status: 'emitido', issuedAt: '2026-09-08T00:00:00.000Z', validUntil: '2026-09-23', pdfUrl: '/api/quotation-preview?id=quotation-issued&format=pdf' },
    };
    await page.addInitScript((draft) => globalThis.sessionStorage.setItem('aspen_drafts', JSON.stringify({ version: 1, drafts: [draft] })), issuedDraft);
    await mockSharedApis(page, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) }));
    await page.goto('/#/novo-orcamento');
    await page.getByRole('tab', { name: 'Manual' }).click();
    await expect.poll(() => page.url()).toContain('#/quotations/quotation-issued');
  });

  test('restaura manual pela rota comum e ignora storage malformado', async ({ page }) => {
    await page.addInitScript(() => {
      if (globalThis.localStorage.getItem('aspen_manual_draft')) return;
      globalThis.localStorage.setItem('aspen_manual_draft', JSON.stringify({
      version: 1, clientType: 'new', clientSearch: '', selectedClient: null,
      newClient: { nome: 'Cliente rota comum', email: '', telefone: '' }, leadSource: 'Google Ads', cnpj: '',
      address: {}, showAddress: false, items: [], prazo: '', observacoes: '', urgente: false, templateKey: '',
      }));
    });
    await mockSharedApis(page, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) }));
    await page.goto('/#/novo-orcamento');
    await page.getByRole('tab', { name: 'Manual' }).click();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('Cliente rota comum');

    await page.evaluate(() => globalThis.localStorage.setItem('aspen_manual_draft', '{broken'));
    await page.reload();
    await page.getByRole('tab', { name: 'Manual' }).click();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('');
  });

  test('envia seleções @ e rejeita modelo desconhecido', async ({ page }) => {
    const requests = [];
    const orderTemplate = { id: 'template-kit', name: 'Kit Probe', archived: false, items: [], created_at: '', updated_at: '' };
    const { unexpectedApiRequests } = await mockSharedApis(page, async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) });
    }, { orderTemplateData: [orderTemplate] });
    await page.goto('/#/novo-orcamento');
    await page.getByLabel('Mensagem do cliente para extração').fill('2 @kit_probe');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].orderTemplateSelections).toEqual([{ id: 'template-kit', quantity: 2 }]);
    await page.getByLabel('Mensagem do cliente para extração').fill('1 @inexistente');
    await page.getByRole('button', { name: 'Extrair dados' }).click();
    await expect(page.getByRole('alert')).toContainText('Modelo não encontrado: @inexistente.');
    expect(requests).toHaveLength(1);
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('drawer só aplica alterações confirmadas e mantém a página sem overflow em 390px', async ({ page }) => {
    const { unexpectedApiRequests } = await mockSharedApis(page, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orders: [] }) }));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/manual');
    const trigger = page.getByRole('button', { name: 'Novo cliente' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Cliente do orçamento' });
    await dialog.getByLabel('Nome do cliente', { exact: true }).fill('Não aplicar');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('');
    await trigger.click();
    await dialog.getByLabel('Nome do cliente', { exact: true }).fill('Aplicado');
    await dialog.getByRole('button', { name: 'Aplicar ao rascunho' }).click();
    await expect(page.getByLabel('Nome do cliente')).toHaveValue('Aplicado');
    const metrics = await page.evaluate(() => {
      const main = globalThis.document.querySelector('main');
      const shell = main?.firstElementChild;
      return {
        main: main ? [main.clientWidth, main.scrollWidth] : null,
        shell: shell ? [shell.clientWidth, shell.scrollWidth] : null,
        tabs: globalThis.document.querySelector('[role="tablist"]')?.getAttribute('aria-label'),
        tabpanel: globalThis.document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby'),
      };
    });
    expect(metrics.main[1]).toBeLessThanOrEqual(metrics.main[0]);
    expect(metrics.shell[1]).toBeLessThanOrEqual(metrics.shell[0]);
    expect(metrics.tabs).toBe('Modo de criação');
    expect(metrics.tabpanel).toBe('quotation-mode-tab-manual');
    expect(unexpectedApiRequests).toEqual([]);
  });

  test('mantém teclado e foco no seletor de modo e no painel lateral', async ({ page }) => {
    await mockSharedApis(page, (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ orders: [] }),
    }));

    await page.goto('/#/novo-orcamento');
    const conversationTab = page.getByRole('tab', { name: 'Da conversa' });
    await conversationTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Manual' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab', { name: 'Manual' })).toBeFocused();

    const newClientTrigger = page.getByRole('button', { name: 'Novo cliente' });
    await newClientTrigger.click();
    const dialog = page.getByRole('dialog', { name: 'Cliente do orçamento' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Nome do cliente', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(newClientTrigger).toBeFocused();
  });
});
