import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { PassThrough } from 'node:stream';

import {
  MAX_PASSWORD_BYTES,
  PASSWORD_DERIVED_KEY_BYTES,
  PASSWORD_SALT_BYTES,
  createPasswordHash,
  parsePasswordHash,
  verifyPassword,
} from '../../api/_shared/password.js';
import { main as hashAppPassword } from '../../scripts/hash-app-password.mjs';

function randomPassword(): string {
  return randomBytes(24).toString('base64url');
}

describe('scrypt password hashes', () => {
  it('creates the exact versioned format and verifies only the supplied password', async () => {
    const password = randomPassword();
    const differentPassword = randomPassword();
    const hash = await createPasswordHash(password);

    assert.match(hash, /^scrypt:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.equal(hash.includes(password), false);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword(differentPassword, hash), false);

    const parsed = parsePasswordHash(hash);
    assert.ok(parsed);
    assert.equal(parsed.salt.length, PASSWORD_SALT_BYTES);
    assert.equal(parsed.derivedKey.length, PASSWORD_DERIVED_KEY_BYTES);
  });

  it('rejects malformed hashes and bounded-invalid password input without throwing', async () => {
    const password = randomPassword();
    const malformed = [
      '',
      'scrypt:v0:abc:def',
      'scrypt:v1:not-base64!:also-not-base64!',
      'scrypt:v1:YWJj:YWJj:extra',
      `scrypt:v1:${'a'.repeat(300)}:${'b'.repeat(300)}`,
    ];

    for (const hash of malformed) {
      assert.equal(parsePasswordHash(hash), null);
      assert.equal(await verifyPassword(password, hash), false);
    }

    const validHash = await createPasswordHash(password);
    assert.equal(await verifyPassword('', validHash), false);
    assert.equal(await verifyPassword('x'.repeat(MAX_PASSWORD_BYTES + 1), validHash), false);
  });
});

describe('hash-app-password generator', () => {
  it('writes only a valid versioned hash to stdout in non-interactive mode', async () => {
    const password = randomPassword();
    const input = new PassThrough();
    const output = new PassThrough();
    const promptOutput = new PassThrough();
    let generated = '';

    output.setEncoding('utf8');
    output.on('data', (chunk) => {
      generated += chunk;
    });

    const command = hashAppPassword({ input, output, promptOutput });
    input.end(`${password}\n`);

    assert.equal(await command, 0);
    const hash = generated.trim();
    assert.match(hash, /^scrypt:v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    assert.equal(generated.includes(password), false);
    assert.equal(await verifyPassword(password, hash), true);
    assert.equal(await verifyPassword(randomPassword(), hash), false);
  });
});
