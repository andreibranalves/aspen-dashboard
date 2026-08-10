// @ts-check
import { test, expect } from '@playwright/test';

const TEST_INPUT = '50 lenços e 20 bonés. Cliente: João Silva, joao@teste.com, (11) 99999-0001';

// ── Mock responses ──

const MOCK_EXTRACT = {
  orders: [
    {
      nome: 'João Silva',
      email: 'joao@teste.com',
      telefone: '(11) 99999-0001',
      urgente: false,
      items: [
        { item_code: 'LNC-SED-70', qty: 50, sku: 'LNC-SED-70', description: 'Lenço Sedoso 70cm' },
        { item_code: 'LNC-CSD-70', qty: 50, sku: 'LNC-CSD-70', description: 'Lenço Customizado 70cm' },
        { item_code: 'BNE-TAC-VNL', qty: 20, sku: 'BNE-TAC-VNL', description: 'Boné Tactel Vanilla' },
      ],
    },
  ],
};

const MOCK_TEMPLATES = {
  templates: [
    { key: 'padrao', name: 'Padrão Aspen', is_default: true },
    { key: 'minimalista', name: 'Minimalista', is_default: false },
  ],
  default_key: 'padrao',
};

const MOCK_ORCAMENTO = {
  success: true,
  quotation_id: 'ORC-20260001',
  quotation_name: 'ORC-20260001',
  quotation_uuid: '11111111-1111-4111-8111-111111111101',
  revision_id: '22222222-2222-4222-8222-222222222201',
  revision_number: 1,
  deal_id: 'CRM-DEAL-2026-00001',
  customer_id: 'CUST-001',
  customer_new: true,
  core_mode: true,
  source: 'postgres',
};

const MOCK_LEADS_LIST = {
  success: true,
  data: [
    {
      id: 'LEAD-001',
      nome: 'João Silva',
      email: 'joao@teste.com',
      telefone: '(11) 99999-0001',
      tipo: 'lead',
    },
    {
      id: 'CUST-001',
      nome: 'Aspen Cliente Antigo',
      email: 'cliente@teste.com',
      telefone: '(21) 98888-0002',
      tipo: 'cliente',
    },
  ],
  pagination: { page: 1, limit: 50, total: 2, total_pages: 1 },
  core_mode: false,
  source: 'frappe',
};

const MOCK_LEAD_DETAIL = {
  success: true,
  doctype: 'Lead',
  name: 'LEAD-001',
  display_name: 'João Silva',
  email: 'joao@teste.com',
  telefone: '(11) 99999-0001',
  origem: 'Google Ads',
  person_type: 'pj',
  tax_id: '12345678000199',
  empresa: 'Silva Eventos',
  contribuinte: '9',
  inscricao_estadual: 'ISENTO',
  creation: '2026-05-20T10:00:00.000Z',
  modified: '2026-05-20T11:00:00.000Z',
  erp_url: 'https://aspenestamparia.l.frappe.cloud/app/lead/LEAD-001',
  address: {
    complete: true,
    endereco: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    complemento: 'Sala 4',
    municipio: 'São Paulo',
    uf: 'SP',
    cep: '01001000',
  },
  latest_quotation: {
    name: 'ORC-20260001',
    status: 'Open',
    grand_total: 3500,
    date: '2026-05-20',
  },
  deal: {
    name: 'CRM-DEAL-001',
    status: 'Orcamento Enviado',
    follow_up_stage: 0,
    next_step: 'Enviar follow-up amanhã',
    quotation: 'ORC-20260001',
  },
  quality_flags: [],
};

const MOCK_WHATSAPP_LEADS = {
  success: true,
  data: [
    {
      id: '5511999991234@s.whatsapp.net',
      remoteJid: '5511999991234@s.whatsapp.net',
      nome: 'Maria WhatsApp',
      telefone: '5511999991234',
      email: 'maria@teste.com',
      produto: 'canga',
      quantidade: 100,
      resumo: 'Cliente: preciso de 100 cangas',
      texto:
        'Nome: Maria WhatsApp\nE-mail: maria@teste.com\nTelefone: 5511999991234\nPedido: canga — 100 un',
    },
  ],
};

// ── Helpers ──

async function setupApiMocks(page) {
  await page.route('**/api/settings**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ operational_mode: false }),
    });
  });

  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_TEMPLATES),
    });
  });

  await page.route('**/api/extract', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_EXTRACT),
    });
  });

  await page.route('**/api/orcamento', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ORCAMENTO),
    });
  });

  await page.route('**/api/pricing-lookup**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, items: [] }),
    });
  });

  // Mock other API calls the page might make on load.
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route('**/api/communication-flows**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route('**/api/quote-leads**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: MOCK_WHATSAPP_LEADS.data.map((lead) => ({
          ...lead,
          pedidoTexto: lead.resumo,
        })),
      }),
    });
  });

  await page.route('**/api/whatsapp-leads**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_WHATSAPP_LEADS),
    });
  });
}

async function setupLeadsMocks(page) {
  let currentDetail = { ...MOCK_LEAD_DETAIL };

  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route('**/api/communication-flows**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: [] }),
    });
  });

  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_LEADS_LIST),
    });
  });

  await page.route('**/api/client-detail**', async (route) => {
    if (route.request().method() === 'PUT') {
      const body = route.request().postDataJSON();
      currentDetail = {
        ...currentDetail,
        display_name: body.nome || currentDetail.display_name,
        email: body.email || currentDetail.email,
        telefone: body.telefone || currentDetail.telefone,
        origem: body.origem || currentDetail.origem,
        empresa: body.empresa || currentDetail.empresa,
        person_type: body.person_type || currentDetail.person_type,
        tax_id: body.tax_id || currentDetail.tax_id,
        contribuinte: body.contribuinte || currentDetail.contribuinte,
        inscricao_estadual: body.inscricao_estadual || currentDetail.inscricao_estadual,
        address: body.endereco
          ? { ...currentDetail.address, ...body.endereco }
          : currentDetail.address,
        modified: '2026-05-20T12:00:00.000Z',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(currentDetail),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(currentDetail),
    });
  });
}

// ── Tests ──

test.describe('Auto Quote — Fluxo Principal', () => {
  test('página /auto carrega com formulário visível', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/auto');
    // Aguarda React montar
    await page.waitForSelector('textarea', { timeout: 10000 });

    // O textarea principal tem placeholder sobre "João pediu"
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible();
    await expect(textarea).toBeEnabled();

    // Botão "Extrair"
    await expect(page.getByRole('button', { name: /Extrair/i })).toBeVisible();
  });

  test('submissão de texto exibe rascunhos para revisão', async ({ page }) => {
    await setupApiMocks(page);
    /** @type {any} */
    let quoteRequest;
    await page.route('**/api/orcamento', async (route) => {
      quoteRequest = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_ORCAMENTO) });
    });
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Preenche o textarea principal
    const textarea = page.locator('textarea').first();
    await textarea.fill(TEST_INPUT);
    await expect(textarea).toHaveValue(TEST_INPUT);

    // Clica "Extrair"
    const submitBtn = page.getByRole('button', { name: /Extrair/i });
    await submitBtn.click();

    // Aguarda a extração terminar e os rascunhos aparecerem
    // O texto "Resultados (1)" aparece quando os drafts estão prontos
    await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });

    // Deve mostrar "Pedido 1 de 1" confirmando que o rascunho foi renderizado
    await expect(page.getByText(/Pedido 1 de 1/i)).toBeVisible({ timeout: 10000 });
    const customItemName = 'Lenço 100 x 100 cm';
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByLabel('Nome exibido no orçamento LNC-SED-70').fill(customItemName);
    await expect(page.getByLabel('Modelo HTML')).toHaveValue('padrao');
    await page.getByLabel('Modelo HTML').selectOption('minimalista');
    await page.getByRole('button', { name: 'Criar orçamento' }).click();
    await expect.poll(() => quoteRequest?.extracted?.items?.[0]?.item_name, { timeout: 10000 }).toBe(customItemName);
    await expect.poll(() => quoteRequest?.extracted?.template_key, { timeout: 10000 }).toBe('minimalista');
    const quotationLink = page.getByRole('link', { name: 'Abrir orçamento' });
    await expect(quotationLink).toBeVisible();
    await expect(quotationLink).toHaveAttribute('href', '/#/quotations/ORC-20260001');
    await expect(quotationLink).toHaveAttribute('target', '_blank');
    await expect(quotationLink.getByRole('button')).toHaveCount(0);
  });

  test('falha ao carregar modelos não bloqueia formulário e permite retry', async ({ page }) => {
    await setupApiMocks(page);
    let templateAttempts = 0;
    await page.route('**/api/quotation-templates**', async (route) => {
      templateAttempts += 1;
      await route.fulfill(templateAttempts === 1
        ? { status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'indisponível' }) }
        : { status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TEMPLATES) });
    });
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });
    await expect(page.getByRole('button', { name: /Extrair/i })).toBeVisible();
    await expect(page.getByText('Não foi possível carregar os modelos HTML.')).toBeVisible({ timeout: 10000 });

    const textarea = page.locator('textarea').first();
    await textarea.fill('50 lenços');
    await expect(textarea).toHaveValue('50 lenços');
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByRole('button', { name: 'Tentar novamente' })).toHaveCount(0);
    await page.getByRole('button', { name: /Extrair/i }).click();
    await expect(page.getByText(/Resultados \(1\)/i)).toBeVisible({ timeout: 30000 });
    await expect(page.getByLabel('Modelo HTML')).toBeEnabled();
    await expect(page.getByLabel('Modelo HTML')).toHaveValue('padrao');
    expect(templateAttempts).toBeGreaterThanOrEqual(2);
  });

  test('botão Extrair desabilitado sem texto', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    const submitBtn = page.getByRole('button', { name: /Extrair/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('botão habilita quando texto é inserido', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    const textarea = page.locator('textarea').first();
    const submitBtn = page.getByRole('button', { name: /Extrair/i });

    // Começa desabilitado
    await expect(submitBtn).toBeDisabled();

    // Preenche texto → habilita
    await textarea.fill('50 lenços');
    await expect(submitBtn).toBeEnabled();
  });

  test('card do WhatsApp preenche a textarea sem extrair automaticamente', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    await page.getByRole('button', { name: /^Leads$/i }).click();
    const quoteLead = page.getByRole('button').filter({ hasText: 'Maria WhatsApp' });
    await expect(quoteLead).toBeVisible();
    await quoteLead.click();

    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue(MOCK_WHATSAPP_LEADS.data[0].texto);
    await expect(page.getByText(/Resultados \(/i)).toHaveCount(0);
  });
});

test.describe('Leads — Página single e visualização rápida', () => {
  test('clique na linha abre a página própria do lead', async ({ page }) => {
    await setupLeadsMocks(page);
    await page.goto('/#/leads');

    await expect(page.getByRole('main').getByRole('heading', { name: /^Leads$/i })).toBeVisible({
      timeout: 10000,
    });
    await page.locator('tbody tr').filter({ hasText: 'João Silva' }).first().click();

    await expect(page).toHaveURL(/#\/leads\/lead\/LEAD-001/);
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'João Silva', level: 2 })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Silva Eventos/i).first()).toBeVisible();
    await expect(page.getByText(/Atividade recente/i)).toBeVisible();
    await expect(page.getByText(/ORC-20260001/i).first()).toBeVisible();
  });

  test('botão de visualização rápida mantém o drawer na lista', async ({ page }) => {
    await setupLeadsMocks(page);
    await page.goto('/#/leads');

    await page.getByRole('button', { name: /Visualização rápida João Silva/i }).click();

    await expect(page).toHaveURL(/#\/leads$/);
    await expect(page.getByText(/Dados gerais/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /Editar/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Página completa/i })).toBeVisible();
  });

  test('página própria permite editar e salvar o cadastro', async ({ page }) => {
    await setupLeadsMocks(page);
    await page.goto('/#/leads/lead/LEAD-001');

    await expect(
      page.getByRole('main').getByRole('heading', { name: 'João Silva', level: 2 })
    ).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Editar cadastro/i }).click();
    await page.locator('input[placeholder="Nome do lead"]').fill('João Silva Atualizado');
    await page.getByRole('button', { name: /^Salvar$/i }).click();

    await expect(page.getByText(/Cadastro atualizado com sucesso/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'João Silva Atualizado', level: 2 })
    ).toBeVisible();
  });
});

test.describe('Orçamento manual — clientes unificados', () => {
  test('usa a resposta core_mode para mostrar Cliente e não oferece escolha de Lead', async ({ page }) => {
    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ id: 'CLIENT-001', nome: 'Cliente Core', email: 'core@example.com', telefone: '5511999990000', tipo: 'cliente' }],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
          core_mode: true,
          source: 'postgres',
        }),
      });
    });
    await page.route('**/api/products**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
    });

    await page.goto('/#/manual');
    await page.getByRole('button', { name: 'Buscar cliente existente' }).click();
    await page.getByRole('textbox', { name: 'Buscar cliente' }).fill('Core');
    await expect(page.getByText('Cliente Core', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Cliente', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Origem da venda *', { exact: true })).toBeVisible();
  });
});
