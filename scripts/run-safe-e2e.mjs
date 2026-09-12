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
//   4. Cria uma capability efêmera, privada e atribuída a este run (arquivo +
//      prova aleatória) e a injeta no ambiente do filho. A config dedicada
//      (playwright.safe.config.js) e a guarda do spec só carregam com ela.
//   5. Invoca o Playwright via npx com `--node-options` fixando a guarda e
//      `--config` da config dedicada, de modo que a configuração npm (inclusive
//      `.npmrc`) não consiga remover a guarda antes do servidor/browser subirem.
//
// O status final é fail-closed: um run do Playwright verde ainda falha quando a
// guarda de egress registrou bloqueio, quando o log de evidência está ilegível
// ou quando a instrumentação não se inicializou. A capability é revogada em
// qualquer desfecho (sucesso, falha do Playwright, falha de auditoria, exceção
// ou sinal). O encerramento do processo lançado é best-effort: sinaliza apenas o
// filho direto/grupo conhecido enquanto o ChildProcess comprova que ele está
// vivo, espera um tempo limitado e encerra. Nunca persegue descendentes nem
// reusa PID/PGID de um filho já fechado; um descendente destacado pode
// sobreviver. Sem nunca expor prova ou caminho em logs.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  aggregateSafeE2eStatus,
  auditSafeE2eEgressLog,
  buildSafeE2eEnvironment,
  NETWORK_GUARD_PATH,
  SAFE_E2E_SPECS,
  safeE2eNpxArgs,
  SAFE_E2E_EGRESS_LOG_VAR,
  SAFE_E2E_SERVER_ENTRY,
} from './lib/safe-e2e-env.mjs';
import {
  createSafeE2eCapability,
  deleteSafeE2eCapability,
  SAFE_E2E_CAPABILITY_PATH_VAR,
  SAFE_E2E_CAPABILITY_PROOF_VAR,
} from './lib/safe-e2e-capability.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const DEFAULT_SPECS = [...SAFE_E2E_SPECS];

function fail(message) {
  process.stderr.write(`${message}\n`);
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

// A suíte é fixa (fonte única SAFE_E2E_SPECS) e a capability é vinculada a ela.
// Argumentos extras que não pertençam à lista são recusados em vez de ignorados.
const requested = process.argv.slice(2).filter((value) => !value.startsWith('-'));
const unexpected = requested.filter((spec) => !SAFE_E2E_SPECS.includes(spec));
if (unexpected.length) {
  fail('FAIL E2E seguro: a seleção de specs é fixa (SAFE_E2E_SPECS); argumentos extras recusados.');
  process.exit(1);
}

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

let capability;
function cleanupCapability() {
  deleteSafeE2eCapability(capability);
}

// --- Encerramento best-effort do processo lançado ---------------------------
// O Playwright é iniciado como líder de um NOVO grupo de processos (detached em
// POSIX). Playwright, por sua vez, sobe `webServer` e browsers com
// `detached: true`, criando grupos/sessões independentes que `kill(-pgid)` não
// alcança. Por design, NÃO há garantia de encerrar descendentes destacados.
//
// Contrato de finalização, idempotente:
//   1. revoga (apaga) a capability PRIMEIRO, em qualquer desfecho;
//   2. sinaliza SOMENTE o filho direto/grupo conhecido, e somente enquanto o
//      ciclo de vida do ChildProcess (exitCode/signalCode nulos) comprova que a
//      identidade ainda é a que lançamos — nunca um PID/PGID reutilizado;
//   3. espera um tempo limitado pelo fechamento do filho;
//   4. encerra com o status convencional do sinal (130/143) quando disponível,
//      ou com o status agregado, preservando a falha.
// Se o filho já fechou, nenhum sinal é enviado. Descendentes que entraram em
// novas sessões podem sobreviver; a revogação da capability não interrompe
// código que já a validou. Ambos são limites documentados em docs/safe-e2e.md.
const TERM_GRACE_MS = 5_000;

let activeChild = null;
let activeChildDetached = false;
let finalizePromise = null;
let capabilityRevoked = false;
let exitCode = null;

function revokeCapability() {
  if (capabilityRevoked) return;
  capabilityRevoked = true;
  cleanupCapability();
}

/** A identidade do filho só é confiável enquanto o ChildProcess não reportou saída. */
function knownChildIsAlive() {
  return Boolean(activeChild) && activeChild.exitCode === null && activeChild.signalCode === null;
}

/**
 * Sinaliza apenas o filho direto ou seu grupo, e apenas enquanto a identidade é
 * a do processo que lançamos. Um filho já fechado nunca é sinalizado, então um
 * PID/PGID reutilizado por terceiros não pode ser atingido por aqui.
 */
function signalKnownChild(signal) {
  if (!knownChildIsAlive()) return false;
  const pid = activeChild.pid;
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    if (activeChildDetached) process.kill(-pid, signal);
    else activeChild.kill(signal);
    return true;
  } catch {
    return false;
  }
}

/** Espera limitada pelo fechamento do filho; resolve true quando ele já fechou. */
function waitForKnownChildClose(timeoutMs) {
  const child = activeChild;
  if (!knownChildIsAlive()) return Promise.resolve(true);
  return new Promise((resolveClose) => {
    let settled = false;
    const finish = (closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolveClose(closed);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(!knownChildIsAlive()), timeoutMs);
    child.once('close', onClose);
    if (!knownChildIsAlive()) finish(true);
  });
}

async function doFinalize() {
  revokeCapability();
  signalKnownChild('SIGTERM');
  await waitForKnownChildClose(TERM_GRACE_MS);
  process.exit(exitCode === null ? 1 : exitCode);
}

function beginFinalize() {
  if (!finalizePromise) finalizePromise = doFinalize();
  return finalizePromise;
}

process.on('SIGINT', () => {
  exitCode = 130;
  void beginFinalize();
});
process.on('SIGTERM', () => {
  exitCode = 143;
  void beginFinalize();
});
process.on('uncaughtException', () => {
  if (exitCode === null) exitCode = 1;
  void beginFinalize();
});
process.on('unhandledRejection', () => {
  if (exitCode === null) exitCode = 1;
  void beginFinalize();
});
// Rede de segurança: a capability nunca sobrevive à saída do runner.
process.on('exit', revokeCapability);

function runPlaywright(env) {
  return new Promise((resolveRun) => {
    activeChildDetached = process.platform !== 'win32';
    const child = spawn('npx', safeE2eNpxArgs(DEFAULT_SPECS), {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit',
      // Grupo próprio: a sinalização de teardown nunca alcança o runner.
      detached: activeChildDetached,
    });
    activeChild = child;
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveRun(result);
    };
    child.on('error', (error) => settle({ status: null, error }));
    child.on('close', (status) => settle({ status }));
  });
}

let status;
capability = createSafeE2eCapability({ runId: safe.runId });
safe.env[SAFE_E2E_CAPABILITY_PATH_VAR] = capability.path;
safe.env[SAFE_E2E_CAPABILITY_PROOF_VAR] = capability.proof;

const result = await runPlaywright(safe.env);
if (exitCode !== null) {
  // Sinal durante o run: a árvore está sendo encerrada; não auditar.
  await beginFinalize();
}

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

status = aggregateSafeE2eStatus({
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

if (exitCode === null) exitCode = status ?? 1;
await beginFinalize();
