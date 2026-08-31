import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createCommercialExportHandler } from '../../api/_modules/commercial-export.js';
import type { FunctionEvent } from '../../api/_http/types.js';
import { routes } from '../../api/_app/routes.js';

function event(query: Record<string, string> = {}, method = 'GET'): FunctionEvent {
  return {
    httpMethod: method,
    body: '',
    headers: {},
    queryStringParameters: query,
  };
}

function parsed(result: { body?: string }): { error?: string } {
  const body: unknown = JSON.parse(result.body || '{}');
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return { error: body.error };
  }
  return {};
}

function handlerWith(
  rows: Array<Record<string, unknown>>,
  now = new Date('2026-08-31T18:30:00.000Z')
) {
  return createCommercialExportHandler({
    load: async (resource) => ({ resource, rows }),
    now: () => now,
  });
}

describe('commercial export endpoint', () => {
  it('accepts only GET and known resources', async () => {
    const handler = handlerWith([]);

    assert.equal(typeof routes['commercial-exports'], 'function');
    const method = await handler(event({ resource: 'clients' }, 'POST'));
    assert.equal(method.statusCode, 405);
    assert.equal(parsed(method).error, 'Método não permitido.');

    const resource = await handler(event({ resource: 'unknown' }));
    assert.equal(resource.statusCode, 400);
    assert.equal(parsed(resource).error, 'Tipo de exportação inválido.');
  });

  it('does not create empty or silently truncated files', async () => {
    const empty = await handlerWith([])(event({ resource: 'clients' }));
    assert.equal(empty.statusCode, 404);
    assert.equal(parsed(empty).error, 'Nenhum registro encontrado para exportar.');
    assert.equal(empty.headers?.['Content-Disposition'], undefined);

    const overLimit = await handlerWith(Array(10_001).fill({}))(event({ resource: 'clients' }));
    assert.equal(overLimit.statusCode, 422);
    assert.equal(
      parsed(overLimit).error,
      'A exportação excede 10 mil linhas. Restrinja os filtros e tente novamente.'
    );
    assert.equal(overLimit.headers?.['Content-Disposition'], undefined);
  });

  it('exports complete structured client fields without notes', async () => {
    const result = await handlerWith([
      {
        id: '11111111-1111-4111-8111-111111111111',
        nome: '=Cliente Fórmula',
        documento: '01234567890',
        email: 'cliente@example.com',
        telefone: '11999998888',
        endereco: 'Rua A',
        numero: '10',
        bairro: 'Centro',
        complemento: 'Sala 2',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01234567',
        arquivado: false,
        createdAt: '2026-08-31T18:30:00.000Z',
        updatedAt: '2026-08-31T18:31:00.000Z',
        archivedAt: null,
      },
    ])(event({ resource: 'clients', status: 'active', search: 'Cliente' }));

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers?.['Content-Type'], 'text/csv; charset=utf-8');
    assert.equal(
      result.headers?.['Content-Disposition'],
      'attachment; filename="clientes-2026-08-31-153000.csv"'
    );
    assert.equal(result.headers?.['Cache-Control'], 'private, no-store');
    assert.equal(result.headers?.['X-Content-Type-Options'], 'nosniff');
    assert.match(result.body || '', /^\uFEFF"ID do cliente";"Nome";/);
    assert.match(result.body || '', /"\'=Cliente Fórmula"/);
    assert.match(result.body || '', /"012\.345\.678-90"/);
    assert.match(result.body || '', /"\(11\) 99999-8888"/);
    assert.match(result.body || '', /"01234-567"/);
    assert.match(result.body || '', /"Ativo"/);
    assert.doesNotMatch(result.body || '', /Observa/);
  });

  it('exports products and quantity pricing as separate relational files', async () => {
    const product = await handlerWith([
      {
        sku: 'SKU-1',
        nome: 'Produto',
        descricao: 'Descrição',
        unidade: 'Und',
        categoria: 'Brindes',
        marca: 'Aspen',
        precoBase: '12.50',
        custoUnitario: '8.25',
        ativo: true,
        criadoEm: '2026-08-31T18:30:00.000Z',
        atualizadoEm: '2026-08-31T18:31:00.000Z',
        arquivadoEm: null,
      },
    ])(event({ resource: 'products' }));
    assert.match(product.body || '', /"Preço-base";"Custo unitário"/);
    assert.match(product.body || '', /"12,50";"8,25"/);

    const pricing = await handlerWith([
      {
        productSku: 'SKU-1',
        productName: 'Produto',
        minimumQuantity: '25.000',
        unitPrice: '10.00',
        criadoEm: '2026-08-31T18:30:00.000Z',
        atualizadoEm: '2026-08-31T18:31:00.000Z',
      },
    ])(event({ resource: 'product-pricing' }));
    assert.match(pricing.body || '', /"SKU";"Produto";"Quantidade mínima";"Preço unitário"/);
    assert.match(pricing.body || '', /"25,000";"10,00"/);
  });

  it('exports historical order and item snapshots with stable relationships', async () => {
    const order = await handlerWith([
      {
        id: '22222222-2222-4222-8222-222222222222',
        orderNumber: 'PED-2026-0001',
        quotationId: '33333333-3333-4333-8333-333333333333',
        quotationNumber: 'ORC-20260001',
        quotationRevisionId: '44444444-4444-4444-8444-444444444444',
        clientId: '11111111-1111-4111-8111-111111111111',
        clientName: 'Cliente histórico',
        clientDocument: '01234567890',
        clientEmail: 'historico@example.com',
        clientPhone: '11999998888',
        clientAddress: 'Rua Antiga',
        clientAddressNumber: '20',
        clientDistrict: 'Centro',
        clientAddressExtra: null,
        clientCity: 'São Paulo',
        clientState: 'SP',
        clientPostalCode: '01234567',
        status: 'To Deliver and Bill',
        transactionDate: '2026-08-31',
        deliveryDate: '2026-09-30',
        perDelivered: '10.00',
        perBilled: '20.00',
        subtotal: '100.00',
        grandTotal: '110.00',
        createdAt: '2026-08-31T18:30:00.000Z',
        updatedAt: '2026-08-31T18:31:00.000Z',
      },
    ])(event({ resource: 'sales-orders' }));
    assert.match(order.body || '', /"Código do status";"Status"/);
    assert.match(order.body || '', /"To Deliver and Bill";"A entregar e faturar"/);
    assert.match(order.body || '', /"Cliente histórico"/);
    assert.match(order.body || '', /"100,00";"110,00"/);

    const item = await handlerWith([
      {
        id: '55555555-5555-4555-8555-555555555555',
        salesOrderId: '22222222-2222-4222-8222-222222222222',
        orderNumber: 'PED-2026-0001',
        position: 0,
        productSku: 'SKU-1',
        productName: 'Produto histórico',
        unit: 'Und',
        quantity: '2.000',
        unitPrice: '50.00',
        lineTotal: '100.00',
        custoUnitario: '30.00',
      },
    ])(event({ resource: 'sales-order-items' }));
    assert.match(item.body || '', /"ID do pedido";"Número do pedido";"Posição"/);
    assert.match(item.body || '', /"Produto histórico";"Und";"2,000";"50,00";"100,00";"30,00"/);
  });

  it('does not expose repository errors', async (context) => {
    context.mock.method(console, 'error', () => undefined);
    const handler = createCommercialExportHandler({
      load: async () => {
        throw new Error('password=segredo');
      },
    });

    const result = await handler(event({ resource: 'clients' }));
    assert.equal(result.statusCode, 503);
    assert.equal(parsed(result).error, 'Não foi possível gerar a exportação. Tente novamente.');
    assert.doesNotMatch(result.body || '', /segredo/);
  });
});
