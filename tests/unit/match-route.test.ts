import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSegments, prefix } from '../../src/app/match-route.ts';

test('matchSegments captura parametro de segmento', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id', '/leads/cliente/ORC-1'), { tipo: 'cliente', id: 'ORC-1' });
});

test('matchSegments captura id com barras via catch-all', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id*', '/leads/cliente/a/b/c'), { tipo: 'cliente', id: 'a/b/c' });
});

test('matchSegments devolve id vazio quando falta o resto', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id*', '/leads/cliente'), { tipo: 'cliente', id: '' });
});

test('matchSegments rejeita rota com menos segmentos que o padrao', () => {
  assert.equal(matchSegments('/a/b', '/a'), null);
});

test('matchSegments rejeita rota com mais segmentos que o padrao sem catch-all', () => {
  assert.equal(matchSegments('/a/b', '/a/b/c'), null);
});

test('matchSegments rejeita segmento estatico diferente', () => {
  assert.equal(matchSegments('/a/b', '/a/x'), null);
});

test('prefix captura o resto apos o prefixo', () => {
  assert.deepEqual(prefix('/quotations/')('/quotations/ORC-1'), { id: 'ORC-1' });
});

test('prefix rejeita rota sem o prefixo (sem barra final)', () => {
  assert.equal(prefix('/quotations/')('/quotations'), null);
});

test('matchers ignoram query da rota', () => {
  assert.deepEqual(matchSegments('/products', '/products?search=abc&page=2'), {});
  assert.deepEqual(prefix('/products/')('/products/SKU-1?search=abc'), { id: 'SKU-1' });
});
