#!/usr/bin/env node

import { readFileSync } from 'node:fs';

import { closeDatabase, getDatabase } from '../api/_infrastructure/db/client.js';
import {
  destinationFromGoogleDataManagerConfig,
  getGoogleDataManagerConfig,
  isGoogleDataManagerConfigured,
} from '../api/_infrastructure/integrations/google-data-manager/config.js';
import { getGoogleDataManagerClient } from '../api/_infrastructure/integrations/google-data-manager/client.js';
import { createAdsOfflineService, AdsOfflinePreflightError } from '../api/_modules/ads-offline.js';
import { createPostgresSalesOrderOfflineExportRepository } from '../api/_infrastructure/db/repositories/sales-order-offline-export-repository.js';

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
      arg === '--preflight-proof'
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
  if (dryRun === apply) throw new AdsOfflineUsageError('Escolha exatamente --dry-run ou --apply.');
  const from = parseDate(values.get('--from'));
  const to = parseDate(values.get('--to'));
  if (!from || !to || from >= to) {
    throw new AdsOfflineUsageError('Informe --from e --to válidos, com início anterior ao fim.');
  }
  if (dryRun && (values.has('--approved-orders') || values.has('--preflight-proof'))) {
    throw new AdsOfflineUsageError('Esses arquivos só podem ser usados com --apply.');
  }
  if (apply && (!values.has('--approved-orders') || !values.has('--preflight-proof'))) {
    throw new AdsOfflineUsageError('--apply exige --approved-orders e --preflight-proof.');
  }
  return {
    mode: dryRun ? 'dry-run' : 'apply',
    from,
    to,
    approvedOrdersPath: values.get('--approved-orders') || null,
    preflightProofPath: values.get('--preflight-proof') || null,
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
  getDatabase: getDatabaseFn = getDatabase,
  closeDatabase: closeDatabaseFn = closeDatabase,
  createRepository = createPostgresSalesOrderOfflineExportRepository,
  createTransport = getGoogleDataManagerClient,
  readFile = readFileSync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  let failure = null;
  try {
    const input = parseAdsOfflineArgs(argv);
    const config = getGoogleDataManagerConfig(env);
    const destination = isGoogleDataManagerConfigured(config)
      ? destinationFromGoogleDataManagerConfig(config)
      : null;
    const service = createAdsOfflineService({
      repository: createRepository(getDatabaseFn),
      transport: createTransport({ getConfig: () => config }),
      destination,
    });
    if (input.mode === 'dry-run') {
      stdout.write(`${JSON.stringify(await service.preview({ from: input.from, to: input.to }), null, 2)}\n`);
    } else {
      const approved = reviewedOrderIds(readJson(input.approvedOrdersPath, readFile));
      const proof = readJson(input.preflightProofPath, readFile);
      stdout.write(
        `${JSON.stringify(
          await service.apply({
            from: input.from,
            to: input.to,
            approvedOrderIds: approved,
            preflightProof: proof,
          }),
          null,
          2
        )}\n`
      );
    }
  } catch (error) {
    failure = error;
  }

  try {
    await closeDatabaseFn();
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

