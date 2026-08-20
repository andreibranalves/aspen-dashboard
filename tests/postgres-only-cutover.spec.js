// @ts-check
import { expect, test } from '@playwright/test';
import {
  apiRequest,
  assertNoForbiddenEgress,
  assertStagingConfig,
  loginToStaging,
} from './support/staging-auth.js';

const CONFIG = assertStagingConfig();
const routes = [
  '/#/dashboard',
  '/#/products',
  '/#/leads',
  '/#/quotations',
  '/#/crm',
  '/#/sales-orders',
  '/#/comunicacao',
  '/#/whatsapp-inbox',
];
const readOnlyPaths = [
  '/api/products?limit=1',
  '/api/leads-clients?limit=1',
  `/api/quotations?id=${encodeURIComponent(CONFIG.postgresQuotationId)}`,
  '/api/crm-deals?limit=1',
  '/api/sales-orders?limit=1',
  '/api/sales-dashboard',
];
const requestsByPage = new WeakMap();

test.describe.configure({ mode: 'serial' });

test.describe('PostgreSQL-only cutover staging smoke @database @critical', () => {
  test.beforeEach(async ({ page }) => {
    const requests = [];
    requestsByPage.set(page, requests);
    page.on('request', (request) => requests.push(request.url()));
    await loginToStaging(page);
  });

  test.afterEach(async ({ page }) => {
    assertNoForbiddenEgress(requestsByPage.get(page) || []);
  });

  for (const route of routes) {
    test(`opens ${route} without uncaught errors`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error));
      await page.goto(route);
      await expect(page.locator('main')).toBeVisible();

      for (const path of readOnlyPaths) {
        const response = await apiRequest(page, 'GET', path);
        expect(response.status(), `${path} must return a 2xx response`).toBeGreaterThanOrEqual(200);
        expect(response.status(), `${path} must return a 2xx response`).toBeLessThan(300);
      }

      expect(pageErrors, `${route} must not emit uncaught page errors`).toEqual([]);
    });
  }
});
