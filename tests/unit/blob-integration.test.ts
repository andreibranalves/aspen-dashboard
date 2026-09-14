import assert from 'node:assert/strict';
import test from 'node:test';
import { getBlobConfig } from '../../api/_infrastructure/integrations/blob/config.js';
import { getBlobClient } from '../../api/_infrastructure/integrations/blob/client.js';

test('normalizes active Blob credentials on every call', () => {
  const env: NodeJS.ProcessEnv = {
    BLOB_READ_WRITE_TOKEN: ' default-token ',
    BLOB_STORE_ID: ' default-store ',
    VERCEL_OIDC_TOKEN: ' oidc-token ',
  };
  assert.deepEqual(getBlobConfig(env), {
    token: 'default-token',
    storeId: 'default-store',
    oidcToken: 'oidc-token',
  });
  env.BLOB_STORE_ID = ' second-store ';
  assert.equal(getBlobConfig(env).storeId, 'second-store');
});

test('Preview blocks deletion and token issuance before the SDK, including contradictory env', async () => {
  for (const env of [
    {},
    { APP_ENV: 'preview', EXTERNAL_WRITES_ENABLED: '0' },
    { APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1', VERCEL_ENV: 'preview' },
  ]) {
    let writes = 0;
    const client = getBlobClient({
      del: async () => { writes += 1; },
      handleUpload: async () => { writes += 1; return {} as never; },
    }, env);
    await assert.rejects(client.del('https://blob.example/a'), { statusCode: 503 });
    await assert.rejects(client.handleUpload({} as never), { statusCode: 503 });
    assert.equal(writes, 0);
  }
});

test('allows minimal SDK operation injection', async () => {
  const calls: string[] = [];
  const client = getBlobClient({
    head: async (url) => {
      calls.push(`head:${url}`);
      return {} as never;
    },
    del: async (url) => {
      calls.push(`del:${String(url)}`);
    },
    handleUpload: async () => {
      calls.push('upload');
      return {} as never;
    },
  }, { APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' });
  await client.head('https://blob.example/a');
  await client.del('https://blob.example/a');
  await client.handleUpload({} as never);
  assert.deepEqual(calls, ['head:https://blob.example/a', 'del:https://blob.example/a', 'upload']);
});
