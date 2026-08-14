import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const requiredCutoverKeys = Object.freeze([
  'STAGING_BASE_URL',
  'STAGING_DATABASE_URL',
  'STAGING_PG_SERVICE',
  'STAGING_E2E',
  'E2E_USERNAME',
  'E2E_PASSWORD',
  'STAGING_E2E_USERNAME',
  'KNOWN_POSTGRES_QUOTATION_ID',
  'KNOWN_POSTGRES_SCRATCH_QUOTATION_ID',
  'STAGING_EXTERNAL_PROVIDERS_DISABLED',
  'STAGING_EGRESS_BLOCKED',
  'STAGING_FIXTURE_RESET',
  'CANARY_BASE_URL',
  'CANARY_PASSWORD',
  'CANARY_QUOTATION_ID',
  'CANARY_PUBLIC_QUOTATION_URL',
  'PRODUCTION_DATABASE_URL',
  'PRODUCTION_PG_SERVICE',
  'PRODUCTION_CANARY_PASSWORD',
  'KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID',
  'KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL',
  'PREVIEW_DEPLOYMENT_URL',
  'PREVIOUS_PRODUCTION_DEPLOYMENT_URL',
  'POST_CLEANUP_PREVIEW_URL',
]);

export function resolveCutoverEnvFiles(env = process.env) {
  const override = String(env.CUTOVER_ENV_FILE || '').trim();
  if (override) return [override];

  const configHome = String(env.XDG_CONFIG_HOME || '').trim() || join(env.HOME || homedir(), '.config');
  const configDir = join(configHome, 'aspen-dashboard');
  return [join(configDir, '.env.local'), join(configDir, '.env')];
}

export function readEnvKeys(filePath) {
  const keys = new Set();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = rawLine.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

export function inspectCutoverEnv({ env = process.env, exists = existsSync, readKeys = readEnvKeys } = {}) {
  const files = [];
  const availableKeys = new Set();

  for (const path of resolveCutoverEnvFiles(env)) {
    if (!exists(path)) {
      files.push({ path, status: 'missing' });
      continue;
    }

    try {
      for (const key of readKeys(path)) availableKeys.add(key);
      files.push({ path, status: 'present' });
    } catch {
      files.push({ path, status: 'unreadable' });
    }
  }

  const keys = requiredCutoverKeys.map((name) => ({
    name,
    status: availableKeys.has(name) ? 'present' : 'missing',
  }));
  const ok = files.every(({ status }) => status === 'present') && keys.every(({ status }) => status === 'present');
  return { files, keys, ok };
}

export function formatCutoverEnvStatus(result) {
  const lines = ['config files:'];
  for (const file of result.files) lines.push(`  ${file.path}: ${file.status}`);
  lines.push('keys:');
  for (const key of result.keys) lines.push(`  ${key.name}: ${key.status}`);
  return `${lines.join('\n')}\n`;
}

function isCli() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  const result = inspectCutoverEnv();
  process.stdout.write(formatCutoverEnvStatus(result));
  if (!result.ok) process.exitCode = 1;
}
