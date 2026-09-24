import type { FunctionEvent, FunctionResult } from '../_http/types.js';
import { createProductionOrdersRepository, type ProductionAction } from '../_infrastructure/db/repositories/production-orders-repository.js';
import { PRODUCTION_STAGES } from './production-order-rules.js';

const repository = createProductionOrdersRepository();
const json = (statusCode: number, body: unknown): FunctionResult => ({
  statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export async function productionOrders(event: FunctionEvent): Promise<FunctionResult> {
  try {
    if (event.httpMethod === 'GET') {
      const id = event.queryStringParameters?.id;
      return json(200, id ? await repository.get(id) : await repository.list());
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Método não permitido.' });
    let body: unknown;
    try { body = JSON.parse(event.body || ''); } catch { return json(400, { error: 'JSON inválido.' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'Payload inválido.' });
    const input = body as Record<string, unknown>;
    const allowed = ['advance', 'undo', 'dates', 'note', 'edit_note', 'delete_note'];
    if (typeof input.id !== 'string' || !allowed.includes(String(input.action))) {
      return json(400, { error: 'Ação ou pedido inválido.' });
    }
    if (input.action === 'advance' && !PRODUCTION_STAGES.includes(input.stage as typeof PRODUCTION_STAGES[number])) {
      return json(400, { error: 'Etapa inválida.' });
    }
    if (input.action === 'undo' && typeof input.token !== 'string') return json(400, { error: 'Token inválido.' });
    if ((input.action === 'note' || input.action === 'edit_note') && typeof input.content !== 'string') {
      return json(400, { error: 'Anotação inválida.' });
    }
    if ((input.action === 'edit_note' || input.action === 'delete_note') && typeof input.note_id !== 'string') {
      return json(400, { error: 'Anotação inválida.' });
    }
    await repository.change(input as ProductionAction);
    return json(200, await repository.get(input.id));
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    if (status === 400 || status === 404 || status === 409) return json(status, { error: (error as Error).message });
    console.error('[production-orders]', error instanceof Error ? error.name : typeof error);
    return json(500, { error: 'Erro interno.' });
  }
}
