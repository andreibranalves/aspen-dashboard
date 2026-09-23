import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { routes } from '../../api/_app/routes.js';

test('routes: 57 nomes únicos e bem formados', () => {
  const names = Object.keys(routes);
  assert.equal(names.length, 57);
  assert.equal(new Set(names).size, names.length, 'nomes duplicados');
  for (const name of names) assert.match(name, /^[a-z][a-z0-9-]*$/, name);
});

test('routes: não registra endpoints aposentados', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'quote-leads'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'typebot-lead-capture'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'site-quote-leads'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'commercial-queue'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'proposal-opportunities'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'client-matches'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'atendimento-context'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'atendimento-client-link'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'quotation-email-template'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(routes, 'whatsapp-send-status'), false);
});

test('rotas e configuração ativas não contêm variáveis Typebot', () => {
  for (const relativePath of [
    '../../api/_app/routes.ts',
    '../../api/_shared/auth.ts',
    '../../api/_shared/rate-limit.ts',
    '../../.env.example',
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /TYPEBOT_/, relativePath);
  }
});

test('routes: todos os handlers são funções', () => {
  for (const [name, handler] of Object.entries(routes)) {
    assert.equal(typeof handler, 'function', name);
  }
});

test('routes: nenhum outro arquivo define mapa de rotas', () => {
  for (const relativePath of ['../../api/[...path].ts', '../../scripts/app-server.mjs']) {
    const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.ok(!source.includes('const ROUTES'), `${relativePath} não deve definir ROUTES`);
  }
});
