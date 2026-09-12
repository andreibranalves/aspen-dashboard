#!/usr/bin/env node
// Ponto de entrada ÚNICO e seguro do E2E integrado (npm run test:e2e:safe).
//
// Ordem fail-closed, antes de qualquer spawn:
//   1. Valida TEST_DATABASE_URL descartável em loopback.
//   2. Monta um ambiente não-operacional: remove credenciais de WhatsApp,
//      e-mail, IA, storage, KV, Ads, Typebot/Meta e tokens de ingestão; fixa
//      APP_ENV não-produção, EXTERNAL_WRITES_ENABLED=0 e
//      DOTENV_CONFIG_PATH=/dev/null; injeta token de ingestão sintético.
//   3. Reconstroi NODE_OPTIONS com a guarda de egress do servidor, sem
//      preservar preloads herdados, descarta aliases npm (`npm_config_*`,
//      `NPM_TOKEN`) que reescreveriam NODE_OPTIONS nos filhos, e FORÇA BASE_URL
//      para loopback derivado de PLAYWRIGHT_PORT (URL de deployment herdada
//      nunca é usada).
//   4. Invoca o Playwright via npx com `--node-options` fixando a guarda, de
//      modo que a configuração npm (inclusive `.npmrc`) não consiga removê-la
//      antes do servidor/browser subirem.
//
// O status final é fail-closed: um run do Playwright verde ainda falha quando a
// guarda de egress registrou bloqueio, quando o log de evidência está ilegível
// ou quando a instrumentação não se inicializou.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  aggregateSafeE2eStatus,
  auditSafeE2eEgressLog,
  buildSafeE2eEnvironment,
  NETWORK_GUARD_PATH,
  safeE2eNpxArgs,
  SAFE_E2E_EGRESS_LOG_VAR,
  SAFE_E2E_SERVER_ENTRY,
} from './lib/safe-e2e-env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
// Suíte DB-gated por padrão; specs extras (ex.: quotation-origin) entram por argumento.
const DEFAULT_SPECS = ['tests/commercial-queue-integrated.spec.js'];
const specs = process.argv.slice(2).filter((value) => !value.startsWith('-'));

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

let safe;
try {
  safe = buildSafeE2eEnvironment(process.env);
} catch (error) {
  fail(`FAIL E2E seguro: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

// Nomes e estados apenas — nunca valores nem URLs.
process.stdout.write(
  'E2E seguro: APP_ENV=test, EXTERNAL_WRITES_ENABLED=0, DOTENV_CONFIG_PATH=/dev/null, ' +
    `banco descartável presente, alvo loopback:${safe.port}, guarda de egress ativa.\n`
);

// Controle positivo: subprocesso com a mesma guarda tenta um destino
// não-loopback. Se a guarda estiver quebrada, o E2E inteiro é recusado.
// Log dedicado para não contaminar a evidência do run real.
const controlLog = `${safe.egressLog}.control`;
const control = spawnSync(
  process.execPath,
  [
    '--import',
    NETWORK_GUARD_PATH,
    '-e',
    `globalThis.fetch('https://control.invalid/egress').then(() => process.exit(9), (error) => process.exit(String(error.message).includes('SAFE_E2E_EGRESS_BLOCKED') ? 0 : 8));`,
  ],
  {
    cwd: PROJECT_ROOT,
    env: { ...safe.env, [SAFE_E2E_EGRESS_LOG_VAR]: controlLog },
    stdio: 'pipe',
  }
);
if (control.status !== 0) {
  fail(
    'FAIL E2E seguro: a guarda de egress não bloqueou um destino não-loopback (controle positivo).'
  );
  process.exit(1);
}

const result = spawnSync('npx', safeE2eNpxArgs(specs.length ? specs : DEFAULT_SPECS), {
  cwd: PROJECT_ROOT,
  env: safe.env,
  stdio: 'inherit',
});

// Evidência de egress do servidor: o log precisa comprovar a inicialização da
// guarda e nenhum destino não-loopback bloqueado. Linha ilegível também falha
// fechado, em vez de passar silenciosamente.
let audit;
try {
  const exists = existsSync(safe.egressLog);
  audit = auditSafeE2eEgressLog({
    exists,
    content: exists ? readFileSync(safe.egressLog, 'utf8') : '',
    runId: safe.runId,
    serverEntry: SAFE_E2E_SERVER_ENTRY,
  });
} catch {
  audit = { initialized: false, instrumented: false, blocked: 0, malformed: true, entries: 0 };
}

const status = aggregateSafeE2eStatus({
  playwrightStatus: result.status === null ? null : result.status,
  audit,
});
if (status !== 0) {
  if (!audit.instrumented) {
    if (audit.initialized) {
      fail(
        'FAIL E2E seguro: a guarda de egress não registrou inicialização no servidor HTTP testado; evidência inválida.'
      );
    } else {
      fail('FAIL E2E seguro: a guarda de egress não registrou inicialização; evidência inválida.');
    }
  } else if (audit.malformed) {
    fail('FAIL E2E seguro: log de evidência de egress ilegível.');
  } else if (audit.blocked > 0) {
    fail(`FAIL E2E seguro: ${audit.blocked} egress não-loopback bloqueado(s) no servidor.`);
  } else if (result.status !== 0) {
    fail(`FAIL E2E seguro: Playwright retornou status ${result.status}.`);
  }
}

process.exit(status);
