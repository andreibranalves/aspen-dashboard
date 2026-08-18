// @ts-check
import { expect, test } from '@playwright/test';

const DEFAULT_TEMPLATE = {
  subject: 'Orçamento {{numero_orcamento}} - Aspen',
  greeting: 'Olá, {{nome_cliente}}.',
  message: 'Segue o orçamento {{numero_orcamento}} em anexo.',
  button_label: 'Ver orçamento',
  signature: 'Atenciosamente,\nAspen',
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ initial?: typeof DEFAULT_TEMPLATE, failGets?: number, putStatus?: number }} [options]
 */
async function mockTemplateApi(page, options = {}) {
  let template = { ...DEFAULT_TEMPLATE, ...(options.initial || {}) };
  let getCalls = 0;
  const puts = [];
  await page.route('**/api/quotation-email-template', async (route) => {
    if (route.request().method() === 'GET') {
      getCalls += 1;
      if (getCalls <= (options.failGets || 0)) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Falha temporária.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(template),
      });
      return;
    }

    const payload = route.request().postDataJSON();
    puts.push(payload);
    if (options.putStatus && options.putStatus >= 400) {
      await route.fulfill({
        status: options.putStatus,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Não foi possível salvar o modelo de e-mail. Tente novamente.' }),
      });
      return;
    }
    template = { ...payload };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(template),
    });
  });
  return {
    puts,
    current: () => template,
    getCalls: () => getCalls,
  };
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ initial?: typeof DEFAULT_TEMPLATE, failGets?: number, putStatus?: number }} [options]
 */
async function openEmailTemplate(page, options) {
  await page.route('**/api/communication-flows**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ flows: [], selectedFlowId: '' }),
    });
  });
  const api = await mockTemplateApi(page, options);
  await page.goto('/#/comunicacao');
  await page.getByRole('button', { name: 'E-mail de orçamento' }).click();
  return api;
}

test.describe('Comunicação - e-mail de orçamento', () => {
  test('carrega a aba e renderiza preview fictício e anexo', async ({ page }) => {
    await openEmailTemplate(page);

    await expect(page.getByLabel('Mensagem principal')).toBeVisible();
    const preview = page.frameLocator('iframe[title="Preview do e-mail"]');
    await expect(preview.getByText('Maria Silva')).toBeVisible();
    await expect(preview.getByText('ORC-20260001')).toBeVisible();
    await expect(page.getByText('Anexo: orcamento-ORC-20260001.pdf')).toBeVisible();
  });

  test('insere as duas variáveis na posição atual do cursor', async ({ page }) => {
    await openEmailTemplate(page);

    const message = page.getByLabel('Mensagem principal');
    await message.fill('Início  fim');
    await message.evaluate((element) => {
      const input = /** @type {HTMLTextAreaElement} */ (element);
      input.setSelectionRange(7, 7);
    });
    await page.getByRole('button', { name: 'Inserir nome do cliente' }).click();
    await page.getByRole('button', { name: 'Inserir número do orçamento' }).click();

    await expect(message).toHaveValue('Início {{nome_cliente}}{{numero_orcamento}} fim');
  });

  test('rejeita variável desconhecida sem PUT e foca a mensagem principal', async ({ page }) => {
    const api = await openEmailTemplate(page);

    const message = page.getByLabel('Mensagem principal');
    await message.fill('Olá, {{cliente_nome}}');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect(message).toBeFocused();
    await expect(page.getByRole('alert').filter({ hasText: /cliente_nome/ })).toBeVisible();
    expect(api.puts).toHaveLength(0);
  });

  test('restaura o padrão no formulário e só salva após confirmação explícita', async ({ page }) => {
    const api = await openEmailTemplate(page, {
      initial: {
        ...DEFAULT_TEMPLATE,
        subject: 'Proposta {{numero_orcamento}}',
      },
    });

    const subject = page.getByLabel('Assunto');
    await expect(subject).toHaveValue('Proposta {{numero_orcamento}}');
    await page.getByRole('button', { name: 'Restaurar modelo padrão' }).click();
    await expect(page.getByText('O formulário será restaurado, mas a alteração só será ativada após salvar.')).toBeVisible();
    await page.getByRole('button', { name: 'Restaurar padrão' }).click();

    await expect(subject).toHaveValue(DEFAULT_TEMPLATE.subject);
    expect(api.puts).toHaveLength(0);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await expect(page.getByRole('status')).toHaveText('Modelo salvo. Os próximos envios usarão esta configuração.');
    expect(api.puts).toEqual([DEFAULT_TEMPLATE]);
  });

  test('salva alteração válida e mostra confirmação de sucesso', async ({ page }) => {
    const api = await openEmailTemplate(page);

    await page.getByLabel('Assunto').fill('Proposta {{numero_orcamento}}');
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect(page.getByRole('status')).toHaveText('Modelo salvo. Os próximos envios usarão esta configuração.');
    expect(api.puts[0]).toMatchObject({ subject: 'Proposta {{numero_orcamento}}' });
  });

  test('preserva o conteúdo digitado quando PUT falha', async ({ page }) => {
    const api = await openEmailTemplate(page, { putStatus: 500 });
    const message = page.getByLabel('Mensagem principal');
    const typed = 'Conteúdo que não pode ser perdido.';
    await message.fill(typed);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();

    await expect(page.getByText('Não foi possível salvar o modelo de e-mail. Tente novamente.')).toBeVisible();
    await expect(message).toHaveValue(typed);
    expect(api.puts).toHaveLength(1);
  });

  test('bloqueia troca de aba até confirmar o descarte', async ({ page }) => {
    await openEmailTemplate(page);
    await page.getByLabel('Mensagem principal').fill('Alteração pendente');
    await page.getByRole('button', { name: 'Canais' }).click();

    await expect(page.getByText('Existem alterações não salvas no modelo de e-mail.')).toBeVisible();
    await page.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(page.getByLabel('Mensagem principal')).toBeVisible();

    await page.getByRole('button', { name: 'Canais' }).click();
    await page.getByRole('button', { name: 'Descartar alterações' }).click();
    await expect(page.getByRole('heading', { name: 'Evolution API' })).toBeVisible();
  });

  test('bloqueia navegação lateral suja e confirma somente uma vez por tentativa', async ({ page }) => {
    await openEmailTemplate(page);
    await page.getByLabel('Mensagem principal').fill('Alteração pendente');

    const dialogs = [];
    let acceptNavigation = false;
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void (acceptNavigation ? dialog.accept() : dialog.dismiss());
    });

    await page.getByRole('button', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/#\/comunicacao$/);
    expect(dialogs).toEqual(['Existem alterações não salvas. Descartar alterações?']);

    acceptNavigation = true;
    await page.getByRole('button', { name: 'Configurações' }).click();
    await expect(page).toHaveURL(/#\/settings$/);
    expect(dialogs).toEqual([
      'Existem alterações não salvas. Descartar alterações?',
      'Existem alterações não salvas. Descartar alterações?',
    ]);
  });

  test('mostra falha de carregamento com edição indisponível e recupera ao tentar novamente', async ({ page }) => {
    const api = await openEmailTemplate(page, { failGets: 1 });

    await expect(page.getByText('Não foi possível carregar o modelo de e-mail.')).toBeVisible();
    await expect(page.getByLabel('Mensagem principal')).toHaveCount(0);
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Mensagem principal')).toBeEnabled();
    expect(api.getCalls()).toBeGreaterThanOrEqual(2);
  });
});
