// @ts-check
import { expect, test } from '@playwright/test';

const SETTINGS = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  secoes: {
    schema_version: 1,
    prazo_producao: { enabled: true, title: 'Prazo de produção' },
    pagamento: { enabled: true, title: 'Pagamento', body: '' },
    condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
  },
};

const TEMPLATE = {
  id: 'default',
  key: 'padrao',
  name: 'Padrão',
  archived: false,
  is_default: true,
  current_version_id: 'v1',
  current_version: 1,
  current_hash: 'hash',
  usage_count: 0,
  updated_at: '2026-01-01T00:00:00.000Z',
};

test.describe('Aspen v2 settings and recovery screens', () => {
  test('groups settings into focused tabs without repeated headings', async ({ page }) => {
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(SETTINGS),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(SETTINGS),
      });
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'GET' && url.searchParams.has('id')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: {
              ...TEMPLATE,
              current_source: '<html><body>{{ quote.name }}</body></html>',
              versions: [],
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ templates: [TEMPLATE], default_key: 'padrao' }),
      });
    });

    await page.goto('/#/settings');

    await expect(page.getByRole('heading', { name: 'Padrões de orçamento' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Padrões' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByRole('tab', { name: 'Modelos de documento' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configurações avançadas' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Modelos de documento' }).click();
    await expect(page.getByRole('heading', { name: 'Modelos de documento' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Novo modelo' })).toBeVisible();
    await page.getByRole('button', { name: /Padrão padrao/ }).click();
    await expect(page.getByText('Valide o modelo para gerar a prévia.')).toBeVisible();
    await page.getByRole('button', { name: 'Editar avançado' }).click();
    await expect(page.getByLabel('Conteúdo do modelo')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar nova versão' })).toBeVisible();
  });

  test('keeps recovery copy safe when settings returns a raw error', async ({ page }) => {
    await page.route('**/api/settings', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Error: postgres password=secret-token' }),
      });
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ templates: [], default_key: '' }),
      });
    });

    await page.goto('/#/settings');

    await expect(page.getByRole('alert')).toContainText(
      'Não foi possível carregar as configurações.'
    );
    await expect(page.getByRole('alert')).not.toContainText('secret-token');
  });

  test('keeps login loading, focus and safe authentication feedback', async ({ page }) => {
    await page.addInitScript(() => globalThis.localStorage.setItem('aspen_theme', 'dark'));
    await page.route('**/api/quotations**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/login', async (route) => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Senha incorreta.' }),
      });
    });

    await page.goto('/#/login');

    await expect(page.locator('html')).toHaveClass(/dark/);
    const password = page.getByLabel('Senha de acesso');
    await expect(password).toBeFocused();
    await password.fill('senha-incorreta');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('button', { name: 'Entrando...' })).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveText('Senha incorreta.');
    await expect(password).toHaveAttribute('aria-invalid', 'true');
  });

  test('keeps successful authentication navigation intact', async ({ page }) => {
    await page.route('**/api/quotations**', async (route) => {
      await route.fulfill({ status: 401, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/#/login');
    await page.getByLabel('Senha de acesso').fill('senha-correta');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/#\/quotations$/);
  });

  test('offers keyboard-accessible recovery from an unknown route', async ({ page }) => {
    await page.goto('/#/rota-inexistente');

    await expect(page.getByRole('heading', { name: 'Página não encontrada' })).toBeVisible();
    await expect(page.getByText('Erro 404')).toBeVisible();
    await page.getByRole('button', { name: 'Ir para o Início' }).focus();
    await expect(page.getByRole('button', { name: 'Ir para o Início' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/dashboard$/);
  });
});
