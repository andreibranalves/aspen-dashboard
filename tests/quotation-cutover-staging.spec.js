// @ts-check
import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import {
  apiRequest,
  assertSafeApiPath,
  assertStagingConfig,
  loginToStaging,
} from './support/staging-auth.js';

const CONFIG = assertStagingConfig();

test.describe.configure({ mode: 'serial' });

test.describe('quotation cutover staging', () => {
  test.beforeEach(async ({ page }) => {
    const requests = [];
    /** @type {any} */
    const testPage = page;
    testPage.__cutoverRequests = requests;
    page.on('request', (request) => requests.push(request.url()));
    await loginToStaging(page);
  });

  test.afterEach(async ({ page }) => {
    /** @type {any} */
    const testPage = page;
    assertNoForbiddenEgress(testPage.__cutoverRequests || []);
  });

  test('opens the PostgreSQL quotation from the list and binds PDF to its revision', async ({ page, browser }) => {
    const detailResponse = await apiRequest(page, 'GET', quotationPath(CONFIG.postgresQuotationId));
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json();
    assert.equal(detail.core_mode, true, 'known PostgreSQL quotation must be in core mode');
    assert.ok(detail.revision_id, 'known PostgreSQL quotation must expose revision_id');

    await page.goto('/#/quotations');
    await expect(page.getByText(CONFIG.postgresQuotationId, { exact: true }).first()).toBeVisible();
    await page.getByText(CONFIG.postgresQuotationId, { exact: true }).first().click();
    await expect(page.getByText(CONFIG.postgresQuotationId, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Revisão', { exact: false }).first()).toBeVisible();

    const pdfPopupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
    const pdfPopup = await pdfPopupPromise;
    const pdfResponse = await pdfPopup.waitForResponse(
      (response) => response.url().includes('/api/quotation-preview') && response.url().includes('format=pdf'),
    );
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
    expect(pdfResponse.headers()['x-document-revision']).toBe(detail.revision_id);
    expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await pdfResponse.body()).subarray(-5).toString()).toBe('%%EOF');
    expect(new globalThis.URL(pdfPopup.url()).pathname).toBe('/api/quotation-preview');
    await pdfPopup.close();

    const anonymous = await browser.newContext({ baseURL: CONFIG.baseUrl });
    try {
      const adminPath = `/api/view?q=${encodeURIComponent(CONFIG.postgresQuotationId)}`;
      assertSafeApiPath(adminPath);
      const adminResponse = await anonymous.request.get(adminPath);
      expect(adminResponse.status()).toBe(401);
    } finally {
      await anonymous.close();
    }
  });

  test('uses disposable scratch quotation for public outbox and UI revision edit', async ({ page }) => {
    let scratchDetail;
    let mainError;
    let cleanupError;
    try {
      const detailResponse = await apiRequest(page, 'GET', quotationPath(CONFIG.scratchQuotationId));
      expect(detailResponse.status()).toBe(200);
      scratchDetail = await detailResponse.json();
      assert.equal(scratchDetail.core_mode, true, 'scratch quotation must be PostgreSQL');
      assert.equal(
        scratchDetail.status_canonical,
        'enviado',
        'scratch quotation must be a disposable sent fixture; draft transition is unsupported',
      );
      assert.ok(scratchDetail.revision_id && scratchDetail.concurrency_token);

      const issueResponse = await apiRequest(page, 'POST', '/api/public-quotation', {
        data: { revisionId: scratchDetail.revision_id, expiresInSeconds: 300 },
      });
      expect(issueResponse.status()).toBe(201);
      const issued = await issueResponse.json();
      expect(issued.revisionId).toBe(scratchDetail.revision_id);
      expect(issued.token).toMatch(/^[A-Za-z0-9_-]{32,256}$/);

      const publicResponse = await apiRequest(
        page,
        'GET',
        `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
      );
      expect(publicResponse.status()).toBe(200);
      expect(publicResponse.headers()['x-document-revision']).toBe(scratchDetail.revision_id);
      const publicHtml = await publicResponse.text();
      expect(publicHtml).not.toContain('/api/view');
      expect(publicHtml).not.toMatch(/ERPNEXT_TOKEN|Bearer\s+/i);

      const aggregateId = scratchDetail.quotation_uuid || scratchDetail.quote_id || scratchDetail.id;
      const inspectResponse = await apiRequest(
        page,
        'GET',
        `/api/quotation-outbox-inspect?quotation_id=${encodeURIComponent(aggregateId)}`,
        { headers: { 'x-e2e-username': CONFIG.username } },
      );
      expect(inspectResponse.status()).toBe(200);
      const inspected = await inspectResponse.json();
      expect(inspected.identity_attested).toBe(true);
      expect(inspected.providers_disabled).toBe(true);
      const issuedEvent = inspected.events.find(
        (event) => event.event_type === 'quotation.issued' && event.provider === 'n8n',
      );
      assert.ok(issuedEvent, 'canonical quotation.issued outbox event must be present');
      expect(issuedEvent.quotation_id).toBe(aggregateId);
      expect(issuedEvent.revision_id).toBe(scratchDetail.revision_id);
      expect(issuedEvent.business_number).toBe(scratchDetail.id);
      expect(['pending', 'retry']).toContain(issuedEvent.status);
      expect(Object.keys(issuedEvent).sort()).toEqual([
        'attempts',
        'business_number',
        'created_at',
        'event_type',
        'idempotency_key',
        'next_attempt_at',
        'provider',
        'quotation_id',
        'revision_id',
        'status',
      ]);

      const revoked = await apiRequest(
        page,
        'DELETE',
        `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
      );
      expect(revoked.status()).toBe(204);
      const revokedRead = await apiRequest(
        page,
        'GET',
        `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
      );
      expect(revokedRead.status()).toBe(404);

      const expiringResponse = await apiRequest(page, 'POST', '/api/public-quotation', {
        data: { revisionId: scratchDetail.revision_id, expiresInSeconds: 1 },
      });
      expect(expiringResponse.status()).toBe(201);
      const expiring = await expiringResponse.json();
      await page.waitForTimeout(1500);
      const expiredRead = await apiRequest(
        page,
        'GET',
        `/api/public-quotation?token=${encodeURIComponent(expiring.token)}`,
      );
      expect(expiredRead.status()).toBe(410);

      await page.goto('/#/quotations');
      await expect(page.getByText(CONFIG.scratchQuotationId, { exact: true }).first()).toBeVisible();
      await page.getByText(CONFIG.scratchQuotationId, { exact: true }).first().click();
      await expect(page.getByText(CONFIG.scratchQuotationId, { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'Nova revisão' }).click();
      await expect(page.getByText('Nova revisão criada em rascunho.')).toBeVisible();

      const revisedResponse = await apiRequest(page, 'GET', quotationPath(CONFIG.scratchQuotationId));
      expect(revisedResponse.status()).toBe(200);
      const revisedDetail = await revisedResponse.json();
      expect(revisedDetail.revision_id).not.toBe(scratchDetail.revision_id);
      expect(revisedDetail.status_canonical).toBe('rascunho');
      assert.ok(Array.isArray(revisedDetail.items) && revisedDetail.items.length > 0);

      await page.getByRole('button', { name: 'Editar' }).click();
      await page.getByLabel('Observações do orçamento').fill('staging cutover Playwright');
      const saveResponsePromise = page.waitForResponse(
        (response) => response.url().includes('/api/quotations') && response.request().method() === 'PUT',
      );
      await page.getByRole('button', { name: 'Salvar' }).click();
      const saveResponse = await saveResponsePromise;
      expect(saveResponse.status()).toBe(200);
      const edited = await saveResponse.json();
      expect(edited.revision_id).toBe(revisedDetail.revision_id);
      expect(edited.status_canonical).toBe('rascunho');
      expect(edited.observacoes).toBe('staging cutover Playwright');
    } catch (error) {
      mainError = error;
    }

    {
      try {
        // Always use the declared disposable scratch ID; detail fields only refine
        // the outbox aggregate identity for that same fixture.
        const aggregateId =
          scratchDetail?.quotation_uuid || scratchDetail?.quote_id || scratchDetail?.id || CONFIG.scratchQuotationId;
        const purge = await apiRequest(
          page,
          'DELETE',
          `/api/quotation-outbox-inspect?quotation_id=${encodeURIComponent(aggregateId)}`,
          { headers: { 'x-e2e-username': CONFIG.username } },
        );
        if (purge.status() !== 204) {
          throw new Error(`STAGING_FIXTURE_RESET failed: outbox purge returned ${purge.status()}`);
        }

        const currentResponse = await apiRequest(page, 'GET', quotationPath(CONFIG.scratchQuotationId));
        if (currentResponse.status() === 404) {
          // Already cleaned by a prior attempt.
        } else if (!currentResponse.ok()) {
          throw new Error(`STAGING_FIXTURE_RESET failed: scratch lookup returned ${currentResponse.status()}`);
        } else {
          const current = await currentResponse.json();
          if (current.status_canonical !== 'rascunho') {
            throw new Error('STAGING_FIXTURE_RESET failed: scratch quotation is not disposable draft');
          }
          const cleanup = await apiRequest(page, 'DELETE', quotationPath(CONFIG.scratchQuotationId));
          if (cleanup.status() !== 200 && cleanup.status() !== 404) {
            throw new Error(`STAGING_FIXTURE_RESET failed: quotation cleanup returned ${cleanup.status()}`);
          }
        }
      } catch (error) {
        cleanupError = error;
      }
    }
    if (mainError && cleanupError) {
      throw Object.assign(new Error('Staging flow and fixture cleanup both failed'), {
        cause: [mainError, cleanupError],
      });
    }
    if (mainError) throw mainError;
    if (cleanupError) throw cleanupError;
  });

  test('opens a known legacy quotation for rollback-compatible read', async ({ page }) => {
    const response = await apiRequest(page, 'GET', quotationPath(CONFIG.legacyQuotationId));
    expect(response.status()).toBe(200);
    const legacy = await response.json();
    expect(legacy.id || legacy.quotation_id).toBe(CONFIG.legacyQuotationId);

    await page.goto(`/#/quotations/${encodeURIComponent(CONFIG.legacyQuotationId)}`);
    await expect(page.getByText(CONFIG.legacyQuotationId, { exact: true }).first()).toBeVisible();
  });
});

function quotationPath(id) {
  return `/api/quotations?id=${encodeURIComponent(id)}`;
}

function assertNoForbiddenEgress(requests) {
  const forbidden = requests.filter((rawUrl) => {
    let parsed;
    try {
      parsed = new globalThis.URL(rawUrl);
    } catch {
      return true;
    }
    const path = parsed.pathname.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    return (
      path.includes('/api/send-whatsapp') ||
      host.includes('frappe') ||
      host.includes('erpnext') ||
      host.includes('n8n') ||
      host.includes('evolution')
    );
  });
  assert.equal(forbidden.length, 0, 'staging browser made a forbidden legacy/provider request');
}
