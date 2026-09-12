// Capability de execução do E2E integrado seguro.
//
// O ambiente seguro COMPLETO (scripts/lib/safe-e2e-env.mjs) sozinho não prova
// que o runner criou o processo: qualquer shell pode escrever as mesmas
// variáveis públicas. A capability é um arquivo efêmero, privado e atribuído à
// execução (runId + config + specs) que o runner cria para o filho do Playwright
// e apaga ao final. A config dedicada e a guarda do spec a validam de forma
// síncrona, antes de qualquer spawn de servidor/browser ou request HTTP.
//
// Fronteira de ameaça: NÃO se afirma proteção contra um processo malicioso do
// mesmo usuário — quem consegue ler a prova também consegue forjar o arquivo. O
// objetivo é falhar fechado diante de execução acidental ou de um ambiente
// "seguro-aparente" (inclusive vindo de `.env`/`loadLocalEnv`) sem uma
// capability viva e correspondente criada pelo runner.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SAFE_E2E_CONFIG_FILE, SAFE_E2E_RUN_ID_VAR, SAFE_E2E_SPECS } from './safe-e2e-env.mjs';

export const SAFE_E2E_CAPABILITY_PATH_VAR = 'SAFE_E2E_CAPABILITY_PATH';
export const SAFE_E2E_CAPABILITY_PROOF_VAR = 'SAFE_E2E_CAPABILITY_PROOF';
export const SAFE_E2E_CAPABILITY_VERSION = 1;
/** Janela curta: a capability só precisa cobrir o carregamento da config e do spec. */
export const SAFE_E2E_CAPABILITY_TTL_MS = 5 * 60 * 1000;

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function hashProof(proof) {
  return createHash('sha256').update(String(proof)).digest('hex');
}

function capabilityConfigPath(config = SAFE_E2E_CONFIG_FILE) {
  return isAbsolute(config) ? resolve(config) : resolve(PROJECT_ROOT, config);
}

function assertPrivateFile(path) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw new Error('capability do E2E seguro ausente ou ilegível.');
  }
  if (stat.isSymbolicLink()) {
    throw new Error('capability do E2E seguro inválida (link simbólico recusado).');
  }
  if (!stat.isFile()) {
    throw new Error('capability do E2E seguro inválida (não é arquivo regular).');
  }
  if ((stat.mode & 0o077) !== 0) {
    throw new Error('capability do E2E seguro inválida (permissões não privadas).');
  }
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('capability do E2E seguro inválida (dono inesperado).');
  }
  const dirStat = statSync(dirname(path));
  if ((dirStat.mode & 0o077) !== 0) {
    throw new Error('capability do E2E seguro inválida (diretório não privado).');
  }
}

/**
 * Cria a capability efêmera do run. Retorna o caminho do arquivo e a prova
 * aleatória que só viaja no ambiente do filho. O arquivo guarda apenas o hash
 * da prova, nunca a prova em claro.
 */
export function createSafeE2eCapability({
  runId,
  config = SAFE_E2E_CONFIG_FILE,
  specs = SAFE_E2E_SPECS,
  ttlMs = SAFE_E2E_CAPABILITY_TTL_MS,
  dir,
} = {}) {
  const run = String(runId || '').trim();
  if (!run) throw new Error('capability do E2E seguro exige um runId não vazio.');
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error('capability do E2E seguro exige ttlMs positivo.');
  }

  const capabilityDir = mkdtempSync(join(dir || tmpdir(), 'aspen-safe-e2e-cap-'));
  chmodSync(capabilityDir, 0o700);
  const proof = randomBytes(32).toString('hex');
  const now = Date.now();
  const payload = {
    version: SAFE_E2E_CAPABILITY_VERSION,
    runId: run,
    config: capabilityConfigPath(config),
    specs: [...specs],
    proofHash: hashProof(proof),
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  const path = join(capabilityDir, 'capability.json');
  writeFileSync(path, JSON.stringify(payload), { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);

  return {
    path,
    proof,
    dir: capabilityDir,
    runId: run,
    config: payload.config,
    specs: payload.specs,
    expiresAt: payload.expiresAt,
  };
}

/**
 * Validação síncrona usada pela config dedicada e pela guarda do spec. Lança um
 * erro curto (sem valores sensíveis) quando a capability não existe, é pública,
 * malformada, de outro run/config/spec, expirada ou traz prova errada.
 */
export function assertSafeE2eCapability(env = process.env, options = {}) {
  const path = String(env[SAFE_E2E_CAPABILITY_PATH_VAR] || '').trim();
  const proof = String(env[SAFE_E2E_CAPABILITY_PROOF_VAR] || '').trim();
  if (!path || !proof) {
    throw new Error(
      'capability do E2E seguro ausente: use `npm run test:e2e:safe` como ponto de entrada.'
    );
  }

  const expectedRunId = String(options.runId || env[SAFE_E2E_RUN_ID_VAR] || '').trim();
  if (!expectedRunId) {
    throw new Error('capability do E2E seguro sem runId atribuído.');
  }
  const expectedConfig = capabilityConfigPath(options.config || SAFE_E2E_CONFIG_FILE);
  const expectedSpecs = [...(options.specs || SAFE_E2E_SPECS)];

  assertPrivateFile(path);

  let payload;
  try {
    payload = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error('capability do E2E seguro malformada.');
  }
  if (!payload || typeof payload !== 'object' || payload.version !== SAFE_E2E_CAPABILITY_VERSION) {
    throw new Error('capability do E2E seguro com formato inesperado.');
  }
  if (payload.runId !== expectedRunId) {
    throw new Error('capability do E2E seguro não pertence a esta execução (runId divergente).');
  }
  if (payload.config !== expectedConfig) {
    throw new Error('capability do E2E seguro não pertence a esta configuração.');
  }
  if (
    !Array.isArray(payload.specs) ||
    payload.specs.length !== expectedSpecs.length ||
    payload.specs.some((spec, index) => spec !== expectedSpecs[index])
  ) {
    throw new Error('capability do E2E seguro não pertence a esta suíte.');
  }
  if (
    !Number.isFinite(payload.createdAt) ||
    !Number.isFinite(payload.expiresAt) ||
    payload.expiresAt - payload.createdAt <= 0 ||
    payload.expiresAt - payload.createdAt > SAFE_E2E_CAPABILITY_TTL_MS
  ) {
    throw new Error('capability do E2E seguro com validade inválida.');
  }
  if (Date.now() > payload.expiresAt) {
    throw new Error('capability do E2E seguro expirada.');
  }
  if (typeof payload.proofHash !== 'string' || payload.proofHash.length !== 64) {
    throw new Error('capability do E2E seguro sem prova válida.');
  }
  const actual = Buffer.from(hashProof(proof), 'hex');
  const expected = Buffer.from(payload.proofHash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('capability do E2E seguro com prova inválida.');
  }

  return {
    path,
    runId: payload.runId,
    config: payload.config,
    specs: payload.specs,
    expiresAt: payload.expiresAt,
  };
}

export function isSafeE2eCapabilityValid(env = process.env, options = {}) {
  try {
    assertSafeE2eCapability(env, options);
    return true;
  } catch {
    return false;
  }
}

/** Remove a capability (arquivo e diretório privado). Idempotente. */
export function deleteSafeE2eCapability(capability) {
  const target = capability && (capability.dir || (capability.path && dirname(capability.path)));
  if (!target) return;
  try {
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Limpeza best-effort: nunca derruba o status do run.
  }
}
