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

    // Botão "Analisar pedido"
    await expect(page.getByRole('button', { name: /Analisar pedido/i })).toBeVisible();
  });

  test('submissão de texto exibe rascunhos para revisão', async ({ page }) => {
    await setupApiMocks(page);
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    // Preenche o textarea principal
    const textarea = page.locator('textarea').first();
    await textarea.fill(TEST_INPUT);
    await expect(textarea).toHaveValue(TEST_INPUT);

    // Clica "Analisar pedido"
    const submitBtn = page.getByRole('button', { name: /Analisar pedido/i });
    await submitBtn.click();

    // Aguarda a fase de "extraindo" passar e os rascunhos aparecerem
    // O texto "em revisão" aparece quando os drafts estão prontos
    await expect(page.getByText(/em revisão/i)).toBeVisible({ timeout: 30000 });

    // Deve mostrar "Pedido 1 de 1" confirmando que o rascunho foi renderizado
    await expect(page.getByText(/Pedido 1 de 1/i)).toBeVisible({ timeout: 10000 });
  });

  test('botão Analisar pedido desabilitado sem texto', async ({ page }) => {
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    const submitBtn = page.getByRole('button', { name: /Analisar pedido/i });
    await expect(submitBtn).toBeDisabled();
  });

  test('botão habilita quando texto é inserido', async ({ page }) => {
    await page.goto('/#/auto');
    await page.waitForSelector('textarea', { timeout: 10000 });

    const textarea = page.locator('textarea').first();
    const submitBtn = page.getByRole('button', { name: /Analisar pedido/i });

    // Começa desabilitado
    await expect(submitBtn).toBeDisabled();

    // Preenche texto → habilita
    await textarea.fill('50 lenços');
    await expect(submitBtn).toBeEnabled();
  });

});
