#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { closeDatabase } from '../api/_db/client.js';
import { createPostgresQuotationOutboxRepository } from '../api/_db/quotation-outbox-repository.js';
import {
  configuredQuotationOutboxProviders,
  createConfiguredQuotationOutboxProviderAdapters,
  quotationOutboxConfigFromEnv,
  runQuotationOutboxWorker,
} from '../api/_functions/quotation-outbox-worker.js';

function positiveInt(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

export function requiredConfiguration(config, env = process.env) {
  const providers = configuredQuotationOutboxProviders(config);
  return providers.length > 0 && !env.DATABASE_URL ? ['DATABASE_URL'] : [];
}

export async function main(env = process.env) {
  const config = quotationOutboxConfigFromEnv(env);
  const providers = configuredQuotationOutboxProviders(config);
  const missing = requiredConfiguration(config, env);
  if (missing.length > 0) {
    console.error(JSON.stringify({
      error: 'Configuração do worker de outbox incompleta.',
      missing,
    }));
    return 1;
  }
  if (providers.length === 0) {
    console.log(JSON.stringify({
      status: 'disabled',
      reason: 'Nenhum provider externo de outbox configurado; nenhum evento foi reivindicado.',
    }));
    return 0;
  }

  try {
    const result = await runQuotationOutboxWorker({
      repository: createPostgresQuotationOutboxRepository(),
      adapters: createConfiguredQuotationOutboxProviderAdapters(config),
      configuredProviders: providers,
      owner: env.OUTBOX_WORKER_ID?.trim() || `quotation-outbox-${randomUUID()}`,
      limit: positiveInt(env.OUTBOX_BATCH_SIZE, 10, 100),
      leaseMs: positiveInt(env.OUTBOX_LEASE_MS, 60_000, 60 * 60 * 1_000),
    });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({
      error: 'Worker de outbox falhou.',
      error_class: error instanceof Error ? error.name : 'Error',
    }));
    return 1;
  } finally {
    await closeDatabase().catch((error) => {
      console.error(JSON.stringify({
        error: 'Worker de outbox não conseguiu fechar o banco.',
        error_class: error instanceof Error ? error.name : 'Error',
      }));
      process.exitCode = 1;
    });
  }
}

const invokedPath = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (invokedPath && import.meta.url === invokedPath) process.exitCode = await main();
