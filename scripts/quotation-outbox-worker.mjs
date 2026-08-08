#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { closeDatabase } from '../api/_db/client.js';
import { createPostgresQuotationOutboxRepository } from '../api/_db/quotation-outbox-repository.js';
import {
  createConfiguredQuotationOutboxProviderAdapters,
  quotationOutboxConfigFromEnv,
  runQuotationOutboxWorker,
} from '../api/_functions/quotation-outbox-worker.js';

function positiveInt(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function requiredConfiguration(config) {
  const missing = [
    ['OUTBOX_N8N_URL or N8N_OUTBOX_WEBHOOK_URL', config.n8nUrl],
    ['OUTBOX_EVOLUTION_URL', config.evolutionUrl],
    ['OUTBOX_CRM_URL', config.crmUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  return missing;
}

const config = quotationOutboxConfigFromEnv();
const missing = requiredConfiguration(config);
if (missing.length > 0) {
  console.error(JSON.stringify({
    error: 'Configuração do worker de outbox incompleta.',
    missing,
  }));
  process.exitCode = 1;
} else {
  try {
    const result = await runQuotationOutboxWorker({
      repository: createPostgresQuotationOutboxRepository(),
      adapters: createConfiguredQuotationOutboxProviderAdapters(config),
      owner: process.env.OUTBOX_WORKER_ID?.trim() || `quotation-outbox-${randomUUID()}`,
      limit: positiveInt(process.env.OUTBOX_BATCH_SIZE, 10, 100),
      leaseMs: positiveInt(process.env.OUTBOX_LEASE_MS, 60_000, 60 * 60 * 1_000),
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({
      error: 'Worker de outbox falhou.',
      error_class: error instanceof Error ? error.name : 'Error',
    }));
    process.exitCode = 1;
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
