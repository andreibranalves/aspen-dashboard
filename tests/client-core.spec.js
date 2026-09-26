// @ts-check
import { expect, test } from '@playwright/test';

const CLIENT = {
  id: '00000000-0000-4000-8000-000000000001',
  nome: 'Maria Cliente',
  email: 'maria@example.com',
  telefone: '5511999990000',
  documento: '12345678901',
  tipo: 'cliente',
  status: 'active',
  arquivado: false,
  notes: null,
  observacoes: null,
};

const DETAIL = {
  id: CLIENT.id,
  name: CLIENT.id,
  nome: CLIENT.nome,
  display_name: CLIENT.nome,
  email: CLIENT.email,
  telefone: CLIENT.telefone,
  documento: CLIENT.documento,
  tax_id: CLIENT.documento,
  arquivado: false,
  status: 'active',
  address: null,
  latest_quotation: null,
  deal: null,
  quality_flags: [],
  notes: null,
  observacoes: null,
};

const COMPLETE_DETAIL = {
  ...DETAIL,
  nome: 'Cliente com nome longo para consulta comercial',
  display_name: 'Cliente com nome longo para consulta comercial',
  address: {
    endereco: 'Rua das Oficinas',
    numero: '123',
    bairro: 'Centro',
    complemento: 'Fundos',
    municipio: 'São Paulo',
    uf: 'SP',
    cep: '01234-567',
  },
  latest_quotation: {
    name: 'ORC-20260001',
    status: 'Aprovado',
    date: '2026-09-01',
    grand_total: '1250.00',
  },
  deal: {
    name: 'Negócio Cliente Longo',
    status: 'Em negociação',
    next_step: 'Confirmar quantidades',
  },
  orders: [
    {
      name: 'PED-2026-0001',
      status: 'Em produção',
      date: '2026-09-02',
      grand_total: '900.00',
    },
  ],
  notes: 'Prefere contato pela manhã.',
  observacoes: 'Prefere contato pela manhã.',
};

/** @typedef {typeof DETAIL & { id?: string, nome?: string, archived?: boolean, updated?: boolean }} ClientDetail */

test.describe('Clientes locais @crm @smoke', () => {
  test('links WhatsApp acrescentam país ao telefone local em todas as visualizações', async ({ page }) => {
    const localClient = { ...CLIENT, telefone: '4791234567' };
    const expectedUrl = 'https://wa.me/554791234567';
    await page.route('**/api/client-detail**', route => route.fulfill({ json: { ...DETAIL, telefone: localClient.telefone } }));
    await page.route('**/api/leads-clients**', route => route.fulfill({ json: {
      data: [localClient], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
    } }));
    await page.goto('/#/leads');
    const phoneLinks = page.locator('a[href^="https://wa.me/"]');
    // Só a versão da largura atual da lista é montada.
    await expect(phoneLinks).toHaveCount(1);
    for (const link of await phoneLinks.all()) await expect(link).toHaveAttribute('href', expectedUrl);
    await page.locator('tbody tr').filter({ hasText: CLIENT.nome }).hover();
    await page.getByRole('button', { name: `Visualização rápida ${CLIENT.nome}`, exact: true }).click();
    await expect(page.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', expectedUrl);
    await page.goto(`/#/leads/cliente/${CLIENT.id}`);
    await expect(page.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', expectedUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('link', { name: 'WhatsApp', exact: true })).toHaveAttribute('href', expectedUrl);
  });
  test('exclusão manual confirma consequência, permite cancelar e remove cliente', async ({ page }) => {
    let deleted = 0;
    await page.route('**/api/client-detail**', async route => {
      if (route.request().method() === 'DELETE') deleted += 1;
      await route.fulfill({ json: route.request().method() === 'DELETE' ? { deleted: true } : DETAIL });
    });
    await page.route('**/api/leads-clients**', route => route.fulfill({ json: { data: [], pagination: { total: 0 } } }));
    await page.goto(`/#/leads/cliente/${CLIENT.id}`);
    await page.getByRole('button', { name: `Mais ações para ${CLIENT.nome}` }).click();
    await page.getByRole('menuitem', { name: 'Excluir cliente' }).click();
    const dialog = page.getByRole('dialog', { name: 'Excluir cliente?' });
    await expect(dialog).toContainText('negócios sem orçamento');
    await dialog.getByRole('button', { name: 'Cancelar' }).click();
    expect(deleted).toBe(0);
    await page.getByRole('button', { name: `Mais ações para ${CLIENT.nome}` }).click();
    await page.getByRole('menuitem', { name: 'Excluir cliente' }).click();
    await dialog.getByRole('button', { name: 'Excluir cliente', exact: true }).click();
    await expect(page).toHaveURL(/#\/leads$/);
    expect(deleted).toBe(1);
  });
  test('exibe Cliente sem Lead e permite abrir detalhe', async ({ page }) => {
    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [CLIENT],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        }),
      });
    });
    await page.route('**/api/client-detail**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(DETAIL),
      });
    });

    await page.goto('/#/leads');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo cliente' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Filtrar clientes por status' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    await page.getByRole('link', { name: `Abrir cliente ${CLIENT.nome}` }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`#\\/leads\\/cliente\\/${CLIENT.id}$`));
    await expect(page.getByRole('heading', { name: CLIENT.nome, exact: true })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
  });

  test('lista clientes preserva dados reais, seleção e ação para abrir o detalhe', async ({ page }) => {
    const detailRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/client-detail')) detailRequests.push(request.url());
    });
    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [CLIENT],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        }),
      });
    });

    await page.goto('/#/leads');

    const table = page.getByRole('table');
    await expect(table.getByRole('columnheader')).toHaveText([
      'Cliente',
      'Contato',
      'Documento',
      'Status',
      'Ações',
    ]);
    const row = table.getByRole('row').nth(1);
    await expect(row.getByRole('link', { name: `Abrir cliente ${CLIENT.nome}` })).toHaveAttribute(
      'href',
      `#/leads/cliente/${CLIENT.id}`
    );
    await expect(row.getByRole('cell').nth(0)).toContainText(CLIENT.nome);
    await page.getByRole('button', { name: 'Selecionar', exact: true }).click();
    await expect(row.getByRole('link', { name: `Abrir cliente ${CLIENT.nome}` })).toBeVisible();
    await expect(row.getByRole('checkbox', { name: `Selecionar ${CLIENT.nome}` })).toBeVisible();
    await expect(page.getByText('1 cliente selecionado')).toHaveCount(0);
    expect(detailRequests).toHaveLength(0);
    await row.getByRole('checkbox', { name: `Selecionar ${CLIENT.nome}` }).check();
    await expect(page.getByText('1 cliente selecionado')).toBeVisible();
    await page.route('**/api/client-detail**', (route) => route.fulfill({ json: DETAIL }));
    // O link cobre a linha; a célula de contato tem os próprios links por cima, então abre pelo teclado.
    await row.getByRole('link', { name: `Abrir cliente ${CLIENT.nome}` }).press('Enter');
    await expect(page).toHaveURL(new RegExp(`#\\/leads\\/cliente\\/${CLIENT.id}$`));
  });

  test('consulta identidade, contato e histórico sem expor UUID e preserva os destinos comerciais', async ({
    page,
  }) => {
    await page.route('**/api/client-detail**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(COMPLETE_DETAIL),
      });
    });

    const detailUrl = `/#/leads/cliente/${CLIENT.id}`;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(detailUrl);

    const breadcrumb = page.getByRole('navigation', { name: 'Trilha de navegação' });
    await expect(breadcrumb.getByText(COMPLETE_DETAIL.display_name, { exact: true })).toBeVisible();
    await expect(breadcrumb.getByText(CLIENT.id, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: COMPLETE_DETAIL.display_name, exact: true })
    ).toBeVisible();
    await expect(page.getByText('(11) 99999-0000', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Rua das Oficinas, 123 · Centro · Fundos · São Paulo/SP · 01234-567', {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Resumo comercial' })).toBeVisible();
    const nextActionCard = page.locator('main section').filter({ has: page.getByRole('heading', { name: 'Próxima ação' }) });
    await expect(nextActionCard.getByText(COMPLETE_DETAIL.deal.next_step, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute(
      'href',
      `https://wa.me/${CLIENT.telefone}`
    );
    await expect(page.getByRole('banner').getByRole('button', { name: 'Novo orçamento' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole('heading', { name: COMPLETE_DETAIL.display_name, exact: true })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Editar cadastro' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Mais ações para Cliente com nome longo' })
    ).toBeVisible();
    // Resumo comercial reúne pedidos e o orçamento recente num bloco só.
    await expect(page.getByRole('heading', { name: 'Resumo comercial' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Atividade recente' })).toHaveCount(0);
    await expect(nextActionCard.getByText(COMPLETE_DETAIL.deal.next_step, { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 768, height: 900 });
    await expect(page.locator('html')).not.toHaveClass(/dark/);
    await expect(page.getByRole('heading', { name: 'Resumo comercial' })).toBeVisible();

    await page.getByRole('button', { name: 'Editar cadastro' }).click();
    await expect(page.getByRole('textbox', { name: 'Nome do cliente *' })).toHaveValue(
      COMPLETE_DETAIL.display_name
    );
    await expect(page.getByRole('textbox', { name: 'E-mail' })).toHaveValue(COMPLETE_DETAIL.email);
    await expect(page.getByRole('textbox', { name: 'Telefone' })).toHaveValue(COMPLETE_DETAIL.telefone);
    await expect(page.getByRole('textbox', { name: 'Endereço', exact: true })).toHaveValue(
      COMPLETE_DETAIL.address.endereco
    );
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    await page.getByRole('button', { name: 'Abrir orçamento ORC-20260001', exact: true }).click();
    await expect(page).toHaveURL(/#\/quotations\/ORC-20260001$/);

    await page.goto(detailUrl);
    await page.getByRole('button', { name: 'Abrir pedido', exact: true }).click();
    await expect(page).toHaveURL(/#\/sales-orders\/PED-2026-0001$/);

    await page.goto(detailUrl);
    await page.getByRole('button', { name: 'Abrir no CRM', exact: true }).click();
    await expect(page).toHaveURL(/#\/crm\?search=Neg%C3%B3cio(?:%20|\+)Cliente(?:%20|\+)Longo$/);
  });

  test('ação de novo orçamento preserva o contexto do cliente', async ({ page }) => {
    await page.route('**/api/leads-clients**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [CLIENT],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        }),
      });
    });

    await page.goto('/#/leads');
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toBeVisible();
    await page.locator('tbody tr').filter({ hasText: CLIENT.nome }).hover();
    await page.getByRole('button', { name: `Novo orçamento para ${CLIENT.nome}` }).click();
    await expect(page).toHaveURL(/#\/auto$/);
    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue(new RegExp(CLIENT.nome));
    await expect(textarea).toHaveValue(new RegExp(CLIENT.email));
    await expect(textarea).toHaveValue(new RegExp(CLIENT.telefone));
  });

  test('cria, pesquisa, edita, arquiva, filtra arquivados e restaura sem terminologia Lead', async ({
    page,
  }) => {
    let rows = [{ ...CLIENT }];
    /** @type {Map<string, ClientDetail>} */
    const details = new Map([[CLIENT.id, { ...DETAIL }]]);

    await page.route('**/api/leads-clients**', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        const created = {
          ...CLIENT,
          id: '00000000-0000-4000-8000-000000000002',
          nome: body.nome,
          empresa: body.empresa || null,
          email: body.email,
          documento: body.documento || null,
          status: 'active',
          arquivado: false,
          notes: body.notes ?? body.observacoes ?? null,
          observacoes: body.notes ?? body.observacoes ?? null,
        };
        rows = [...rows, created];
        details.set(created.id, {
          ...DETAIL,
          id: created.id,
          name: created.id,
          display_name: created.nome,
          nome: created.nome,
          empresa: created.empresa,
          email: created.email,
          documento: created.documento,
          tax_id: created.documento,
        });
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            id: created.id,
            created: created.id,
            data: created,
          }),
        });
        return;
      }
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        rows = rows.map((row) =>
          row.id === id ? { ...row, arquivado: true, status: 'archived' } : row
        );
        const detail = details.get(id);
        if (detail)
          details.set(id, { ...detail, arquivado: true, archived: true, status: 'archived' });
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id, deleted: id, archived: true, arquivado: true }),
        });
        return;
      }
      const status = url.searchParams.get('status') || 'active';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const data = rows.filter(
        (row) =>
          (status === 'all' || row.status === status) &&
          (!search || `${row.nome} ${row.email} ${row.documento}`.toLowerCase().includes(search))
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          pagination: { page: 1, limit: 10, total: data.length, total_pages: data.length ? 1 : 0 },
        }),
      });
    });

    await page.route('**/api/client-detail**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      const id = url.searchParams.get('name') || '';
      const current = details.get(id) || {
        ...DETAIL,
        id,
        name: id,
        display_name: id,
        nome: DETAIL.display_name,
        archived: false,
      };
      if (request.method() === 'PATCH' || request.method() === 'PUT') {
        const body = request.postDataJSON();
        const notes = Object.prototype.hasOwnProperty.call(body, 'notes')
          ? body.notes
          : Object.prototype.hasOwnProperty.call(body, 'observacoes')
            ? body.observacoes
            : current.notes;
        const next = {
          ...current,
          display_name: body.nome || current.display_name,
          nome: body.nome || current.nome,
          empresa: body.empresa ?? current.empresa,
          email: body.email ?? current.email,
          notes,
          observacoes: notes,
          updated: true,
        };
        if (typeof body.arquivado === 'boolean') {
          next.arquivado = body.arquivado;
          next.status = body.arquivado ? 'archived' : 'active';
          next.archived = body.arquivado;
        }
        details.set(id, next);
        rows = rows.map((row) =>
          row.id === id
            ? {
                ...row,
                nome: next.display_name,
                empresa: next.empresa,
                email: next.email,
                arquivado: next.arquivado,
                status: next.status,
              }
            : row
        );
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...next }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...current }),
      });
    });

    await page.goto('/#/leads');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Novo cliente' }).click();
    await expect(page).toHaveURL(/#\/leads\/new/);
    await expect(page.getByRole('heading', { name: 'Novo cliente', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Nome do cliente *' }).fill('Ana Cliente');
    await page.getByRole('button', { name: 'Salvar cliente' }).last().click();

    await page.getByRole('button', { name: 'Clientes' }).first().click();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByLabel('Buscar clientes').fill('Ana');
    await expect(page.locator('tbody tr').filter({ hasText: 'Ana Cliente' }).first()).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    const row = page.locator('tbody tr').filter({ hasText: 'Ana Cliente' }).first();
    await row.hover();
    await row.getByRole('button', { name: /Visualização rápida Ana Cliente/ }).click();
    await expect(page.getByText('Empresa', { exact: true })).toBeVisible();
    await expect(page.getByText('Empresa não informada', { exact: true })).toBeVisible();
    await expect(page.getByText('Origem', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Contribuinte', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Inscrição Estadual', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('textbox', { name: 'Nome' }).fill('Ana Cliente Editada');
    await page.getByRole('textbox', { name: 'Empresa' }).fill('Ana Eventos');
    await page.getByLabel('Observações').fill('Nota do drawer');
    await page.getByRole('button', { name: /^Salvar$/ }).click();
    await expect(page.getByText('Ana Cliente Editada', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Ana Eventos', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Nota do drawer', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // Ações secundárias usam menu e confirmação (sem confirm() nativo)
    await page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first().hover();
    await page.getByRole('button', { name: /Mais ações para Ana Cliente Editada/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Arquivar cliente' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await page.getByRole('combobox', { name: 'Filtrar clientes por status' }).selectOption('archived');
    await expect(
      page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first()
    ).toBeVisible();
    await page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first().hover();
    await page.getByRole('button', { name: /Mais ações para Ana Cliente Editada/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Restaurar cliente' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' })).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Filtrar clientes por status' }).selectOption('active');
    await expect(
      page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first()
    ).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
  });

  test('deep-link novo cliente renders the local form directly', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/#/leads/cliente/new');
    await expect(page.getByRole('heading', { name: 'Novo cliente', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Salvar cliente' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
    expect(requests.some((url) => url.includes('/api/leads-clients'))).toBe(false);
  });

  test('deep-link novo cliente navega após um único POST @smoke', async ({ page }) => {
    const id = '33333333-3333-4333-8333-333333333333';
    let postCount = 0;
    /** @type {() => void} */
    let releasePost = () => {};
    const pendingPost = new Promise((resolve) => {
      releasePost = resolve;
    });
    await page.route('**/api/leads-clients**', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.fulfill({ json: { data: [], pagination: { total: 0 } } });
        return;
      }
      postCount += 1;
      await pendingPost;
      await route.fulfill({ json: { created: id } });
    });
    await page.route('**/api/client-detail**', (route) =>
      route.fulfill({ json: { ...DETAIL, id, name: id, nome: 'Cliente Deep Link', display_name: 'Cliente Deep Link' } })
    );

    await page.goto('/#/leads/cliente/new');
    await page.getByRole('textbox', { name: 'Nome do cliente *' }).fill('Cliente Deep Link');
    await page.getByRole('button', { name: 'Salvar cliente' }).last().click();
    await expect.poll(() => postCount).toBe(1);
    await expect(page).toHaveURL(/#\/leads\/cliente\/new$/);
    releasePost();
    await expect(page).toHaveURL(new RegExp(`#\\/leads\\/cliente\\/${id}$`));
    await expect(page.getByRole('heading', { name: 'Cliente Deep Link' })).toBeVisible();
    expect(postCount).toBe(1);
  });

  test('lista mantém o contrato local enquanto a API está pendente', async ({ page }) => {
    /** @type {() => void} */
    let release = () => {};
    /** @type {Promise<void>} */
    const pending = new Promise((resolve) => {
      release = () => resolve();
    });
    const initialRequests = [];
    await page.route('**/api/leads-clients**', async (route) => {
      initialRequests.push(route.request().url());
      await pending;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [],
          pagination: { page: 1, limit: 1, total: 0, total_pages: 0 },
        }),
      });
    });

    await page.goto('/#/leads');
    const sidebarClients = page
      .locator('aside')
      .getByRole('button', { name: 'Clientes', exact: true });
    await expect(sidebarClients).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByText('Leads', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
    expect(
      initialRequests.every(
        (requestUrl) => !new globalThis.URL(requestUrl).searchParams.has('tipo')
      )
    ).toBe(true);

    release();
    await expect(page.getByText('Nenhum cliente encontrado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo cliente' }).first()).toBeVisible();
    await expect(sidebarClients).toBeVisible();
    await expect(page.getByText('Leads', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
  });

  test('ação em massa core arquiva ativos e restaura arquivados sem exclusão irreversível', async ({
    page,
  }) => {
    let rows = [{ ...CLIENT }];
    const archiveRequests = [];
    const restoreRequests = [];

    await page.route('**/api/leads-clients**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id');
        archiveRequests.push({ id });
        rows = rows.map((row) =>
          row.id === id ? { ...row, arquivado: true, status: 'archived' } : row
        );
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, id, archived: true, arquivado: true }),
        });
        return;
      }

      const requestedStatus = url.searchParams.get('status') || 'active';
      const data = rows.filter(
        (row) => requestedStatus === 'all' || row.status === requestedStatus
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data,
          pagination: { page: 1, limit: 10, total: data.length, total_pages: data.length ? 1 : 0 },
        }),
      });
    });

    await page.route('**/api/client-detail**', async (route) => {
      const id = new globalThis.URL(route.request().url()).searchParams.get('name');
      const body = route.request().postDataJSON();
      restoreRequests.push({ id, body });
      rows = rows.map((row) =>
        row.id === id ? { ...row, arquivado: false, status: 'active' } : row
      );
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id, arquivado: false, status: 'active' }),
      });
    });

    await page.goto('/#/leads');
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toBeVisible();
    await page.getByRole('button', { name: 'Selecionar', exact: true }).click();
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await expect(page.getByRole('button', { name: 'Arquivar clientes' })).toBeVisible();
    await page.getByRole('button', { name: 'Arquivar clientes' }).click();
    await expect(page.getByRole('dialog').getByText('Arquivar 1 cliente?')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toContainText('Arquivado');
    expect(archiveRequests).toEqual([{ id: CLIENT.id }]);

    await page.getByRole('combobox', { name: 'Filtrar clientes por status' }).selectOption('all');
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await page.getByRole('button', { name: 'Arquivar clientes' }).click();
    await expect(page.getByText('Selecione clientes ativos para arquivar.')).toBeVisible();
    expect(archiveRequests).toHaveLength(1);

    await page.getByRole('combobox', { name: 'Filtrar clientes por status' }).selectOption('archived');
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toBeVisible();
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await expect(page.getByRole('button', { name: 'Restaurar clientes' })).toBeVisible();
    await page.getByRole('button', { name: 'Restaurar clientes' }).click();
    await expect(page.getByRole('dialog').getByText('Restaurar 1 cliente?')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText('Nenhum cliente corresponde aos filtros')).toBeVisible();
    expect(restoreRequests).toEqual([{ id: CLIENT.id, body: { arquivado: false } }]);
  });

  test('cliente local cria, lê e edita observações', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000003';
    let record = {
      ...DETAIL,
      id,
      name: id,
      display_name: '',
      nome: '',
      notes: null,
      observacoes: null,
    };
    let createdNotes = null;
    let editedNotes = null;
    /** @type {{ nome: string, email: string, telefone: string, documento?: string, notes?: string, endereco?: object }} */
    let createdPost = { nome: '', email: '', telefone: '' };

    await page.route('**/api/leads-clients**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [],
            pagination: { page: 1, limit: 1, total: 0, total_pages: 0 },
          }),
        });
        return;
      }
      const body = request.postDataJSON();
      createdPost = body;
      createdNotes = body.notes ?? null;
      record = {
        ...record,
        display_name: body.nome,
        nome: body.nome,
        email: body.email || null,
        telefone: body.telefone || null,
        notes: body.notes ?? null,
        observacoes: body.notes ?? null,
        documento: body.documento ?? null,
        tax_id: body.documento ?? null,
      };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id, created: id, name: id, data: record }),
      });
    });

    await page.route('**/api/client-detail**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...record }),
        });
        return;
      }
      const body = request.postDataJSON();
      const notes = body.notes ?? body.observacoes ?? null;
      editedNotes = notes;
      record = {
        ...record,
        email: body.email ?? record.email,
        telefone: body.telefone ?? record.telefone,
        tax_id: body.tax_id ?? body.documento ?? record.tax_id,
        documento: body.tax_id ?? body.documento ?? record.documento,
        address: body.endereco ?? body.address ?? record.address,
        notes,
        observacoes: notes,
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...record, updated: true }),
      });
    });

    await page.goto('/#/leads/new');
    await expect(page.getByRole('heading', { name: 'Identificação' })).toBeVisible();
    await expect(page.getByText('Origem', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Contribuinte', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Inscrição estadual', { exact: true })).toHaveCount(0);
    await page.getByRole('textbox', { name: 'Nome do cliente *' }).fill('Cliente com observação');
    await page.getByRole('textbox', { name: 'E-mail' }).fill('cliente@example.com');
    await page.getByRole('textbox', { name: 'Telefone' }).fill('(11) 99999-0000');
    await page.getByRole('textbox', { name: 'Documento' }).fill('12345678901');
    await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Observações' }) }).locator('summary').click();
    await page.getByLabel('Observações').fill('Nota criada');
    await page.getByRole('button', { name: 'Salvar cliente' }).click();
    await expect(page).toHaveURL(new RegExp(`#\\/leads\\/cliente\\/${id}$`));
    await expect(page.getByText('Nota criada', { exact: true })).toBeVisible();
    expect(createdNotes).toBe('Nota criada');
    expect(createdPost.nome).toBe('Cliente com observação');
    expect(createdPost.email).toBe('cliente@example.com');
    expect(createdPost.telefone).toBe('(11) 99999-0000');
    expect(createdPost.documento).toBe('12345678901');
    expect(createdPost.notes).toBe('Nota criada');

    await page.getByRole('button', { name: 'Editar cadastro' }).click();
    await expect(page.getByLabel('Observações')).toHaveValue('Nota criada');
    await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Observações' }) }).locator('summary').click();
    await page.getByLabel('Observações').fill('Nota editada');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Nota editada', { exact: true })).toBeVisible();
    expect(editedNotes).toBe('Nota editada');
  });

  test('lista preserva filtros na URL, usa o nome como link e mantém arquivar no menu secundário', async ({
    page,
  }) => {
    const requests = [];
    /** @type {URL | undefined} */
    let exportRequest;
    await page.route('**/api/commercial-exports**', async (route) => {
      exportRequest = new globalThis.URL(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: 'text/csv',
        headers: { 'Content-Disposition': 'attachment; filename="clientes.csv"' },
        body: 'nome\nMaria\n',
      });
    });
    await page.route('**/api/leads-clients**', async (route) => {
      const requestUrl = new globalThis.URL(route.request().url());
      requests.push(requestUrl);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ ...CLIENT, nome: 'Cliente com nome longo para validar quebra de conteúdo' }],
          pagination: { page: 2, limit: 25, total: 26, total_pages: 2 },
        }),
      });
    });

    await page.goto('/#/leads?search=Maria&status=all&page=2&limit=25');
    await expect(page.locator('tbody a[href^="#/leads/cliente/"]').first()).toHaveAttribute(
      'href',
      `#/leads/cliente/${CLIENT.id}`
    );
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((requestUrl) => requestUrl.searchParams.get('search') === 'Maria')).toBe(
      true
    );
    expect(requests.every((requestUrl) => requestUrl.searchParams.get('status') === 'all')).toBe(
      true
    );
    expect(requests.every((requestUrl) => requestUrl.searchParams.get('page') === '2')).toBe(true);
    expect(requests.every((requestUrl) => requestUrl.searchParams.get('limit') === '25')).toBe(
      true
    );

    await page.getByRole('button', { name: 'Exportar CSV' }).click();
    await expect.poll(() => exportRequest?.searchParams.get('resource')).toBe('clients');
    if (!exportRequest) throw new Error('A exportação controlada não foi solicitada.');
    expect(exportRequest.searchParams.get('search')).toBe('Maria');
    expect(exportRequest.searchParams.get('status')).toBe('all');

    await page.locator('tbody tr').filter({ hasText: 'Cliente com nome longo' }).hover();
    await page.getByRole('button', { name: /Mais ações para Cliente com nome longo/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Arquivar cliente' }).click();
    await expect(
      page
        .getByRole('dialog')
        .getByText('Arquivar o cliente Cliente com nome longo para validar quebra de conteúdo?')
    ).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(requests.length).toBeGreaterThan(0);
  });

  test('detalhe cancela para o último estado do servidor e omite relações ausentes', async ({
    page,
  }) => {
    const serverName = 'Cliente no servidor';
    await page.route('**/api/client-detail**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...DETAIL,
          nome: serverName,
          display_name: serverName,
          notes: null,
          observacoes: null,
          address: null,
          latest_quotation: null,
          deal: null,
          quality_flags: [],
        }),
      });
    });

    await page.goto(`/#/leads/cliente/${CLIENT.id}`);
    await expect(page.getByRole('heading', { name: serverName }).first()).toBeVisible();
    await expect(page.getByText('Observações', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir orçamento recente' })).toHaveCount(0);
    await expect(page.getByText('Endereço', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Editar cadastro' }).click();
    await page.getByRole('textbox', { name: 'Nome do cliente *' }).fill('Alteração descartada');
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Descartar', exact: true }).click();
    await expect(page.getByText(serverName, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Alteração descartada', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: /Mais ações para Cliente no servidor/ }).click();
    await page.getByRole('menu').getByRole('menuitem', { name: 'Arquivar cliente' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  });

  test('drawer preserva o formulário após falha e protege alterações ao fechar', async ({ page }) => {
    await page.route('**/api/leads-clients**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [CLIENT],
          pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        }),
      })
    );
    await page.route('**/api/client-detail**', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL) })
        : route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'falha controlada' }) })
    );

    await page.goto('/#/leads');
    const trigger = page.getByRole('button', { name: `Visualização rápida ${CLIENT.nome}` });
    await page.locator('tbody tr').filter({ hasText: CLIENT.nome }).hover();
    await trigger.click();
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Nome', exact: true });
    await name.fill('Alteração preservada');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByText('Não foi possível salvar as alterações. Tente novamente.')).toBeVisible();
    await expect(name).toHaveValue('Alteração preservada');

    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    const discard = page.getByRole('dialog', { name: 'Descartar alterações?' });
    await expect(discard).toBeVisible();
    await discard.getByRole('button', { name: 'Continuar editando' }).click();
    await expect(name).toHaveValue('Alteração preservada');
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Descartar alterações?' }).getByRole('button', { name: 'Descartar' }).click();
    await expect(trigger).toBeFocused();
  });
});
