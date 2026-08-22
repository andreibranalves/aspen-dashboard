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

/** @typedef {typeof DETAIL & { id?: string, nome?: string, archived?: boolean, updated?: boolean }} ClientDetail */

test.describe('Clientes locais @crm @smoke', () => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DETAIL) });
    });

    await page.goto('/#/leads');
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo contato' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ativos' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Arquivados' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    await page.getByText(CLIENT.nome, { exact: true }).first().click();
    await expect(page.getByText('Cliente', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(CLIENT.nome, { exact: true }).last()).toBeVisible();
  });

  test('cria, pesquisa, edita, arquiva, filtra arquivados e restaura sem terminologia Lead', async ({ page }) => {
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
          email: body.email,
          documento: body.documento || null,
          status: 'active',
          arquivado: false,
          notes: body.notes ?? body.observacoes ?? null,
          observacoes: body.notes ?? body.observacoes ?? null,
        };
        rows = [...rows, created];
        details.set(created.id, { ...DETAIL, id: created.id, name: created.id, display_name: created.nome, nome: created.nome, email: created.email, documento: created.documento, tax_id: created.documento });
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ success: true, id: created.id, created: created.id, data: created }) });
        return;
      }
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id') || '';
        rows = rows.map((row) => row.id === id ? { ...row, arquivado: true, status: 'archived' } : row);
        const detail = details.get(id);
        if (detail) details.set(id, { ...detail, arquivado: true, archived: true, status: 'archived' });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id, deleted: id, archived: true, arquivado: true }) });
        return;
      }
      const status = url.searchParams.get('status') || 'active';
      const search = (url.searchParams.get('search') || '').toLowerCase();
      const data = rows.filter((row) => (status === 'all' || row.status === status) && (!search || `${row.nome} ${row.email} ${row.documento}`.toLowerCase().includes(search)));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, pagination: { page: 1, limit: 10, total: data.length, total_pages: data.length ? 1 : 0 } }) });
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
        rows = rows.map((row) => row.id === id ? { ...row, nome: next.display_name, email: next.email, arquivado: next.arquivado, status: next.status } : row);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...next }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...current }) });
    });

    await page.goto('/#/leads');
    await page.getByRole('button', { name: 'Clientes' }).first().click();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Novo contato' }).click();
    await expect(page).toHaveURL(/#\/leads\/cliente\/new/);
    await expect(page.getByText('Novo cliente', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Nome do cliente').fill('Ana Cliente');
    await page.getByRole('button', { name: 'Criar cliente' }).last().click();

    await page.getByRole('button', { name: 'voltar' }).click();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await page.getByLabel('Buscar clientes').fill('Ana');
    await expect(page.locator('tbody tr').filter({ hasText: 'Ana Cliente' }).first()).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);

    const row = page.locator('tbody tr').filter({ hasText: 'Ana Cliente' }).first();
    await row.getByRole('button', { name: /Visualização rápida Ana Cliente/ }).click();
    await expect(page.getByText('Empresa', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Origem', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Contribuinte', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Inscrição Estadual', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Editar' }).click();
    await page.getByRole('textbox', { name: 'Nome' }).fill('Ana Cliente Editada');
    await page.getByLabel('Observações').fill('Nota do drawer');
    await page.getByRole('button', { name: /^Salvar$/ }).click();
    await expect(page.getByText('Ana Cliente Editada', { exact: true }).last()).toBeVisible();
    await expect(page.getByText('Nota do drawer', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Fechar', exact: true }).click();

    // Confirmação migrada para ConfirmDialog (sem confirm() nativo)
    await page.getByRole('button', { name: /Arquivar Ana Cliente Editada/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await page.getByRole('button', { name: 'Arquivados' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Restaurar Ana Cliente Editada/ })).toBeVisible();
    await page.getByRole('button', { name: /Restaurar Ana Cliente Editada/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
    await page.getByRole('button', { name: 'Ativos' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Ana Cliente Editada' }).first()).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
  });

  test('deep-link novo cliente renders the local form directly', async ({ page }) => {
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.goto('/#/leads/cliente/new');
    await expect(page.getByText('Novo cliente', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar cliente' })).toBeVisible();
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
    expect(requests.some((url) => url.includes('/api/leads-clients'))).toBe(false);
  });

  test('lista mantém o contrato local enquanto a API está pendente', async ({ page }) => {
    /** @type {() => void} */
    let release = () => {};
    /** @type {Promise<void>} */
    const pending = new Promise((resolve) => { release = () => resolve(); });
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
    const sidebarClients = page.locator('aside').getByRole('button', { name: 'Clientes', exact: true });
    await expect(sidebarClients).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clientes' })).toBeVisible();
    await expect(page.getByText('Leads', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
    expect(initialRequests.every((requestUrl) => !new globalThis.URL(requestUrl).searchParams.has('tipo'))).toBe(true);

    release();
    await expect(page.getByText('Nenhum cliente encontrado', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novo contato' }).first()).toBeVisible();
    await expect(sidebarClients).toBeVisible();
    await expect(page.getByText('Leads', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Lead', { exact: true })).toHaveCount(0);
  });

  test('ação em massa core arquiva ativos e restaura arquivados sem exclusão irreversível', async ({ page }) => {
    let rows = [{ ...CLIENT }];
    const archiveRequests = [];
    const restoreRequests = [];

    await page.route('**/api/leads-clients**', async (route) => {
      const request = route.request();
      const url = new globalThis.URL(request.url());
      if (request.method() === 'DELETE') {
        const id = url.searchParams.get('id');
        archiveRequests.push({ id });
        rows = rows.map((row) => row.id === id ? { ...row, arquivado: true, status: 'archived' } : row);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id, archived: true, arquivado: true }) });
        return;
      }

      const requestedStatus = url.searchParams.get('status') || 'active';
      const data = rows.filter((row) => requestedStatus === 'all' || row.status === requestedStatus);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data, pagination: { page: 1, limit: 10, total: data.length, total_pages: data.length ? 1 : 0 } }),
      });
    });

    await page.route('**/api/client-detail**', async (route) => {
      const id = new globalThis.URL(route.request().url()).searchParams.get('name');
      const body = route.request().postDataJSON();
      restoreRequests.push({ id, body });
      rows = rows.map((row) => row.id === id ? { ...row, arquivado: false, status: 'active' } : row);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, id, arquivado: false, status: 'active' }) });
    });

    await page.goto('/#/leads');
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toBeVisible();
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await expect(page.getByRole('button', { name: 'Arquivar clientes' })).toBeVisible();
    await page.getByRole('button', { name: 'Arquivar clientes' }).click();
    await expect(page.getByRole('dialog').getByText('Arquivar 1 cliente?')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Arquivar', exact: true }).click();
    await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();
    expect(archiveRequests).toEqual([{ id: CLIENT.id }]);

    await page.getByRole('button', { name: 'Todos' }).click();
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await page.getByRole('button', { name: 'Arquivar clientes' }).click();
    await expect(page.getByText('Selecione clientes ativos para arquivar.')).toBeVisible();
    expect(archiveRequests).toHaveLength(1);

    await page.getByRole('button', { name: 'Arquivados' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: CLIENT.nome })).toBeVisible();
    await page.getByLabel(`Selecionar ${CLIENT.nome}`).check();
    await expect(page.getByRole('button', { name: 'Restaurar clientes' })).toBeVisible();
    await page.getByRole('button', { name: 'Restaurar clientes' }).click();
    await expect(page.getByRole('dialog').getByText('Restaurar 1 cliente?')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
    await expect(page.getByText('Nenhum cliente encontrado')).toBeVisible();
    expect(restoreRequests).toEqual([{ id: CLIENT.id, body: { arquivado: false } }]);
  });

  test('cliente local cria, lê e edita observações', async ({ page }) => {
    const id = '00000000-0000-4000-8000-000000000003';
    let record = { ...DETAIL, id, name: id, display_name: '', nome: '', notes: null, observacoes: null };
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
          body: JSON.stringify({ data: [], pagination: { page: 1, limit: 1, total: 0, total_pages: 0 } }),
        });
        return;
      }
      const body = request.postDataJSON();
      createdPost = body;
      createdNotes = body.notes ?? null;
      record = { ...record, display_name: body.nome, nome: body.nome, email: body.email || null, telefone: body.telefone || null, notes: body.notes ?? null, observacoes: body.notes ?? null, documento: body.documento ?? null, tax_id: body.documento ?? null };
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, id, created: id, name: id, data: record }),
      });
    });

    await page.route('**/api/client-detail**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...record }) });
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...record, updated: true }) });
    });

    await page.goto('/#/leads/cliente/new');
    await expect(page.getByText('Empresa', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Origem', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Contribuinte', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Inscrição estadual', { exact: true })).toHaveCount(0);
    await page.getByPlaceholder('Nome do cliente').fill('Cliente com observação');
    await page.getByPlaceholder('email@exemplo.com').fill('cliente@example.com');
    await page.getByPlaceholder('(99) 99999-9999').fill('(11) 99999-0000');
    await page.getByPlaceholder('CPF ou CNPJ').fill('12345678901');
    await page.getByLabel('Observações').fill('Nota criada');
    await page.getByRole('button', { name: 'Criar cliente' }).click();
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
    await page.getByLabel('Observações').fill('Nota editada');
    await page.getByRole('button', { name: 'Salvar' }).click();
    await expect(page.getByText('Nota editada', { exact: true })).toBeVisible();
    expect(editedNotes).toBe('Nota editada');
  });
});
