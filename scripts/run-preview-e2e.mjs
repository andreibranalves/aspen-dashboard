#!/usr/bin/env node
// Launcher único do E2E controlado de Preview
// (`npm run test:e2e:preview`).
//
// Ordem fail-closed antes de qualquer spawn/request:
//   1. Carrega e reporta o contrato da operação a partir da origem externa.
//   2. Fixa APP_ENV=preview, EXTERNAL_WRITES_ENABLED=0 e DOTENV_CONFIG_PATH=/dev/null.
//   3. Executa o preflight de Preview e valida PREVIEW_BASE_URL.
//   4. Cria uma capability efêmera para esta config e lista de specs.
//   5. Entrega ao Playwright somente a origem, credenciais, atestações E2E e
//      os três valores da capability; DATABASE_URL/PRODUCTION_DATABASE_URL
//      ficam no executor do preflight.
//   6. Invoca apenas a lista controlada e repassa filtros úteis, sem permitir
//      uma config alternativa que amplie o discovery remoto.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { formatPreviewPreflight, runPreviewPreflight } from './preview-preflight.mjs';
import {
  fillFromExternalConfig,
  formatOperationEnvStatus,
  inspectOperationEnv,
} from './lib/operation-env.mjs';
import { PREVIEW_E2E_SPECS } from './lib/preview-e2e-specs.mjs';
import { SAFE_E2E_RUN_ID_VAR } from './lib/safe-e2e-env.mjs';
import {
  createSafeE2eCapability,
  deleteSafeE2eCapability,
  SAFE_E2E_CAPABILITY_PATH_VAR,
  SAFE_E2E_CAPABILITY_PROOF_VAR,
} from './lib/safe-e2e-capability.mjs';
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
  'VERCEL_AUTOMATION_BYPASS_SECRET',
  // SAFE_E2E_* names are reused internally for the ephemeral Preview runner
  // capability; they are not operational configuration exposed to the user.
  'SAFE_E2E_RUN_ID',
  'SAFE_E2E_CAPABILITY_PATH',
  'SAFE_E2E_CAPABILITY_PROOF',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
  'PREVIEW_EGRESS_BLOCKED',
  'PREVIEW_FIXTURE_RESET',
];

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
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index]);
    if (arg === '--list') continue;

    if (arg === '--grep' || arg === '--grep-invert') {
      const value = args[index + 1];
      if (value === undefined || String(value).length === 0 || String(value).startsWith('-')) {
        throw new Error(`Argumento do Playwright recusado: ${arg}`);
      }
      index += 1;
      continue;
    }

    if (arg.startsWith('--grep=') || arg.startsWith('--grep-invert=')) {
      const value = arg.slice(arg.indexOf('=') + 1);
      if (value.length === 0) throw new Error(`Argumento do Playwright recusado: ${arg}`);
      continue;
    }

    throw new Error(`Argumento do Playwright recusado: ${arg}`);
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
// Reutiliza a capability efêmera existente do E2E seguro, vinculada aqui ao
// config comum e à lista exata do Preview depois de todos os preflights.
const capability = createSafeE2eCapability({
  runId: randomBytes(16).toString('hex'),
  config: 'playwright.config.js',
  specs: PREVIEW_E2E_SPECS,
});

let result;
try {
  const childEnv = {
    ...process.env,
    [SAFE_E2E_RUN_ID_VAR]: capability.runId,
    [SAFE_E2E_CAPABILITY_PATH_VAR]: capability.path,
    [SAFE_E2E_CAPABILITY_PROOF_VAR]: capability.proof,
  };
  result = spawnSync('npx', args, {
    stdio: 'inherit',
    env: buildPlaywrightEnvironment(childEnv),
  });
} finally {
  deleteSafeE2eCapability(capability);
}
process.exit(result.status ?? 1);
