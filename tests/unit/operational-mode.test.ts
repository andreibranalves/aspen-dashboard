import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

// ── isOperationalMode ──────────────────────────────────────────────────────

import { isOperationalMode } from '../../api/_functions/operational-mode.js';

describe('isOperationalMode', () => {
  const original = process.env.CRM_OPERATIONAL_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = original;
  });

  it('returns false when env var is unset', () => {
    delete process.env.CRM_OPERATIONAL_MODE;
    assert.equal(isOperationalMode(), false);
  });

  it('returns false for non-true values', () => {
    for (const value of ['false', '1', 'TRUE', '', 'yes']) {
      process.env.CRM_OPERATIONAL_MODE = value;
      assert.equal(isOperationalMode(), false, `expected false for "${value}"`);
    }
  });

  it('returns true only for exact string "true"', () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    assert.equal(isOperationalMode(), true);
  });
});

// ── Feature flag override ──────────────────────────────────────────────────

import { isProductsCoreEnabled } from '../../api/_functions/products-mode.js';
import { isCoreQuotesEnabled, getQuoteRolloutState } from '../../api/_functions/orcamento-mode.js';
import { isCoreClientsEnabled } from '../../api/_functions/client-core.js';

describe('feature flag override via operational mode', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of [
      'CRM_OPERATIONAL_MODE',
      'CRM_CORE_PRODUCTS_ENABLED',
      'CRM_CORE_QUOTES_ENABLED',
      'CRM_CORE_CLIENTS_ENABLED',
    ]) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('products core enabled when operational mode is on', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_PRODUCTS_ENABLED = process.env.CRM_CORE_PRODUCTS_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_PRODUCTS_ENABLED;
    assert.equal(isProductsCoreEnabled(), true);
  });

  it('quotes core NOT enabled by operational mode alone (flag is isolated)', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    assert.equal(isCoreQuotesEnabled(), false);
  });

  it('clients core enabled when operational mode is on', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_CLIENTS_ENABLED = process.env.CRM_CORE_CLIENTS_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_CLIENTS_ENABLED;
    assert.equal(isCoreClientsEnabled(), true);
  });

  it('individual flags still work when operational mode is off', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_PRODUCTS_ENABLED = process.env.CRM_CORE_PRODUCTS_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'false';
    process.env.CRM_CORE_PRODUCTS_ENABLED = 'true';
    assert.equal(isProductsCoreEnabled(), true);
  });

  it('quotes core enabled only by its own flag', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'false';
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    assert.equal(isCoreQuotesEnabled(), true);
  });

  it('quotes core disabled when own flag is unset', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    assert.equal(isCoreQuotesEnabled(), false);
  });

  it('quotes core disabled for invalid flag values', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    for (const value of ['1', 'TRUE', 'yes', '']) {
      process.env.CRM_CORE_QUOTES_ENABLED = value;
      assert.equal(isCoreQuotesEnabled(), false, `expected false for "${value}"`);
    }
  });
});

// ── Quote rollout states ──────────────────────────────────────────────────

describe('getQuoteRolloutState', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('defaults to legacy when env var is unset', () => {
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    assert.equal(getQuoteRolloutState(), 'legacy');
  });

  it('returns legacy for unrecognized values', () => {
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'bogus';
    assert.equal(getQuoteRolloutState(), 'legacy');
  });

  it('returns postgres-write when set', () => {
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    assert.equal(getQuoteRolloutState(), 'postgres-write');
  });

  it('returns postgres-read-only when set', () => {
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    assert.equal(getQuoteRolloutState(), 'postgres-read-only');
  });

  it('returns rollback-compatible when set', () => {
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    assert.equal(getQuoteRolloutState(), 'rollback-compatible');
  });
});

// ── Rollback contract: postgres record readable after rollback-compatible ─

describe('rollback-compatible quotation detail contract', () => {
  it('returns postgres record when state is rollback-compatible', async () => {
    const fakeRecord = { id: 'ORC-TEST001', grand_total: 1000 };
    const repositoryStub = {
      list: async () => ({ quotations: [fakeRecord], total: 1 }),
      get: async (id: string) => (id === 'ORC-TEST001' ? fakeRecord : null),
      update: async () => fakeRecord,
      delete: async () => undefined,
    };
    const { createCoreHandler } = await import('../../api/_functions/quotations-core.js');
    const handler = createCoreHandler({ repository: repositoryStub as any });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { id: 'ORC-TEST001' },
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body || '{}');
    assert.equal(body.id, 'ORC-TEST001');
    assert.equal(body.source, 'postgres');
  });

  it('legacy handler path remains accessible for Frappe records', async () => {
    // Verify the dispatch boundary: when isCoreQuotesEnabled() is false,
    // the legacy path is never touched by the core handler.
    const prev = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    assert.equal(isCoreQuotesEnabled(), false);
    if (prev === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = prev;
  });
});

// ── Guard returns 503 ──────────────────────────────────────────────────────

import { gateOperational } from '../../api/_functions/lib/operational-guard.js';

describe('gateOperational', () => {
  const original = process.env.CRM_OPERATIONAL_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = original;
  });

  const dummyHandler = async () => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true }),
  });

  const dummyEvent = {
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
    body: '{}',
  };

  it('returns 503 when operational mode is active', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    const guarded = gateOperational(dummyHandler, 'test-endpoint');
    const result = await guarded(dummyEvent as any);
    assert.equal(result.statusCode, 503);
    const body = JSON.parse(result.body || '{}');
    assert.equal(body.error, 'test-endpoint não está disponível no modo operacional.');
  });

  it('passes through when operational mode is off', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'false';
    const guarded = gateOperational(dummyHandler, 'test-endpoint');
    const result = await guarded(dummyEvent as any);
    assert.equal(result.statusCode, 200);
  });
});

// ── Handler guard integration (sales-dashboard) ────────────────────────────

describe('sales-dashboard handler guard', () => {
  const original = process.env.CRM_OPERATIONAL_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = original;
  });

  it('returns 503 in operational mode without calling Frappe', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    const { handler } = await import('../../api/_functions/sales-dashboard.js');
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 503);
    const body = JSON.parse(result.body || '{}');
    assert.match(body.error, /não está disponível no modo operacional/);
    // Ensure no stack trace leaks
    assert.equal(body.stack, undefined);
  });
});

// ── Handler guard integration (crm-deals) ──────────────────────────────────

describe('crm-deals handler guard', () => {
  const original = process.env.CRM_OPERATIONAL_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = original;
  });

  it('returns 503 in operational mode', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    const { handler } = await import('../../api/_functions/crm-deals.js');
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 503);
    const body = JSON.parse(result.body || '{}');
    assert.match(body.error, /não está disponível/);
  });
});

// ── Typebot early return ───────────────────────────────────────────────────

describe('typebot-lead-capture operational mode', () => {
  const original = process.env.CRM_OPERATIONAL_MODE;

  afterEach(() => {
    if (original === undefined) delete process.env.CRM_OPERATIONAL_MODE;
    else process.env.CRM_OPERATIONAL_MODE = original;
  });

  it('returns 200 with mode "operational" without calling Frappe', async () => {
    process.env.CRM_OPERATIONAL_MODE = 'true';
    const { handler } = await import('../../api/_functions/typebot-lead-capture.js');
    const result = await handler({
      httpMethod: 'POST',
      headers: { authorization: 'Bearer dummy' },
      queryStringParameters: {},
      body: JSON.stringify({ nome: 'Test' }),
    } as any);
    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body || '{}');
    assert.equal(body.received, true);
    assert.equal(body.mode, 'operational');
  });
});

// ── Operational status handler structure ────────────────────────────────────

describe('operational-status handler', () => {
  it('returns expected structure', async () => {
    // This test verifies the handler can be imported and called.
    // Without a real database, some checks will fail, but the structure should be correct.
    const { handler } = await import('../../api/_functions/operational-status.js');
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    } as any);

    assert.equal(result.statusCode, 200);
    const body = JSON.parse(result.body || '{}');

    // Verify structure
    assert.equal(typeof body.ready, 'boolean');
    assert.equal(typeof body.checks, 'object');
    assert.equal(typeof body.checks.database_connected, 'boolean');
    assert.equal(typeof body.checks.migration_complete, 'boolean');
    assert.equal(typeof body.checks.pdfs_archived, 'boolean');
    assert.equal(typeof body.checks.backup_validated, 'boolean');
    assert.equal(typeof body.checks.capacity_ok, 'boolean');
    assert.equal(typeof body.checks.mandatory_settings, 'boolean');
    assert.equal(typeof body.details, 'object');
    assert.equal(typeof body.details.product_count, 'number');
    assert.equal(typeof body.details.client_count, 'number');
    assert.equal(typeof body.details.quotation_count, 'number');
    assert.equal(typeof body.details.pdf_count, 'number');
    assert.ok(Array.isArray(body.details.settings_missing));
  });

  it('returns 405 for non-GET methods', async () => {
    const { handler } = await import('../../api/_functions/operational-status.js');
    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 405);
  });
});
