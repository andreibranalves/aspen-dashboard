// GET /api/operational-status - PostgreSQL readiness and local settings check.
import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { getDatabase } from '../_infrastructure/db/client.js';
import { appSettings } from '../_infrastructure/db/schema.js';
import { normalizeQuotationSections } from './quotation-content.js';
import { sql } from 'drizzle-orm';

function jsonResponse(statusCode: number, body: unknown): FunctionResult {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function checkDatabaseConnected(): Promise<boolean> {
  try {
    await getDatabase().execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkMandatorySettings(): Promise<{ configured: boolean; missing: string[] }> {
  const requiredFields = ['validade_dias', 'pagamento', 'template_padrao'];
  try {
    const [settings] = await getDatabase().select().from(appSettings).limit(1);
    if (!settings) return { configured: false, missing: requiredFields };
    const secoes = normalizeQuotationSections(settings.quotationSections);
    const missing: string[] = [];
    if (!settings.validadeDias || settings.validadeDias < 1) missing.push('validade_dias');
    if (!secoes.pagamento.body.trim()) missing.push('pagamento');
    if (!settings.templatePadrao.trim()) missing.push('template_padrao');
    return { configured: missing.length === 0, missing };
  } catch {
    return { configured: false, missing: requiredFields };
  }
}

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'GET') return jsonResponse(405, { error: 'Método não permitido.' });

  const databaseConnected = await checkDatabaseConnected();
  const settings = await checkMandatorySettings();
  return jsonResponse(200, {
    ready: databaseConnected && settings.configured,
    checks: {
      database_connected: databaseConnected,
      mandatory_settings: settings.configured,
    },
    details: {
      settings_missing: settings.missing,
    },
  });
}
