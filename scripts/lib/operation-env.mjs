// Contratos de ambiente por operação.
//
// Fonte normativa única para quais variáveis cada operação operacional exige.
// Regras:
// - Origem externa explícita e consistente: $HOME/.config/aspen-dashboard/.env.local
//   (ou .env), sobrescrita por CUTOVER_ENV_FILE. Arquivos do checkout nunca são origem.
// - Contratos separados por operação: uma migração não exige credenciais de canário/e-mail,
//   um canário não exige variáveis de backup/restore, e assim por diante.
// - Saída e erros contêm apenas NOMES de variáveis e estados, nunca valores.
// - Variáveis declaradas em `paths` referenciam arquivos que devem ser regulares com
//   modo 0600; a permissão é verificada no valor resolvido (processo ou arquivo externo).
// - Chaves com valores padrão no código (ex.: BACKUP_RETENTION_DAYS) são ajustes,
//   não requisitos, e ficam fora do contrato obrigatório.

import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * keys = exigidas para toda execução da operação.
 * anyOf = grupos alternativos: basta uma chave do grupo estar presente.
 * paths = chaves cujo valor é caminho de arquivo protegido (regular, 0600).
 */
export const OPERATION_ENV_CONTRACTS = Object.freeze({
  runtime: {
    description: 'Aplicação implantada (Vercel) e transporte de e-mail.',
    keys: [
      'APP_ENV',
      'EXTERNAL_WRITES_ENABLED',
      'RESEND_API_KEY',
      'RESEND_FROM_EMAIL',
      'QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT',
      'QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED',
      'QUOTATION_FOLLOW_UP_WORKER_URL',
    ],
    anyOf: [],
    paths: {},
  },
  migration: {
    description: 'Preflight e apply operacional de migrations.',
    keys: ['STAGING_DATABASE_URL', 'STAGING_PG_SERVICE', 'PRODUCTION_DATABASE_URL', 'PGSERVICEFILE', 'PGPASSFILE'],
    anyOf: [],
    paths: { PGSERVICEFILE: true, PGPASSFILE: true },
  },
  'staging-e2e': {
    description: 'E2E controlado contra o ambiente de staging.',
    keys: [
      'STAGING_BASE_URL',
      'STAGING_DATABASE_URL',
      'STAGING_PG_SERVICE',
      'E2E_USERNAME',
      'E2E_PASSWORD',
      'STAGING_E2E_USERNAME',
      'KNOWN_POSTGRES_QUOTATION_ID',
      'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
      'STAGING_EGRESS_BLOCKED',
      'STAGING_FIXTURE_RESET',
    ],
    anyOf: [],
    paths: {},
  },
  canary: {
    description: 'Canário PostgreSQL somente leitura e evidências de cutover.',
    keys: [
      'CANARY_BASE_URL',
      'CANARY_PASSWORD',
      'CANARY_QUOTATION_ID',
      'CANARY_PUBLIC_QUOTATION_URL',
      'PRODUCTION_CANARY_PASSWORD',
      'KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID',
      'KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL',
      'PREVIEW_DEPLOYMENT_URL',
      'PREVIOUS_PRODUCTION_DEPLOYMENT_URL',
      'POST_CLEANUP_PREVIEW_URL',
    ],
    anyOf: [],
    paths: {},
  },
  'backup-restore': {
    description: 'Backup, restore validado e preflight de capacidade. A URL de produção é exigida no validate; serviços nomeados protegem alvos quando configurados (guardas do próprio comando).',
    keys: ['DATABASE_URL'],
    anyOf: [['BLOB_READ_WRITE_TOKEN', 'QUOTATION_BLOB_READ_WRITE_TOKEN']],
    paths: {},
  },
  cleanup: {
    description: 'Limpeza de dados; identidade positiva do alvo e evidências de recuperação permanecem gates do próprio comando.',
    keys: ['DATABASE_URL', 'CLEANUP_TARGET_IDENTITY'],
    anyOf: [],
    paths: {},
  },
});

export function operationNames() {
  return Object.keys(OPERATION_ENV_CONTRACTS);
}

export function assertKnownOperation(operation) {
  if (!Object.hasOwn(OPERATION_ENV_CONTRACTS, operation)) {
    throw new Error(`Operação desconhecida: ${operation}. Use uma de ${operationNames().join(', ')}.`);
  }
}

/** Origem externa única de configuração operacional. */
export function resolveOperationConfigFiles(env = process.env) {
  const override = String(env.CUTOVER_ENV_FILE || '').trim();
  if (override) return [override];

  const configHome = String(env.XDG_CONFIG_HOME || '').trim() || join(env.HOME || homedir(), '.config');
  const configDir = join(configHome, 'aspen-dashboard');
  return [join(configDir, '.env.local'), join(configDir, '.env')];
}

function trimQuotes(value) {
  let out = value.trim();
  if ((out.startsWith('"') && out.endsWith('"')) || (out.startsWith("'") && out.endsWith("'"))) {
    out = out.slice(1, -1);
  }
  return out.trim();
}

function parseEnvFile(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && value.length > 0) values[key] = trimQuotes(value);
  }
  return values;
}

function readFileOrNothing(filePath, readFile) {
  try {
    return parseEnvFile(readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Relatório redigido (somente nomes e estados) da configuração efetiva de uma
 * operação. Valores presentes no processo vencem; a origem externa preenche
 * o restante. Estados possíveis por chave: present | missing | not-needed |
 * invalid-permission | unreadable.
 */
export function inspectOperationEnv(operation, { env = process.env, exists = existsSync, lstat = lstatSync, readFile = readFileSync } = {}) {
  assertKnownOperation(operation);
  const contract = OPERATION_ENV_CONTRACTS[operation];
  const paths = resolveOperationConfigFiles(env);

  // Origem externa única: primeiro arquivo existente na lista resolvida.
  const pathExists = (path) => {
    try {
      return Boolean(exists(path));
    } catch {
      return false;
    }
  };
  const loadedPath = paths.find(pathExists) ?? null;
  const fileValues = loadedPath ? readFileOrNothing(loadedPath, readFile) : null;

  // Valores vindos do processo têm precedência; o arquivo externo preenche o resto.
  const combined = {};
  for (const [key, value] of Object.entries(env)) {
    if (String(value ?? '').trim().length > 0) combined[key] = String(value);
  }
  for (const [key, value] of Object.entries(fileValues ?? {})) {
    if (!(key in combined)) combined[key] = value;
  }

  const hasValue = (key) => String(combined[key] ?? '').trim().length > 0;
  const missingRequired = contract.keys.filter((key) => !hasValue(key));
  const satisfiedAnyOf = new Set(
    contract.anyOf.filter((group) => group.some(hasValue)).flat(),
  );

  const allContractKeys = [...contract.keys, ...contract.anyOf.flat()];
  const keyStatus = {};
  for (const key of allContractKeys) {
    if (hasValue(key)) keyStatus[key] = 'present';
    else if (contract.anyOf.some((group) => group.includes(key))) {
      keyStatus[key] = satisfiedAnyOf.size > 0 ? 'not-needed' : 'missing';
    } else keyStatus[key] = 'missing';
  }

  for (const [key] of Object.entries(contract.paths)) {
    if (!hasValue(key)) continue;
    let stat;
    try {
      stat = lstat(resolve(combined[key]));
    } catch {
      keyStatus[key] = 'unreadable';
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
      keyStatus[key] = 'invalid-permission';
    }
  }

  const ok =
    missingRequired.length === 0 &&
    contract.anyOf.every((group) => group.some(hasValue)) &&
    Object.values(keyStatus).every((status) => status === 'present' || status === 'not-needed');

  return {
    operation,
    ok,
    files: paths.map((path) => ({ path, status: path === loadedPath ? 'present' : 'missing' })),
    keys: allContractKeys.map((name) => ({ name, status: keyStatus[name] })),
  };
}

/**
 * Núcleo de validação sobre uma visão de ambiente já completa (sem acessar
 * a origem externa). Usada por quem garante os valores antes da checagem.
 */
export function checkOperationEnv(operation, env = process.env, { lstat = lstatSync } = {}) {
  assertKnownOperation(operation);
  const contract = OPERATION_ENV_CONTRACTS[operation];

  const hasValue = (key) => String(env[key] ?? '').trim().length > 0;
  const missingRequired = contract.keys.filter((key) => !hasValue(key));

  const allContractKeys = [...contract.keys, ...contract.anyOf.flat()];
  const keyStatus = {};
  for (const key of allContractKeys) {
    keyStatus[key] = hasValue(key) ? 'present' : 'missing';
  }
  for (const [key] of Object.entries(contract.paths)) {
    if (!hasValue(key)) continue;
    let stat;
    try {
      stat = lstat(resolve(String(env[key])));
    } catch {
      keyStatus[key] = 'unreadable';
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
      keyStatus[key] = 'invalid-permission';
    }
  }

  const ok = missingRequired.length === 0 && Object.values(keyStatus).every((status) => status === 'present');
  return {
    operation,
    ok,
    keys: allContractKeys.map((name) => ({ name, status: keyStatus[name] })),
  };
}

export function formatOperationEnvStatus(result) {
  const lines = [`operacao: ${result.operation}`, 'config files:'];
  for (const file of result.files) lines.push(`  ${file.path}: ${file.status}`);
  lines.push('keys:');
  for (const key of result.keys) lines.push(`  ${key.name}: ${key.status}`);
  return `${lines.join('\n')}\n`;
}

/** Lista de problemas para falha fechada — apenas nomes e estados. */
export function missingOperationKeys(result) {
  return result.keys
    .filter(({ status }) => !['present', 'not-needed'].includes(status))
    .map(({ name, status }) => `${name} (${status})`);
}

/** Falha fechada com saída redigida. */
export function assertOperationEnv(operation, options = {}) {
  const result = inspectOperationEnv(operation, options);
  if (!result.ok) {
    throw new Error(
      `Ambiente incompleto para a operação ${operation}: ${missingOperationKeys(result).join(', ')}. ` +
        'Configure na origem externa única ($HOME/.config/aspen-dashboard ou CUTOVER_ENV_FILE).',
    );
  }
  return result;
}

/**
 * Preenche APENAS variáveis ausentes com valores da origem externa única.
 * Valores já presentes no processo vencem. Retorna o caminho carregado ou null.
 */
export function fillFromExternalConfig(env = process.env, { readFile = readFileSync } = {}) {
  const paths = resolveOperationConfigFiles(env);
  for (const filePath of paths) {
    const values = readFileOrNothing(filePath, readFile);
    if (values) {
      for (const [key, value] of Object.entries(values)) {
        if (!(String(env[key] ?? '').trim().length > 0)) env[key] = value;
      }
      return filePath;
    }
  }
  return null;
}

/**
 * Carrega a origem externa única e então valida o contrato da operação
 * sobre o ambiente resultante.
 */
export function loadOperationEnv(operation, { env = process.env, ...options } = {}) {
  assertKnownOperation(operation);
  fillFromExternalConfig(env, options);
  return assertOperationEnv(operation, { env, ...options });
}
