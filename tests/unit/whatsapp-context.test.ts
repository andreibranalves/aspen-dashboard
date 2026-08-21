import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createHandler, normalizeContextPhone } from '../../api/_modules/whatsapp-context.js';
import type { LocalCrmCandidate } from '../../api/_modules/whatsapp-crm-match.js';

function parse(result: { body?: string }): Record<string, any> {
  return JSON.parse(result.body || '{}');
}

function candidate(overrides: Partial<LocalCrmCandidate> = {}): LocalCrmCandidate {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tipo: 'cliente',
    nome: 'Maria Silva',
    telefone: '5511999999999',
    email: 'maria@example.com',
    ...overrides,
  };
}

describe('whatsapp-context', () => {
  it('normalizes Brazilian WhatsApp phone candidates', () => {
    assert.equal(normalizeContextPhone('(11) 99999-9999'), '5511999999999');
    assert.equal(normalizeContextPhone('+55 11 99999-9999'), '5511999999999');
    assert.equal(normalizeContextPhone('contact-without-phone'), '');
  });

  it('returns a minimal matched contact projection and safe actions', async () => {
    let requestedPhone = '';
    const handler = createHandler({
      extensionOrigin: 'chrome-extension://test',
      findCandidatesByPhone: async (phone) => {
        requestedPhone = phone;
        return [candidate()];
      },
    });

    const result = await handler({
      httpMethod: 'GET',
      headers: { origin: 'chrome-extension://test' },
      queryStringParameters: {
        phone: '(11) 99999-9999',
        name: 'Maria Silva',
      },
      body: '',
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.headers?.['Access-Control-Allow-Origin'], 'chrome-extension://test');
    assert.equal(result.headers?.['Access-Control-Allow-Credentials'], 'true');
    const body = parse(result).data;
    assert.equal(requestedPhone, '5511999999999');
    assert.equal(body.match, 'matched');
    assert.deepEqual(body.contact, {
      id: '11111111-1111-4111-8111-111111111111',
      tipo: 'cliente',
      nome: 'Maria Silva',
      telefone: '5511999999999',
      email: 'maria@example.com',
    });
    assert.equal(body.actions.openContact, '/#/leads/cliente/11111111-1111-4111-8111-111111111111');
    assert.equal('raw' in body, false);
    assert.equal('providerConversationId' in body, false);
  });

  it('opens a lead match through the CRM search instead of a client-only detail route', async () => {
    const handler = createHandler({
      findCandidatesByPhone: async () => [candidate({ tipo: 'lead' })],
    });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { phone: '5511999999999' },
      body: '',
    });

    assert.equal(result.statusCode, 200);
    assert.equal(
      parse(result).data.actions.openContact,
      '/#/leads?search=5511999999999&status=all'
    );
  });

  it('returns not_found without inventing a CRM record', async () => {
    const handler = createHandler({
      findCandidatesByPhone: async () => [],
    });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { phone: '5511999999999', name: 'Contato Novo' },
      body: '',
    });

    assert.equal(result.statusCode, 200);
    const body = parse(result).data;
    assert.equal(body.match, 'not_found');
    assert.equal(body.contact, null);
    assert.equal(body.actions.openNewContact, '/#/leads/cliente/new?nome=Contato+Novo&telefone=5511999999999');
  });

  it('returns ambiguous when more than one candidate shares the phone', async () => {
    const handler = createHandler({
      findCandidatesByPhone: async () => [
        candidate({ id: '11111111-1111-4111-8111-111111111111' }),
        candidate({ id: '22222222-2222-4222-8222-222222222222', nome: 'Outra Maria' }),
      ],
    });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { phone: '5511999999999' },
      body: '',
    });

    assert.equal(result.statusCode, 200);
    const body = parse(result).data;
    assert.equal(body.match, 'ambiguous');
    assert.equal(body.contact, null);
    assert.equal(body.actions.openContact, null);
  });

  it('returns unresolved for a missing or invalid phone without querying CRM', async () => {
    let calls = 0;
    const handler = createHandler({
      findCandidatesByPhone: async () => {
        calls += 1;
        return [];
      },
    });
    const result = await handler({
      httpMethod: 'GET',
      headers: {},
      queryStringParameters: { phone: 'not-a-phone', name: 'Contato' },
      body: '',
    });

    assert.equal(result.statusCode, 200);
    const body = parse(result).data;
    assert.equal(body.match, 'unresolved');
    assert.equal(body.contact, null);
    assert.equal(calls, 0);
  });

  it('rejects non-GET requests with a Portuguese public error', async () => {
    const result = await createHandler()({
      httpMethod: 'POST',
      headers: {},
      queryStringParameters: {},
      body: '{}',
    });

    assert.equal(result.statusCode, 405);
    assert.match(parse(result).error, /método não permitido/i);
  });
});
