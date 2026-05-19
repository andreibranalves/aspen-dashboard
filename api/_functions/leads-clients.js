import { erpGetList, createHttpError } from './lib/erpnext.js';

// ── Helpers ──

function parsePageLimit(params) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(params.limit, 10) || 50));
  return { page, limit };
}

function buildSearchFilter(params, field) {
  if (!params.search) return undefined;
  const term = params.search.trim();
  if (!term) return undefined;
  return [[field, 'like', `%${term}%`]];
}

function mapCustomer(c) {
  return {
    id: c.name,
    nome: c.customer_name,
    email: null,
    telefone: null,
    tipo: 'cliente',
    data_criacao: c.creation,
  };
}

function mapLead(l) {
  return {
    id: l.name,
    nome: l.lead_name,
    email: l.email_id || null,
    telefone: l.mobile_no || null,
    tipo: 'lead',
    data_criacao: l.creation,
  };
}

// ── Handler ──

export async function handler(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const params = event.queryStringParameters || {};
    const { page, limit } = parsePageLimit(params);
    const tipo = (params.tipo || 'todos').toLowerCase();

    if (!['cliente', 'lead', 'todos'].includes(tipo)) {
      throw createHttpError(400, 'Tipo inválido. Valores aceitos: cliente, lead, todos');
    }

    const ALL_LIMIT = 10000;
    const searchCustomers = buildSearchFilter(params, 'customer_name');
    const searchLeads = buildSearchFilter(params, 'lead_name');

    let customers = [];
    let leads = [];

    if (tipo === 'cliente' || tipo === 'todos') {
      customers = await erpGetList('Customer', {
        fields: ['name', 'customer_name', 'creation'],
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
    merged.sort((a, b) => new Date(b.data_criacao) - new Date(a.data_criacao));

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
  } catch (err) {
    const code = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    console.error('[leads-clients]', err?.logMessage || err?.message || err);
    return {
      statusCode: code,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err?.message || 'Erro interno.' }),
    };
  }
}
