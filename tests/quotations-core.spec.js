import { expect, test } from '@playwright/test';
import { URL } from 'node:url';

const id = 'ORC-20260001';
const token = '2026-07-01T12:00:00.000Z';

function withCanonicalDetail(value) {
  return {
    ...value,
    canonical: {
      id: value.quotation_uuid,
      businessNumber: value.quotation_id,
      name: value.quotation_name || value.quotation_id,
      revisionId: value.revision_id,
      revision: value.revision_number ?? value.revision,
      status: value.status_canonical,
      clienteId: value.client_id,
      cliente: value.cliente,
      data: value.data,
      validade: value.validade,
      validadeDias: value.validade_dias,
      subtotal: value.subtotal,
      total: value.total,
      frete: value.frete,
      expired: value.derived_expired,
      concurrencyToken: value.concurrency_token,
      updatedAt: value.updated_at,
      emailSent: value.email_sent,
      emailSentAt: value.email_sent_at,
      pagamento: value.pagamento,
      entrega: value.entrega,
      observacoes: value.observacoes,
      prazoProducao: value.prazo_producao,
      templateKey: value.template_key,
      templateHash: value.template_hash,
      items: [],
      revisionHistory: [],
    },
  };
}

function withCanonicalListRow(value, quotationUuid) {
  return {
    ...value,
    canonical: {
      id: quotationUuid,
      businessNumber: value.id,
      name: value.cliente,
      revisionId: value.revision_id,
      revision: value.revision_number ?? value.revision ?? 1,
      status: value.status_canonical || 'rascunho',
      clienteId: value.client_id || '33333333-3333-4333-8333-333333333333',
      cliente: value.cliente,
      data: value.data,
      validade: value.validade || '2026-09-04',
      validadeDias: value.validade_dias ?? 15,
      subtotal: value.subtotal ?? value.valor ?? '0.00',
      total: value.total ?? value.valor ?? '0.00',
      frete: value.frete ?? '0.00',
      expired: false,
      concurrencyToken: value.concurrency_token || token,
      updatedAt: value.updated_at || token,
      emailSent: value.email_sent || false,
    },
  };
}

function detail(overrides = {}) {
  return withCanonicalDetail({
    id,
    quotation_id: id,
    quotation_uuid: '11111111-1111-4111-8111-111111111111',
    revision_id: '22222222-2222-4222-8222-222222222222',
    revision: 1,
    revision_number: 1,
    status: 'Draft',
    status_canonical: 'rascunho',
    cliente: 'Cliente local',
    client_id: '33333333-3333-4333-8333-333333333333',
    cliente_snapshot: {
      id: '33333333-3333-4333-8333-333333333333',
      nome: 'Cliente local',
      email: 'cliente@example.com',
    },
    email_sent: false,
    email_sent_at: null,
    validade_dias: 15,
    validade: '2026-07-16',
    data: '2026-07-01',
    pagamento: 'À vista',
    entrega: '10 dias',
    frete_padrao: '0.00',
    frete: '0.00',
    observacoes: 'Original',
    prazo_producao: '3 dias',
    template_padrao: 'padrao',
    template_key: 'padrao',
    template_hash: 'ee159f5ad83ae26cabd2eb8c00fc6a0227319290ee24809055cc23da0a26108e',
    template_version_id: null,
    template_version: null,
    secoes: { schema_version: 1, prazo_producao: { base: { enabled: true, title: 'Prazo' }, current: { enabled: true, title: 'Prazo' } }, pagamento: { base: { enabled: true, title: 'Pagamento', body: 'À vista' }, current: { enabled: true, title: 'Pagamento', body: 'À vista' } }, condicoes_gerais: { base: { enabled: true, title: 'Condições', body: '' }, current: { enabled: true, title: 'Condições', body: '' } } },
    subtotal: '90.00',
    total: '90.00',
    valor: '90.00',
    concurrency_token: token,
    updated_at: token,
    items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: 'Produto local', item_name: 'Produto local', qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '9.00', price_difference: '0.00', line_total: '90.00', manual_rate: false }],
    revision_history: [], derived_expired: false, expiration_derived: false, is_expired: false, expirada: false,
    ...overrides,
  });
}

test('exclusão manual permite excluir enviado e exibe bloqueio de pedido', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/quotations**', async route => {
    if (route.request().method() === 'DELETE') {
      attempts += 1;
      await route.fulfill({ status: attempts === 1 ? 409 : 200, json: attempts === 1 ? { error: 'Este orçamento possui pedido vinculado e não pode ser excluído.' } : { success: true } });
    } else {
      await route.fulfill({ json: new URL(route.request().url()).searchParams.has('id')
        ? detail({ status: 'Enviado', status_canonical: 'emitido' })
        : { data: [], pagination: { total: 0 } } });
    }
  });
  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir orçamento' }).click();
  const dialog = page.getByRole('dialog', { name: 'Excluir orçamento?' });
  await expect(dialog).toContainText('todas as suas revisões');
  await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByText('Este orçamento possui pedido vinculado e não pode ser excluído.')).toBeVisible();
  await page.getByRole('button', { name: 'Mais ações', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Excluir orçamento' }).click();
  await dialog.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page).toHaveURL(/#\/quotations$/);
  expect(attempts).toBe(2);
});

test('email markers render on desktop and mobile', async ({ page }) => {
  const rows = [
    withCanonicalListRow({
      id: 'ORC-EMAIL-1',
      data: '2026-08-17',
      cliente: 'Cliente Enviado',
      valor: '100.00',
      status: 'Enviado',
      status_canonical: 'emitido',
      revision_id: '11111111-1111-4111-8111-111111111111',
      email_sent: true,
      email_sent_at: '2026-08-17T12:00:00.000Z',
    }, '11111111-1111-4111-8111-111111111101'),
    withCanonicalListRow({
      id: 'ORC-EMAIL-2',
      data: '2026-08-17',
      cliente: 'Cliente Pendente',
      valor: '200.00',
      status: 'Enviado',
      status_canonical: 'emitido',
      revision_id: '22222222-2222-4222-8222-222222222222',
      email_sent: false,
      email_sent_at: null,
    }, '22222222-2222-4222-8222-222222222202'),
  ];
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: rows,
        pagination: { page: 1, limit: 10, total: rows.length, total_pages: 1 },
        status_summary: { Enviado: rows.length },
      }),
    });
  });

  await page.goto('/#/quotations');
  // marcador de e-mail agora é icônico: enviado = ícone + data; pendente = '—'
  const desktopRows = page.getByRole('row');
  await expect(
    desktopRows.filter({ hasText: 'ORC-EMAIL-1' }).getByLabel('E-mail enviado em 17/08/2026')
  ).toBeVisible();
  const pendingDesktopRow = desktopRows.filter({ hasText: 'ORC-EMAIL-2' });
  await expect(pendingDesktopRow.getByLabel('E-mail ainda não enviado')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const mobileCards = page.locator('[class~="md:hidden"] > div');
  await expect(
    mobileCards.filter({ hasText: 'ORC-EMAIL-1' }).getByLabel('E-mail enviado em 17/08/2026')
  ).toBeVisible();
  const pendingMobileCard = mobileCards.filter({ hasText: 'ORC-EMAIL-2' });
  await expect(pendingMobileCard.getByLabel('E-mail ainda não enviado')).toBeVisible();
});

test('lista oferece recuperação sem expor erro bruto @quotations @smoke', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/quotations**', async (route) => {
    attempts += 1;
    if (attempts <= 2) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'internal database details' }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [withCanonicalListRow({
          id: 'ORC-RETRY-1',
          data: '2026-08-20',
          cliente: 'Cliente de recuperação',
          valor: '100.00',
          status: 'Rascunho',
          status_canonical: 'rascunho',
          revision_id: '11111111-1111-4111-8111-111111111111',
          email_sent: false,
          email_sent_at: null,
        }, '11111111-1111-4111-8111-111111111102')],
        pagination: { page: 1, limit: 10, total: 1, total_pages: 1 },
        status_summary: { Rascunho: 1 },
      }),
    });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText('Não foi possível carregar os orçamentos.')).toBeVisible();
  await expect(page.getByText('internal database details')).toHaveCount(0);
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByRole('cell', { name: 'ORC-RETRY-1', exact: true })).toBeVisible();
  expect(attempts).toBeGreaterThanOrEqual(3);
});

test('lista distingue filtro sem resultado, preserva paginação e destaca o orçamento como ação primária @quotations @smoke', async ({ page }) => {
  const row = withCanonicalListRow({
    id: 'ORC-PRIMARY-1',
    data: '2026-08-20',
    cliente: 'Cliente com nome longo para uma proposta comercial',
    valor: '1250.00',
    status: 'Aprovado',
    status_canonical: 'aprovado',
    revision_id: '11111111-1111-4222-8222-222222222222',
    email_sent: false,
    email_sent_at: null,
  }, '11111111-1111-4111-8111-111111111103');
  await page.route('**/api/quotations**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    const filtered = url.searchParams.get('search') === 'sem-resultado';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: filtered ? [] : [row],
        pagination: { page: 1, limit: 25, total: filtered ? 0 : 1, total_pages: 1 },
        status_summary: { Rascunho: 0, Enviado: 0, Aprovado: 1, Perdido: 0 },
      }),
    });
  });

  await page.goto('/#/quotations?search=sem-resultado&status=aprovado&page=2&limit=25');
  await expect(page.getByText('Nenhum orçamento encontrado')).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(page.getByRole('cell', { name: row.id, exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Aprovado', exact: true })).toBeVisible();

  const hash = new globalThis.URL(page.url().replace(/^.*#/, 'http://local/'));
  expect(hash.searchParams.get('search')).toBeNull();
  expect(hash.searchParams.get('status')).toBeNull();
  expect(hash.searchParams.get('page')).toBeNull();
  expect(hash.searchParams.get('limit')).toBe('25');
});

test('detalhe mantém conteúdo longo legível em modo somente leitura @quotations @smoke', async ({ page }) => {
  const longText = 'Observação comercial com conteúdo extenso que deve continuar legível e quebrar dentro da seção sem criar rolagem horizontal.'.repeat(3);
  await page.route('**/api/quotations?id=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail({
        status: 'Enviado',
        status_canonical: 'emitido',
        observacoes: longText,
        secoes: {
          ...detail().secoes,
          condicoes_gerais: {
            ...detail().secoes.condicoes_gerais,
            current: { ...detail().secoes.condicoes_gerais.current, body: longText },
          },
        },
        items: [{
          id: '44444444-4444-4444-8444-444444444444',
          sku: 'SKU-LONGO',
          item_code: 'SKU-LONGO',
          nome: 'Produto com nome suficientemente longo para validar a quebra de conteúdo na tabela',
          item_name: 'Produto com nome suficientemente longo para validar a quebra de conteúdo na tabela',
          qty: '10.000',
          suggested_unit_price: '9.00',
          applied_unit_price: '9.00',
          price_difference: '0.00',
          line_total: '90.00',
          manual_rate: false,
        }],
      })),
    });
  });
  await page.route('**/api/communication-flows', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flows: [], selectedFlowId: null }) });
  });
  await page.route('**/api/quotation-templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Somente leitura. Alterações criam uma nova revisão.')).toBeVisible();
  await expect(page.getByText(longText)).toBeVisible();
  await expect(page.getByText('Produto com nome suficientemente longo para validar a quebra de conteúdo na tabela')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Itens do orçamento' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Condições comerciais' })).toBeVisible();
});

test('menu de ações e detalhes recolhíveis mantêm fechamento, foco e semântica acessíveis @quotations', async ({ page }) => {
  const firstRow = withCanonicalListRow({
    id: 'ORC-MENU-1',
    data: '2026-08-20',
    cliente: 'Cliente do menu 1',
    valor: '100.00',
    status: 'Enviado',
    status_canonical: 'emitido',
    revision_id: '11111111-1111-4222-8222-222222222221',
  }, '11111111-1111-4111-8111-111111111121');
  const secondRow = withCanonicalListRow({
    id: 'ORC-MENU-2',
    data: '2026-08-21',
    cliente: 'Cliente do menu 2',
    valor: '200.00',
    status: 'Enviado',
    status_canonical: 'emitido',
    revision_id: '22222222-2222-4222-8222-222222222222',
  }, '22222222-2222-4222-8222-222222222222');
  await page.route('**/api/quotations**', async (route) => {
    const url = new globalThis.URL(route.request().url());
    if (url.searchParams.has('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail({ status: 'Enviado', status_canonical: 'emitido' })) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [firstRow, secondRow],
        pagination: { page: 1, limit: 10, total: 2, total_pages: 1 },
        status_summary: { Enviado: 2 },
      }),
    });
  });
  await page.route('**/api/communication-flows**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flows: [], selectedFlowId: null }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/quotations');
  const firstAction = page.getByRole('button', { name: 'Ações do orçamento ORC-MENU-1' });
  const secondAction = page.getByRole('button', { name: 'Ações do orçamento ORC-MENU-2' });
  await firstAction.click();
  const firstMenu = page.locator('#quotation-actions-mobile-11111111-1111-4111-8111-111111111121');
  await expect(firstMenu).toBeVisible();
  await expect(firstMenu.locator('[role="menuitem"]')).toHaveCount(0);
  expect(await firstMenu.evaluate((element) => globalThis.getComputedStyle(element).position)).toBe('fixed');
  const firstMenuBottom = await firstMenu.evaluate((element) => element.getBoundingClientRect().bottom);
  expect(firstMenuBottom).toBeLessThanOrEqual(844);

  await secondAction.click();
  await expect(firstMenu).toBeHidden();
  const secondMenu = page.locator('#quotation-actions-mobile-22222222-2222-4222-8222-222222222222');
  await expect(secondMenu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(secondMenu).toBeHidden();
  await expect(secondAction).toBeFocused();
  await secondAction.click();
  await secondMenu.getByRole('button', { name: 'Duplicar' }).click();
  await expect(page.getByRole('dialog', { name: 'Duplicar orçamento?' })).toBeVisible();
  await expect(secondMenu).toBeHidden();
  await page.getByRole('dialog', { name: 'Duplicar orçamento?' }).getByRole('button', { name: 'Cancelar' }).click();
  await secondAction.click();
  await page.getByRole('heading', { name: 'Orçamentos', exact: true }).click();
  await expect(secondMenu).toBeHidden();

  await page.goto('/#/quotations/q-emitido');
  const detailPanel = page.locator('#quotation-panel');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(detailPanel).not.toHaveAttribute('role', 'tabpanel');

  const documentSummary = detailPanel.locator('summary').filter({ hasText: 'Detalhes do documento' });
  await documentSummary.focus();
  await page.keyboard.press('Enter');
  await expect(documentSummary.locator('..')).toHaveAttribute('open', '');
  await expect(documentSummary).toBeFocused();

  const historySummary = detailPanel.locator('summary').filter({ hasText: 'Histórico e revisões' });
  await historySummary.click();
  await expect(historySummary.locator('..')).toHaveAttribute('open', '');
  await expect(detailPanel.getByRole('table').last()).toBeVisible();
});

test('detalhe mantém um único scroll vertical no shell @quotations @smoke', async ({ page }) => {
  await page.route('**/api/quotations?id=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail({
        items: Array.from({ length: 30 }, (_, index) => ({
          id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
          sku: `SKU-${index}`,
          item_code: `SKU-${index}`,
          nome: `Produto local ${index}`,
          item_name: `Produto local ${index}`,
          qty: '10.000',
          suggested_unit_price: '9.00',
          applied_unit_price: '9.00',
          price_difference: '0.00',
          line_total: '90.00',
          manual_rate: false,
        })),
      })),
    });
  });
  await page.route('**/api/communication-flows', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, flows: [], selectedFlowId: null }) });
  });
  await page.route('**/api/quotation-templates', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ templates: [] }) });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByRole('heading', { name: 'Itens' })).toBeVisible();

  const readScrollState = () => page.evaluate(() => {
    const main = globalThis.document.querySelector('main');
    const topBar = main?.previousElementSibling;
    return {
      windowY: globalThis.scrollY,
      documentHeight: globalThis.document.documentElement.scrollHeight,
      viewportHeight: globalThis.innerHeight,
      mainTop: main?.getBoundingClientRect().top,
      mainBottom: main?.getBoundingClientRect().bottom,
      mainScrollHeight: main?.scrollHeight,
      mainClientHeight: main?.clientHeight,
      topBarTop: topBar?.getBoundingClientRect().top,
    };
  });

  const initial = await readScrollState();
  expect(initial.documentHeight).toBeLessThanOrEqual(initial.viewportHeight);
  await page.locator('main').evaluate((main) => { main.scrollTop = main.scrollHeight; });
  await expect(page.getByRole('navigation', { name: 'Trilha de navegação' })).toBeVisible();
  const scrolled = await readScrollState();
  expect(scrolled.windowY).toBe(0);
  expect(scrolled.documentHeight).toBeLessThanOrEqual(scrolled.viewportHeight);
  expect(scrolled.mainBottom).toBe(scrolled.viewportHeight);
  expect(scrolled.topBarTop).toBe(0);
  expect(scrolled.mainScrollHeight).toBeGreaterThan(scrolled.mainClientHeight);
});

test('cancelar edição sem alterações não abre confirmação de descarte @quotations @smoke', async ({ page }) => {
  let authoritative = detail();
  await page.route('**/api/quotations**', async (route) => {
    if (route.request().method() === 'GET' && new globalThis.URL(route.request().url()).searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [withCanonicalListRow({ id, revision_id: '22222222-2222-4222-8222-222222222222', cliente: 'Cliente local', data: '2026-07-01', valor: '90.00', status: 'Rascunho', status_canonical: 'rascunho' }, '11111111-1111-4111-8111-111111111111')], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 }, status_summary: { Rascunho: 1 } }),
    });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_key: 'padrao',
        templates: [
          {
            key: 'padrao',
            name: 'Padrão Aspen',
            archived: false,
            is_default: true,
            current_version_id: '99999999-9999-4999-8999-999999999999',
            current_version: 2,
          },
        ],
      }),
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await expect(page.getByText('Produto local')).toBeVisible();

  // editar sem alterar nada e cancelar: dirty detection determinística não deve disparar
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByText('Descartar alterações?')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Editar/ })).toBeVisible();
});

test('editar mantém o início do formulário e a seleção ativa nos editores @quotations', async ({ page }) => {
  await page.route('**/api/quotations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail()) });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: 'Editar' }).click();

  const clientHeading = page.getByRole('heading', { name: 'Cliente', exact: true });
  const conditions = page.getByRole('textbox', { name: 'Condições gerais', exact: true });
  await expect(clientHeading).toBeInViewport();
  await expect(conditions).not.toBeFocused();

  const payment = page.getByRole('textbox', { name: 'Condição de pagamento', exact: true });
  await payment.focus();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('Prazo final');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.type('bem ');

  await expect(payment).toBeFocused();
  await expect(payment).toHaveText('Prazo bem final');
});

test('local quotations list/search/open/edit and surface optimistic conflicts @quotations @smoke', async ({ page }) => {
  const customItemName = 'Lenço 100 x 100 cm';
  let putCount = 0;
  let lastPutPayload;
  let authoritative = detail();
  await page.route('**/api/quotations**', async (route) => {
    const request = route.request();
    const url = new globalThis.URL(request.url());
    if (request.method() === 'GET' && url.searchParams.get('id')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      return;
    }
    if (request.method() === 'PUT') {
      putCount += 1;
      lastPutPayload = request.postDataJSON();
      if (putCount === 2) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'O orçamento foi alterado por outro usuário. Recarregue antes de salvar.' }) });
      } else {
        const authoritativeSections = globalThis.structuredClone(lastPutPayload.secoes);
        authoritativeSections.pagamento.current.body = '30 dias';
        authoritativeSections.condicoes_gerais.current.body = 'Alteração local';
        authoritative = detail({
          pagamento: authoritativeSections.pagamento.current.body,
          frete: '1.25',
          observacoes: authoritativeSections.condicoes_gerais.current.body,
          secoes: authoritativeSections,
          subtotal: '100.00',
          total: '101.25',
          valor: '101.25',
          concurrency_token: '2026-07-01T12:01:00.000Z',
          updated_at: '2026-07-01T12:01:00.000Z',
          items: [{ id: '44444444-4444-4444-8444-444444444444', sku: 'SKU-1', item_code: 'SKU-1', nome: lastPutPayload.items[0].item_name, item_name: lastPutPayload.items[0].item_name, qty: '10.000', suggested_unit_price: '9.00', applied_unit_price: '10.00', price_difference: '1.00', line_total: '100.00', manual_rate: true }],
        });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(authoritative) });
      }
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [withCanonicalListRow({ id, revision_id: '22222222-2222-4222-8222-222222222222', cliente: 'Cliente local', data: '2026-07-01', valor: '90.00', status: 'Rascunho', status_canonical: 'rascunho' }, '11111111-1111-4111-8111-111111111111')], pagination: { page: 1, limit: 10, total: 1, total_pages: 1 }, status_summary: { Rascunho: 1 } }),
    });
  });
  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ id: '33333333-3333-4333-8333-333333333333', nome: 'Cliente local' }] }) });
  });

  await page.goto('/#/quotations');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByLabel('Buscar orçamentos').fill('Cliente');
  await expect(page.getByText(id).first()).toBeVisible();
  await page.getByRole('cell', { name: id, exact: true }).click();
  await expect(page.getByText('Produto local')).toBeVisible();
  await page.getByRole('button', { name: /Editar/ }).click();
  await page.getByLabel('Condição de pagamento').fill('Não persistir');
  await page.getByRole('button', { name: 'Cancelar' }).click();
  // cancelar com edições sujas pede confirmação
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar' }).click();
  await page.getByRole('button', { name: /Editar/ }).click();
  await expect(page.getByLabel('Condição de pagamento')).toHaveText('À vista');
  await page.getByLabel('Nome exibido no orçamento SKU-1').fill(customItemName);
  await page.getByLabel('Condição de pagamento').fill('30 dias');
  await page.getByLabel('Frete do orçamento').fill('1.25');
  await page.getByRole('textbox', { name: 'Condições gerais', exact: true }).fill('Alteração local');
  await page.getByLabel('Preço aplicado SKU-1').fill('10.00');
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText('Orçamento salvo.')).toBeVisible();
  expect(putCount).toBe(1);
  expect(lastPutPayload.concurrency_token).toBe(token);
  expect(lastPutPayload.pagamento).toBeUndefined();
  expect(lastPutPayload.frete).toBe('1.25');
  expect(lastPutPayload.observacoes).toBeUndefined();
  expect(lastPutPayload.secoes.pagamento.current.body).toContain('30 dias');
  expect(lastPutPayload.secoes.condicoes_gerais.current.body).toContain('Alteração local');
  expect(lastPutPayload.items[0].manual_rate).toBe(true);
  expect(lastPutPayload.items[0].rate).toBe('10.00');
  expect(lastPutPayload.items[0].item_name).toBe(customItemName);
  await expect(page.getByText('R$ 101,25')).toBeVisible();
  await expect(page.getByText('30 dias').first()).toBeVisible();
  await expect(page.getByText(customItemName)).toBeVisible();
  // análise de preço (diferença) agora é visível apenas no modo de edição
  await page.getByRole('button', { name: /Editar/ }).click();
  await expect(page.getByText('R$ 1,00')).toBeVisible();
  await page.getByRole('button', { name: /Salvar/ }).click();
  await expect(page.getByText(/O orçamento (foi alterado por outro usuário|mudou ou não pode mais ser editado)/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recarregar' })).toBeVisible();
});

test('pré-seleciona o modelo padrão em rascunho já existente @quotations @smoke', async ({ page }) => {
  await page.route('**/api/leads-clients**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  await page.route('**/api/quotation-templates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_key: 'simples',
        templates: [
          { key: 'branded', name: 'Aspen Original', is_default: false, current_version_id: '55555555-5555-4555-8555-555555555555', current_version: 1 },
          { key: 'simples', name: 'Simples', is_default: true, current_version_id: '66666666-6666-4666-8666-666666666666', current_version: 1 },
        ],
      }),
    });
  });
  await page.route('**/api/quotations?id=*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(detail({
        template_key: 'branded',
        template_padrao: 'branded',
        template_version_id: '55555555-5555-4555-8555-555555555555',
      })),
    });
  });

  await page.goto(`/#/quotations/${id}`);
  await page.getByRole('button', { name: /Editar/ }).click();
  await expect(page.getByLabel('Modelo do orçamento')).toHaveValue('simples');
});
