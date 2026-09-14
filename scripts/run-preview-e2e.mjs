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

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { formatPreviewPreflight, runPreviewPreflight } from './preview-preflight.mjs';
import {
  fillFromExternalConfig,
  formatOperationEnvStatus,
  inspectOperationEnv,
} from './lib/operation-env.mjs';
import { PREVIEW_E2E_SPECS } from './lib/preview-e2e-specs.mjs';
import { SAFE_E2E_RUN_ID_VAR } from './lib/safe-e2e-env.mjs';
import { restorePreviewQuotationFixture } from './lib/preview-quotation-fixture.mjs';
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

export function buildPlaywrightEnvironment(env = process.env) {
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

function assertCapabilityRemoved(capability) {
  if (capability?.path && existsSync(capability.path)) {
    throw new Error('capability do E2E de Preview permaneceu no disco.');
  }
  if (capability?.dir && existsSync(capability.dir)) {
    throw new Error('diretório da capability do E2E de Preview permaneceu no disco.');
  }
}

export async function runPreviewE2e({
  env = process.env,
  args = process.argv.slice(2),
  spawn = spawnSync,
  resetFixture = restorePreviewQuotationFixture,
  createCapability = createSafeE2eCapability,
  deleteCapability = deleteSafeE2eCapability,
  runIdFactory = () => randomBytes(16).toString('hex'),
  inspectEnv = (operationEnv) => inspectOperationEnv('preview-e2e', { env: operationEnv }),
  preflight = runPreviewPreflight,
  formatStatus = formatOperationEnvStatus,
  formatPreflight = formatPreviewPreflight,
  resolveBaseUrl = resolveE2eBaseUrl,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  // These values are fixed before the preflight: inherited configuration cannot
  // turn this command into a production run or re-enable writes.
  const effectiveEnv = {
    ...env,
    APP_ENV: 'preview',
    EXTERNAL_WRITES_ENABLED: '0',
    DOTENV_CONFIG_PATH: '/dev/null',
  };
  const writeError = (message) => stderr.write(`${message}\n`);
  const writeOutput = (message) => stdout.write(message);

  const status = inspectEnv(effectiveEnv);
  writeOutput(formatStatus(status));
  if (!status.ok) {
    writeError('Contrato preview-e2e incompleto; bloqueando o E2E de Preview.');
    return 1;
  }

  try {
    writeOutput(formatPreflight(preflight(effectiveEnv)));
    // The config and helpers use PREVIEW_BASE_URL as the only remote origin.
    // This check still happens in the executor, before creating the child.
    resolveBaseUrl(effectiveEnv);
    assertPlaywrightArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'falha não classificada';
    writeError(`FAIL preflight de Preview: ${message}`);
    return 1;
  }

  const listOnly = args.includes('--list');
  if (!listOnly) {
    try {
      await resetFixture(effectiveEnv);
    } catch {
      writeError('FAIL pre-reset da fixture Preview.');
      return 1;
    }
  }

  const playwrightArgs = ['playwright', 'test', ...PREVIEW_E2E_SPECS, ...args];
  // Reuse the existing ephemeral safe-E2E capability, bound here to the common
  // config and exact Preview spec list after all preflights and pre-reset.
  let capability;
  let playwrightExitCode;
  let postResetFailed = false;
  let capabilityCleanupFailed = false;
  try {
    capability = createCapability({
      runId: runIdFactory(),
      config: 'playwright.config.js',
      specs: PREVIEW_E2E_SPECS,
    });
    const childEnv = {
      ...effectiveEnv,
      [SAFE_E2E_RUN_ID_VAR]: capability.runId,
      [SAFE_E2E_CAPABILITY_PATH_VAR]: capability.path,
      [SAFE_E2E_CAPABILITY_PROOF_VAR]: capability.proof,
    };
    try {
      const result = spawn('npx', playwrightArgs, {
        stdio: 'inherit',
        env: buildPlaywrightEnvironment(childEnv),
      });
      playwrightExitCode = result?.status ?? 1;
    } catch {
      writeError('FAIL execução do Playwright de Preview.');
      playwrightExitCode = 1;
    } finally {
      try {
        deleteCapability(capability);
        assertCapabilityRemoved(capability);
      } catch {
        capabilityCleanupFailed = true;
        writeError('FAIL remoção da capability do E2E de Preview.');
      }
    }
  } catch {
    writeError('FAIL preparação da capability do E2E de Preview.');
    playwrightExitCode = 1;
  }

  if (!listOnly) {
    try {
      await resetFixture(effectiveEnv);
    } catch {
      postResetFailed = true;
      writeError('FAIL post-reset da fixture Preview.');
    }
  }

  if (postResetFailed || capabilityCleanupFailed) return 1;
  return playwrightExitCode ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fillFromExternalConfig();
  runPreviewE2e().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    process.stderr.write('FAIL execução do runner de Preview.\n');
    process.exitCode = 1;
  });
}
