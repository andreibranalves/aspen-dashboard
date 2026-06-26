import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { erpGetList, erpDelete, erpPost, createHttpError } from './lib/erpnext.js';

// ── Helpers ──

function parsePageLimit(params: Record<string, string | undefined>) {
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(params.limit ?? '50', 10) || 50));
  return { page, limit };
}

function buildSearchFilter(params: Record<string, string | undefined>, field: string) {
  if (!params.search) return undefined;
  const term = params.search.trim();
  if (!term) return undefined;
  return [[field, 'like', `%${term}%`]];
}

function mapCustomer(c: Record<string, unknown>) {
  return {
    id: c.name,
    nome: c.customer_name,
    email: null,
    telefone: null,
    cnpj: c.tax_id || null,
    tipo: 'cliente',
    data_criacao: c.creation,
  };
}

function mapLead(l: Record<string, unknown>) {
  return {
    id: l.name,
    nome: l.lead_name,
    email: l.email_id || null,
    telefone: l.mobile_no || null,
    cnpj: null,
    tipo: 'lead',
    data_criacao: l.creation,
  };
}

// ── Handler ──

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  const params = event.queryStringParameters || {};

  // GET — list leads + customers
  if (event.httpMethod === 'GET') {
    try {
      const { page, limit } = parsePageLimit(params);
      const tipo = (params.tipo || 'todos').toLowerCase();

      if (!['cliente', 'lead', 'todos'].includes(tipo)) {
        throw createHttpError(400, 'Tipo inválido. Valores aceitos: cliente, lead, todos');
      }

      const ALL_LIMIT = 10000;
      const searchCustomers = buildSearchFilter(params, 'customer_name');
      const searchLeads = buildSearchFilter(params, 'lead_name');

      let customers: Record<string, unknown>[] = [];
      let leads: Record<string, unknown>[] = [];

      if (tipo === 'cliente' || tipo === 'todos') {
        customers = await erpGetList('Customer', {
          fields: ['name', 'customer_name', 'tax_id', 'creation'],
          filters: searchCustomers,
          order_by: 'creation desc',
          limit: ALL_LIMIT,
        });
      }

      if (tipo === 'lead' || tipo === 'todos') {
        leads = await erpGetList('Lead', {
          fields: ['name', 'lead_name', 'email_id', 'mobile_no', 'creation'],
          filters: searchLeads,
          order_by: 'creation desc',
          limit: ALL_LIMIT,
        });
      }

      const merged = [
        ...customers.map(mapCustomer),
        ...leads.map(mapLead),
      ];
      merged.sort((a: Record<string, unknown>, b: Record<string, unknown>) => new Date(b.data_criacao as string).getTime() - new Date(a.data_criacao as string).getTime());

      const total = merged.length;
      const start = (page - 1) * limit;
      const data = merged.slice(start, start + limit);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data,
          pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit) || 0,
          },
        }),
      };
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[leads-clients] GET', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
      };
    }
  }

  // POST — create a lead or customer
  if (event.httpMethod === 'POST') {
    try {
      let payload;
      try { payload = JSON.parse(event.body); }
      catch { throw createHttpError(400, 'JSON inválido.'); }

      const tipo = (payload.tipo || 'lead').toLowerCase();
      if (!['lead', 'cliente'].includes(tipo)) {
        throw createHttpError(400, 'Tipo inválido. Use "lead" ou "cliente".');
      }

      const nome = (payload.nome || '').trim();
      if (!nome) throw createHttpError(400, 'Nome é obrigatório.');

      const doctype = tipo === 'lead' ? 'Lead' : 'Customer';
      const docPayload: Record<string, unknown> = {};

      if (tipo === 'lead') {
        docPayload.lead_name = nome;
        if (payload.email) docPayload.email_id = payload.email.trim();
        if (payload.telefone) docPayload.mobile_no = payload.telefone.trim();
        if (payload.origem) docPayload.source = payload.origem.trim();
      } else {
        docPayload.customer_name = nome;
        docPayload.customer_type = 'Individual';
      }

      const created = await erpPost(doctype, docPayload);

      return {
        statusCode: 201,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, created: created.name || created, tipo }),
      };
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[leads-clients] POST', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro ao criar.' }),
      };
    }
  }

  // DELETE — delete a lead or customer
  if (event.httpMethod === 'DELETE') {
    try {
      const id = params.id;
      const tipo = (params.tipo || 'lead').toLowerCase();

      if (!id) {
        throw createHttpError(400, 'ID não informado.');
      }
      if (!['lead', 'cliente'].includes(tipo)) {
        throw createHttpError(400, 'Tipo inválido. Use "lead" ou "cliente".');
      }

      const doctype = tipo === 'lead' ? 'Lead' : 'Customer';
      await erpDelete(doctype, id);

      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: true, deleted: id, tipo }),
      };
    } catch (err: any) {
      const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
      console.error('[leads-clients] DELETE', err?.logMessage || err?.message || err);
      return {
        statusCode: code,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: err?.message || 'Erro ao excluir.' }),
      };
    }
  }

  return {
    statusCode: 405,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: 'Method Not Allowed' }),
  };
}
