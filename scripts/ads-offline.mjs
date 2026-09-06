#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createAdsOfflineService, AdsOfflinePreflightError } from '../api/_modules/ads-offline.js';
import { validateOfflinePreflight } from '../api/_modules/ads-offline-core.js';
import {
  parsePostgresRuntimeUrl,
  postgresRuntimeIdentity,
} from '../api/_shared/postgres-target.js';

const SAFE_INFRASTRUCTURE_ERROR = 'Falha ao executar exportação offline.';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AdsOfflineUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdsOfflineUsageError';
  }
}

function clean(value) {
  return String(value || '').trim();
}

function parseDate(value) {
  const date = new Date(clean(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resolveAdsOfflineRuntimeTarget(env = process.env) {
  const target = clean(env.ADS_OFFLINE_RUNTIME_TARGET);
  const owner = clean(env.ADS_OFFLINE_RUNTIME_OWNER);
  const deploymentRef = clean(env.ADS_OFFLINE_RUNTIME_DEPLOYMENT_REF);
  if (!target || !owner || !deploymentRef || !clean(env.DATABASE_URL)) {
    throw new AdsOfflinePreflightError('Identidade efetiva do alvo não configurada.');
  }
  let databaseFingerprint;
  try {
    const connection = parsePostgresRuntimeUrl(env.DATABASE_URL, env);
    databaseFingerprint = createHash('sha256')
      .update(postgresRuntimeIdentity(connection))
      .digest('hex');
  } catch {
    throw new AdsOfflinePreflightError('DATABASE_URL ambígua ou inválida para o preflight.');
  }
  return { target, owner, databaseFingerprint, deploymentRef };
}

export function parseAdsOfflineArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run' || arg === '--apply') {
      if (values.has(arg)) throw new AdsOfflineUsageError('Modo repetido.');
      values.set(arg, true);
    } else if (
      arg === '--from' ||
      arg === '--to' ||
      arg === '--approved-orders' ||
      arg === '--preflight-proof' ||
      arg === '--diagnose'
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--') || values.has(arg)) {
        throw new AdsOfflineUsageError('Argumento inválido.');
      }
      values.set(arg, value);
      index += 1;
    } else {
      throw new AdsOfflineUsageError('Argumento inválido.');
    }
  }
  const dryRun = Boolean(values.get('--dry-run'));
  const apply = Boolean(values.get('--apply'));
  const diagnose = values.has('--diagnose');
  if (Number(dryRun) + Number(apply) + Number(diagnose) !== 1) {
    throw new AdsOfflineUsageError('Escolha exatamente --dry-run, --apply ou --diagnose.');
  }
  const from = diagnose ? null : parseDate(values.get('--from'));
  const to = diagnose ? null : parseDate(values.get('--to'));
  if (!diagnose && (!from || !to || from >= to)) {
    throw new AdsOfflineUsageError('Informe --from e --to válidos, com início anterior ao fim.');
  }
  if (diagnose && (values.has('--from') || values.has('--to') || values.has('--approved-orders'))) {
    throw new AdsOfflineUsageError('Diagnóstico exige apenas o identificador e o preflight.');
  }
  if (dryRun && (values.has('--approved-orders') || values.has('--preflight-proof') || diagnose)) {
    throw new AdsOfflineUsageError('Esses arquivos só podem ser usados com --apply.');
  }
  if (apply && (!values.has('--approved-orders') || !values.has('--preflight-proof'))) {
    throw new AdsOfflineUsageError('--apply exige --approved-orders e --preflight-proof.');
  }
  if (diagnose && !values.has('--preflight-proof')) {
    throw new AdsOfflineUsageError('--diagnose exige --preflight-proof.');
  }
  if (diagnose && !UUID_PATTERN.test(clean(values.get('--diagnose')))) {
    throw new AdsOfflineUsageError('Identificador de exportação inválido.');
  }
  return {
    mode: dryRun ? 'dry-run' : apply ? 'apply' : 'diagnose',
    from,
    to,
    approvedOrdersPath: values.get('--approved-orders') || null,
    preflightProofPath: values.get('--preflight-proof') || null,
    exportId: values.get('--diagnose') || null,
  };
}

function readJson(path, readFile = readFileSync) {
  try {
    return JSON.parse(readFile(path, 'utf8'));
  } catch {
    throw new AdsOfflineUsageError('Arquivo de preflight ou lista revisada inválido.');
  }
}

function reviewedOrderIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AdsOfflineUsageError('A lista revisada deve conter UUIDs de pedidos.');
  }
  const ids = new Set(value.map((item) => (typeof item === 'string' ? item.trim() : '')));
  if (ids.size !== value.length || [...ids].some((id) => !UUID_PATTERN.test(id))) {
    throw new AdsOfflineUsageError('A lista revisada deve conter apenas UUIDs únicos.');
  }
  return ids;
}

export async function runAdsOffline({
  argv = process.argv.slice(2),
  env = process.env,
  getDatabase: getDatabaseOverride,
  closeDatabase: closeDatabaseOverride,
  createRepository: createRepositoryOverride,
  createTransport: createTransportOverride,
  readFile = readFileSync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let failure = null;
  let closeDatabaseFn = closeDatabaseOverride;
  try {
    const input = parseAdsOfflineArgs(argv);
    let approved = null;
    let proof = null;
    let runtimeTarget = null;
    if (input.mode === 'apply' || input.mode === 'diagnose') {
      runtimeTarget = resolveAdsOfflineRuntimeTarget(env);
      proof = readJson(input.preflightProofPath, readFile);
    }
    const {
      destinationFromGoogleDataManagerConfig,
      getGoogleDataManagerConfig,
      isGoogleDataManagerConfigured,
    } = await import('../api/_infrastructure/integrations/google-data-manager/config.js');
    const config = getGoogleDataManagerConfig(env);
    const destination = isGoogleDataManagerConfigured(config)
      ? destinationFromGoogleDataManagerConfig(config)
      : null;
    if (input.mode !== 'dry-run') {
      if (!destination)
        throw new AdsOfflinePreflightError('Destino do Data Manager não configurado.');
      const proofCheck = validateOfflinePreflight(proof, destination, runtimeTarget);
      if (!proofCheck.ok)
        throw new AdsOfflinePreflightError(`Preflight recusado: ${proofCheck.reason}.`);
    }
    if (input.mode === 'apply')
      approved = reviewedOrderIds(readJson(input.approvedOrdersPath, readFile));
    let getDatabaseFn = getDatabaseOverride;
    let createRepository = createRepositoryOverride;
    let createTransport = createTransportOverride;
    if (!getDatabaseFn || !closeDatabaseFn) {
      const database = await import('../api/_infrastructure/db/client.js');
      getDatabaseFn ||= database.getDatabase;
      closeDatabaseFn ||= database.closeDatabase;
    }
    if (!createRepository) {
      createRepository = (
        await import('../api/_infrastructure/db/repositories/sales-order-offline-export-repository.js')
      ).createPostgresSalesOrderOfflineExportRepository;
    }
    if (!createTransport) {
      createTransport = (
        await import('../api/_infrastructure/integrations/google-data-manager/client.js')
      ).getGoogleDataManagerClient;
    }
    const databaseProvider =
      input.mode === 'dry-run' ? getDatabaseFn : () => getDatabaseFn({ strictTarget: true });
    const service = createAdsOfflineService({
      repository: createRepository(databaseProvider),
      transport: createTransport({ getConfig: () => config }),
      destination,
    });
    if (input.mode === 'dry-run') {
      stdout.write(
        `${JSON.stringify(await service.preview({ from: input.from, to: input.to }), null, 2)}\n`
      );
    } else if (input.mode === 'apply') {
      stdout.write(
        `${JSON.stringify(
          await service.apply({
            from: input.from,
            to: input.to,
            approvedOrderIds: approved,
            preflightProof: proof,
            runtimeTarget,
          }),
          null,
          2
        )}\n`
      );
    } else {
      stdout.write(
        `${JSON.stringify(
          {
            exportId: input.exportId,
            diagnosed: await service.diagnose({
              exportId: input.exportId,
              preflightProof: proof,
              runtimeTarget,
            }),
          },
          null,
          2
        )}\n`
      );
    }
  } catch (error) {
    failure = error;
  }

  try {
    if (closeDatabaseFn) await closeDatabaseFn();
  } catch (error) {
    if (!failure) failure = error;
  }

  if (failure) {
    const message =
      failure instanceof AdsOfflineUsageError || failure instanceof AdsOfflinePreflightError
        ? failure.message
        : SAFE_INFRASTRUCTURE_ERROR;
    stderr.write(`${message}\n`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runAdsOffline()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write(`${SAFE_INFRASTRUCTURE_ERROR}\n`);
      process.exitCode = 1;
    });
}
