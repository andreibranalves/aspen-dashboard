import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpPut, createHttpError } from './lib/erpnext.js';

// ── Handler ──

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  if (event.httpMethod !== 'PUT' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'JSON inválido' }) };
  }

  try {
    const { deal_id, status, follow_up_stage } = payload;

    if (!deal_id || !status) {
      throw createHttpError(400, 'deal_id e status são obrigatórios');
    }

    // ponytail: Record<string, unknown> for dynamic object properties
    const update: Record<string, unknown> = { status };

    // ERPNext CRM Deal requires lost_reason when moving to Perdido
    if (status === 'Perdido') {
      update.lost_reason = 'Unresponsive Prospect';
    }

    // Opcional: atualiza estágio de follow-up junto com o status
    if (follow_up_stage !== undefined && follow_up_stage !== null) {
      update.custom_follow_up_stage = follow_up_stage;
    }

    await erpPut('CRM Deal', deal_id, update);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, deal_id, status }),
    };
  } catch (err: any) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[crm-update-deal]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.statusCode ? err.message : 'Erro interno.' }),
    };
  }
}
