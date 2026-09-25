// Dados sintéticos e estáveis para a referência visual.
import {
  withCanonicalQuotationDetail,
  withCanonicalQuotationListRow,
} from '../fixtures/quotation-detail.js';

const CLIENTS = [
  ['00000000-0000-4000-8000-000000000001', 'Confecções Horizonte Ltda', 'compras@horizonte.example', '5511999990001', '12345678000190'],
  ['00000000-0000-4000-8000-000000000002', 'Marina Albuquerque', 'marina@example.com', '5521988887777', '12345678901'],
  ['00000000-0000-4000-8000-000000000003', 'Estamparia Litoral Norte', 'contato@litoral.example', '5512977776666', '98765432000110'],
];

export const leadsClients = {
  data: CLIENTS.map(([id, nome, email, telefone, documento]) => ({
    id, nome, email, telefone, documento, tipo: 'cliente', status: 'active', arquivado: false,
  })),
  pagination: { page: 1, limit: 10, total: 3, total_pages: 1 },
};

const QUOTATIONS = [
  ['ORC-20260101', 'Confecções Horizonte Ltda', '1250.00', 'Enviado', 'emitido', '2026-09-10'],
  ['ORC-20260102', 'Marina Albuquerque', '480.00', 'Aprovado', 'aprovado', '2026-09-08'],
  ['ORC-20260103', 'Estamparia Litoral Norte', '3920.50', 'Rascunho', 'rascunho', '2026-09-05'],
];

export const quotationsList = {
  data: QUOTATIONS.map(([id, cliente, total, status, canonical, data], index) =>
    withCanonicalQuotationListRow({
      id,
      quotation_id: id,
      quotation_uuid: `11111111-1111-4111-8111-00000000000${index + 1}`,
      revision_id: `22222222-2222-4222-8222-00000000000${index + 1}`,
      revision_number: 1,
      cliente,
      client_id: CLIENTS[index][0],
      data,
      validade: '2026-09-30',
      validade_dias: 15,
      valor: total,
      subtotal: total,
      total,
      frete: '0.00',
      derived_expired: false,
      concurrency_token: `${data}T12:00:00.000Z`,
      updated_at: `${data}T12:00:00.000Z`,
      email_sent: false,
      status,
      status_canonical: canonical,
    })
  ),
  pagination: { page: 1, limit: 10, total: 3, total_pages: 1 },
  status_summary: { Rascunho: 1, Enviado: 1, Aprovado: 1, Perdido: 0 },
};

export const quotationDetail = withCanonicalQuotationDetail({
  id: 'ORC-20260101',
  quotation_id: 'ORC-20260101',
  quotation_name: 'ORC-20260101',
  quotation_uuid: '11111111-1111-4111-8111-000000000001',
  revision_id: '22222222-2222-4222-8222-000000000001',
  revision: 1,
  revision_number: 1,
  status: 'Emitido',
  status_canonical: 'emitido',
  cliente: CLIENTS[0][1],
  client_id: CLIENTS[0][0],
  cliente_snapshot: { id: CLIENTS[0][0], nome: CLIENTS[0][1], email: CLIENTS[0][2], telefone: CLIENTS[0][3] },
  validade_dias: 15,
  validade: '2026-09-25',
  data: '2026-09-10',
  pagamento: '50% no pedido, 50% na entrega',
  entrega: 'Retirada',
  frete_padrao: '0.00',
  frete: '0.00',
  observacoes: '',
  prazo_producao: '15 dias úteis',
  template_key: 'padrao',
  template_hash: 'a'.repeat(64),
  template_version_id: null,
  template_version: null,
  secoes: {
    schema_version: 1,
    prazo_producao: {
      base: { enabled: true, title: 'Prazo de produção', value: '15 dias úteis' },
      current: { enabled: true, title: 'Prazo de produção', value: '15 dias úteis' },
    },
    pagamento: {
      base: { enabled: true, title: 'Pagamento', body: '50% no pedido, 50% na entrega' },
      current: { enabled: true, title: 'Pagamento', body: '50% no pedido, 50% na entrega' },
    },
    condicoes_gerais: {
      base: { enabled: true, title: 'Condições gerais', body: '' },
      current: { enabled: true, title: 'Condições gerais', body: '' },
    },
  },
  items: [
    ['CAN-100', 'Canga estampada 100x160', '100.000', '9.50', '950.00'],
    ['LEN-040', 'Lenço de seda 40x40', '30.000', '10.00', '300.00'],
  ].map(([sku, nome, qty, price, total]) => ({
    item_code: sku, sku, item_name: nome, nome, qty,
    suggested_unit_price: price, applied_unit_price: price, price_difference: '0.00',
    line_total: total, manual_rate: false,
  })),
  subtotal: '1250.00',
  total: '1250.00',
  valor: '1250.00',
  revision_history: [],
  derived_expired: false,
  concurrency_token: '2026-09-10T12:00:00.000Z',
  updated_at: '2026-09-10T12:00:00.000Z',
  email_sent: false,
  email_sent_at: null,
});

export const products = {
  data: [
    ['CAN-100', 'Canga estampada 100x160', 'Cangas', '11.90', '9.50'],
    ['LEN-040', 'Lenço de seda 40x40', 'Lenços', '12.50', '10.00'],
    ['BOL-200', 'Bolsa de praia em lona', 'Bolsas', '34.00', '28.00'],
  ].map(([sku, nome, categoria, base, min]) => ({
    sku, nome, descricao: '', unidade: 'Und', categoria, marca: 'Aspen', ativo: true,
    preco_base: base, precos: [{ minimum_quantity: '30', unit_price: min }],
    preco_minimo: min, pricing_available: true,
  })),
  pagination: { page: 1, limit: 10, total: 3, total_pages: 1 },
};

export const salesOrders = {
  success: true,
  items: [
    ['PED-2026-0101', CLIENTS[0], 1250, 'To Deliver and Bill', 0, 0],
    ['PED-2026-0102', CLIENTS[1], 480, 'Completed', 100, 100],
    ['PED-2026-0103', CLIENTS[2], 3920.5, 'To Bill', 100, 0],
  ].map(([id, [customer, customer_name], total, status, delivered, billed], index) => ({
    id, date: `2026-09-0${index + 3}`, customer_name, customer,
    grand_total: total, rounded_total: total, status, delivery_date: '2026-09-20',
    per_delivered: delivered, per_billed: billed, source_quotation: QUOTATIONS[index][0],
  })),
  page: 1,
  limit: 10,
  has_more: false,
};

export const salesDashboard = {
  success: true,
  summary: {
    total_revenue: 5650.5,
    revenue_delta: 12.5,
    orders_count: 3,
    orders_delta: null,
    avg_ticket: 1883.5,
    avg_ticket_delta: null,
    open_orders: 2,
    conversion_rate: 0.5,
    conversion_delta: null,
  },
};

export const commercialQueue = {
  data: [
    ['Lead Sintético', 'Cangas 100 unidades', 'overdue', '5521999990000'],
    ['Marina Albuquerque', 'Lenços para evento', 'today', '5521988887777'],
  ].map(([contact_name, demand_summary, due_status, contact_phone], index) => ({
    action_id: `11111111-1111-4111-8111-10000000000${index}`,
    opportunity_id: `22222222-2222-4222-8222-20000000000${index}`,
    kind: 'first_contact',
    kind_label: 'Primeiro contato',
    reason_code: 'new_lead',
    reason_label: 'Primeiro atendimento',
    reason: 'Primeiro atendimento',
    origin: 'automatic',
    state: 'active',
    due_at: '2026-09-15T12:00:00.000Z',
    due_date: '2026-09-15',
    due_time: '09:00',
    schedule_type: 'timed',
    due_status,
    version: 1,
    follow_up_stage: 0,
    actor: 'system',
    is_urgent: false,
    priority: 4,
    opportunity_status: 'Novo Lead',
    contact_context: { status: 'available', last_contact_at: '2026-09-15T11:30:00.000Z', last_contact_direction: 'inbound', blockers: [] },
    whatsapp_href: `https://wa.me/${contact_phone}`,
    demand_summary,
    contact_name,
    contact_phone,
    contact_email: 'synthetic@example.invalid',
    client_id: null,
    client_name: null,
    proposals: [],
  })),
  total: 2,
  page: 1,
  page_size: 10,
};

/** Respostas por caminho; `{ status, body }` troca o status e `null` indica fixture ausente. */
export function respond(url) {
  const { pathname, searchParams } = url;
  if (pathname === '/api/leads-clients') return leadsClients;
  if (pathname === '/api/quotations') return searchParams.has('id') ? quotationDetail : quotationsList;
  if (pathname === '/api/products') {
    return searchParams.get('view') === 'categories' ? { categories: ['Bolsas', 'Cangas', 'Lenços'] } : products;
  }
  if (pathname === '/api/sales-orders') return salesOrders;
  // Sem configurações salvas: a tela usa os padrões locais.
  if (pathname === '/api/settings') return { status: 404, body: { error: 'Configurações não encontradas.' } };
  if (pathname === '/api/tasks') return searchParams.get('view') === 'alerts' ? { overdue_count: 0 } : { tasks: [], today: '2026-09-15', overdue_count: 0 };
  if (pathname === '/api/sales-dashboard') return salesDashboard;
  if (pathname === '/api/commercial-queue') return commercialQueue;
  if (pathname === '/api/quotation-templates') {
    return { templates: [{ key: 'padrao', name: 'Padrão', is_default: true, current_version_id: null }], default_key: 'padrao' };
  }
  if (pathname === '/api/quotation-deliveries') return { status: 404, body: { error: 'Entrega não encontrada.' } };
  if (pathname === '/api/order-templates') return { data: [] };
  if (pathname === '/api/communication-flows') {
    return {
      success: true,
      flows: [{
        id: 'flow-padrao', name: 'Envio de orçamento', context: 'manual', channel: 'whatsapp',
        vendor_name: 'Juliana', enabled: true, delay_min_seconds: 0, delay_max_seconds: 0,
        max_media_per_product_group: 1, steps: [{ id: 'step-1', type: 'text', template: 'Olá' }],
      }],
      selectedFlowId: 'flow-padrao',
    };
  }
  return null;
}

/** @param {URL} url Consultas POST só de leitura; `null` marca a chamada como sem fixture. */
export function respondReadOnlyPost(url) {
  if (url.pathname === '/api/client-matches') {
    return { status: 'not_found', matched_client_id: null, candidates: [], total_candidates: 0, page: 1, has_more: false };
  }
  return null;
}
