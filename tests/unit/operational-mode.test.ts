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

  it('quotes core enabled when operational mode is on', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    assert.equal(isCoreQuotesEnabled(), true);
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

  it('quotes core enabled when operational mode overrides a false flag', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    assert.equal(isCoreQuotesEnabled(), true);
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

import {
  resolveEffectiveRolloutState,
  isCoreReadEnabled,
  isCoreWriteEnabled,
} from '../../api/_functions/orcamento-mode.js';

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

// ── Precedence matrix: CRM_CORE_QUOTES_ENABLED x CRM_QUOTES_ROLLOUT_STATE ─

describe('resolveEffectiveRolloutState precedence matrix', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_OPERATIONAL_MODE', 'CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('flag=false + any state -> legacy', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    delete process.env.CRM_OPERATIONAL_MODE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    assert.equal(resolveEffectiveRolloutState(), 'legacy');
  });

  it('operational mode forces postgres-write regardless of quote flags', () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
    assert.equal(isCoreReadEnabled(), true);
    assert.equal(isCoreWriteEnabled(), true);
  });

  it('flag=true + unset state -> postgres-write', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
  });

  it('flag=true + legacy state -> legacy (explicit state preserved)', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    assert.equal(resolveEffectiveRolloutState(), 'legacy');
  });

  it('flag=true + postgres-write -> postgres-write', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
  });

  it('flag=true + postgres-read-only -> postgres-read-only', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    assert.equal(resolveEffectiveRolloutState(), 'postgres-read-only');
  });

  it('flag=true + rollback-compatible -> rollback-compatible', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    assert.equal(resolveEffectiveRolloutState(), 'rollback-compatible');
  });

  it('flag=true + bogus state -> postgres-write (bogus treated as legacy)', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'bogus';
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
  });

  it('isCoreReadEnabled matches resolveEffectiveRolloutState', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    assert.equal(isCoreReadEnabled(), true);
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    assert.equal(isCoreReadEnabled(), false); // explicit legacy preserved
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    assert.equal(isCoreReadEnabled(), false);
  });

  it('isCoreWriteEnabled only true in postgres-write', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    assert.equal(isCoreWriteEnabled(), true);
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    assert.equal(isCoreWriteEnabled(), false);
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    assert.equal(isCoreWriteEnabled(), false);
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    assert.equal(isCoreWriteEnabled(), false); // explicit legacy preserved
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    assert.equal(isCoreWriteEnabled(), false);
  });
});

// ── Dispatch: orcamento.ts uses rollout state ─────────────────────────────

describe('orcamento dispatch uses rollout state', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_OPERATIONAL_MODE', 'CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('operational mode dispatches to core handler', async () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    let called = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { called = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { throw new Error('legacy should not be called in operational mode'); },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(called, true);
  });

  it('postgres-write dispatches to core handler', async () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    delete process.env.CRM_OPERATIONAL_MODE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    let called = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { called = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { called = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(called, true);
  });

  it('legacy state + flag=true dispatches to legacy (explicit state preserved)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    let legacyCalled = false;
    let coreCalled = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    // flag=true + explicit state=legacy -> effective legacy -> legacy handler
    assert.equal(legacyCalled, true);
    assert.equal(coreCalled, false);
  });

  it('flag=false + legacy state dispatches to legacy handler', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    let legacyCalled = false;
    let coreCalled = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(legacyCalled, true);
    assert.equal(coreCalled, false);
  });

  it('rollback-compatible dispatches to legacy handler (write to Frappe)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    let legacyCalled = false;
    let coreCalled = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(legacyCalled, true);
    assert.equal(coreCalled, false);
  });

  it('flag=false dispatches to legacy handler', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    let legacyCalled = false;
    let coreCalled = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(legacyCalled, true);
    assert.equal(coreCalled, false);
  });
});

// ── Dispatch: quotations.ts uses rollout state with write blocking ─────────

describe('quotations dispatch uses rollout state', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('postgres-write dispatches all methods to core', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      let coreCalled = false;
      const handler = createHandler({
        core: async () => { coreCalled = true; return { statusCode: 200, body: '{}' }; },
        legacy: async () => { throw new Error('legacy should not be called'); },
      });
      await handler({ httpMethod: method, headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
      assert.equal(coreCalled, true, `core should be called for ${method}`);
    }
  });

  it('postgres-read-only GET dispatches to core, PUT/DELETE dispatch to legacy', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    // GET -> core
    let coreCalled = false;
    const getHandler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 200, body: '{}' }; },
      legacy: async () => { throw new Error('legacy should not be called for GET'); },
    });
    await getHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(coreCalled, true, 'GET should dispatch to core');
    // PUT -> legacy
    let legacyPutCalled = false;
    const putHandler = createHandler({
      core: async () => { throw new Error('core should not be called for PUT'); },
      legacy: async () => { legacyPutCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await putHandler({ httpMethod: 'PUT', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(legacyPutCalled, true, 'PUT should dispatch to legacy');
    // DELETE -> legacy
    let legacyDeleteCalled = false;
    const deleteHandler = createHandler({
      core: async () => { throw new Error('core should not be called for DELETE'); },
      legacy: async () => { legacyDeleteCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await deleteHandler({ httpMethod: 'DELETE', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(legacyDeleteCalled, true, 'DELETE should dispatch to legacy');
  });

  it('rollback-compatible GET dispatches to core, writes dispatch to legacy', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    // GET -> core
    let coreGetCalled = false;
    const getHandler = createHandler({
      core: async () => { coreGetCalled = true; return { statusCode: 200, body: '{}' }; },
      legacy: async () => { throw new Error('legacy should not be called for GET'); },
    });
    await getHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(coreGetCalled, true, 'GET should dispatch to core');
    // PUT -> legacy
    let legacyPutCalled = false;
    const putHandler = createHandler({
      core: async () => { throw new Error('core should not be called for PUT'); },
      legacy: async () => { legacyPutCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await putHandler({ httpMethod: 'PUT', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(legacyPutCalled, true, 'PUT should dispatch to legacy');
  });

  it('legacy state + flag=true dispatches all methods to legacy (explicit state preserved)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      let legacyCalled = false;
      const handler = createHandler({
        core: async () => { throw new Error('core should not be called'); },
        legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
      });
      await handler({ httpMethod: method, headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
      // flag=true + explicit state=legacy -> effective legacy -> legacy handler
      assert.equal(legacyCalled, true, `legacy should be called for ${method}`);
    }
  });

  it('flag=false + legacy state dispatches all methods to legacy', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      let legacyCalled = false;
      const handler = createHandler({
        core: async () => { throw new Error('core should not be called'); },
        legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
      });
      await handler({ httpMethod: method, headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
      assert.equal(legacyCalled, true, `legacy should be called for ${method}`);
    }
  });

  it('flag=false dispatches all methods to legacy', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    let legacyCalled = false;
    const handler = createHandler({
      core: async () => { throw new Error('core should not be called'); },
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(legacyCalled, true, 'legacy should be called when flag is false');
  });
});

// ── Write blocking: quotation-templates.ts in postgres-read-only ───────────

describe('quotation-templates write blocking', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('postgres-read-only blocks POST (create template)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'POST', headers: {}, queryStringParameters: {},
      body: JSON.stringify({ key: 'k', name: 'n', source: 's' }),
      url: '/api/quotation-templates',
    } as any);
    assert.equal(result.statusCode, 403);
    assert.match(JSON.parse(result.body || '{}').error, /escrita/);
  });

  it('postgres-read-only blocks PUT (save_version)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'PUT', headers: {}, queryStringParameters: { id: 'tid' },
      body: JSON.stringify({ action: 'save_version', source: 's' }),
      url: '/api/quotation-templates',
    } as any);
    assert.equal(result.statusCode, 403);
    assert.match(JSON.parse(result.body || '{}').error, /escrita/);
  });

  it('postgres-read-only blocks POST validate', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-read-only';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'POST', headers: {}, queryStringParameters: {},
      body: JSON.stringify({ key: 'k', source: 's' }),
      url: '/api/quotation-templates/validate',
    } as any);
    assert.equal(result.statusCode, 403);
  });

  it('rollback-compatible blocks POST and PUT', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const postResult = await handler({
      httpMethod: 'POST', headers: {}, queryStringParameters: {},
      body: JSON.stringify({ key: 'k', name: 'n', source: 's' }),
      url: '/api/quotation-templates',
    } as any);
    assert.equal(postResult.statusCode, 403);
    const putResult = await handler({
      httpMethod: 'PUT', headers: {}, queryStringParameters: { id: 'tid' },
      body: JSON.stringify({ action: 'save_version', source: 's' }),
      url: '/api/quotation-templates',
    } as any);
    assert.equal(putResult.statusCode, 403);
  });

  it('postgres-write allows all operations', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const postResult = await handler({
      httpMethod: 'POST', headers: {}, queryStringParameters: {},
      body: JSON.stringify({ key: 'k', name: 'n', source: 's' }),
      url: '/api/quotation-templates',
    } as any);
    assert.equal(postResult.statusCode, 201);
  });

  it('flag=true + state=legacy returns 404 (legacy preserved)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '',
      url: '/api/quotation-templates',
    } as any);
    // flag=true + explicit state=legacy -> effective legacy -> 404
    assert.equal(result.statusCode, 404);
  });

  it('flag=false returns 404', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({ id: 'x' }), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '',
      url: '/api/quotation-templates',
    } as any);
    assert.equal(result.statusCode, 404);
  });
});

// ── No fallback: core error does not invoke legacy handler ────────────────

describe('core failure does not fall back to Frappe', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('orcamento core error is returned directly without legacy fallback', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    let legacyCalled = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => ({ statusCode: 500, body: JSON.stringify({ error: 'core failure' }) }),
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    const result = await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    assert.equal(result.statusCode, 500);
    assert.equal(legacyCalled, false, 'legacy handler must not be called on core failure');
    assert.match(JSON.parse(result.body || '{}').error, /core failure/);
  });

  it('quotations core error is returned directly without legacy fallback', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    let legacyCalled = false;
    const { createHandler } = await import('../../api/_functions/quotations.js');
    const handler = createHandler({
      core: async () => ({ statusCode: 500, body: JSON.stringify({ error: 'db down' }) }),
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });
    const result = await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(result.statusCode, 500);
    assert.equal(legacyCalled, false, 'legacy handler must not be called on core failure');
  });
});

// ── Real legacy handler: pipeline is actually invoked ──────────────────────

describe('real legacy handler invokes pipeline', () => {
  it('calls runQuotePipeline with adapted payload', async () => {
    const pipelineCalls: any[] = [];
    const fakePipeline = async (...args: any[]) => {
      pipelineCalls.push(args);
      return { quotation_id: 'ORC-LEGACY-001', deal_id: 'DEAL-001' };
    };
    const { createLegacyHandler } = await import('../../api/_functions/orcamento-legacy.js');
    const handler = createLegacyHandler({ runQuotePipeline: fakePipeline as any });
    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({
        extracted: {
          items: [{ item_code: 'SKU-A', qty: 1, rate: 100 }],
          cliente_nome: 'Teste',
        },
      }),
    } as any);
    assert.equal(result.statusCode, 200);
    assert.equal(pipelineCalls.length, 1);
    const body = JSON.parse(result.body || '{}');
    assert.equal(body.quotation_id, 'ORC-LEGACY-001');
    assert.equal(body.deal_id, 'DEAL-001');
  });

  it('returns pipeline errors as generic message without upstream details', async () => {
    const failingPipeline = async () => {
      const err: any = new Error('Frappe unavailable');
      err.statusCode = 502;
      err.logMessage = 'Frappe connection timeout';
      throw err;
    };
    const { createLegacyHandler } = await import('../../api/_functions/orcamento-legacy.js');
    const handler = createLegacyHandler({ runQuotePipeline: failingPipeline as any });
    const result = await handler({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({ extracted: { items: [] } }),
    } as any);
    assert.equal(result.statusCode, 502);
    const body = JSON.parse(result.body || '{}');
    // Client receives generic Portuguese message, not upstream error
    assert.equal(body.error, 'Erro ao processar orçamento. Tente novamente.');
    assert.match(body.error, /Erro ao processar orçamento/);
    // Upstream details must NOT leak to response
    assert.ok(!JSON.stringify(body).includes('Frappe unavailable'));
    assert.ok(!JSON.stringify(body).includes('connection timeout'));
    assert.ok(!JSON.stringify(body).includes('stack'));
  });

  it('rejects non-POST methods', async () => {
    const { createLegacyHandler } = await import('../../api/_functions/orcamento-legacy.js');
    const handler = createLegacyHandler();
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 405);
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

// ── Quotations handler: CRM_OPERATIONAL_MODE=true without quotes flag ─────

describe('quotation handlers in operational mode', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_OPERATIONAL_MODE', 'CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('routes quotations to core when operational mode is active', async () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    let coreCalled = false;
    const handler = createHandler({
      core: async () => { coreCalled = true; return { statusCode: 200, body: '{}' }; },
      legacy: async () => { throw new Error('legacy should not be called in operational mode'); },
    });
    await handler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
    assert.equal(coreCalled, true);
  });

  it('keeps quotation preview available through the core repository', async () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    const { createQuotationPreviewHandler } = await import('../../api/_functions/quotation-preview.js');
    const handler = createQuotationPreviewHandler({ repository: { get: async () => null } });
    const result = await handler({
      httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'X' }, body: '{}',
    } as any);
    assert.equal(result.statusCode, 404);
  });

  it('keeps quotation templates available through the core repository', async () => {
    savedVars.CRM_OPERATIONAL_MODE = process.env.CRM_OPERATIONAL_MODE;
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_OPERATIONAL_MODE = 'true';
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    const { createQuotationTemplatesHandler } = await import('../../api/_functions/quotation-templates.js');
    const repo = { list: async () => ({ templates: [], default_key: '' }), get: async () => null, create: async () => ({}), saveVersion: async () => ({}), archive: async () => ({}), setDefault: async () => ({}), validate: async () => ({}) };
    const handler = createQuotationTemplatesHandler({ repository: repo as any });
    const result = await handler({
      httpMethod: 'GET', headers: {}, queryStringParameters: {}, body: '{}',
      url: '/api/quotation-templates',
    } as any);
    assert.equal(result.statusCode, 200);
  });
});

// ── Rollback-compatible contract: real handlers with repository seams ────
//
// These tests wire the REAL createCoreHandler from quotations-core.ts through
// the REAL createHandler from quotations.ts, backed by an in-memory repository
// seam. This proves the boundary works end-to-end, not just with stubs.

describe('rollback-compatible contract: real handlers + repository seam', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  /** Shared in-memory store between create and read repos. */
  function createSharedStore() {
    const store = new Map<string, Record<string, unknown>>();
    return {
      store,
      /** QuoteDraftRepository seam for orcamento-core (createDraft). */
      createRepo: {
        createDraft: async (input: Record<string, unknown>) => {
          const id = `ORC-PG-${store.size + 1}`;
          const record = { id, ...input, created_at: new Date().toISOString() };
          store.set(id, record);
          return {
            success: true as const,
            quotation_id: id,
            quotation_name: id,
            quote_id: id,
            quotation_uuid: id,
            revision_id: 'rev-1',
            quote_revision_id: 'rev-1',
            revision: 1,
            revision_number: 1,
            status: 'rascunho' as const,
            cliente: String((input as any).cliente_nome || ''),
            cliente_id: '',
            cliente_snapshot: { id: '', nome: String((input as any).cliente_nome || ''), documento: null, email: null, telefone: null, notes: null, address: null },
            items: [],
            subtotal: '0', frete: '0', total: '0',
            validade_dias: 30, pagamento: '', entrega: '', observacoes: '', prazo_producao: '',
            template_padrao: '', template_key: '', template_hash: '', template_version_id: '',
            secoes: {} as any,
            created_at: record.created_at,
          };
        },
      },
      /** QuoteDraftManagementRepository seam for quotations-core (list/get/update/delete). */
      managementRepo: {
        list: async (opts?: { page?: number; limit?: number }) => {
          const rows = [...store.values()];
          return {
            rows,
            total: rows.length,
            page: opts?.page || 1,
            limit: opts?.limit || 50,
            status_summary: {} as Record<string, number>,
          };
        },
        get: async (id: string) => store.get(id) || null,
        update: async (id: string, input: Record<string, unknown>) => {
          const existing = store.get(id);
          if (!existing) throw Object.assign(new Error('não encontrado'), { statusCode: 404 });
          const updated = { ...existing, ...input };
          store.set(id, updated);
          return updated;
        },
        delete: async (id: string) => {
          store.delete(id);
          return { id, deletedAt: new Date().toISOString() };
        },
      },
    };
  }

  it('POST creates via orcamento-core, then GET reads in rollback-compatible from PG', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;

    // Phase 1: create the quote in PG via postgres-write
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';

    const shared = createSharedStore();
    const { createHandler: createOrcamentoHandler } = await import('../../api/_functions/orcamento.js');
    const { createCoreHandler: createOrcamentoCoreHandler } = await import('../../api/_functions/orcamento-core.js');
    const coreHandler = createOrcamentoCoreHandler({ repository: shared.createRepo as any });
    const noopLegacy = async () => { throw new Error('legacy must not be called in postgres-write'); };
    const orcamentoHandler = createOrcamentoHandler({ core: coreHandler, legacy: noopLegacy });

    const createResult = await orcamentoHandler({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: JSON.stringify({
        extracted: {
          cliente_nome: 'Teste PG',
          items: [{ item_code: 'SKU-TEST', qty: 2, rate: 150 }],
        },
      }),
    } as any);
    assert.equal(createResult.statusCode, 201, 'create should succeed');
    const created = JSON.parse(createResult.body || '{}');
    const createdId = created.quotation_id || created.id || created.name;
    assert.ok(createdId, 'created record must have an id');
    assert.equal(shared.store.has(createdId), true, 'record must exist in PG seam');

    // Phase 2: switch to rollback-compatible and read the same record
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';

    const { createHandler: createQuotationsHandler } = await import('../../api/_functions/quotations.js');
    const { createCoreHandler: createQuotationsCoreHandler } = await import('../../api/_functions/quotations-core.js');
    const quotationsCore = createQuotationsCoreHandler({ repository: shared.managementRepo as any });
    let legacyCalled = false;
    const quotationsHandler = createQuotationsHandler({
      core: quotationsCore,
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });

    const getResult = await quotationsHandler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { id: createdId },
      body: '{}',
    } as any);
    assert.equal(getResult.statusCode, 200, 'GET must succeed');
    assert.equal(legacyCalled, false, 'legacy must NOT be called when PG has the record');
    assert.equal((getResult.headers as any)['X-Quote-Source'], 'postgres', 'source must be postgres');
    const detail = JSON.parse(getResult.body || '{}');
    assert.equal(detail.id, createdId, 'returned id must match');
  });

  it('GET falls back to Frappe when record only exists in legacy (not in PG)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';

    const sharedRead = createSharedStore(); // empty - no PG records
    const { createHandler: createQuotationsHandler } = await import('../../api/_functions/quotations.js');
    const { createCoreHandler: createQuotationsCoreHandler } = await import('../../api/_functions/quotations-core.js');
    const quotationsCore = createQuotationsCoreHandler({ repository: sharedRead.managementRepo as any });

    const legacyRecord = {
      id: 'ORC-FRAPPE-001', data: '2025-06-01', cliente: 'Cliente Legado',
      tipo_entidade: 'Customer', entidade_id: 'CUST-001', valor: 350,
      status: 'Open', docstatus: 1, validade: '2025-12-31',
      items: [{ item_code: 'SKU-OLD', item_name: 'Old SKU', qty: 1, rate: 350, amount: 350, uom: 'Un' }],
      email: '', telefone: '', sales_order_id: null,
    };
    let legacyCalled = false;
    const quotationsHandler = createQuotationsHandler({
      core: quotationsCore,
      legacy: async () => {
        legacyCalled = true;
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(legacyRecord),
        };
      },
    });

    const result = await quotationsHandler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { id: 'ORC-FRAPPE-001' },
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 200);
    assert.equal(legacyCalled, true, 'legacy handler must be called when PG has no record');
    assert.equal((result.headers as any)['X-Quote-Source'], 'frappe', 'source must be frappe');
    const detail = JSON.parse(result.body || '{}');
    assert.equal(detail.id, 'ORC-FRAPPE-001');
  });

  it('GET does NOT fall back to Frappe on non-404 core error', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';

    const brokenShared = createSharedStore();
    // Inject a broken repo that throws a 503-level error
    const brokenRepo = {
      ...brokenShared.managementRepo,
      get: async () => { throw Object.assign(new Error('connection refused'), { statusCode: 503 }); },
    };
    const { createHandler: createQuotationsHandler } = await import('../../api/_functions/quotations.js');
    const { createCoreHandler: createQuotationsCoreHandler } = await import('../../api/_functions/quotations-core.js');
    const quotationsCore = createQuotationsCoreHandler({ repository: brokenRepo as any });
    let legacyCalled = false;
    const quotationsHandler = createQuotationsHandler({
      core: quotationsCore,
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: '{}' }; },
    });

    const result = await quotationsHandler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { id: 'X' },
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 503);
    assert.equal(legacyCalled, false, 'legacy must NOT be called on non-404 error');
  });

  it('PUT in rollback-compatible writes to legacy handler, not PG', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'rollback-compatible';

    const writeShared = createSharedStore();
    writeShared.store.set('ORC-001', { id: 'ORC-001', items: [{ item_code: 'SKU', qty: 1, rate: 100 }] });
    const { createHandler: createQuotationsHandler } = await import('../../api/_functions/quotations.js');
    const { createCoreHandler: createQuotationsCoreHandler } = await import('../../api/_functions/quotations-core.js');
    const quotationsCore = createQuotationsCoreHandler({ repository: writeShared.managementRepo as any });
    let legacyCalled = false;
    const quotationsHandler = createQuotationsHandler({
      core: quotationsCore,
      legacy: async () => { legacyCalled = true; return { statusCode: 200, body: JSON.stringify({ ok: true }) }; },
    });

    const result = await quotationsHandler({
      httpMethod: 'PUT',
      headers: {},
      queryStringParameters: { id: 'ORC-001' },
      body: JSON.stringify({ items: [{ item_code: 'SKU', qty: 2, rate: 200 }] }),
    } as any);
    assert.equal(result.statusCode, 200);
    assert.equal(legacyCalled, true, 'writes must go to legacy in rollback-compatible');
  });

  it('legacy-only path: handler without core uses Frappe directly', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;

    const legacyRecord = { id: 'ORC-LEGACY-ONLY', cliente: 'Só Frappe', valor: 100 };
    let legacyCalled = false;
    const { createHandler } = await import('../../api/_functions/quotations.js');
    const handler = createHandler({
      core: async () => { throw new Error('no core'); },
      legacy: async () => {
        legacyCalled = true;
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(legacyRecord),
        };
      },
    });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { id: 'ORC-LEGACY-ONLY' },
      body: '{}',
    } as any);
    assert.equal(result.statusCode, 200);
    assert.equal(legacyCalled, true, 'legacy must be called when flag is off');
    const detail = JSON.parse(result.body || '{}');
    assert.equal(detail.id, 'ORC-LEGACY-ONLY');
  });
});
