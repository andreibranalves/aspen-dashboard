import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { clearTimeout, setTimeout } from 'node:timers';
import { URL } from 'node:url';
import vm from 'node:vm';

const { AbortController } = globalThis;

const contentSource = await readFile(new URL('../../extensions/whatsapp-context/content.js', import.meta.url), 'utf8');
const backgroundSource = await readFile(new URL('../../extensions/whatsapp-context/background.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return { promise, resolve };
}

function settled(value) {
  return { promise: Promise.resolve(value) };
}

function createHarness({ conversations, lookupResults = [], visibleKeys = [] }) {
  const elements = new Map();
  const lookups = [];
  const observers = [];
  let conversationIndex = 0;
  let visibleIndex = 0;
  let appendCount = 0;

  class Element {
    constructor() { this.innerHTML = ''; this.id = ''; }
    addEventListener() {}
    appendChild(element) { appendCount += 1; elements.set(element.id, element); }
  }
  const body = new Element();
  const document = {
    readyState: 'complete', body,
    documentElement: body,
    createElement: () => new Element(),
    getElementById: id => elements.get(id) || null,
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
  }
  const provider = {
    visibleConversationKey: () => visibleKeys[Math.min(visibleIndex, visibleKeys.length - 1)] || '',
    resolveConversation: async () => {
      const value = conversations[Math.min(conversationIndex++, conversations.length - 1)];
      return value && typeof value.then === 'function' ? value : value;
    },
  };
  const chrome = { runtime: { sendMessage(message, callback) {
    if (message.type !== 'aspen-context:lookup') return callback({ ok: true });
    const pending = lookupResults[lookups.length] || deferred();
    lookups.push({ message, callback, pending });
    pending.promise.then(callback);
  } } };
  const context = vm.createContext({
    AspenWhatsappProvider: provider,
    chrome, document, navigator: {}, MutationObserver,
    clearTimeout, setTimeout, console,
  });
  vm.runInContext(contentSource, context, { filename: 'content.js' });
  return {
    get html() { return elements.get('aspen-whatsapp-context-extension')?.innerHTML || ''; },
    get lookupCount() { return lookups.length; },
    get appendCount() { return appendCount; },
    lookup: index => lookups[index],
    mutate: () => { visibleIndex += 1; observers[0].callback(); },
    reload: () => vm.runInContext(contentSource, context, { filename: 'content.js' }),
  };
}

function createBackgroundHarness(fetchFn, timers = { setTimeout, clearTimeout }) {
  let listener;
  const context = vm.createContext({
    ASPEN_WHATSAPP_CONTEXT_CONFIG: { appOrigin: 'https://aspen.example', endpointPath: '/api/whatsapp-context' },
    AbortController, URL, console,
    importScripts() {}, fetch: fetchFn,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    chrome: {
      runtime: { onMessage: { addListener(value) { listener = value; } } },
      tabs: { create() {} },
    },
  });
  vm.runInContext(backgroundSource, context, { filename: 'background.js' });
  return {
    lookup(phone = '5521981763562') {
      return new Promise(resolve => listener({ type: 'aspen-context:lookup', phone }, {}, resolve));
    },
  };
}

const conversationA = { status: 'ready', phone: '5521981763562', technicalId: 'a@c.us', displayName: '+55 21 98176-3562' };
const matchedA = { match: 'matched', contact: { id: 'a', tipo: 'cliente', nome: 'Contato A', telefone: '5521981763562', email: null }, latestQuotation: null, quotations: [], deliveries: [], actions: { openContact: '/#/leads/cliente/a' } };

async function flush(ms = 0) { await new Promise(resolve => setTimeout(resolve, ms)); }

test('same-conversation DOM mutation does not strand a valid Aspen lookup', async () => {
  const response = deferred();
  const harness = createHarness({ conversations: [conversationA, conversationA], lookupResults: [response] });
  await flush();
  assert.equal(harness.lookupCount, 1);
  harness.mutate();
  await flush(275);
  response.resolve(matchedA);
  await flush();
  assert.match(harness.html, /Contato A/);
  assert.doesNotMatch(harness.html, /Carregando contexto comercial/);
});

test('switching A to B rejects A response and renders only B', async () => {
  const responseA = deferred();
  const responseB = deferred();
  const conversationB = { status: 'ready', phone: '5511999999999', technicalId: 'b@c.us', displayName: 'Contato B' };
  const harness = createHarness({ conversations: [conversationA, conversationB], lookupResults: [responseA, responseB] });
  await flush();
  harness.mutate();
  await flush(275);
  assert.equal(harness.lookupCount, 2);
  responseA.resolve(matchedA);
  await flush();
  assert.doesNotMatch(harness.html, /Contato A/);
  responseB.resolve({ ...matchedA, contact: { ...matchedA.contact, id: 'b', nome: 'Contato B', telefone: conversationB.phone } });
  await flush();
  assert.match(harness.html, /Contato B/);
  assert.doesNotMatch(harness.html, /Contato A/);
});

test('visible conversation switch hides A and invalidates its lookup before slow B identity resolves', async () => {
  const responseA = deferred();
  const conversationB = deferred();
  const harness = createHarness({
    conversations: [conversationA, conversationB.promise],
    lookupResults: [responseA],
    visibleKeys: ['Contato A|Digite para A', 'Contato B|Digite para B'],
  });
  await flush();
  harness.mutate();
  await flush(275);
  responseA.resolve(matchedA);
  await flush();
  assert.doesNotMatch(harness.html, /Contato A/);
  assert.match(harness.html, /Identificando conversa/);
  conversationB.resolve({ status: 'ready', phone: '5511999999999', technicalId: 'b@c.us', displayName: 'Contato B' });
  await flush();
});

test('same conversation avoids request storms and mount is idempotent', async () => {
  const response = deferred();
  const harness = createHarness({ conversations: [conversationA, conversationA], lookupResults: [response] });
  await flush();
  harness.mutate(); harness.mutate(); harness.mutate();
  await flush(275);
  assert.equal(harness.lookupCount, 1);
  harness.reload();
  assert.equal(harness.appendCount, 1);
  response.resolve(matchedA);
  await flush();
  assert.match(harness.html, /Contato A/);
});

test('content panel renders explicit terminal states for login, API, and empty results', async () => {
  const cases = [
    [{ status: 'login_required', message: 'Faça login no Aspen para consultar o contexto.' }, /Faça login no Aspen/],
    [{ status: 'error', message: 'Aspen indisponível. Tente novamente.' }, /Aspen indisponível/],
    [{ match: 'not_found', contact: null, actions: {} }, /Nenhum cadastro encontrado/],
    [{ match: 'ambiguous', contact: null, actions: {} }, /Match ambíguo/],
  ];
  for (const [result, expected] of cases) {
    const harness = createHarness({ conversations: [conversationA, conversationA], lookupResults: [settled(result)] });
    await flush();
    assert.match(harness.html, expected);
    assert.doesNotMatch(harness.html, /Carregando contexto comercial/);
    harness.mutate();
    await flush(275);
    assert.match(harness.html, expected);
    assert.doesNotMatch(harness.html, /Consultando o contexto comercial Aspen/);
  }
});

test('background preserves credentialed CORS request and maps HTTP/network failures', async () => {
  let request;
  const success = createBackgroundHarness(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ match: 'not_found', contact: null, actions: {} }) };
  });
  assert.equal((await success.lookup()).match, 'not_found');
  assert.equal(request.options.credentials, 'include');
  assert.equal(request.options.mode, 'cors');
  assert.match(request.url, /\/api\/whatsapp-context\?phone=5521981763562/);

  for (const [status, expected] of [[401, 'login_required'], [403, 'error'], [500, 'error']]) {
    const harness = createBackgroundHarness(async () => ({ ok: false, status, json: async () => ({ error: 'internal' }) }));
    assert.equal((await harness.lookup()).status, expected);
  }
  const network = createBackgroundHarness(async () => { throw new Error('private network detail'); });
  const networkResult = await network.lookup();
  assert.equal(networkResult.status, 'error');
  assert.equal(networkResult.message, 'Não foi possível conectar ao Aspen.');
});

test('background aborts a hung request and returns a recoverable timeout state', async () => {
  const harness = createBackgroundHarness((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }), {
    setTimeout(callback) { Promise.resolve().then(callback); return 1; },
    clearTimeout() {},
  });
  const result = await harness.lookup();
  assert.equal(result.status, 'error');
  assert.equal(result.message, 'Aspen indisponível. Tente novamente.');
});
