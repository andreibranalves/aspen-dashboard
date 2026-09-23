// Isolamento de ambiente do E2E integrado local (HTTP -> PostgreSQL -> UI).
//
// O runner integrado acrescenta instrumentação de egress à sanitização local:
// um listener de browser NÃO enxerga egress do servidor. Esta camada monta um
// ambiente explicitamente não-operacional ANTES de qualquer spawn: remove
// credenciais de integração, fixa APP_ENV não-produção,
// EXTERNAL_WRITES_ENABLED=0, força DOTENV_CONFIG_PATH=/dev/null, exige um
// PostgreSQL descartável em loopback e FORÇA o alvo HTTP para loopback derivado
// de PLAYWRIGHT_PORT — nunca herda BASE_URL/PREVIEW_BASE_URL.
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { isDisposablePostgresUrl } from '../test-postgres.mjs';
import { resolveE2eBaseUrl } from './e2e-mode.mjs';

export const SAFE_E2E_MARKER = 'SAFE_E2E';
export const SAFE_E2E_EGRESS_LOG_VAR = 'SAFE_E2E_EGRESS_LOG';
export const SAFE_E2E_RUN_ID_VAR = 'SAFE_E2E_RUN_ID';
/**
 * Configuração Playwright dedicada à suíte integrada. É a única que seleciona
 * SAFE_E2E_SPECS e só carrega com a capability viva do run (ver
 * scripts/lib/safe-e2e-capability.mjs). O playwright.config.js comum NUNCA a
 * usa e sempre exclui SAFE_E2E_SPECS, independentemente do ambiente.
 */
export const SAFE_E2E_CONFIG_FILE = 'playwright.safe.config.js';
/**
 * Process entry the run's HTTP API responses actually come from. The guard is
 * preloaded via NODE_OPTIONS into every Node process (npx, Playwright, the Vite
 * dev server), so an unqualified `guard_initialized` could belong to any of
 * them. Evidence only counts when a marker comes from the app server process
 * that serves the integrated HTTP requests.
 */
export const SAFE_E2E_SERVER_ENTRY = 'app-server.mjs';
export const SAFE_E2E_APP_ENV = 'test';
export const SAFE_E2E_DOTENV_PATH = '/dev/null';
export const MIN_INGEST_TOKEN_BYTES = 32;
export const SAFE_E2E_DEFAULT_PORT = 5173;

/**
 * Fonte única da suíte integrada que exige o ponto de entrada seguro. É
 * consumida por scripts/run-safe-e2e.mjs (seleção explícita), por
 * playwright.safe.config.js (testMatch) e por playwright.config.js (exclusão
 * incondicional do discovery comum). O spec só é descoberto pela config
 * dedicada, que exige a capability viva criada pelo runner: `test:e2e` genérico
 * e `--grep @smoke` nunca o importam, e a invocação direta e não segura falha
 * fechada ("No tests found" no Playwright, ou a guarda do próprio spec como
 * defesa em profundidade).
 */
export const SAFE_E2E_SPECS = Object.freeze(['tests/commercial-queue-integrated.spec.js']);

const HERE = dirname(fileURLToPath(import.meta.url));
export const NETWORK_GUARD_PATH = resolve(HERE, 'safe-e2e-network-guard.mjs');

/**
 * Chaves cujo valor nunca pode chegar ao servidor de teste: credenciais de
 * transporte (WhatsApp), e-mail, IA, storage, KV, Ads, Typebot/Meta, URLs de
 * bancos operacionais, tokens de ingestão (inclusive o anterior, que a
 * machine-auth ainda aceita) e URLs de deployment/modos de E2E. O casamento por
 * prefixo falha fechada para novas chaves com o mesmo prefixo.
 */
const OPERATIONAL_KEY_PATTERNS = [
  /^EVOLUTION_/,
  /^OPENROUTER_/,
  /^RESEND_/,
  /^SMTP_/,
  /^BLOB_/,
  /^QUOTATION_BLOB_/,
  /^KV_/,
  /^SANITY_/,
  /^GOOGLE_(?:ADS|DATA_MANAGER)_/,
  /^TYPEBOT_/,
  /^META_(?:CAPI|PIXEL)_/,
  /^QUOTE_LEADS_/,
  // QStash publication and cron/worker auth. These are real credentials and
  // remote targets consumed by the follow-up pipeline and delivery workers.
  /^QSTASH_/,
  /^CRON_/,
  /^QUOTATION_FOLLOW_UP_/,
  // The browser extension origin alters the server CORS headers.
  /^WHATSAPP_CONTEXT_EXTENSION_/,
  // Operational database targets and one-off operator modes.
  /^(?:STAGING|PRODUCTION|RESTORE)_DATABASE_URL$/,
  /^RESTORE_/,
  /^MIGRATION_/,
  /^CLIENT_CONSOLIDATION_/,
  /^CLEANUP_/,
  /^LITE_BASELINE_/,
  /^PG[A-Z0-9_]*$/,
  // Plataforma de deployment: `VERCEL` muda o ramo do Vite de dev para servir
  // artefatos de `public/`; `URL`/`DEPLOY_PRIME_URL` são consumidos como origem
  // pública. Nenhum modo/origem operacional pode chegar ao servidor de teste.
  /^VERCEL(?:_|$)/,
  /^DEPLOY_PRIME_URL$/,
  /^URL$/,
  /^CUTOVER_/,
  /^APP_(?:PASSWORD_HASH|SESSION_SECRET)$/,
  /^E2E_(?:USERNAME|PASSWORD)$/,
  // npm config aliases (case-insensitive) are not test plumbing. `node-options`
  // replaces the child's NODE_OPTIONS, dropping the egress guard before the app
  // server starts, and `userconfig` can point npm at a hostile `.npmrc`; both
  // arrive as `npm_config_*`. `NPM_TOKEN` is a registry credential (and feeds
  // `${NPM_TOKEN}` interpolation in `.npmrc`). All are discarded fail-closed.
  /^npm_config_/i,
  /^NPM_TOKEN$/i,
  // Alvos remotos e modos de execução: o E2E seguro deriva o próprio loopback.
  /^(?:BASE_URL|PREVIEW_BASE_URL|DEPLOYMENT_URL|PREVIEW_DEPLOYMENT_URL|PREVIOUS_PRODUCTION_DEPLOYMENT_URL|POST_CLEANUP_PREVIEW_URL|CANARY_BASE_URL|CANARY_PUBLIC_QUOTATION_URL|KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL)$/,
];

/**
 * Allowlist of non-operational process/runtime/test variables allowed into the
 * integrated test server. Isolation is fail-closed: anything not listed is
 * dropped, so a newly introduced operational key cannot leak by default. The
 * denylist above remains as an explicit, auditable classification used by the
 * regression tests and as defense-in-depth for replaced keys.
 */
const ALLOWED_RUNTIME_KEYS = new Set([
  // Process / OS essentials.
  'PATH',
  'Path',
  'HOME',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TZ',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'COLORTERM',
  'FORCE_COLOR',
  'NO_COLOR',
  'PWD',
  'OLDPWD',
  'SHLVL',
  'CI',
  'HOSTNAME',
  'OSTYPE',
  'MACHTYPE',
  'INIT_CWD',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  // Windows process essentials (ignored on Linux but harmless to preserve).
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'windir',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'PROGRAMW6432',
  'COMMONPROGRAMFILES',
  'OS',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'PROCESSOR_IDENTIFIER',
  // Node.js runtime.
  'NODE_ENV',
  'NODE_PATH',
  // Browsers / Playwright.
  'PLAYWRIGHT_PORT',
  'PLAYWRIGHT_BROWSERS_PATH',
  'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD',
  // Disposable test stack knobs consumed by the integrated server.
  'TEST_DATABASE_URL',
  'DATABASE_URL',
  'PORT',
  'API_PORT',
  'HOST',
  'APP_ENV',
  'APP_AUTH_BYPASS',
  'EXTERNAL_WRITES_ENABLED',
  'DOTENV_CONFIG_PATH',
  'QUOTE_LEADS_INGEST_TOKEN',
  'VITE_API_PROXY_TARGET',
  'SAFE_E2E',
  'SAFE_E2E_EGRESS_LOG',
  'SAFE_E2E_RUN_ID',
]);

const ALLOWED_RUNTIME_PATTERNS = [
  // Locale variants and run-scoped/Playwright plumbing. npm is intentionally
  // absent: `npm_config_*`, `NPM_TOKEN` and unknown `npm_*` aliases are dropped
  // by the fail-closed default (and classified as operational above).
  /^LC_[A-Z]+$/,
  /^PLAYWRIGHT_/,
  /^SAFE_E2E_/,
];

export function isAllowedRuntimeKey(key) {
  return (
    ALLOWED_RUNTIME_KEYS.has(key) || ALLOWED_RUNTIME_PATTERNS.some((pattern) => pattern.test(key))
  );
}

export function isOperationalKey(key) {
  return OPERATIONAL_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * argv for the real `npx` invocation that launches Playwright under the
 * dedicated config. The explicit `--node-options` config is the failsafe that
 * makes the guard survive npm's environment rewriting: npm assigns
 * `env.NODE_OPTIONS` from this config for every child, and CLI config outranks
 * `npm_config_node_options`/`.npmrc`, so a poisoned npm chain cannot drop the
 * guard from the app-server/Playwright descendants. `--no-install` keeps npx
 * from resolving or downloading anything. `--config` selects the only config
 * that can discover SAFE_E2E_SPECS.
 */
export function safeE2eNpxArgs(specs = SAFE_E2E_SPECS) {
  return [
    '--node-options',
    `--import ${NETWORK_GUARD_PATH}`,
    '--no-install',
    'playwright',
    'test',
    '--config',
    SAFE_E2E_CONFIG_FILE,
    ...specs,
  ];
}

/** Um token sintético válido (>= 32 bytes), nunca lido do ambiente operacional. */
export function syntheticIngestToken() {
  return `safe-e2e-${randomBytes(32).toString('hex')}`;
}

export function assertDisposableLoopbackDatabaseUrl(raw, label) {
  const value = String(raw || '').trim();
  if (!value) {
    throw new Error(
      `${label} é obrigatória para o E2E integrado seguro (PostgreSQL descartável em loopback).`
    );
  }
  if (!isDisposablePostgresUrl(value)) {
    throw new Error(
      `${label} deve apontar para um PostgreSQL descartável em localhost/127.0.0.1/[::1]; ` +
        'o E2E seguro se recusou a usar um alvo remoto ou malformado.'
    );
  }
  return value;
}

/** Porta de loopback validada; nunca aceita host ou URL de deployment. */
export function safeE2ePort(baseEnv = process.env) {
  const raw = String(baseEnv.PLAYWRIGHT_PORT ?? '').trim();
  if (!raw) return SAFE_E2E_DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PLAYWRIGHT_PORT deve ser uma porta TCP inteira entre 1 e 65535.');
  }
  return port;
}

export function isLoopbackOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('127.'))
  );
}

/**
 * Constrói o ambiente do E2E integrado seguro. `baseEnv` é o ambiente atual
 * (possivelmente "envenenado" com credenciais reais); a saída nunca as contém.
 */
export function buildSafeE2eEnvironment(baseEnv = process.env, options = {}) {
  const databaseUrl = assertDisposableLoopbackDatabaseUrl(
    baseEnv.TEST_DATABASE_URL,
    'TEST_DATABASE_URL'
  );
  const configured = String(baseEnv.DATABASE_URL || '').trim();
  if (configured && configured !== databaseUrl) {
    throw new Error('DATABASE_URL deve coincidir com TEST_DATABASE_URL descartável no E2E seguro.');
  }

  const port = safeE2ePort(baseEnv);
  const isolated = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    // Preloads herdados não podem desligar a guarda; só o NODE_OPTIONS montado abaixo vale.
    // Fail-closed: só entram chaves explicitamente não-operacionais; qualquer
    // chave nova (operacional ou não) é descartada por padrão.
    if (key === 'NODE_OPTIONS' || isOperationalKey(key) || !isAllowedRuntimeKey(key)) continue;
    isolated[key] = value;
  }

  isolated.NODE_ENV = 'test';
  isolated.APP_ENV = SAFE_E2E_APP_ENV;
  isolated.EXTERNAL_WRITES_ENABLED = '0';
  isolated.APP_AUTH_BYPASS = 'true';
  isolated.DOTENV_CONFIG_PATH = SAFE_E2E_DOTENV_PATH;
  isolated.TEST_DATABASE_URL = databaseUrl;
  isolated.DATABASE_URL = databaseUrl;
  isolated[SAFE_E2E_MARKER] = '1';
  isolated.PLAYWRIGHT_PORT = String(port);
  // O alvo efetivo vem SEMPRE daqui; nenhuma URL herdada sobrevive. O Vite de
  // desenvolvimento escuta em `localhost` (convenção do e2e-mode.mjs), então o
  // alvo forçado é esse loopback na porta validada.
  isolated.BASE_URL = `http://localhost:${port}`;
  isolated.QUOTE_LEADS_INGEST_TOKEN = syntheticIngestToken();

  const egressLog =
    options.egressLog ||
    String(baseEnv[SAFE_E2E_EGRESS_LOG_VAR] || '').trim() ||
    join(tmpdir(), `safe-e2e-egress-${randomBytes(8).toString('hex')}.log`);
  isolated[SAFE_E2E_EGRESS_LOG_VAR] = egressLog;
  // Run-scoped nonce: a marker written by a previous run (or an unrelated
  // process) cannot satisfy this run's audit even if the log path is reused.
  const runId = String(options.runId || '').trim() || randomBytes(16).toString('hex');
  isolated[SAFE_E2E_RUN_ID_VAR] = runId;
  // NODE_OPTIONS é reconstruído do zero: nenhum preload herdado pode desarmar a guarda.
  isolated.NODE_OPTIONS = `--import ${NETWORK_GUARD_PATH}`;

  const resolvedTarget = resolveE2eBaseUrl(isolated, { port });
  if (!isLoopbackOrigin(resolvedTarget)) {
    throw new Error('O alvo HTTP resolvido do E2E seguro não é loopback; execução recusada.');
  }

  return { env: isolated, databaseUrl, egressLog, runId, baseUrl: resolvedTarget, port };
}

/** Invariantes verificadas pelo spec antes de qualquer request HTTP. */
export function safeE2eEnvironmentIsValid(env = process.env) {
  if (
    env[SAFE_E2E_MARKER] !== '1' ||
    env.APP_ENV !== SAFE_E2E_APP_ENV ||
    env.EXTERNAL_WRITES_ENABLED !== '0' ||
    env.DOTENV_CONFIG_PATH !== SAFE_E2E_DOTENV_PATH ||
    !env[SAFE_E2E_EGRESS_LOG_VAR] ||
    !env[SAFE_E2E_RUN_ID_VAR]
  ) {
    return false;
  }
  const port = Number(String(env.PLAYWRIGHT_PORT ?? '').trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (String(env.PREVIEW_BASE_URL || '').trim()) return false;
  // BASE_URL só é aceita quando é exatamente o loopback forçado pela porta
  // validada; qualquer outro alvo herdado reprova o ambiente.
  const expected = `http://localhost:${port}`;
  if (String(env.BASE_URL || '').trim() && String(env.BASE_URL).trim() !== expected) return false;
  let resolved;
  try {
    resolved = resolveE2eBaseUrl({ ...env, BASE_URL: expected }, { port });
  } catch {
    return false;
  }
  return isLoopbackOrigin(resolved);
}

function baseName(value) {
  const parts = String(value || '')
    .replace(/\\/g, '/')
    .split('/');
  return parts[parts.length - 1] || '';
}

/**
 * Lê a evidência escrita pela guarda. Distingue "sem tráfego" de "guarda
 * ausente/quebrada": exige um marcador de inicialização atribuído ao processo
 * do servidor HTTP (`serverEntry`) e à execução corrente (`runId`), e conta
 * bloqueios e linhas ilegíveis (malformadas = falha fechada).
 */
export function auditSafeE2eEgressLog({ exists, content, runId, serverEntry } = {}) {
  if (!exists) {
    return {
      initialized: false,
      instrumented: false,
      blocked: 0,
      malformed: false,
      entries: 0,
    };
  }
  let malformed = false;
  let blocked = 0;
  let initialized = false;
  let instrumented = false;
  let entries = 0;
  for (const line of String(content || '').split('\n')) {
    if (!line.trim()) continue;
    entries += 1;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed = true;
      continue;
    }
    if (!parsed || typeof parsed !== 'object') {
      malformed = true;
      continue;
    }
    if (parsed.event === 'guard_initialized') {
      initialized = true;
      const matchesRun = !runId || parsed.runId === runId;
      const matchesServer = !serverEntry || baseName(parsed.entry) === serverEntry;
      if (matchesRun && matchesServer) instrumented = true;
    }
    if (parsed.event === 'blocked') blocked += 1;
  }
  return { initialized, instrumented, blocked, malformed, entries };
}

/**
 * Agregação fail-closed do status final do runner. `audit` descreve o log de
 * evidência da guarda: sem o marcador de inicialização a instrumentação não é
 * considerada ativa, e qualquer entrada bloqueada ou linha ilegível reprova o
 * run mesmo quando o Playwright passa.
 */
export function aggregateSafeE2eStatus({ playwrightStatus, audit }) {
  const failed = playwrightStatus === null || playwrightStatus !== 0;
  if (failed) return playwrightStatus === null ? 1 : playwrightStatus;
  if (!audit || !audit.instrumented || audit.malformed || audit.blocked > 0) return 1;
  return 0;
}
