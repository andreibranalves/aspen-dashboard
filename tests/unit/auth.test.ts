import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  getAuthConfiguration,
  isAuthenticated,
  isDevelopmentAuthBypassEnabled,
  isMachineRoute,
  isProductionEnvironment,
} from '../../api/_shared/auth.js';
import { createPasswordHash } from '../../api/_shared/password.js';
import { createSessionToken } from '../../api/_shared/session.js';

function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

function protectedRequest(headers: Record<string, string> = {}) {
  return { url: '/api/quotations', headers };
}

describe('auth guard', () => {
  it('keeps public and login/logout routes available while protected routes fail closed', () => {
    assert.equal(isAuthenticated({ url: '/api/view/quote-1' }, {}), false);
    assert.equal(
      isAuthenticated({ url: '/api/public-quotation?token=valid', method: 'GET' }, {}),
      true
    );
    assert.equal(
      isAuthenticated({ url: '/api/public-quotation?token=valid', method: 'POST' }, {}),
      false
    );
    assert.equal(isAuthenticated({ url: '/api/login' }, {}), true);
    assert.equal(isAuthenticated({ url: '/api/logout' }, {}), true);
    assert.equal(isAuthenticated(protectedRequest(), {}), false);
    assert.equal(isAuthenticated({ url: '/api/quotation-templates' }, {}), false);
    assert.equal(isAuthenticated({ url: '/api/quotation-preview?id=ORC-20260001' }, {}), false);
    assert.equal(isAuthenticated({ url: '/api/quotation-issue' }, {}), false);
    assert.equal(isAuthenticated({ url: '/api/quotation-document?id=documento' }, {}), false);
  });

  it('lets explicit machine routes reach their own bearer guards only', () => {
    assert.equal(isMachineRoute('evolution-webhook'), true);
    assert.equal(isMachineRoute('quotation-delivery-worker'), true);
    assert.equal(isMachineRoute('quotation-follow-up-worker'), true);
    assert.equal(isMachineRoute('site-quote-leads'), true);
    assert.equal(isMachineRoute('quotation-deliveries'), false);
    assert.equal(isAuthenticated({ url: '/api/evolution-webhook' }, {}), true);
    assert.equal(isAuthenticated({ url: '/api/quotation-delivery-worker' }, {}), true);
    assert.equal(isAuthenticated({ url: '/api/quotation-follow-up-worker' }, {}), true);
    assert.equal(isAuthenticated({ url: '/api/site-quote-leads', method: 'POST' }, {}), true);
  });
  it('requires a valid signed cookie and never accepts the removed header fallback', async () => {
    const passwordHash = await createPasswordHash(randomBytes(24).toString('base64url'));
    const secret = randomSecret();
    const token = createSessionToken(secret);
    assert.ok(token);
    const environment = { APP_PASSWORD_HASH: passwordHash, APP_SESSION_SECRET: secret };

    assert.equal(
      isAuthenticated(protectedRequest({ cookie: `aspen_token=${token}` }), environment),
      true
    );
    assert.equal(isAuthenticated(protectedRequest({ 'x-aspen-key': token }), environment), false);
    assert.equal(
      isAuthenticated(protectedRequest({ cookie: 'aspen_token=legacy-plaintext' }), environment),
      false
    );
  });

  it('only honors the explicit bypass outside both production indicators', () => {
    assert.equal(isDevelopmentAuthBypassEnabled({ APP_AUTH_BYPASS: 'true' }), true);
    assert.equal(
      isAuthenticated(protectedRequest(), { APP_AUTH_BYPASS: 'true', NODE_ENV: 'development' }),
      true
    );

    for (const environment of [
      { APP_AUTH_BYPASS: 'true', NODE_ENV: 'production' },
      { APP_AUTH_BYPASS: 'true', VERCEL_ENV: 'production' },
    ]) {
      assert.equal(isProductionEnvironment(environment), true);
      assert.equal(isDevelopmentAuthBypassEnabled(environment), false);
      assert.equal(isAuthenticated(protectedRequest(), environment), false);
    }
  });

  it('does not accept a session when either production credential setting is malformed or missing', async () => {
    const secret = randomSecret();
    const token = createSessionToken(secret, Date.UTC(2026, 0, 1));
    assert.ok(token);
    const request = protectedRequest({ cookie: `aspen_token=${token}` });

    assert.equal(
      isAuthenticated(request, {
        APP_PASSWORD_HASH: 'scrypt:v1:malformed:malformed',
        APP_SESSION_SECRET: secret,
        NODE_ENV: 'production',
      }),
      false
    );
    assert.equal(
      isAuthenticated(request, {
        APP_SESSION_SECRET: secret,
        VERCEL_ENV: 'production',
      }),
      false
    );
    assert.equal(
      isAuthenticated(request, {
        APP_PASSWORD_HASH: await createPasswordHash(randomBytes(24).toString('base64url')),
        APP_SESSION_SECRET: 'short',
        NODE_ENV: 'production',
      }),
      false
    );
    assert.equal(
      getAuthConfiguration({ APP_PASSWORD_HASH: 'not-a-hash', APP_SESSION_SECRET: secret }).isValid,
      false
    );
  });
});
