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
