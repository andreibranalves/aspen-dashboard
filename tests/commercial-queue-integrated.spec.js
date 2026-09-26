// @ts-check
// Integrated contract of the commercial queue: controlled HTTP ingestion ->
// disposable PostgreSQL -> real GET /api/commercial-queue -> rendered UI.
// Unit/HTTP tests mock repositories and adapter tests call repositories
// directly, so only this spec proves the chain the operator actually uses.
//
// Fail-closed: this spec only runs through `npm run test:e2e:safe`
// (scripts/run-safe-e2e.mjs), which strips operational credentials, forces a
// nonproduction environment and preloads a server-side egress guard. Direct
// execution against an unsanitized environment is refused instead of silently
// loading real configuration.
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import * as schema from '../api/_infrastructure/db/schema.js';
import {
  SAFE_E2E_EGRESS_LOG_VAR,
  SAFE_E2E_MARKER,
  SAFE_E2E_RUN_ID_VAR,
  SAFE_E2E_SERVER_ENTRY,
  auditSafeE2eEgressLog,
  safeE2eEnvironmentIsValid,
} from '../scripts/lib/safe-e2e-env.mjs';
import { assertSafeE2eCapability } from '../scripts/lib/safe-e2e-capability.mjs';
import { requireMatchingDisposableTestDatabaseUrl } from './support/disposable-postgres.js';
import { expectedIngestStatus } from './support/ingest-status-contract.js';

// Fail-closed antes de qualquer request: o ambiente isolado COMPLETO e a
// capability viva do run (config dedicada + specs + runId + prova) precisam
// bater. A mesma validação roda no carregamento de playwright.safe.config.js.
if (!safeE2eEnvironmentIsValid(process.env)) {
  throw new Error(
    'O E2E integrado exige o ponto de entrada seguro. Use `npm run test:e2e:safe` ' +
      '(executa scripts/run-safe-e2e.mjs, que isola o ambiente antes de subir o servidor).'
  );
}
assertSafeE2eCapability(process.env);

const INGEST_TOKEN = String(process.env.QUOTE_LEADS_INGEST_TOKEN || '').trim();
const EGRESS_LOG = String(process.env[SAFE_E2E_EGRESS_LOG_VAR] || '');
const RUN_ID = String(process.env[SAFE_E2E_RUN_ID_VAR] || '');
const HAS_INTEGRATED_STACK = Boolean(
  process.env[SAFE_E2E_MARKER] === '1' && process.env.TEST_DATABASE_URL && INGEST_TOKEN
);
const SKIP_REASON = 'o E2E seguro é obrigatório (TEST_DATABASE_URL + token sintético)';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '..', 'drizzle');
const suffix = randomUUID().slice(0, 8);

// Endpoints that could produce external communication. A lead becomes queue
// work, never a message, so the journey must never touch them.
const EXTERNAL_COMMUNICATION =
  /\/api\/(send-whatsapp|send-quotation-email|quotation-deliveries)/;

let sql;
let db;
const createdLeadIds = [];

function submission(label, overrides = {}) {
  const externalId = `siteQuote.${randomUUID()}`;
  return {
    externalId,
    payloadFingerprint: createHash('sha256').update(externalId).digest('hex'),
    originalCreatedAt: '2026-09-11T11:00:00.000Z',
    nome: `Fila integrada ${label} ${suffix}`,
    email: `fila-${suffix}@example.invalid`,
    whatsapp: '5521999990000',
    produto: 'Cangas',
    quantidade: '100',
    prazo: 'setembro',
    consent: { given: true, source: 'site_quote_form' },
    ...overrides,
  };
}

async function ingest(request, payload) {
  const response = await request.post('/api/site-quote-leads', {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${INGEST_TOKEN}` },
    data: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`resposta não-JSON (status ${response.status()}): ${text}`);
  }
  // Exact status, derived from the handler's own result: a `created` reply must
  // be 201 and a `deduplicated` reply must be 200. Inverting the codes fails.
  expect(response.status(), text).toBe(expectedIngestStatus(body.result));
  return body;
}

async function queuePage(request, page) {
  const response = await request.get(`/api/commercial-queue?page=${page}&page_size=25`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

/**
 * Finds a queue item by client name in the agenda (one <details> per action),
 * paging through the UI when needed, and opens it to expose its actions.
 */
async function openQueueItem(page, name, pageSizeValue = '100') {
  const agenda = page.getByLabel('Agenda comercial');
  await expect(agenda).toBeVisible();
  const pageSize = page.getByRole('combobox', { name: 'Itens por página' });
  if ((await pageSize.count()) > 0 && (await pageSize.inputValue()) !== pageSizeValue) {
    await pageSize.selectOption(pageSizeValue);
  }
  const item = agenda.locator('details').filter({ hasText: name });
  for (let attempt = 0; attempt < 30 && (await item.count()) === 0; attempt += 1) {
    const next = page.getByRole('button', { name: 'Próximo' });
    if ((await next.count()) === 0 || !(await next.isEnabled())) {
      await page.waitForTimeout(200);
      continue;
    }
    await next.click();
    await page.waitForTimeout(200);
  }
  await expect(item).toBeVisible();
  if (!(await item.evaluate((element) => element.open))) await item.locator('summary').click();
  return item;
}

/** Walks the real API pages and returns where an action is visible. */
async function locateAction(request, actionId) {
  const first = await queuePage(request, 1);
  const lastPage = Math.max(1, Math.ceil(first.total / first.page_size));
  for (let page = 1; page <= lastPage; page += 1) {
    const current = page === 1 ? first : await queuePage(request, page);
    const index = current.data.findIndex((item) => item.action_id === actionId);
    if (index !== -1)
      return { page, indexInPage: index, total: current.total, pageSize: current.page_size };
  }
  return null;
}

// Prova de egress do servidor: lê o log escrito pela guarda pré-carregada no
// processo Node do servidor. Um listener de request do browser não enxergaria
// egress do servidor, então esta é a evidência válida. O marcador de
// inicialização prova que a instrumentação estava ativa.
function serverEgressEntries() {
  try {
    return readFileSync(EGRESS_LOG, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function serverEgressAudit() {
  let content = '';
  let exists = true;
  try {
    content = readFileSync(EGRESS_LOG, 'utf8');
  } catch {
    exists = false;
  }
  return auditSafeE2eEgressLog({
    exists,
    content,
    runId: RUN_ID,
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
}

// Controle positivo da guarda é executado pelo ponto de entrada seguro
// (scripts/run-safe-e2e.mjs) com log próprio; um log vazio não distingue
// "sem egress" de "guarda ausente".

/** Efeitos duráveis que o caminho de transporte externo deixaria para trás. */
async function durableEffectCounts() {
  const [row] = await sql`
    SELECT
      (SELECT count(*)::int FROM quotation_deliveries) AS deliveries,
      (SELECT count(*)::int FROM quotation_email_deliveries) AS email_deliveries,
      (SELECT count(*)::int FROM quotation_follow_ups) AS follow_ups,
      (SELECT count(*)::int FROM sales_orders) AS orders
  `;
  return row;
}

test.beforeAll(async () => {
  if (!HAS_INTEGRATED_STACK) return;
  const databaseUrl = requireMatchingDisposableTestDatabaseUrl(process.env);
  sql = postgres(databaseUrl, { max: 2, prepare: false, onnotice: () => {} });
  db = drizzle(sql, { schema });
  await migrate(db, { migrationsFolder });
});

test.afterAll(async () => {
  if (!sql) return;
  if (createdLeadIds.length) {
    await sql`DELETE FROM manual_contact_events WHERE opportunity_id IN (
      SELECT id FROM crm_deals WHERE quote_lead_id = ANY(${createdLeadIds}::uuid[])
    )`;
    await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id IN (
      SELECT id FROM crm_deals WHERE quote_lead_id = ANY(${createdLeadIds}::uuid[])
    )`;
    await sql`UPDATE quote_leads SET crm_deal_id = NULL WHERE id = ANY(${createdLeadIds}::uuid[])`;
    await sql`DELETE FROM crm_deals WHERE quote_lead_id = ANY(${createdLeadIds}::uuid[])`;
    await sql`DELETE FROM quote_leads WHERE id = ANY(${createdLeadIds}::uuid[])`;
  }
  await sql.end({ timeout: 5 });
});

test.beforeEach(async () => {
  if (!sql || createdLeadIds.length === 0) return;
  const ids = createdLeadIds.splice(0, createdLeadIds.length);
  await sql`DELETE FROM manual_contact_events WHERE opportunity_id IN (
    SELECT id FROM crm_deals WHERE quote_lead_id = ANY(${ids}::uuid[])
  )`;
  await sql`DELETE FROM opportunity_next_actions WHERE opportunity_id IN (
    SELECT id FROM crm_deals WHERE quote_lead_id = ANY(${ids}::uuid[])
  )`;
  await sql`UPDATE quote_leads SET crm_deal_id = NULL WHERE id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM crm_deals WHERE quote_lead_id = ANY(${ids}::uuid[])`;
  await sql`DELETE FROM quote_leads WHERE id = ANY(${ids}::uuid[])`;
});

test('operador registra contato manual com continuidade e histórico separado', async ({
  page,
  request,
}) => {
  test.skip(!HAS_INTEGRATED_STACK, SKIP_REASON);
  const externalCommunication = [];
  page.on('request', (browserRequest) => {
    if (EXTERNAL_COMMUNICATION.test(browserRequest.url())) {
      externalCommunication.push(browserRequest.url());
    }
  });

  const payload = submission('contato manual');
  await ingest(request, payload);
  const [lead] = await sql`
    SELECT id, crm_deal_id FROM quote_leads
    WHERE external_id = ${payload.externalId} AND source = 'site_form'
  `;
  createdLeadIds.push(lead.id);
  await page.goto('/#/crm?tab=queue');
  const row = await openQueueItem(page, payload.nome);
  await row.getByRole('button', { name: 'Registrar contato' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Registrar contato' })).toBeVisible();

  const requests = [];
  page.on('request', (browserRequest) => {
    if (browserRequest.url().includes('/api/commercial-queue')) requests.push(browserRequest);
  });
  await dialog.getByRole('button', { name: 'Registrar contato' }).click();
  expect(
    requests.filter((browserRequest) => browserRequest.method() === 'POST'),
    'continuidade vazia não envia o comando'
  ).toHaveLength(0);

  await dialog
    .getByRole('combobox', { name: 'Resultado do contato' })
    .selectOption('follow_up_agreed');
  await dialog.getByRole('combobox', { name: 'Continuidade' }).selectOption('successor');
  await dialog.getByLabel('Data da próxima ação').fill('2026-09-15');
  await dialog.getByLabel('Motivo da continuidade').fill('Confirmar pedido');
  // Wait for the completed command, not just the outgoing request, so the
  // queue is inspected only after the successor action exists.
  const submitResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/commercial-queue') &&
      response.request().method() === 'POST' &&
      response.ok()
  );
  await dialog.getByRole('button', { name: 'Registrar contato' }).click();
  const manualResponse = await submitResponse;
  expect(JSON.parse(manualResponse.request().postData() || '{}').command).toBe('manual_contact');
  await expect(dialog).toBeHidden();

  await page.reload();
  const refreshedRow = await openQueueItem(page, payload.nome);
  await expect(refreshedRow.getByRole('button', { name: 'Histórico' })).toBeVisible();
  await refreshedRow.getByRole('button', { name: 'Histórico' }).click();
  await expect(page.getByRole('heading', { name: 'Histórico da próxima ação' })).toBeVisible();
  await expect(page.getByText('Declaração manual')).toBeVisible();
  await expect(page.getByText('Próximo passo combinado')).toBeVisible();
  expect(externalCommunication).toEqual([]);
});

test('operador fecha contato manual preenchendo somente o motivo explícito', async ({
  page,
  request,
}) => {
  test.skip(!HAS_INTEGRATED_STACK, SKIP_REASON);
  const externalCommunication = [];
  page.on('request', (browserRequest) => {
    if (EXTERNAL_COMMUNICATION.test(browserRequest.url())) {
      externalCommunication.push(browserRequest.url());
    }
  });

  const before = await durableEffectCounts();
  const egressBefore = serverEgressEntries().length;
  const payload = submission('fechamento manual');
  await ingest(request, payload);
  const [lead] = await sql`
    SELECT id FROM quote_leads
    WHERE external_id = ${payload.externalId} AND source = 'site_form'
  `;
  createdLeadIds.push(lead.id);

  await page.goto('/#/crm?tab=queue');
  const row = await openQueueItem(page, payload.nome);
  await row.getByRole('button', { name: 'Registrar contato' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Continuidade' }).selectOption('close');
  await expect(dialog.getByLabel('Data local')).toHaveCount(0);
  await expect(dialog.getByLabel('Motivo', { exact: true })).toHaveCount(0);
  await dialog.getByLabel('Motivo do fechamento').fill('Cliente não prosseguiu.');

  const submitRequest = page.waitForRequest(
    (browserRequest) =>
      browserRequest.url().includes('/api/commercial-queue') && browserRequest.method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Registrar contato' }).click();
  const manualRequest = await submitRequest;
  expect(JSON.parse(manualRequest.postData() || '{}')).toMatchObject({
    command: 'manual_contact',
    continuation: { type: 'close', reason: 'Cliente não prosseguiu.' },
  });
  await expect(dialog).toBeHidden();

  await page.getByRole('combobox', { name: 'Filtrar fila por status' }).selectOption('closed');
  const closedRow = await openQueueItem(page, payload.nome);
  await expect(closedRow.getByText('Status final: Perdido')).toBeVisible();
  await expect(
    closedRow.getByText('Motivo do encerramento: Cliente não prosseguiu.')
  ).toBeVisible();

  expect(await durableEffectCounts()).toEqual(before);
  expect(externalCommunication).toEqual([]);
  const audit = serverEgressAudit();
  expect(audit.instrumented).toBe(true);
  expect(audit.malformed).toBe(false);
  expect(audit.blocked).toBe(0);
  expect(
    serverEgressEntries()
      .slice(egressBefore)
      .filter((entry) => entry.event === 'blocked')
  ).toEqual([]);
});

test('lead ingested over HTTP reaches the queue UI once, even on retry, without external communication', async ({
  page,
  request,
}) => {
  test.skip(!HAS_INTEGRATED_STACK, SKIP_REASON);
  const externalCommunication = [];
  page.on('request', (browserRequest) => {
    if (EXTERNAL_COMMUNICATION.test(browserRequest.url()))
      externalCommunication.push(browserRequest.url());
  });

  const before = await durableEffectCounts();
  const egressBefore = serverEgressEntries().length;
  const payload = submission('retry');

  const first = await ingest(request, payload);
  expect(first.result).toBe('created');
  const retry = await ingest(request, payload);
  expect(retry.result, 'a repeated payload is deduplicated, not duplicated').toBe('deduplicated');

  const [lead] = await sql`
    SELECT id, crm_deal_id FROM quote_leads
    WHERE external_id = ${payload.externalId} AND source = 'site_form'
  `;
  createdLeadIds.push(lead.id);
  expect(lead.crm_deal_id, 'the ingested lead owns one opportunity').toBeTruthy();

  const [{ opportunities }] = await sql`
    SELECT count(*)::int AS opportunities FROM crm_deals WHERE quote_lead_id = ${lead.id}::uuid
  `;
  expect(opportunities).toBe(1);

  const [{ actions }] = await sql`
    SELECT count(*)::int AS actions FROM opportunity_next_actions
    WHERE opportunity_id = ${lead.crm_deal_id}::uuid
  `;
  expect(actions, 'exactly one action after the retry').toBe(1);

  const [{ id: actionId }] = await sql`
    SELECT id FROM opportunity_next_actions WHERE opportunity_id = ${lead.crm_deal_id}::uuid
  `;
  const located = await locateAction(request, actionId);
  expect(located, 'the ingested action is reachable through the queue API').not.toBeNull();
  const lastPage = Math.ceil(located.total / located.pageSize);

  await page.goto('/#/crm?tab=queue');
  await expect(page.getByLabel('Agenda comercial')).toBeVisible();
  const pageSize = page.getByRole('combobox', { name: 'Itens por página' });
  if (lastPage > 1) await pageSize.selectOption(String(located.pageSize));
  for (let pageNumber = 1; pageNumber < located.page; pageNumber += 1) {
    await page.getByRole('button', { name: 'Próximo' }).click();
    await expect(page.getByText(`Página ${pageNumber + 1}`, { exact: true })).toBeVisible();
  }
  const row = await openQueueItem(page, payload.nome, String(located.pageSize));
  await expect(row.getByText('Primeiro atendimento')).toBeVisible();
  await expect(row.getByText('Cangas')).toBeVisible();

  expect(await durableEffectCounts()).toEqual(before);
  expect(externalCommunication).toEqual([]);

  // Prova de egress no seam do servidor: a guarda precisa estar inicializada
  // (evidência válida, não log ausente) e sem nenhuma saída não-loopback — contar
  // linhas de tabela sozinho não prova transporte.
  const audit = serverEgressAudit();
  expect(audit.instrumented, 'the server egress guard must have initialized').toBe(true);
  expect(audit.malformed).toBe(false);
  expect(audit.blocked).toBe(0);
  const egress = serverEgressEntries().slice(egressBefore);
  expect(egress.filter((entry) => entry.event === 'blocked')).toEqual([]);
  expect(
    egress.every((entry) => entry.event === 'allowed'),
    'only loopback traffic may reach the server network layer'
  ).toBe(true);
});
test('every ingested action stays reachable when the real queue has more than 25 rows', async ({
  page,
  request,
}) => {
  test.skip(!HAS_INTEGRATED_STACK, SKIP_REASON);
  const payloads = Array.from({ length: 26 }, (_, index) => submission(`pagina ${index + 1}`));
  for (const payload of payloads) {
    const result = await ingest(request, payload);
    expect(result.result).toBe('created');
  }

  const ourActions = new Set();
  for (const payload of payloads) {
    const [lead] = await sql`
      SELECT id, crm_deal_id FROM quote_leads
      WHERE external_id = ${payload.externalId} AND source = 'site_form'
    `;
    createdLeadIds.push(lead.id);
    const [action] = await sql`
      SELECT id FROM opportunity_next_actions WHERE opportunity_id = ${lead.crm_deal_id}::uuid
    `;
    ourActions.add(action.id);
  }
  expect(ourActions.size).toBe(26);

  const firstPage = await queuePage(request, 1);
  expect(firstPage.page_size).toBe(25);
  expect(firstPage.data.length).toBe(25);
  expect(firstPage.total).toBeGreaterThanOrEqual(26);
  const lastPage = Math.ceil(firstPage.total / firstPage.page_size);
  expect(lastPage).toBeGreaterThan(1);

  const seen = new Set();
  for (let pageNumber = 1; pageNumber <= lastPage; pageNumber += 1) {
    const current = pageNumber === 1 ? firstPage : await queuePage(request, pageNumber);
    for (const item of current.data) seen.add(item.action_id);
  }
  for (const actionId of ourActions) {
    expect(seen.has(actionId), `action ${actionId} is hidden from pagination`).toBe(true);
  }

  await page.goto('/#/crm?tab=queue');
  await expect(page.getByRole('navigation', { name: 'Paginação da fila comercial' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Itens por página' }).selectOption('25');
  const agendaItems = page.getByLabel('Agenda comercial').locator('details');
  await expect(page.getByText('Página 1', { exact: true })).toBeVisible();
  await expect(agendaItems).toHaveCount(25);

  await page.getByRole('button', { name: 'Próximo' }).click();
  await expect(page.getByText('Página 2', { exact: true })).toBeVisible();
  const secondPage = await queuePage(request, 2);
  await expect(agendaItems).toHaveCount(secondPage.data.length);
  await expect(page.getByRole('button', { name: 'Anterior' })).toBeEnabled();
});
