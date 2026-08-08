// @ts-check
import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import { assertStagingConfig, loginToStaging } from './support/staging-auth.js';

const CONFIG = assertStagingConfig();

function quotationPath(id) {
  return `/api/quotations?id=${encodeURIComponent(id)}`;
}

function assertNoForbiddenEgress(requests) {
  const forbidden = requests.filter((url) => /frappe|erpnext|n8n|evolution/i.test(url));
  assert.equal(forbidden.length, 0, 'staging browser made a forbidden legacy/provider request');
}

test.describe('quotation cutover staging', () => {
  test.beforeEach(async ({ page }) => {
    const requests = [];
    page.__cutoverRequests = requests;
    page.on('request', (request) => requests.push(request.url()));
    await loginToStaging(page);
  });

  test.afterEach(async ({ page }) => {
    assertNoForbiddenEgress(page.__cutoverRequests || []);
  });

  test('reads PostgreSQL quotation, renders PDF and serves revision-bound public link', async ({ page }) => {
    const detailResponse = await page.request.get(quotationPath(CONFIG.postgresQuotationId));
    expect(detailResponse.status()).toBe(200);
    const detail = await detailResponse.json();
    assert.equal(detail.core_mode, true, 'known PostgreSQL quotation must be in core mode');
    assert.ok(detail.revision_id, 'known PostgreSQL quotation must expose revision_id');

    await page.goto(`/#/quotations/${encodeURIComponent(CONFIG.postgresQuotationId)}`);
    await expect(page.getByText(CONFIG.postgresQuotationId, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Revisão', { exact: false }).first()).toBeVisible();

    const pdfPopupPromise = page.waitForEvent('popup');
    const pdfResponsePromise = page.waitForResponse(
      (response) => response.url().includes('/api/quotation-preview') && response.url().includes('format=pdf'),
    );
    await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
    const [pdfPopup, pdfResponse] = await Promise.all([pdfPopupPromise, pdfResponsePromise]);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
    expect((await pdfResponse.body()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(new globalThis.URL(pdfPopup.url()).pathname).toBe('/api/quotation-preview');
    await pdfPopup.close();

    const issueResponse = await page.request.post('/api/public-quotation', {
      data: { revisionId: detail.revision_id, expiresInSeconds: 300 },
    });
    expect(issueResponse.status()).toBe(201);
    const issued = await issueResponse.json();
    expect(issued.revisionId).toBe(detail.revision_id);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{32,256}$/);

    const publicResponse = await page.request.get(
      `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
    );
    expect(publicResponse.status()).toBe(200);
    expect(publicResponse.headers()['x-document-revision']).toBe(detail.revision_id);
    const publicHtml = await publicResponse.text();
    expect(publicHtml).not.toContain('/api/view');
    expect(publicHtml).not.toMatch(/ERPNEXT_TOKEN|Bearer\s+/i);

    const revoked = await page.request.delete(
      `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
    );
    expect(revoked.status()).toBe(204);
    const revokedRead = await page.request.get(
      `/api/public-quotation?token=${encodeURIComponent(issued.token)}`,
    );
    expect(revokedRead.status()).toBe(404);

    const expiringResponse = await page.request.post('/api/public-quotation', {
      data: { revisionId: detail.revision_id, expiresInSeconds: 1 },
    });
    expect(expiringResponse.status()).toBe(201);
    const expiring = await expiringResponse.json();
    await page.waitForTimeout(1500);
    const expiredRead = await page.request.get(
      `/api/public-quotation?token=${encodeURIComponent(expiring.token)}`,
    );
    expect(expiredRead.status()).toBe(410);
  });

  test('requires admin auth and creates a new PostgreSQL revision without real providers', async ({ page, browser }) => {
    const detailResponse = await page.request.get(quotationPath(CONFIG.postgresQuotationId));
    expect(detailResponse.status()).toBe(200);
    let detail = await detailResponse.json();
    assert.ok(detail.revision_id && detail.concurrency_token, 'known quotation lacks revision concurrency data');

    const anonymous = await browser.newContext({ baseURL: CONFIG.baseUrl });
    try {
      const adminResponse = await anonymous.request.get(`/api/view?q=${encodeURIComponent(CONFIG.postgresQuotationId)}`);
      expect(adminResponse.status()).toBe(401);
    } finally {
      await anonymous.close();
    }

    if (detail.status_canonical === 'rascunho') {
      const issued = await page.request.post(quotationPath(CONFIG.postgresQuotationId), {
        data: { action: 'set_status', status: 'enviado', concurrency_token: detail.concurrency_token },
      });
      expect(issued.status()).toBe(200);
      detail = await issued.json();
    }
    assert.notEqual(detail.status_canonical, 'rascunho', 'known quotation must be issuable in staging');

    const revisionResponse = await page.request.post(quotationPath(CONFIG.postgresQuotationId), {
      data: {
        action: 'create_revision',
        source_revision_id: detail.revision_id,
        concurrency_token: detail.concurrency_token || detail.updated_at,
      },
    });
    expect(revisionResponse.status()).toBe(200);
    const revised = await revisionResponse.json();
    expect(revised.revision_id).toBeTruthy();
    expect(revised.revision_id).not.toBe(detail.revision_id);
    expect(revised.status_canonical).toBe('rascunho');

    const editResponse = await page.request.put(quotationPath(CONFIG.postgresQuotationId), {
      data: {
        observacoes: 'staging cutover Playwright',
        concurrency_token: revised.concurrency_token || revised.updated_at,
      },
    });
    expect(editResponse.status()).toBe(200);
    const edited = await editResponse.json();
    expect(edited.revision_id).toBe(revised.revision_id);
    expect(edited.observacoes).toBe('staging cutover Playwright');
  });

  test('opens a known legacy quotation for rollback-compatible read', async ({ page }) => {
    const response = await page.request.get(quotationPath(CONFIG.legacyQuotationId));
    expect(response.status()).toBe(200);
    const legacy = await response.json();
    expect(legacy.id || legacy.quotation_id).toBe(CONFIG.legacyQuotationId);

    await page.goto(`/#/quotations/${encodeURIComponent(CONFIG.legacyQuotationId)}`);
    await expect(page.getByText(CONFIG.legacyQuotationId, { exact: true }).first()).toBeVisible();
  });
});
