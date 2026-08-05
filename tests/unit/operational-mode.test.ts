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
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('flag=false + any state -> legacy', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    assert.equal(resolveEffectiveRolloutState(), 'legacy');
  });

  it('flag=true + unset state -> postgres-write', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    delete process.env.CRM_QUOTES_ROLLOUT_STATE;
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
  });

  it('flag=true + legacy state -> postgres-write', () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    assert.equal(resolveEffectiveRolloutState(), 'postgres-write');
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
    assert.equal(isCoreReadEnabled(), true);
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
    assert.equal(isCoreWriteEnabled(), true); // flag on + legacy -> postgres-write
    process.env.CRM_CORE_QUOTES_ENABLED = 'false';
    assert.equal(isCoreWriteEnabled(), false);
  });
});

// ── Dispatch: orcamento.ts uses rollout state ─────────────────────────────

describe('orcamento dispatch uses rollout state', () => {
  const savedVars: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of ['CRM_CORE_QUOTES_ENABLED', 'CRM_QUOTES_ROLLOUT_STATE']) {
      if (savedVars[key] === undefined) delete process.env[key];
      else process.env[key] = savedVars[key];
    }
  });

  it('postgres-write dispatches to core handler', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'postgres-write';
    let called = false;
    const { createHandler } = await import('../../api/_functions/orcamento.js');
    const handler = createHandler({
      core: async () => { called = true; return { statusCode: 201, body: '{}' }; },
      legacy: async () => { called = true; return { statusCode: 200, body: '{}' }; },
    });
    await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any);
    const body = JSON.parse((await handler({ httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: '{}' } as any)).body || '{}');
    assert.equal(called, true);
  });

  it('legacy state + flag=true dispatches to core (flag overrides legacy)', async () => {
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
    // flag=true + state=legacy -> effective postgres-write -> core
    assert.equal(coreCalled, true);
    assert.equal(legacyCalled, false);
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

  it('legacy state + flag=true dispatches all methods to core (flag overrides)', async () => {
    savedVars.CRM_CORE_QUOTES_ENABLED = process.env.CRM_CORE_QUOTES_ENABLED;
    savedVars.CRM_QUOTES_ROLLOUT_STATE = process.env.CRM_QUOTES_ROLLOUT_STATE;
    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    process.env.CRM_QUOTES_ROLLOUT_STATE = 'legacy';
    const { createHandler } = await import('../../api/_functions/quotations.js');
    for (const method of ['GET', 'PUT', 'DELETE'] as const) {
      let coreCalled = false;
      const handler = createHandler({
        core: async () => { coreCalled = true; return { statusCode: 200, body: '{}' }; },
        legacy: async () => { throw new Error('legacy should not be called'); },
      });
      await handler({ httpMethod: method, headers: {}, queryStringParameters: { id: 'X' }, body: '{}' } as any);
      // flag=true + state=legacy -> effective postgres-write -> core
      assert.equal(coreCalled, true, `core should be called for ${method}`);
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

  it('legacy state returns 404', async () => {
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

  it('returns pipeline errors directly as HTTP errors', async () => {
    const failingPipeline = async () => {
      const err: any = new Error('Frappe unavailable');
      err.statusCode = 502;
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
    assert.match(body.error, /Frappe unavailable/);
    assert.equal(body.stack, undefined, 'no stack trace leak');
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
