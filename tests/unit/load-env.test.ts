import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadLocalEnv, localEnvPaths } from '../../scripts/load-env.mjs';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('local environment loader', () => {
  it('loads configured external file without overwriting injected values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'aspen-env-'));
    temporaryDirectories.push(directory);
    const envFile = join(directory, '.env');
    writeFileSync(envFile, 'DATABASE_URL=from-file\nAPP_SESSION_SECRET=from-file\n');
    const env: Record<string, string | undefined> = {
      DOTENV_CONFIG_PATH: envFile,
      DATABASE_URL: '',
    };

    assert.equal(loadLocalEnv(env), envFile);
    assert.equal(env.DATABASE_URL, '');
    assert.equal(env.APP_SESSION_SECRET, 'from-file');
  });

  it('tries the XDG config file before the root fallback', () => {
    assert.deepEqual(localEnvPaths({ XDG_CONFIG_HOME: '/tmp/config' }), [
      '/tmp/config/aspen-dashboard/.env',
      '.env',
    ]);
  });
});
