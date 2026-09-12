import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');

test(
  'launcher de staging carrega a origem externa antes de iniciar o Playwright',
  { skip: process.platform === 'win32' ? 'fixture executável POSIX' : false },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aspen-staging-e2e-env-'));
    const configPath = path.join(directory, 'staging.env');
    const fakeNpx = path.join(directory, 'npx');
    const capturePath = path.join(directory, 'capture.json');

    try {
      await writeFile(
        configPath,
        [
          'STAGING_BASE_URL=https://preview.example.test',
          'STAGING_DATABASE_URL=postgresql://test:test@127.0.0.1:5432/staging_test',
          'STAGING_PG_SERVICE=staging-test',
          'E2E_USERNAME=operator',
          'E2E_PASSWORD=synthetic-password',
          'STAGING_E2E_USERNAME=operator',
          'KNOWN_POSTGRES_QUOTATION_ID=00000000-0000-4000-8000-000000000001',
          'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID=00000000-0000-4000-8000-000000000002',
          'STAGING_EGRESS_BLOCKED=1',
          'STAGING_FIXTURE_RESET=1',
        ].join('\n'),
        { mode: 0o600 }
      );
      await writeFile(
        fakeNpx,
        `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const selected = {
  APP_ENV: process.env.APP_ENV,
  EXTERNAL_WRITES_ENABLED: process.env.EXTERNAL_WRITES_ENABLED,
  STAGING_BASE_URL: process.env.STAGING_BASE_URL,
  E2E_USERNAME: process.env.E2E_USERNAME,
};
writeFileSync(process.env.CAPTURE_PATH, JSON.stringify(selected));
process.exit(selected.STAGING_BASE_URL === 'https://preview.example.test' ? 0 : 42);
`,
        { mode: 0o755 }
      );
      await chmod(fakeNpx, 0o755);

      const cleanEnv = {
        PATH: `${directory}${path.delimiter}${process.env.PATH || ''}`,
        HOME: directory,
        CUTOVER_ENV_FILE: configPath,
        CAPTURE_PATH: capturePath,
      };
      const result = spawnSync(process.execPath, ['scripts/run-staging-e2e.mjs'], {
        cwd: PROJECT_ROOT,
        env: cleanEnv,
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr || result.stdout);
      const captured = JSON.parse(await import('node:fs').then(({ readFileSync }) => readFileSync(capturePath, 'utf8')));
      assert.deepEqual(captured, {
        APP_ENV: 'preview',
        EXTERNAL_WRITES_ENABLED: '0',
        STAGING_BASE_URL: 'https://preview.example.test',
        E2E_USERNAME: 'operator',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
