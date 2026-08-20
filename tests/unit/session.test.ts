import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  SESSION_COOKIE_NAME,
  SESSION_LIFETIME_SECONDS,
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  isValidSessionSecret,
  verifySessionToken,
} from '../../api/_shared/session.js';

function sessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

describe('signed sessions', () => {
  it('issues a versioned token with a fresh nonce and validates it with the independent secret', () => {
    const secret = sessionSecret();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const first = createSessionToken(secret, now);
    const second = createSessionToken(secret, now);

    assert.ok(first);
    assert.ok(second);
    assert.notEqual(first, second);
    assert.deepEqual(first.split(':').slice(0, 2), ['aspen-session', 'v1']);
    assert.equal(first.includes(secret), false);
    assert.equal(verifySessionToken(first, secret, now), true);
    assert.equal(verifySessionToken(first, sessionSecret(), now), false);
  });

  it('rejects tampering, expiry, malformed tokens, and weak secrets', () => {
    const secret = sessionSecret();
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const token = createSessionToken(secret, now);
    assert.ok(token);

    const parts = token.split(':');
    parts[3] = `${parts[3][0] === 'A' ? 'B' : 'A'}${parts[3].slice(1)}`;
    const tampered = parts.join(':');

    assert.equal(verifySessionToken(tampered, secret, now), false);
    assert.equal(verifySessionToken(token, secret, now + SESSION_LIFETIME_SECONDS * 1000), false);
    assert.equal(verifySessionToken('not-a-session', secret, now), false);
    assert.equal(createSessionToken('too-short', now), null);
    assert.equal(verifySessionToken(token, 'too-short', now), false);
    assert.equal(isValidSessionSecret('x'.repeat(31)), false);
    assert.equal(isValidSessionSecret('x'.repeat(32)), true);
  });

  it('uses the required cookie attributes and rejects unsafe cookie values', () => {
    const token = createSessionToken(sessionSecret(), Date.UTC(2026, 0, 1));
    assert.ok(token);

    assert.equal(
      createSessionCookie(token),
      `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}; Path=/`
    );
    assert.equal(createSessionCookie('unsafe;value'), null);
    assert.equal(
      clearSessionCookie(),
      `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/`
    );
  });
});
