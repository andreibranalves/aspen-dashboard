// @ts-check
import { expect, test } from '@playwright/test';

const SETTINGS = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  aliquota: '4.00',
  settings_version: 1,
  empresa: {
    schema_version: 1,
    identity: { legal_name: 'Aspen Comércio', document: '55.458.072/0001-79' },
    banking: { bank_name: '', bank_code: '', branch: '', account: '', pix_key: '' },
    contacts: { website: '', phone: '', email: '', instagram: '' },
  },
  secoes: {
    schema_version: 1,
    show_summary: true,
    rich_text: true,
    prazo_producao: { enabled: true, title: 'Prazo de produção', value: '' },
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

const FLOW = {
  id: 'flow-evidence',
  name: 'Fluxo comercial',
  context: 'email_first_contact',
  channel: 'whatsapp',
  vendor_name: 'Juliana',
  enabled: true,
  delay_min_seconds: 5,
  delay_max_seconds: 8,
  max_media_per_product_group: 1,
  created_at: '2026-08-01T09:00:00.000Z',
  updated_at: '2026-08-02T09:00:00.000Z',
  steps: [
    { id: 'step-text', type: 'text', template: 'Olá (primeiro_nome), segue a proposta.' },
    { id: 'step-document', type: 'document', source: 'quotation_pdf', caption: 'Orçamento' },
    { id: 'step-media', type: 'product_media', max_items: 1, caption_template: '' },
  ],
};

async function mockSettings(page) {
  let flowState = 'loaded';
  let settingsError = false;
  await page.route('/api/settings**', async (route) => {
    if (settingsError) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(SETTINGS),
    });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (route.request().method() === 'GET' && url.searchParams.has('id')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { ...TEMPLATE, current_source: '<p>{{ quote.name }}</p>', versions: [] },
        }),
      });
      return;
    }
    if (url.pathname.endsWith('/validate')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ valid: true, warnings: [], preview: '<p>Prévia</p>' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ templates: [TEMPLATE], default_key: 'padrao' }),
    });
  });
  await page.route('**/api/communication-flows*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        selectedFlowId: flowState === 'loaded' ? FLOW.id : '',
        flows: flowState === 'loaded' ? [FLOW] : [],
      }),
    });
  });
  return {
    emptyFlows() {
      flowState = 'empty';
    },
    failSettings() {
      settingsError = true;
    },
  };
}

test('captura Configurações nos temas e tamanhos principais', async ({ page }) => {
  const state = await mockSettings(page);
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Padrões de orçamento' })).toBeVisible();

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `docs/design/evidence/configuracoes/padroes-light-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }

  await page.evaluate(() => globalThis.localStorage.setItem('aspen_theme', 'dark'));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Padrões de orçamento' })).toBeVisible();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 1024, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: `docs/design/evidence/configuracoes/padroes-dark-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [tab, name] of [
    ['templates', 'modelos'],
    ['flows', 'fluxos'],
    ['company', 'empresa'],
    ['channels', 'canais'],
  ]) {
    await page
      .getByRole('tab', {
        name:
          tab === 'templates'
            ? 'Modelos de documento'
            : tab === 'flows'
              ? 'Fluxos WhatsApp'
              : tab === 'company'
                ? 'Empresa'
                : 'Canais',
      })
      .click();
    await page.screenshot({
      path: `docs/design/evidence/configuracoes/${name}-dark-1440x900.png`,
      fullPage: true,
    });
  }

  await page.getByRole('tab', { name: 'Padrões' }).click();
  await page.getByLabel('Validade padrão (dias)').focus();
  await page.screenshot({
    path: 'docs/design/evidence/configuracoes/foco-dark-1440x900.png',
    fullPage: true,
  });

  await page.getByRole('tab', { name: 'Fluxos WhatsApp' }).click();
  await page.getByRole('button', { name: 'Olá (primeiro_nome), segue a proposta.' }).click();
  await page.getByLabel('Mensagem').fill('Alteração pendente');
  await page.getByRole('tab', { name: 'Canais' }).click();
  await expect(page.getByRole('dialog', { name: 'Sair sem salvar?' })).toBeVisible();
  await page.screenshot({
    path: 'docs/design/evidence/configuracoes/confirmacao-escape-dark-1440x900.png',
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sair sem salvar?' })).toBeHidden();

  state.emptyFlows();
  await page.getByRole('tab', { name: 'Canais' }).click();
  await page.getByRole('button', { name: 'Sair da aba' }).click();
  await page.getByRole('tab', { name: 'Fluxos WhatsApp' }).click();
  await expect(page.getByText('Nenhum fluxo criado ainda')).toBeVisible();
  await page.screenshot({
    path: 'docs/design/evidence/configuracoes/vazio-fluxos-dark-1440x900.png',
    fullPage: true,
  });

  state.failSettings();
  await page.goto('/#/settings?tab=patterns');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'Não foi possível carregar as configurações.'
  );
  await page.screenshot({
    path: 'docs/design/evidence/configuracoes/erro-configuracoes-dark-1440x900.png',
    fullPage: true,
  });
});
