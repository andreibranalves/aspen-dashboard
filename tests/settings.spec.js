// @ts-check
import { expect, test } from '@playwright/test';

const INITIAL_SETTINGS = {
  validade_dias: 15,
  pagamento: '',
  entrega: '',
  frete_padrao: '0.00',
  observacoes: '',
  template_padrao: 'padrao',
  settings_version: 1,
  empresa: {
    schema_version: 1,
    identity: { legal_name: 'ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA', document: '55.458.072/0001-79' },
    banking: { bank_name: 'Stone Pagamentos S.A.', bank_code: '197', branch: '0001', account: '35207618-6', pix_key: '55.458.072/0001-79' },
    contacts: { website: 'https://www.aspenestamparia.com', phone: '(21) 96924-1265', email: 'contato@aspenestamparia.com', instagram: 'https://www.instagram.com/aspenestamparia' },
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

test.describe('Configurações de orçamento @quotations', () => {
  test('carrega, edita e salva todos os valores padrão', async ({ page }) => {
    let settings = { ...INITIAL_SETTINGS };
    let receivedPayload;
    let savedResponse;

    await page.route('/api/settings**', async (route) => {
      if (route.request().method() === 'GET') {
        const response = route.request().url().includes('scope=operational')
          ? {}
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
        pagamento: receivedPayload.secoes.pagamento.body,
        observacoes: receivedPayload.secoes.condicoes_gerais.body,
        frete_padrao: '12.50',
      };
      savedResponse = settings;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(savedResponse),
      });
    });

    await page.goto('/#/settings');
    await expect(page.getByRole('heading', { name: 'Padrões de orçamento' })).toBeVisible();

    await page.getByLabel('Validade padrão (dias)').fill('30');
    await page.getByLabel('Frete padrão (R$)').fill('12.5');
    await page.getByText('Conteúdo do documento', { exact: true }).first().click();
    await page.getByLabel('Exibir seção - Prazo de produção').uncheck();
    await page.getByLabel('Título - Prazo de produção').fill('Produção customizada');
    await page.getByLabel('Exibir seção - Pagamento').uncheck();
    await page.getByLabel('Título - Pagamento').fill('Condição comercial');
    const paymentBody = 'Pagamento em duas parcelas';
    await page.getByLabel('Condição de pagamento').fill(paymentBody);
    await page.getByLabel('Exibir seção - Condições Gerais').uncheck();
    await page.getByLabel('Título - Condições Gerais').fill('Notas gerais');
    await page.getByLabel('Prazo de produção do orçamento').fill('7 dias úteis');
    await page.getByLabel('Observações padrão').fill('Aprovar arte antes da produção.');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();

    await expect(page.getByRole('status')).toHaveText('Configurações salvas com sucesso.');
    expect(receivedPayload).toMatchObject({
      validade_dias: 30,
      entrega: '',
      frete_padrao: '12.5',
      empresa: INITIAL_SETTINGS.empresa,
      settings_version: 1,
      secoes: {
        schema_version: 1,
        show_summary: true,
        rich_text: true,
        prazo_producao: { enabled: false, title: 'Produção customizada' },
        pagamento: { enabled: false, title: 'Condição comercial' },
        condicoes_gerais: { enabled: false, title: 'Notas gerais' },
      },
    });
    expect(receivedPayload.secoes.prazo_producao.value).toContain('7 dias úteis');
    expect(receivedPayload.secoes.pagamento.body).toContain('Pagamento em duas parcelas');
    expect(receivedPayload.secoes.condicoes_gerais.body).toContain('Aprovar arte antes da produção.');
    expect(savedResponse.pagamento).toContain('Pagamento em duas parcelas');
    expect(savedResponse.observacoes).toContain('Aprovar arte antes da produção.');
    await expect(page.getByLabel('Frete padrão (R$)')).toHaveValue('12.50');
  });

  test('gerencia modelos, preview, versões, padrão e arquivamento', async ({ page }) => {
    const source = '<html><body>{{ quote.name }} {{ secoes.pagamento.body }} {{ secoes.condicoes_gerais.body }} {{ secoes.prazo_producao.body }}</body></html>';
    const templates = [
      { id: 'one', key: 'padrao', name: 'Padrão', archived: false, is_default: true, current_version_id: 'v1', current_version: 1, current_hash: 'hash', usage_count: 2, updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'two', key: 'alternativo', name: 'Alternativo', archived: false, is_default: false, current_version_id: 'v2', current_version: 1, current_hash: 'hash2', usage_count: 0, updated_at: '2026-01-01T00:00:00.000Z' },
    ];
    let defaultKey = 'padrao';
    let version = 1;
    let settingsPayload;
    /** @type {{ template_padrao?: string } | undefined} */
    let savedSettings;
    await page.route('/api/settings?scope=operational**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) });
    });
    await page.route('**/api/settings', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(INITIAL_SETTINGS) });
      } else {
        settingsPayload = route.request().postDataJSON();
        savedSettings = { ...INITIAL_SETTINGS, ...settingsPayload, template_padrao: defaultKey };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedSettings) });
      }
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'GET' && url.searchParams.has('id')) {
        const item = templates.find((template) => template.id === url.searchParams.get('id')) || templates[1];
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ...item, current_version: version, current_source: source, versions: [{ id: `v${version}`, version, source_hash: 'hash', created_at: '2026-01-01T00:00:00.000Z' }] } }) });
      } else if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates, default_key: defaultKey }) });
      } else if (url.pathname.endsWith('/validate')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true, warnings: ['A seção prazo_producao não é usada pelo template.'], preview: '<p>preview</p>' }) });
      } else if (request.method() === 'PUT') {
        const payload = request.postDataJSON();
        if (payload.action === 'set_default') defaultKey = 'alternativo';
        if (payload.action === 'save_version') version += 1;
        if (payload.action === 'archive') {
          const archivedTemplate = templates.find((template) => template.id === 'two');
          if (archivedTemplate) archivedTemplate.archived = true;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload.action === 'archive' ? { archived: true } : { default_key: defaultKey, id: 'v2' }) });
      } else {
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'two' }) });
      }
    });

    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: /Alternativo alternativo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Padrão padrao/ })).toContainText('Padrão');
    await expect(page.getByText('Usado por 2 revisões')).toBeVisible();
    await page.getByRole('button', { name: /Alternativo alternativo/ }).click();
    await expect(page.getByLabel('Fonte HTML')).toHaveValue(source);
    await page.getByRole('button', { name: 'Validar e visualizar preview' }).click();
    await expect(page.getByText('Aviso: A seção prazo_producao não é usada pelo template.')).toBeVisible();
    await expect(page.getByTitle('Preview do template')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar nova versão' }).click();
    await expect(page.getByText('Template salvo com sucesso.')).toBeVisible();
    await expect(page.getByText('Versão atual: 2')).toBeVisible();
    await page.getByRole('button', { name: 'Definir como padrão' }).click();
    // confirmações migradas para ConfirmDialog (sem confirm() nativo)
    await page.getByRole('dialog').getByRole('button', { name: 'Definir como padrão' }).click();
    await expect(page.getByText('Template padrão alterado.')).toBeVisible();
    await page.getByText('Conteúdo do documento', { exact: true }).first().click();
    await page.getByLabel('Condição de pagamento').fill('novo padrão');
    await page.getByRole('button', { name: 'Salvar configurações' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Configurações salvas com sucesso.' })).toBeVisible();
    await expect(page.getByText('Modelo padrão: alternativo')).toBeVisible();
    expect(savedSettings).toBeDefined();
    expect(savedSettings?.template_padrao).toBe('alternativo');
    expect(settingsPayload).not.toHaveProperty('template_padrao');
    await page.getByRole('button', { name: 'Arquivar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar' }).click();
    await expect(page.getByText('Template arquivado.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Alternativo alternativo/ })).toContainText('Arquivado');
  });

  test('cria modelo e recupera falha de detalhe com nova requisição', async ({ page }) => {
    const source = '<html><body>{{ quote.name }}</body></html>';
    let listCalls = 0;
    let detailCalls = 0;
    let created = false;
    await page.route('/api/settings**', async (route) => {
      const response = route.request().method() === 'GET' ? INITIAL_SETTINGS : INITIAL_SETTINGS;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
    });
    await page.route('**/api/quotation-templates**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'GET' && url.searchParams.has('id')) {
        detailCalls += 1;
        if (detailCalls === 1) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha temporária.' }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 'new', key: 'novo', name: 'Novo', archived: false, is_default: false, current_version_id: 'v1', current_version: 1, current_hash: 'hash', usage_count: 0, updated_at: '', current_source: source, versions: [] } }) });
        return;
      }
      if (request.method() === 'GET') {
        listCalls += 1;
        if (listCalls === 1) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Falha temporária.' }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: created ? [{ id: 'new', key: 'novo', name: 'Novo', archived: false, is_default: false, current_version_id: 'v1', current_version: 1, current_hash: 'hash', usage_count: 0, updated_at: '' }] : [], default_key: '' }) });
        return;
      }
      if (request.method() === 'POST') {
        created = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'new' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/#/settings');
    await expect(page.getByRole('button', { name: 'Recarregar modelos' })).toBeVisible();
    await page.getByRole('button', { name: 'Recarregar modelos' }).click();
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    await page.getByLabel('Nome').fill('Novo');
    await page.getByLabel('Chave imutável').fill('novo');
    await page.getByLabel('Fonte HTML').fill(source);
    await page.getByRole('button', { name: 'Criar modelo' }).click();
    await expect(page.getByRole('alert')).toContainText('Não foi possível carregar o template.');
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByLabel('Fonte HTML')).toHaveValue(source);
    expect(detailCalls).toBe(2);
  });

  test('exibe erro de carregamento e permite tentar novamente', async ({ page }) => {
    let settingsCalls = 0;
    await page.route('/api/settings?scope=operational**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({}),
      });
    });
    await page.route('/api/settings**', async (route) => {
      if (route.request().url().includes('scope=operational')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({}),
        });
        return;
      }
      settingsCalls += 1;
      if (settingsCalls <= 1) {
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
        body: JSON.stringify({ ...INITIAL_SETTINGS }),
      });
    });

    await page.goto('/#/settings');
    await expect(page.getByText('Não foi possível carregar as configurações.')).toBeVisible();
    await page.getByRole('button', { name: 'Tentar novamente' }).click();
    await expect(page.getByRole('button', { name: 'Salvar configurações' })).toBeVisible();
  });
});
