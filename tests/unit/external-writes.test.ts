import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertExternalWritesAllowed,
  isExternalWritesAllowed,
} from '../../api/_shared/external-writes.js';

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: 'development',
    EXTERNAL_WRITES_ENABLED: '0',
    ...overrides,
  };
}

describe('external writes guard', () => {
  it('permite somente production com flag explícita', () => {
    assert.equal(isExternalWritesAllowed(env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' })), true);
    assert.doesNotThrow(() => assertExternalWritesAllowed('evolution', env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1' })));
  });

  it('bloqueia Preview mesmo se a flag estiver ligada', () => {
    const preview = env({ APP_ENV: 'preview', EXTERNAL_WRITES_ENABLED: '1' });
    assert.equal(isExternalWritesAllowed(preview), false);
    assert.throws(
      () => assertExternalWritesAllowed('evolution', preview),
      (error: Error & { statusCode?: number; logMessage?: string }) => {
        assert.equal(error.statusCode, 503);
        assert.equal(error.message, 'Integrações externas desativadas neste ambiente.');
        assert.match(error.logMessage || '', /evolution/);
        return true;
      },
    );
  });

  it('a identidade Vercel veta variáveis de produção herdadas no Preview', () => {
    for (const VERCEL_ENV of ['preview', 'development', ' PREVIEW ']) {
      assert.equal(isExternalWritesAllowed(env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1', VERCEL_ENV })), false);
    }
    assert.equal(isExternalWritesAllowed(env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '1', VERCEL_ENV: 'production' })), true);
  });

  it('bloqueia development, ambiente ausente e flag diferente de 1', () => {
    for (const candidate of [
      env(),
      env({ APP_ENV: undefined, EXTERNAL_WRITES_ENABLED: '1' }),
      env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: undefined }),
      env({ APP_ENV: 'development', EXTERNAL_WRITES_ENABLED: '1' }),
      env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: '0' }),
      env({ APP_ENV: 'production', EXTERNAL_WRITES_ENABLED: 'true' }),
    ]) {
      assert.equal(isExternalWritesAllowed(candidate), false);
      assert.throws(() => assertExternalWritesAllowed('evolution', candidate), { statusCode: 503 });
    }
  });
});
