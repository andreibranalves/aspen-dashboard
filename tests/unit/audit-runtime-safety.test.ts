import assert from 'node:assert/strict';
import test from 'node:test';
import { getDatabase } from '../../api/_infrastructure/db/client.js';
import { handler as upload } from '../../api/_modules/communication-media-upload.js';
import { handler as media } from '../../api/_modules/communication-media.js';
import { createHttpError, isPublicHttpError } from '../../api/_shared/http-error.js';

// No connection: runtime must reject contradictory platform identity first.
test('database refuses Vercel Preview disguised as production before opening a pool', () => {
  const saved = { ...process.env };
  try {
    process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@127.0.0.1:1/unused';
    process.env.VERCEL_ENV = 'preview';
    for (const appEnv of ['', 'production', 'development']) {
      process.env.APP_ENV = appEnv;
      assert.throws(() => getDatabase(), /Preview exige APP_ENV=preview/);
    }
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

test('HTTP errors require the explicit public marker, not just a vendor status', () => {
  assert.equal(isPublicHttpError(createHttpError(409, 'Conflito.')), true);
  assert.equal(isPublicHttpError(Object.assign(new Error('secret'), { statusCode: 400 })), false);
  assert.equal(isPublicHttpError(Object.assign(createHttpError(400, 'secret'), { expose: false })), false);
});

test('upload and media never expose or log unknown provider errors', async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  const error = Object.assign(new Error('SENSITIVE_SENTINEL'), { statusCode: 400 });
  try {
    const response = await upload({ httpMethod: 'POST', body: '{}' }, {
      blobClient: {
        head: async () => { throw error; },
        del: async () => { throw error; },
        handleUpload: async () => { throw error; },
      },
    });
    assert.equal(response.statusCode, 503);
    assert.doesNotMatch(response.body, /SENSITIVE_SENTINEL/);
    const result = await media({ httpMethod: 'GET', queryStringParameters: {} }, {
      kvClient: { scan: async () => { throw error; } } as never,
    });
    assert.doesNotMatch(result.body, /SENSITIVE_SENTINEL/);
    assert.doesNotMatch(lines.join('\n'), /SENSITIVE_SENTINEL/);
  } finally {
    console.error = original;
  }
});
