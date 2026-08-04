// @ts-check
import { expect, test } from '@playwright/test';

const INITIAL_SETTINGS = {
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

test.describe('Configurações de orçamento', () => {
  test('carrega, edita e salva todos os valores padrão', async ({ page }) => {
    let settings = { ...INITIAL_SETTINGS };
    let receivedPayload;

    await page.route('**/api/settings**', async (route) => {
      if (route.request().method() === 'GET') {
        const response = route.request().url().includes('scope=operational')
          ? { operational_mode: false }
          : settings;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(response),
        });
        return;
      }

      receivedPayload = route.request().postDataJSON();
      settings = {
        ...settings,
        ...receivedPayload,
        frete_padrao: '12.50',
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(settings),
      });
    });

    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: 'Padrões de orçamento' })).toBeVisible();

    await page.getByLabel('Validade padrão (dias)').fill('30');
    await page.getByLabel('Frete padrão (R$)').fill('12.5');
    await page.getByLabel('Condição de pagamento').fill('50% no pedido');
    await page.getByLabel('Prazo de entrega').fill('7 dias úteis');
    await page.getByLabel('Observações padrão').fill('Aprovar arte antes da produção.');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();

    await expect(page.getByRole('status')).toHaveText('Configurações salvas com sucesso.');
    expect(receivedPayload).toEqual({
      validade_dias: 30,
      entrega: '7 dias úteis',
      frete_padrao: '12.5',
      secoes: {
        schema_version: 1,
        prazo_producao: { enabled: true, title: 'Prazo de produção' },
        pagamento: { enabled: true, title: 'Pagamento', body: '50% no pedido' },
        condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: 'Aprovar arte antes da produção.' },
      },
    });
    await expect(page.getByLabel('Frete padrão (R$)')).toHaveValue('12.50');
  });

  test('gerencia modelos, preview, versões, padrão e arquivamento', async ({ page }) => {
    const source = '<html><body>{{ quote.name }} {{ secoes.pagamento.body }} {{ secoes.condicoes_gerais.body }} {{ secoes.prazo_producao.body }}</body></html>';
    const templates = [
      { id: 'one', key: 'padrao', name: 'Padrão', archived: false, is_default: true, current_version_id: 'v1', current_version: 1, current_hash: 'hash', usage_count: 2, updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'two', key: 'alternativo', name: 'Alternativo', archived: false, is_default: false, current_version_id: 'v2', current_version: 1, current_hash: 'hash2', usage_count: 0, updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    let defaultKey = 'padrao';
    await page.route('**/api/settings?scope=operational**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ operational_mode: false }) });
    });
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INITIAL_SETTINGS) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INITIAL_SETTINGS) });
      }
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'GET' && url.searchParams.has('id')) {
        const item = templates.find((template) => template.id === url.searchParams.get('id')) || templates[1];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...item, current_source: source, versions: [{ id: 'v1', version: 1, source_hash: 'hash', created_at: '2026-01-01T00:00:00.000Z' }] } }) });
      } else if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates, default_key: defaultKey }) });
      } else if (url.pathname.endsWith('/validate')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, warnings: ['A seção prazo_producao não é usada pelo template.'], preview: '<p>preview</p>' }) });
      } else if (request.method() === 'PUT') {
        const payload = request.postDataJSON();
        if (payload.action === 'set_default') defaultKey = 'alternativo';
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload.action === 'archive' ? { archived: true } : { default_key: defaultKey, id: 'v2' }) });
      } else {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'two' }) });
      }
    });

    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: /Alternativo alternativo/ })).toBeVisible();
    await page.getByRole('button', { name: /Alternativo alternativo/ }).click();
    await expect(page.getByLabel('Fonte HTML')).toHaveValue(source);
    await page.getByRole('button', { name: 'Validar e visualizar preview' }).click();
    await expect(page.getByTitle('Preview do template')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar nova versão' }).click();
    await expect(page.getByText('Template salvo com sucesso.')).toBeVisible();
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Definir como padrão' }).click();
    await expect(page.getByText('Template padrão alterado.')).toBeVisible();
    await page.getByRole('button', { name: 'Arquivar' }).click();
    await expect(page.getByText('Template arquivado.')).toBeVisible();
  });

  test('exibe erro de carregamento e permite tentar novamente', async ({ page }) => {
    let settingsCalls = 0;
    await page.route('**/api/settings?scope=operational**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ operational_mode: false }),
      });
    });
    await page.route('**/api/settings**', async (route) => {
      if (route.request().url().includes('scope=operational')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ operational_mode: false }),
        });
        return;
      }
      settingsCalls += 1;
      if (settingsCalls <= 5) {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Banco indisponível.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...INITIAL_SETTINGS, operational_mode: false }),
      });
    });

    await page.goto('/#/settings');
    await expect(page.getByText('Não foi possível carregar as configurações.')).toBeVisible();
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByRole('button', { name: 'Salvar configurações' })).toBeVisible();
  });
});
