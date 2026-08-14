// @ts-check
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { expect, test } from '@playwright/test';
import {
  apiRequest,
  assertNoForbiddenEgress,
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
    assert.equal(Object.keys(detail).some((key) => key.endsWith('_mode')), false, 'quotation detail must not expose rollout metadata');
    assert.equal(Object.prototype.hasOwnProperty.call(detail, 'origin'), false, 'quotation detail must not expose origin metadata');
    assert.ok(detail.revision_id, 'known PostgreSQL quotation must expose revision_id');

    await page.goto('/#/quotations');
    await expect(page.getByText(CONFIG.postgresQuotationId, { exact: true }).first()).toBeVisible();
    await page.getByText(CONFIG.postgresQuotationId, { exact: true }).first().click();
    await expect(page.getByText(CONFIG.postgresQuotationId, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Revisão', { exact: false }).first()).toBeVisible();

    const pdfPopupPromise = page.waitForEvent('popup');
    const pdfResponsePromise = page.context().waitForEvent('response', {
      predicate: (response) =>
        response.url().includes('/api/quotation-preview') && response.url().includes('format=pdf'),
    });
    const pdfDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Visualizar', exact: true }).first().click();
    const [pdfPopup, pdfResponse, pdfDownload] = await Promise.all([
      pdfPopupPromise,
      pdfResponsePromise,
      pdfDownloadPromise,
    ]);
    expect(pdfResponse.status()).toBe(200);
    expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
    expect(pdfResponse.headers()['x-document-revision']).toBe(detail.revision_id);
    const pdfStream = await pdfDownload.createReadStream();
    assert.ok(pdfStream, 'PDF download stream must be available');
    const chunks = [];
    for await (const chunk of pdfStream) chunks.push(chunk);
    const pdfBody = Buffer.concat(chunks);
    expect(pdfBody.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfBody.toString('latin1').trimEnd().endsWith('%%EOF')).toBe(true);
    expect(new globalThis.URL(pdfResponse.url()).pathname).toBe('/api/quotation-preview');
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

  test('uses disposable scratch quotation for public link and UI revision edit', async ({ page }) => {
    let scratchDetail;
    let mainError;
    let cleanupError;
    try {
      const detailResponse = await apiRequest(page, 'GET', quotationPath(CONFIG.scratchQuotationId));
      expect(detailResponse.status()).toBe(200);
      scratchDetail = await detailResponse.json();
      assert.equal(Object.keys(scratchDetail).some((key) => key.endsWith('_mode')), false, 'scratch quotation must not expose rollout metadata');
      assert.equal(Object.prototype.hasOwnProperty.call(scratchDetail, 'origin'), false, 'scratch quotation must not expose origin metadata');
      assert.equal(
        scratchDetail.status_canonical,
        'emitido',
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
      expect(publicHtml).not.toMatch(/EXTERNAL_API_TOKEN|Bearer\s+/i);

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
      const expiringRead = await apiRequest(
        page,
        'GET',
        `/api/public-quotation?token=${encodeURIComponent(expiring.token)}`,
      );
      expect(expiringRead.status()).toBe(200);
      expect(expiringRead.headers()['x-document-revision']).toBe(scratchDetail.revision_id);
      await page.waitForTimeout(1500);
      const expiredRead = await apiRequest(
        page,
        'GET',
        `/api/public-quotation?token=${encodeURIComponent(expiring.token)}`,
      );
      expect([404, 410]).toContain(expiredRead.status());

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

});

function quotationPath(id) {
  return `/api/quotations?id=${encodeURIComponent(id)}`;
}
