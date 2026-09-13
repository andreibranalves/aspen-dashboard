#!/usr/bin/env node
// Launcher único do E2E controlado de Preview
// (`npm run test:e2e:preview`).
//
// Ordem fail-closed antes de qualquer spawn/request:
//   1. Carrega e reporta o contrato da operação a partir da origem externa.
//   2. Fixa APP_ENV=preview, EXTERNAL_WRITES_ENABLED=0 e DOTENV_CONFIG_PATH=/dev/null.
//   3. Executa o preflight de Preview e valida PREVIEW_BASE_URL.
//   4. Entrega ao Playwright somente a origem, credenciais e atestações E2E;
//      DATABASE_URL/PRODUCTION_DATABASE_URL ficam no executor do preflight.
//   5. Invoca apenas a lista controlada e repassa filtros úteis, sem permitir
//      uma config alternativa que amplie o discovery remoto.

import { spawnSync } from 'node:child_process';
import { formatPreviewPreflight, runPreviewPreflight } from './preview-preflight.mjs';
import {
  fillFromExternalConfig,
  formatOperationEnvStatus,
  inspectOperationEnv,
} from './lib/operation-env.mjs';
import { PREVIEW_E2E_SPECS } from './lib/preview-e2e-specs.mjs';
import { resolveE2eBaseUrl } from './lib/e2e-mode.mjs';

const CHILD_ENV_KEYS = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TZ',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'CI',
  'NODE_ENV',
  'NODE_PATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  'APP_ENV',
  'EXTERNAL_WRITES_ENABLED',
  'DOTENV_CONFIG_PATH',
  'PREVIEW_BASE_URL',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'PREVIEW_E2E_USERNAME',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
  'PREVIEW_EGRESS_BLOCKED',
  'PREVIEW_FIXTURE_RESET',
];

const FORBIDDEN_PLAYWRIGHT_ARGS = /^(?:--config(?:=|$)|-c(?:$|=|[^-]))|^(?:--test-dir|--test-match|--test-ignore)(?:=|$)/;

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function buildPlaywrightEnvironment(env = process.env) {
  return Object.fromEntries(
    CHILD_ENV_KEYS.filter((key) => String(env[key] ?? '').trim().length > 0).map((key) => [
      key,
      env[key],
    ])
  );
}

function assertPlaywrightArgs(args) {
  const forbidden = args.find((arg) => FORBIDDEN_PLAYWRIGHT_ARGS.test(String(arg)));
  if (forbidden) {
    throw new Error(
      'configuração alternativa do Playwright recusada: o E2E de Preview mantém a config e a lista controlada.'
    );
  }
}

fillFromExternalConfig();

// Esses valores são fixados antes do preflight: uma configuração herdada não
// pode transformar este comando em execução de produção ou reativar writes.
process.env.APP_ENV = 'preview';
process.env.EXTERNAL_WRITES_ENABLED = '0';
process.env.DOTENV_CONFIG_PATH = '/dev/null';

const status = inspectOperationEnv('preview-e2e');
process.stdout.write(formatOperationEnvStatus(status));
if (!status.ok) {
  fail('Contrato preview-e2e incompleto; bloqueando o E2E de Preview.');
  process.exit(1);
}

try {
  const preflight = runPreviewPreflight(process.env);
  process.stdout.write(formatPreviewPreflight(preflight));
  // A config e os helpers usam PREVIEW_BASE_URL como única origem remota.
  // Esta checagem ocorre ainda no executor, antes de criar o filho.
  resolveE2eBaseUrl(process.env);
  assertPlaywrightArgs(process.argv.slice(2));
} catch (error) {
  fail(`FAIL preflight de Preview: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const args = ['playwright', 'test', ...PREVIEW_E2E_SPECS, ...process.argv.slice(2)];
const result = spawnSync('npx', args, {
  stdio: 'inherit',
  env: buildPlaywrightEnvironment(),
});
process.exit(result.status ?? 1);
