import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { afterEach, before, describe, it } from 'node:test';

import { handler } from '../../api/modules/login.js';
import { createPasswordHash } from '../../api/_shared/password.js';
import { SESSION_LIFETIME_SECONDS, verifySessionToken } from '../../api/_shared/session.js';

const AUTH_ENV_KEYS = ['APP_PASSWORD_HASH', 'APP_SESSION_SECRET', 'APP_AUTH_BYPASS'] as const;
const originalEnvironment = Object.fromEntries(
  AUTH_ENV_KEYS.map((key) => [key, process.env[key]])
) as Record<(typeof AUTH_ENV_KEYS)[number], string | undefined>;

let passwordHash = '';
let password = '';
let sessionSecret = '';

function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

function restoreEnvironment(): void {
  for (const key of AUTH_ENV_KEYS) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureValidAuth(): void {
  process.env.APP_PASSWORD_HASH = passwordHash;
  process.env.APP_SESSION_SECRET = sessionSecret;
  delete process.env.APP_AUTH_BYPASS;
}

function event(body: unknown, method = 'POST') {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

before(async () => {
  password = randomValue();
  sessionSecret = randomValue();
  passwordHash = await createPasswordHash(password);
});

afterEach(() => {
  restoreEnvironment();
});

describe('login handler', () => {
  it('verifies scrypt credentials and issues a signed 30-day cookie without credential material', async () => {
    configureValidAuth();

    const result = await handler(event({ password }));
    const cookie = result.headers?.['Set-Cookie'];

    assert.equal(result.statusCode, 200);
    assert.deepEqual(JSON.parse(result.body || '{}'), { success: true });
    assert.equal(typeof cookie, 'string');
    assert.match(
      cookie,
      new RegExp(`^aspen_token=[A-Za-z0-9:_-]+; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_LIFETIME_SECONDS}; Path=/$`)
    );
    assert.equal(cookie.includes(password), false);
    assert.equal(cookie.includes(passwordHash), false);
    assert.equal(cookie.includes(sessionSecret), false);

    const token = cookie.slice('aspen_token='.length).split(';')[0];
    assert.equal(verifySessionToken(token, sessionSecret), true);
  });

  it('rejects an incorrect password with the existing Portuguese error', async () => {
    configureValidAuth();

    const result = await handler(event({ password: randomValue() }));

    assert.equal(result.statusCode, 401);
    assert.deepEqual(JSON.parse(result.body || '{}'), { error: 'Senha incorreta.' });
    assert.equal(result.headers?.['Set-Cookie'], undefined);
  });

  it('keeps malformed JSON and method responses structured', async () => {
    configureValidAuth();

    const invalidJson = await handler(event('{password:', 'POST'));
    const wrongMethod = await handler(event({}, 'GET'));

    assert.equal(invalidJson.statusCode, 400);
    assert.deepEqual(JSON.parse(invalidJson.body || '{}'), { error: 'JSON inválido.' });
    assert.equal(wrongMethod.statusCode, 405);
    assert.deepEqual(JSON.parse(wrongMethod.body || '{}'), { error: 'Método não permitido.' });
  });

  it('fails closed with a generic configuration error instead of exposing credential configuration', async () => {
    process.env.APP_PASSWORD_HASH = 'scrypt:v1:malformed:malformed';
    process.env.APP_SESSION_SECRET = sessionSecret;

    const result = await handler(event({ password }));
    const body = result.body || '';

    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(body), {
      error: 'Autenticação indisponível. Tente novamente mais tarde.',
    });
    assert.equal(body.includes('APP_PASSWORD_HASH'), false);
    assert.equal(body.includes('APP_SESSION_SECRET'), false);
    assert.equal(result.headers?.['Set-Cookie'], undefined);
  });
});
