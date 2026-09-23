import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ClientMatchRequest,
  ClientMatchResponse,
  LinkedClient,
} from '../../src/lib/api/clientMatchApi.ts';
import type { Draft, DraftEdited } from '../../src/types/domain.ts';
import {
  AutomaticClientResolutionController,
  clientResolutionBlockMessage,
  clientResolutionRequest,
  clientResolutionRequestKey,
  clientResolutionSignature,
  clientResolutionTextTerms,
  hasUsableStrongIdentifier,
  isClientResolutionActive,
  isSearchableClientIdentity,
  planClientResolutionApplication,
  planClientSelection,
  viewFromResponse,
  type ClientResolutionCandidate,
  type ClientResolutionView,
} from '../../src/features/quotations/automaticClientResolution.ts';

const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

const IDENTITY_RESPONSE: ClientMatchResponse = {
  status: 'matched',
  matched_client_id: CLIENT_A,
  candidates: [
    {
      id: CLIENT_A,
      nome: 'Maria Souza',
      empresa: 'Souza Ltda',
      documento: '**.***.***/****-90',
      email: 'maria@example.com',
      telefone: '11988887777',
      arquivado: false,
      matched_by: ['email'],
    },
  ],
  total_candidates: 1,
  page: 1,
  has_more: false,
};

function envelope(overrides: Partial<ClientMatchResponse>): ClientMatchResponse {
  return {
    status: 'not_found',
    matched_client_id: null,
    candidates: [],
    total_candidates: 0,
    page: 1,
    has_more: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<ClientResolutionCandidate> = {}): ClientResolutionCandidate {
  return {
    id: CLIENT_A,
    nome: 'Maria Souza',
    empresa: 'Souza Ltda',
    documento: '**.***.***/****-90',
    email: 'maria@example.com',
    telefone: '11988887777',
    arquivado: false,
    matchedBy: ['email'],
    ...overrides,
  };
}

const ENDERECO = {
  cep: '01001000',
  logradouro: 'Rua A',
  numero: '10',
  complemento: '',
  bairro: 'Centro',
  cidade: 'São Paulo',
  uf: 'SP',
};

function makeDraft(overrides: Partial<DraftEdited> = {}, index = 0): Draft {
  return {
    index,
    original: { nome: 'Maria Souza', itens: [{ item_code: 'SKU-1', qty: 2 }] },
    edited: {
      nome: 'Maria Souza',
      empresa: 'Souza Ltda',
      email: 'maria@example.com',
      telefone: '(11) 98888-7777',
      urgente: false,
      origem: 'Google Ads',
      cnpj: '',
      endereco: ENDERECO,
      items: [{ item_code: 'SKU-1', qty: 2, rate: 10 }],
      prazo_producao: '5 dias',
      observacoes: 'Entrega combinada',
      ...overrides,
    },
    approved: false,
    discarded: false,
  };
}

async function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}

function createScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    schedule(callback: () => void, delayMs: number) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + Math.max(0, delayMs), callback });
      return () => {
        timers.delete(id);
      };
    },
    pending: () => timers.size,
    async advance(ms: number) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((left, right) => left[1].at - right[1].at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.callback();
      }
      await flush();
    },
  };
}

interface Settle {
  resolve: (value: ClientMatchResponse) => void;
  reject: (error: unknown) => void;
}

function createHarness(
  drafts: Draft[],
  options: {
    matches?: (input: ClientMatchRequest) => Promise<ClientMatchResponse>;
    linked?: (clientId: string) => Promise<LinkedClient>;
  } = {}
) {
  const state = { drafts };
  const scheduler = createScheduler();
  const calls = { matches: [] as ClientMatchRequest[], linked: [] as string[] };
  const edits: Array<{ index: number; edited: Partial<DraftEdited>; system: Partial<DraftEdited> }> = [];
  const settles: Settle[] = [];
  const controller = new AutomaticClientResolutionController({
    fetchMatches: (input) => {
      calls.matches.push(input);
      if (options.matches) return options.matches(input);
      const deferred = Promise.withResolvers<ClientMatchResponse>();
      settles.push({ resolve: deferred.resolve, reject: deferred.reject });
      return deferred.promise;
    },
    fetchLinked: (clientId) => {
      calls.linked.push(clientId);
      if (options.linked) return options.linked(clientId);
      return Promise.resolve({ id: clientId, nome: 'Maria Souza', arquivado: false });
    },
    schedule: scheduler.schedule,
    applyEdits: (index, plan) => {
      edits.push({ index, edited: plan.edited, system: plan.system });
      state.drafts = state.drafts.map((draft) => (
        draft.index === index
          ? { ...draft, edited: { ...draft.edited, ...plan.edited, ...plan.system } }
          : draft
      ));
    },
    notify: () => {},
  });
  return {
    controller,
    state,
    calls,
    edits,
    settles,
    scheduler,
    sync: (enabled = true) => controller.sync(state.drafts, enabled),
    edit: (index: number, fields: Partial<DraftEdited>) => {
      state.drafts = state.drafts.map((draft) => (
        draft.index === index ? { ...draft, edited: { ...draft.edited, ...fields } } : draft
      ));
    },
  };
}

test('the identity signature ignores formatting-only edits', () => {
  const base = {
    nome: 'José  da Silva',
    empresa: 'Ávila & Cia',
    email: ' Maria@Example.com ',
    telefone: '(11) 98888-7777',
    cnpj: '12.345.678/0001-90',
  };
  const reformatted = {
    nome: 'jose da silva',
    empresa: 'avila & cia',
    email: 'maria@example.com',
    telefone: '11988887777',
    cnpj: '12345678000190',
  };
  assert.equal(clientResolutionSignature(base), clientResolutionSignature(reformatted));
});

test('a relevant identity edit changes the signature', () => {
  const base = { nome: 'Maria', telefone: '11988887777' };
  assert.notEqual(
    clientResolutionSignature(base),
    clientResolutionSignature({ ...base, nome: 'Mariana' })
  );
  assert.notEqual(
    clientResolutionSignature(base),
    clientResolutionSignature({ ...base, telefone: '11988887778' })
  );
});

test('the request identity is the draft index plus its data version', () => {
  const first = clientResolutionSignature({ nome: 'Maria' });
  const second = clientResolutionSignature({ nome: 'Mariana' });
  assert.equal(clientResolutionRequestKey(2, first), clientResolutionRequestKey(2, first));
  assert.notEqual(clientResolutionRequestKey(2, first), clientResolutionRequestKey(2, second));
  assert.notEqual(clientResolutionRequestKey(2, first), clientResolutionRequestKey(3, first));
});

test('only the current data version of an active draft applies its response', () => {
  const request = { key: clientResolutionRequestKey(0, 'sig'), token: Symbol('request') };
  const base = {
    request,
    token: request.token,
    draftActive: true,
    draftSignature: 'sig',
    responseSignature: 'sig',
  };
  assert.deepEqual(planClientResolutionApplication(base), { apply: true });
  assert.deepEqual(planClientResolutionApplication({ ...base, draftActive: false }), { apply: false });
  assert.deepEqual(
    planClientResolutionApplication({ ...base, token: Symbol('other') }),
    { apply: false }
  );
  assert.deepEqual(
    planClientResolutionApplication({ ...base, responseSignature: 'older' }),
    { apply: false }
  );
  assert.deepEqual(
    planClientResolutionApplication({ ...base, request: undefined }),
    { apply: false }
  );
});

test('a short name alone is not searchable and a usable identifier is', () => {
  assert.equal(isSearchableClientIdentity({ nome: 'Jo' }), false);
  assert.equal(isSearchableClientIdentity({ nome: 'Jo', empresa: 'ab' }), false);
  assert.equal(isSearchableClientIdentity({ nome: '  ', empresa: '' }), false);
  assert.equal(isSearchableClientIdentity({ nome: 'Jos' }), true);
  assert.equal(isSearchableClientIdentity({ nome: 'Jo', email: 'a@b.com' }), true);
  assert.equal(isSearchableClientIdentity({ nome: 'Jo', telefone: '(11) 9' }), true);
  assert.deepEqual(clientResolutionTextTerms({ nome: 'Jo', empresa: 'ABC Ltda' }), ['ABC Ltda']);
});

test('a filled but unusable identifier still requires the explicit confirmation', () => {
  assert.equal(hasUsableStrongIdentifier({ email: 'maria@example.com' }), true);
  assert.equal(hasUsableStrongIdentifier({ cnpj: '12.345.678/0001-90' }), true);
  assert.equal(hasUsableStrongIdentifier({ telefone: '(11) 98888-7777' }), true);
  assert.equal(hasUsableStrongIdentifier({ email: 'maria' }), false);
  assert.equal(hasUsableStrongIdentifier({ cnpj: '123' }), false);
  assert.equal(hasUsableStrongIdentifier({ telefone: '119' }), false);
  assert.equal(hasUsableStrongIdentifier({ nome: 'Maria' }), false);
});

test('the request carries only what the identity actually fills', () => {
  assert.deepEqual(
    clientResolutionRequest({ nome: ' Maria ', empresa: '', email: null, telefone: '  ', cnpj: '' }),
    { nome: 'Maria' }
  );
});

test('every state maps to its blocking message', () => {
  assert.equal(clientResolutionBlockMessage({ state: 'idle' }), null);
  assert.equal(
    clientResolutionBlockMessage({ state: 'checking' }),
    'Aguardando a verificação do cliente.'
  );
  assert.equal(clientResolutionBlockMessage({ state: 'linked', clientId: CLIENT_A, nome: 'Maria' }), null);
  assert.equal(
    clientResolutionBlockMessage({ state: 'choice', reason: 'multiple_matches', candidates: [], allowNewClient: false }),
    'Escolha o cliente para continuar.'
  );
  assert.equal(
    clientResolutionBlockMessage({ state: 'archived', clientId: CLIENT_A, nome: 'Maria' }),
    'Cliente arquivado. Regularize o cadastro na tela Clientes para continuar.'
  );
  assert.equal(
    clientResolutionBlockMessage({ state: 'new_client', needsConfirmation: true, confirmed: false }),
    'Confirme que é um novo cliente para continuar.'
  );
  assert.equal(
    clientResolutionBlockMessage({ state: 'new_client', needsConfirmation: true, confirmed: true }),
    null
  );
  assert.equal(
    clientResolutionBlockMessage({ state: 'new_client', needsConfirmation: false, confirmed: false }),
    null
  );
  assert.equal(
    clientResolutionBlockMessage({ state: 'error' }),
    'Não foi possível verificar o cliente. Tente novamente.'
  );
});

test('each response status maps onto the card view', () => {
  const matched = IDENTITY_RESPONSE.candidates[0];
  assert.deepEqual(
    viewFromResponse(IDENTITY_RESPONSE, {}),
    { state: 'linked', clientId: CLIENT_A, nome: 'Maria Souza' }
  );
  assert.deepEqual(
    viewFromResponse(envelope({ status: 'review', reason: 'weak_matches_only', candidates: [matched] }), {}),
    { state: 'choice', reason: 'weak_matches_only', candidates: [candidate()], allowNewClient: true }
  );
  assert.deepEqual(
    viewFromResponse(
      envelope({ status: 'review', reason: 'archived_match', candidates: [{ ...matched, arquivado: true }] }),
      {}
    ),
    { state: 'archived', clientId: CLIENT_A, nome: 'Maria Souza' }
  );
  // An archived strong match beside an active one forces the choice, and the
  // archived candidate stays flagged for the card to keep it unavailable.
  assert.deepEqual(
    viewFromResponse(
      envelope({
        status: 'review',
        reason: 'archived_match',
        candidates: [{ ...matched, arquivado: true }, { ...matched, id: CLIENT_B }],
      }),
      {}
    ),
    {
      state: 'choice',
      reason: 'archived_match',
      candidates: [candidate({ arquivado: true }), candidate({ id: CLIENT_B })],
      allowNewClient: false,
    }
  );
  assert.deepEqual(
    viewFromResponse(
      envelope({
        status: 'review',
        reason: 'archived_match',
        candidates: [
          { ...matched, arquivado: true },
          { ...matched, id: CLIENT_B, arquivado: true },
        ],
      }),
      {}
    ),
    { state: 'archived', clientId: null, nome: null }
  );
  assert.deepEqual(
    viewFromResponse(envelope({}), { hasStrongIdentifier: true }),
    { state: 'new_client', needsConfirmation: false, confirmed: false }
  );
  assert.deepEqual(
    viewFromResponse(envelope({}), { hasStrongIdentifier: false }),
    { state: 'new_client', needsConfirmation: true, confirmed: false }
  );
  assert.deepEqual(
    viewFromResponse(envelope({ status: 'insufficient' }), { hasStrongIdentifier: true }),
    { state: 'new_client', needsConfirmation: true, confirmed: false }
  );
  assert.deepEqual(
    viewFromResponse(envelope({ status: 'review', reason: 'multiple_matches' }), {}),
    { state: 'error' }
  );
  assert.deepEqual(
    viewFromResponse(envelope({ status: 'matched', matched_client_id: CLIENT_B }), {}),
    { state: 'error' }
  );
});

test('the query starts only after the debounce window', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync();
  assert.deepEqual(harness.controller.views()[0], { state: 'checking' });
  await harness.scheduler.advance(299);
  assert.equal(harness.calls.matches.length, 0);
  await harness.scheduler.advance(1);
  assert.equal(harness.calls.matches.length, 1);
  assert.deepEqual(harness.calls.matches[0], {
    nome: 'Maria Souza',
    empresa: 'Souza Ltda',
    email: 'maria@example.com',
    telefone: '(11) 98888-7777',
  });
  harness.settles[0].resolve(IDENTITY_RESPONSE);
  await flush();
  assert.deepEqual(harness.controller.views()[0], {
    state: 'linked',
    clientId: CLIENT_A,
    nome: 'Maria Souza',
  });
  // Automatic linking assigns the reference and keeps the typed data.
  assert.equal(harness.state.drafts[0].edited.client_id, CLIENT_A);
  assert.equal(harness.state.drafts[0].edited.telefone, '(11) 98888-7777');
});

test('editing the identity restarts the debounce instead of querying per keystroke', async () => {
  const harness = createHarness([makeDraft({ nome: 'Mar' })]);
  harness.sync();
  await harness.scheduler.advance(200);
  harness.edit(0, { nome: 'Mari' });
  harness.sync();
  await harness.scheduler.advance(200);
  assert.equal(harness.calls.matches.length, 0);
  await harness.scheduler.advance(100);
  assert.equal(harness.calls.matches.length, 1);
  assert.equal(harness.calls.matches[0].nome, 'Mari');
});

test('a late response from an older data version never applies', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync();
  await harness.scheduler.advance(300);
  assert.equal(harness.calls.matches.length, 1);

  harness.edit(0, { nome: 'Mariana Souza' });
  harness.sync();
  await harness.scheduler.advance(300);
  assert.equal(harness.calls.matches.length, 2);

  harness.settles[1].resolve(envelope({}));
  await flush();
  assert.deepEqual(harness.controller.views()[0], {
    state: 'new_client',
    needsConfirmation: false,
    confirmed: false,
  });

  // The first query answers after the second one: it must not overwrite the
  // decision the operator already sees, nor link a client.
  harness.settles[0].resolve(IDENTITY_RESPONSE);
  await flush();
  assert.deepEqual(harness.controller.views()[0], {
    state: 'new_client',
    needsConfirmation: false,
    confirmed: false,
  });
  assert.equal(harness.state.drafts[0].edited.client_id, undefined);
});

test('a stale link response never restores a client id the operator removed', async () => {
  const pendingLink = Promise.withResolvers<LinkedClient>();
  const harness = createHarness([makeDraft({ client_id: CLIENT_A })], {
    linked: () => pendingLink.promise,
  });
  harness.sync();
  await harness.scheduler.advance(300);
  assert.deepEqual(harness.calls.linked, [CLIENT_A]);

  harness.controller.clearSelection(0);
  assert.equal(harness.state.drafts[0].edited.client_id, undefined);
  await harness.scheduler.advance(0);
  assert.equal(harness.calls.matches.length, 1);

  pendingLink.resolve({ id: CLIENT_A, nome: 'Maria Souza', arquivado: false });
  await flush();
  assert.deepEqual(harness.controller.views()[0], { state: 'checking' });
  assert.equal(harness.state.drafts[0].edited.client_id, undefined);

  harness.settles[0].resolve(envelope({}));
  await flush();
  assert.deepEqual(harness.controller.views()[0], {
    state: 'new_client',
    needsConfirmation: false,
    confirmed: false,
  });
});

test('a relevant identity edit drops the link and the confirmation', async () => {
  const harness = createHarness([
    makeDraft({ client_id: CLIENT_A }),
    makeDraft({ email: '', telefone: '', cnpj: '' }, 1),
  ]);
  harness.sync();
  await harness.scheduler.advance(300);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'linked',
    clientId: CLIENT_A,
    nome: 'Maria Souza',
  });
  assert.deepEqual(harness.controller.views()[1], { state: 'checking' });
  harness.settles[0].resolve(envelope({}));
  await flush();
  assert.deepEqual(harness.controller.views()[1], {
    state: 'new_client',
    needsConfirmation: true,
    confirmed: false,
  });
  harness.controller.confirmNewClient(1);
  assert.equal(harness.state.drafts[1].edited.confirm_new_client, true);
  assert.deepEqual(harness.controller.views()[1], {
    state: 'new_client',
    needsConfirmation: true,
    confirmed: true,
  });

  harness.edit(0, { nome: 'Mariana Souza' });
  harness.edit(1, { telefone: '(11) 98888-7778' });
  harness.sync();
  assert.equal(harness.state.drafts[0].edited.client_id, undefined);
  assert.equal(harness.state.drafts[1].edited.confirm_new_client, undefined);
  assert.deepEqual(harness.controller.views()[0], { state: 'checking' });
  assert.deepEqual(harness.controller.views()[1], { state: 'checking' });
});

test('a mask-only edit keeps a valid selection', async () => {
  const harness = createHarness([makeDraft({ client_id: CLIENT_A, telefone: '(11) 98888-7777' })]);
  harness.sync();
  await harness.scheduler.advance(300);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'linked',
    clientId: CLIENT_A,
    nome: 'Maria Souza',
  });
  const editsBefore = harness.edits.length;

  harness.edit(0, { telefone: '11988887777' });
  harness.sync();
  assert.equal(harness.state.drafts[0].edited.client_id, CLIENT_A);
  assert.equal(harness.edits.length, editsBefore);
  assert.equal(harness.calls.linked.length, 1);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'linked',
    clientId: CLIENT_A,
    nome: 'Maria Souza',
  });
});

test('nothing searchable skips the network entirely', async () => {
  const harness = createHarness([
    makeDraft({ nome: 'Jo', empresa: '', email: '', telefone: '', cnpj: '' }),
  ]);
  harness.sync();
  await harness.scheduler.advance(1000);
  assert.deepEqual(harness.calls.matches, []);
  assert.deepEqual(harness.calls.linked, []);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'new_client',
    needsConfirmation: true,
    confirmed: false,
  });
});

test('a restored link is revalidated and an archived register stays blocked', async () => {
  const harness = createHarness([makeDraft({ client_id: CLIENT_A })], {
    linked: async (clientId) => ({ id: clientId, nome: 'Maria Souza (cadastro)', arquivado: true }),
  });
  harness.sync();
  await harness.scheduler.advance(300);
  assert.deepEqual(harness.calls.linked, [CLIENT_A]);
  assert.deepEqual(harness.calls.matches, []);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'archived',
    clientId: CLIENT_A,
    nome: 'Maria Souza (cadastro)',
  });
});

test('a failed query shows the retry instead of a new client', async () => {
  const harness = createHarness([makeDraft()], {
    matches: async () => {
      throw new Error('offline');
    },
  });
  harness.sync();
  await harness.scheduler.advance(300);
  assert.deepEqual(harness.controller.views()[0], { state: 'error' });
  harness.controller.retry(0);
  await harness.scheduler.advance(0);
  assert.equal(harness.calls.matches.length, 2);
});

test('a frozen identity neither queries nor applies a pending response', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync();
  await harness.scheduler.advance(300);
  assert.equal(harness.calls.matches.length, 1);

  harness.sync(false);
  harness.settles[0].resolve(IDENTITY_RESPONSE);
  await flush();
  assert.deepEqual(harness.controller.views()[0], { state: 'checking' });
  assert.equal(harness.state.drafts[0].edited.client_id, undefined);

  harness.sync(true);
  await harness.scheduler.advance(300);
  assert.equal(harness.calls.matches.length, 2);
});

test('a frozen card starts no new query', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync(false);
  await harness.scheduler.advance(1000);
  assert.deepEqual(harness.calls.matches, []);
});

test('discarded, saved and issued drafts receive no resolution', async () => {
  const harness = createHarness([
    makeDraft({}, 0),
    { ...makeDraft({}, 1), discarded: true },
    { ...makeDraft({}, 2), status: 'done' },
    {
      ...makeDraft({}, 3),
      saved: { quotationId: 'q1', businessNumber: 'ORC-1', revisionId: 'r1', concurrencyToken: 't1' },
    },
  ]);
  harness.sync();
  await harness.scheduler.advance(1000);
  assert.deepEqual(Object.keys(harness.controller.views()), ['0']);
  assert.equal(harness.calls.matches.length, 1);
  assert.equal(isClientResolutionActive(makeDraft()), true);
  assert.equal(isClientResolutionActive({ ...makeDraft(), discarded: true }), false);
  assert.equal(
    isClientResolutionActive({
      ...makeDraft(),
      saved: { quotationId: 'q1', businessNumber: 'ORC-1', revisionId: 'r1', concurrencyToken: 't1' },
    }),
    false
  );
});

test('selecting a candidate fills the canonical register atomically', async () => {
  const original = { nome: 'Maria Souza', itens: [{ item_code: 'SKU-1', qty: 2 }] };
  const draft = makeDraft({
    nome: 'maria souza',
    empresa: '',
    email: '',
    telefone: '',
    cnpj: '12.345.678/0001-90',
    opportunity_id: CLIENT_B,
    new_demand: false,
    demand_summary: 'Troca de tela',
  });
  draft.original = original;
  const harness = createHarness([draft]);
  harness.sync();
  await harness.scheduler.advance(300);

  harness.controller.selectClient(0, candidate({
    documento: '12345678000190',
    email: 'contato@example.com',
    telefone: '1132658899',
  }));
  const edited = harness.state.drafts[0].edited;
  assert.equal(edited.client_id, CLIENT_A);
  assert.equal(edited.nome, 'Maria Souza');
  assert.equal(edited.empresa, 'Souza Ltda');
  assert.equal(edited.email, 'contato@example.com');
  assert.equal(edited.telefone, '1132658899');
  assert.equal(edited.cnpj, '12345678000190');
  assert.equal(edited.confirm_new_client, undefined);
  assert.equal(edited.opportunity_id, undefined);
  assert.equal(edited.new_demand, false);
  assert.equal(edited.demand_summary, undefined);
  // Everything the selection must not touch is preserved.
  assert.deepEqual(edited.items, [{ item_code: 'SKU-1', qty: 2, rate: 10 }]);
  assert.deepEqual(edited.endereco, ENDERECO);
  assert.equal(edited.observacoes, 'Entrega combinada');
  assert.equal(edited.prazo_producao, '5 dias');
  assert.deepEqual(harness.state.drafts[0].original, original);
  assert.deepEqual(harness.edits[0].system, {
    opportunity_id: undefined,
    new_demand: false,
    demand_summary: undefined,
  });

  // The canonical fill records its own signature: it never loops into a query.
  const requestsBefore = harness.calls.matches.length;
  harness.sync();
  await harness.scheduler.advance(1000);
  assert.equal(harness.calls.matches.length, requestsBefore);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'linked',
    clientId: CLIENT_A,
    nome: 'Maria Souza',
  });
});

test('the canonical fill keeps what the register does not provide', () => {
  const draft = makeDraft({ empresa: 'Empresa digitada', cnpj: '12345678000190' });
  const plan = planClientSelection(draft, candidate({
    empresa: null,
    email: null,
    telefone: null,
    documento: '**.***.***/****-90',
  }));
  assert.equal(plan.edited.empresa, 'Empresa digitada');
  assert.equal(plan.edited.email, 'maria@example.com');
  assert.equal(plan.edited.telefone, '(11) 98888-7777');
  // A masked document never fills the draft.
  assert.equal(plan.edited.cnpj, '12345678000190');
  assert.equal(clientResolutionSignature(plan.identity), clientResolutionSignature(plan.edited));
});

test('an explicit new-client confirmation unblocks only that identity', async () => {
  const harness = createHarness([
    makeDraft({ nome: 'Maria Souza', email: '', telefone: '', cnpj: '' }),
  ]);
  harness.sync();
  await harness.scheduler.advance(300);
  harness.settles[0].resolve(envelope({}));
  await flush();
  const pending: ClientResolutionView = {
    state: 'new_client',
    needsConfirmation: true,
    confirmed: false,
  };
  assert.deepEqual(harness.controller.views()[0], pending);
  assert.equal(clientResolutionBlockMessage(pending), 'Confirme que é um novo cliente para continuar.');

  harness.controller.confirmNewClient(0);
  assert.equal(harness.state.drafts[0].edited.confirm_new_client, true);
  assert.equal(clientResolutionBlockMessage(harness.controller.views()[0]), null);

  harness.edit(0, { nome: 'Joana Souza' });
  harness.sync();
  assert.equal(harness.state.drafts[0].edited.confirm_new_client, undefined);
  assert.equal(clientResolutionBlockMessage(harness.controller.views()[0]), 'Aguardando a verificação do cliente.');
});

test('weak suggestions allow refusing them in favour of an explicit new client', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync();
  await harness.scheduler.advance(300);
  const matched = IDENTITY_RESPONSE.candidates[0];
  harness.settles[0].resolve(
    envelope({ status: 'review', reason: 'weak_matches_only', candidates: [matched] })
  );
  await flush();

  const suggesting = harness.controller.views()[0];
  assert.deepEqual(suggesting, {
    state: 'choice',
    reason: 'weak_matches_only',
    candidates: [candidate()],
    allowNewClient: true,
  });
  assert.equal(
    clientResolutionBlockMessage(suggesting),
    'Escolha o cliente ou confirme que é um novo cadastro.'
  );

  harness.controller.confirmNewClient(0);
  assert.equal(harness.state.drafts[0].edited.confirm_new_client, true);
  assert.deepEqual(harness.controller.views()[0], {
    state: 'new_client',
    needsConfirmation: true,
    confirmed: true,
  });
  assert.equal(clientResolutionBlockMessage(harness.controller.views()[0]), null);
});

test('an e-mail or phone shared with another client may be declined as a new client', async () => {
  const harness = createHarness([makeDraft()]);
  harness.sync();
  await harness.scheduler.advance(300);
  const matched = IDENTITY_RESPONSE.candidates[0];
  harness.settles[0].resolve(
    envelope({ status: 'review', reason: 'identifier_in_use', candidates: [matched] })
  );
  await flush();

  const view = harness.controller.views()[0];
  assert.equal(view.state, 'choice');
  assert.equal(view.state === 'choice' && view.allowNewClient, true);

  harness.controller.confirmNewClient(0);
  assert.equal(harness.state.drafts[0].edited.confirm_new_client, true);
  assert.equal(clientResolutionBlockMessage(harness.controller.views()[0]), null);
});

test('a strong-match choice cannot be declined as a new client', async () => {
  const harness = createHarness([makeDraft({ telefone: '11999990000' })]);
  harness.sync();
  await harness.scheduler.advance(300);
  const matched = IDENTITY_RESPONSE.candidates[0];
  harness.settles[0].resolve(
    envelope({
      status: 'review',
      reason: 'multiple_matches',
      candidates: [matched, { ...matched, id: CLIENT_B }],
    })
  );
  await flush();

  assert.deepEqual(harness.controller.views()[0], {
    state: 'choice',
    reason: 'multiple_matches',
    candidates: [candidate(), candidate({ id: CLIENT_B })],
    allowNewClient: false,
  });

  harness.controller.confirmNewClient(0);
  assert.equal(harness.state.drafts[0].edited.confirm_new_client, undefined);
  assert.equal(harness.controller.views()[0].state, 'choice');
});
