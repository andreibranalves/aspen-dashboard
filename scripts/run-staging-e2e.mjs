#!/usr/bin/env node
// Launcher único do E2E de staging (npm run test:e2e:staging).
//
// Ordem fail-closed antes de qualquer request HTTP:
//   1. Contrato de ambiente 'staging-e2e' via origem externa única
//      ($HOME/.config/aspen-dashboard/.env.local, sobrescrita por CUTOVER_ENV_FILE).
//      Saída contém somente nomes e estados — nunca valores.
//   2. Modo Preview fixado aqui e consumido pelo playwright.config.js,
//      que seleciona SOMENTE a suíte controlada de staging.
//
// Escopo deliberado: este comando NÃO é a prova de identidade do deployment.
// A prova remota (ambiente, writes-off, persistência aprovada) roda dentro de
// cada spec de staging ANTES da primeira mutação, via tests/support/staging-auth.js.

import { spawnSync } from 'node:child_process';
import {
  formatOperationEnvStatus,
  inspectOperationEnv,
} from './lib/operation-env.mjs';
import { STAGING_E2E_SPECS } from './lib/staging-e2e-specs.mjs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

// 1. Pré-voo redigido por operação (origem externa explícita).
const status = inspectOperationEnv('staging-e2e');
process.stdout.write(formatOperationEnvStatus(status));
if (!status.ok) {
  fail('Contrato staging-e2e incompleto; bloqueando o E2E de staging.');
  process.exit(1);
}

// 2. Modo Preview definido uma única vez (o config deriva dele).
process.env.APP_ENV = 'preview';
process.env.EXTERNAL_WRITES_ENABLED = '0';

// 3. Suíte exata da fonte única — nada genérico roda contra o staging.
const result = spawnSync('npx', ['playwright', 'test', ...STAGING_E2E_SPECS], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
