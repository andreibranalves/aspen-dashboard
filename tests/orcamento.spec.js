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
        { sku: 'LNC-SED-70', quantity: 50, description: 'Lenço Sedoso 70cm' },
        { sku: 'LNC-CSD-70', quantity: 50, description: 'Lenço Customizado 70cm' },
        { sku: 'BNE-TAC-VNL', quantity: 20, description: 'Boné Tactel Vanilla' },
      ],
    },
  ],
};

const MOCK_ORCAMENTO = {
  success: true,
  quotation_id: 'ORC-20260001',
  quotation_name: 'ORC-20260001',
  deal_id: 'CRM-DEAL-2026-00001',
  customer_id: 'CUST-001',
  customer_new: true,
  print_url: '/api/view?q=ORC-20260001',
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

// ── Helpers ──

async function setupApiMocks(page) {
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

  // Mock other API calls the page might make on load (quotations list, etc.)
  await page.route('**/api/quotations', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: [] }) });
  });
}

async function setupLeadsMocks(page) {
  let currentDetail = { ...MOCK_LEAD_DETAIL };

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
        address: body.endereco ? { ...currentDetail.address, ...body.endereco } : currentDetail.address,
        modified: '2026-05-20T12:00:00.000Z',
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentDetail) });
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
  });

  test('botão Extrair desabilitado sem texto', async ({ page }) => {
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    const submitBtn = page.getByRole('button', { name: /Extrair/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('botão habilita quando texto é inserido', async ({ page }) => {
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

});

test.describe('Leads — Página single e visualização rápida', () => {
  test('clique na linha abre a página própria do lead', async ({ page }) => {
    await setupLeadsMocks(page);
    await page.goto('/#/leads');

    await expect(page.getByRole('main').getByRole('heading', { name: /Leads \/ Clientes/i })).toBeVisible({ timeout: 10000 });
    await page.getByText('João Silva').first().click();

    await expect(page).toHaveURL(/#\/leads\/lead\/LEAD-001/);
    await expect(page.locator('main h1').filter({ hasText: 'João Silva' }).first()).toBeVisible({ timeout: 10000 });
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

    await expect(page.locator('main h1').filter({ hasText: 'João Silva' }).first()).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /Editar cadastro/i }).click();
    await page.locator('input[placeholder="Nome do lead"]').fill('João Silva Atualizado');
    await page.getByRole('button', { name: /^Salvar$/i }).click();

    await expect(page.getByText(/Cadastro atualizado com sucesso/i)).toBeVisible({ timeout: 10000 });
    await expect(page.locator('main h1').filter({ hasText: 'João Silva Atualizado' }).first()).toBeVisible();
  });
});
