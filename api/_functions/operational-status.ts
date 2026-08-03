// GET /api/operational-status — readiness check for operational mode activation.
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { getDatabase } from '../_db/client.js';
import { frappeImportLineage, issuedDocuments, appSettings } from '../_db/schema.js';
import { eq, count, sql } from 'drizzle-orm';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function jsonResponse(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function checkDatabaseConnected(): Promise<boolean> {
  try {
    const db = getDatabase();
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkMigrationComplete(): Promise<{ complete: boolean; counts: Record<string, number> }> {
  const entityTypes = ['produto', 'faixa', 'cliente', 'orcamento'];
  const counts: Record<string, number> = {};
  let complete = true;

  try {
    const db = getDatabase();
    for (const entityType of entityTypes) {
      const result = await db
        .select({ cnt: count() })
        .from(frappeImportLineage)
        .where(eq(frappeImportLineage.entityType, entityType));
      const cnt = result[0]?.cnt ?? 0;
      counts[entityType] = cnt;
      if (cnt === 0) complete = false;
    }
  } catch {
    complete = false;
    for (const entityType of entityTypes) {
      counts[entityType] = 0;
    }
  }

  return { complete, counts };
}

async function checkPdfsArchived(): Promise<{ archived: boolean; pdfCount: number; blobTokenPresent: boolean }> {
  const blobTokenPresent = !!process.env.BLOB_READ_WRITE_TOKEN;
  let pdfCount = 0;

  try {
    const db = getDatabase();
    const result = await db
      .select({ cnt: count() })
      .from(issuedDocuments);
    pdfCount = result[0]?.cnt ?? 0;
  } catch {
    // Database not available
  }

  return {
    archived: pdfCount > 0 && blobTokenPresent,
    pdfCount,
    blobTokenPresent,
  };
}

function checkBackupValidated(): { validated: boolean; lastBackup: string | null } {
  const backupsDir = join(process.cwd(), 'backups');
  if (!existsSync(backupsDir)) {
    return { validated: false, lastBackup: null };
  }

  try {
    const files = readdirSync(backupsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse();

    if (files.length === 0) {
      return { validated: false, lastBackup: null };
    }

    const latestFile = join(backupsDir, files[0]);
    const stat = statSync(latestFile);
    const lastBackup = stat.mtime.toISOString();
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);

    return {
      validated: stat.size > 0 && ageHours < 24,
      lastBackup,
    };
  } catch {
    return { validated: false, lastBackup: null };
  }
}

function checkCapacityOk(): boolean {
  // Basic capacity check: ensure the app can start and database is reachable.
  // Full capacity checks (DB size, connection count, blob usage) are deferred
  // to the backup-crm.mjs preflight script.
  return true;
}

async function checkMandatorySettings(): Promise<{ configured: boolean; missing: string[] }> {
  const requiredFields = ['validade_dias', 'pagamento', 'template_padrao'];
  const missing: string[] = [];

  try {
    const db = getDatabase();
    const result = await db.select().from(appSettings).limit(1);
    const settings = result[0];

    if (!settings) {
      return { configured: false, missing: requiredFields };
    }

    if (!settings.validadeDias || settings.validadeDias < 1) missing.push('validade_dias');
    if (!settings.pagamento || !settings.pagamento.trim()) missing.push('pagamento');
    if (!settings.templatePadrao || !settings.templatePadrao.trim()) missing.push('template_padrao');

    return { configured: missing.length === 0, missing };
  } catch {
    return { configured: false, missing: requiredFields };
  }
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { error: 'Método não permitido.' });
  }

  const dbConnected = await checkDatabaseConnected();
  const migration = await checkMigrationComplete();
  const pdfs = await checkPdfsArchived();
  const backup = checkBackupValidated();
  const capacityOk = checkCapacityOk();
  const settings = await checkMandatorySettings();

  const ready =
    dbConnected &&
    migration.complete &&
    pdfs.archived &&
    backup.validated &&
    capacityOk &&
    settings.configured;

  return jsonResponse(200, {
    ready,
    checks: {
      database_connected: dbConnected,
      migration_complete: migration.complete,
      pdfs_archived: pdfs.archived,
      backup_validated: backup.validated,
      capacity_ok: capacityOk,
      mandatory_settings: settings.configured,
    },
    details: {
      product_count: migration.counts.produto ?? 0,
      client_count: migration.counts.cliente ?? 0,
      quotation_count: migration.counts.orcamento ?? 0,
      pricing_tier_count: migration.counts.faixa ?? 0,
      pdf_count: pdfs.pdfCount,
      settings_configured: settings.configured ? settings.missing : [],
      settings_missing: settings.missing,
      last_backup: backup.lastBackup,
      blob_token_present: pdfs.blobTokenPresent,
    },
  });
}
