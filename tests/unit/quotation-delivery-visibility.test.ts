import assert from 'node:assert/strict';
import test from 'node:test';

import { toPublicDeliveryView } from '../../api/_modules/quotation-deliveries.js';
import {
  projectDelivery,
  resolveDelivery,
  type DeliveryView,
} from '../../src/lib/api/quotationDeliveryApi.ts';

const updatedAt = '2026-09-18T13:26:00.000Z';

function step(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    position: 0,
    type: 'text',
    state: 'queued',
    attemptCount: 0,
    publicError: null,
    failureKind: null,
    retryBlocked: false,
    nextAttemptAt: null,
    acceptedAt: null,
    deliveredAt: null,
    readAt: null,
    updatedAt,
    ...overrides,
  };
}

function delivery(overrides: Partial<DeliveryView> = {}): DeliveryView {
  const steps = overrides.steps || [step()];
  const accepted = steps.filter((entry) =>
    ['server_ack', 'delivered', 'read'].includes(entry.state)
  ).length;
  const delivered = steps.filter((entry) => ['delivered', 'read'].includes(entry.state)).length;
  return {
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511900000001',
    flowId: 'flow-1',
    flowName: 'Fluxo',
    state: 'queued',
    publicError: null,
    completionSource: null,
    progress: { accepted, delivered, total: steps.length },
    steps,
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: updatedAt,
    updatedAt,
    ...overrides,
  } as DeliveryView;
}

test('a delivery whose dispatch was never accepted does not claim it was sent', () => {
  // The incident screen: Evolution unreachable, so the step is ambiguous and the
  // aggregate sits in reconciliation. Nothing was confirmed by the provider.
  const projection = projectDelivery(
    delivery({
      state: 'reconciling',
      steps: [
        step({
          state: 'reconciling',
          publicError:
            'O resultado do transporte requer reconciliação. Não reenvie automaticamente.',
        }),
      ],
    })
  );
  assert.equal(projection.label, 'Reconciliação em andamento');
  assert.equal(projection.sendConfirmed, false);
  assert.equal(projection.canRetrySameRevision, false);
  assert.doesNotMatch(projection.sendBlockedReason, /já foi enviado/i);
  assert.match(projection.sendBlockedReason, /Aguardando a confirmação/);
  assert.equal(projection.requiresAction, false);
});

test('acceptance is what authorizes the sent wording, never the delivery row', () => {
  const accepted = projectDelivery(
    delivery({
      state: 'provider_accepted',
      steps: [step({ state: 'server_ack', acceptedAt: updatedAt })],
    })
  );
  assert.equal(accepted.sendConfirmed, true);
  assert.equal(accepted.sendBlockedReason, 'Este orçamento já foi enviado pelo WhatsApp.');
  const delivered = projectDelivery(
    delivery({
      state: 'delivered',
      deliveredAt: updatedAt,
      steps: [
        step({ state: 'read', acceptedAt: updatedAt, deliveredAt: updatedAt, readAt: updatedAt }),
      ],
    })
  );
  assert.equal(delivered.label, 'Entregue');
  assert.equal(delivered.sendConfirmed, true);
});

test('reconciliation needing a decision offers the resolution action', () => {
  const projection = projectDelivery(
    delivery({ state: 'needs_review', steps: [step({ state: 'needs_review' })] })
  );
  assert.equal(projection.requiresAction, true);
  assert.equal(projection.canRetrySameRevision, false);
  assert.match(projection.sendBlockedReason, /precisa da sua decisão/);
});

test('only a provably pre-transport failure unlocks re-sending the same revision', () => {
  const retryable = projectDelivery(
    delivery({
      state: 'failed',
      publicError: 'O provedor rejeitou o transporte.',
      steps: [step({ state: 'failed', failureKind: 'permanent_pre_transport', attemptCount: 1 })],
    })
  );
  assert.equal(retryable.canRetrySameRevision, true);
  assert.equal(retryable.label, 'Falhou antes do envio');
  assert.match(retryable.sendBlockedReason, /Reenvie a mesma revisão/);

  const exhausted = projectDelivery(
    delivery({
      state: 'failed',
      steps: [step({ state: 'failed', failureKind: 'transient_pre_transport', attemptCount: 4 })],
    })
  );
  assert.equal(exhausted.canRetrySameRevision, true);

  // Ambiguity never reaches `failed`, so a legacy failed step without a
  // classified kind keeps the previous block.
  const unclassified = projectDelivery(
    delivery({ state: 'failed', steps: [step({ state: 'failed' })] })
  );
  assert.equal(unclassified.canRetrySameRevision, false);
  assert.equal(
    unclassified.sendBlockedReason,
    'A entrega falhou e esta revisão não pode ser reenviada.'
  );

  // A step that already carried a provider id or acceptance clock is not
  // provably pre-transport, even when its last failure was.
  const previouslyAccepted = projectDelivery(
    delivery({
      state: 'failed',
      steps: [
        step({
          state: 'failed',
          failureKind: 'permanent_pre_transport',
          acceptedAt: updatedAt,
        }),
      ],
    })
  );
  assert.equal(previouslyAccepted.canRetrySameRevision, false);

  const cancelled = projectDelivery(
    delivery({
      state: 'failed',
      completionSource: 'operator',
      steps: [step({ state: 'failed', failureKind: 'permanent_pre_transport' })],
    })
  );
  assert.equal(cancelled.canRetrySameRevision, false);
  assert.equal(cancelled.label, 'Cancelada pelo operador');
  assert.equal(cancelled.sendBlockedReason, 'A entrega foi cancelada pelo operador.');
});

test('an undeliverable revision never offers the same-revision re-send', () => {
  // The revision expired (or its frozen step no longer matches it). Nothing left
  // the machine, but re-sending the same revision fails again with the same
  // cause, so the screen keeps the existing path: emit a new revision.
  const projection = projectDelivery(
    delivery({
      state: 'failed',
      publicError: 'A revisão do orçamento não está disponível para envio.',
      steps: [
        step({
          state: 'failed',
          failureKind: 'permanent_pre_transport',
          publicError: 'A revisão do orçamento não está disponível para envio.',
          retryBlocked: true,
        }),
      ],
    })
  );
  assert.equal(projection.canRetrySameRevision, false);
  assert.equal(
    projection.sendBlockedReason,
    'A revisão não está disponível para envio. Emita uma nova revisão.'
  );
  assert.doesNotMatch(projection.sendBlockedReason, /Reenvie a mesma revisão/);
});

test('acceptance evidence, not the step state, decides the sent wording', () => {
  // An ERROR receipt moves an accepted step back to `needs_review` while the
  // durable acceptance clock stays: the provider did take the message.
  const regressed = projectDelivery(
    delivery({
      state: 'needs_review',
      steps: [step({ state: 'needs_review', acceptedAt: updatedAt })],
    })
  );
  assert.equal(regressed.sendConfirmed, true);
  assert.equal(
    regressed.sendBlockedReason,
    'A entrega precisa da sua decisão antes de qualquer reenvio.'
  );

  // The operator confirmation carries no provider acceptance, so it never
  // claims a message was confirmed by WhatsApp.
  const manuallyConfirmed = projectDelivery(
    delivery({
      state: 'delivered',
      completionSource: 'operator',
      deliveredAt: updatedAt,
      steps: [step({ state: 'delivered', deliveredAt: updatedAt })],
    })
  );
  assert.equal(manuallyConfirmed.sendConfirmed, false);
});

test('the public view counts acceptance and delivery as separate facts', () => {
  const view = toPublicDeliveryView({
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511900000001',
    flowId: 'flow-1',
    flowName: 'Fluxo',
    state: 'provider_accepted',
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    steps: [
      {
        id: 'step-1',
        position: 0,
        type: 'text',
        state: 'server_ack',
        attemptCount: 1,
        publicError: null,
        failureKind: null,
        nextAttemptAt: null,
        acceptedAt: new Date(updatedAt),
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
      {
        id: 'step-2',
        position: 1,
        type: 'quotation_pdf',
        state: 'server_ack',
        attemptCount: 1,
        publicError: null,
        failureKind: null,
        nextAttemptAt: null,
        acceptedAt: new Date(updatedAt),
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
      {
        id: 'step-3',
        position: 2,
        type: 'text',
        state: 'delivered',
        attemptCount: 1,
        publicError: null,
        failureKind: null,
        nextAttemptAt: null,
        acceptedAt: new Date(updatedAt),
        deliveredAt: new Date(updatedAt),
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
    ],
  } as never);
  // The incident showed "0 de 3" for three accepted steps: acceptance and
  // delivery are now counted apart instead of conflated.
  assert.deepEqual(view.progress, { accepted: 3, delivered: 1, total: 3 });

  const regressed = toPublicDeliveryView({
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511900000001',
    flowId: 'flow-1',
    flowName: 'Fluxo',
    state: 'needs_review',
    completionSource: null,
    publicError: null,
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    steps: [
      {
        id: 'step-1',
        position: 0,
        type: 'text',
        state: 'needs_review',
        attemptCount: 1,
        publicError: null,
        failureKind: null,
        nextAttemptAt: null,
        acceptedAt: new Date(updatedAt),
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
      {
        id: 'step-2',
        position: 1,
        type: 'text',
        state: 'delivered',
        attemptCount: 1,
        publicError: null,
        failureKind: null,
        nextAttemptAt: null,
        acceptedAt: null,
        deliveredAt: new Date(updatedAt),
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
    ],
  } as never);
  // The ERROR receipt did not erase the durable acceptance, and the manually
  // confirmed step is delivery without provider acceptance.
  assert.deepEqual(regressed.progress, { accepted: 1, delivered: 1, total: 2 });
});

test('the public view exposes the failure class the retry decision depends on', () => {
  const view = toPublicDeliveryView({
    id: 'delivery-1',
    revisionId: 'revision-1',
    businessNumber: 'ORC-20260001',
    clientName: 'Cliente',
    phone: '5511900000001',
    flowId: 'flow-1',
    flowName: 'Fluxo',
    state: 'failed',
    completionSource: null,
    publicError: 'O provedor rejeitou o transporte.',
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    steps: [
      {
        id: 'step-1',
        position: 0,
        type: 'text',
        state: 'failed',
        attemptCount: 1,
        publicError: 'O provedor rejeitou o transporte.',
        failureKind: 'permanent_pre_transport',
        nextAttemptAt: null,
        acceptedAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
    ],
  } as never);
  const steps = view.steps as Array<Record<string, unknown>>;
  assert.equal(steps[0]?.failure_kind, 'permanent_pre_transport');
  // A provider rejection keeps the same-revision re-send open; the revision
  // itself being undeliverable closes it, and the wire payload is where the
  // screen learns that.
  assert.equal(steps[0]?.retry_blocked, false);

  const revisionUnavailable = toPublicDeliveryView({
    id: 'delivery-2',
    revisionId: 'revision-2',
    businessNumber: 'ORC-20260002',
    clientName: 'Cliente',
    phone: '5511900000002',
    flowId: 'flow-2',
    flowName: 'Fluxo',
    state: 'failed',
    completionSource: null,
    publicError: 'A revisão do orçamento não está disponível para envio.',
    nextAttemptAt: null,
    actionDeadline: null,
    reconciliationDeadline: null,
    deliveredAt: null,
    createdAt: new Date(updatedAt),
    updatedAt: new Date(updatedAt),
    steps: [
      {
        id: 'step-2',
        position: 0,
        type: 'quotation_pdf',
        state: 'failed',
        attemptCount: 1,
        publicError: 'A revisão do orçamento não está disponível para envio.',
        failureKind: 'permanent_pre_transport',
        nextAttemptAt: null,
        acceptedAt: null,
        deliveredAt: null,
        readAt: null,
        updatedAt: new Date(updatedAt),
      },
    ],
  } as never);
  assert.equal((revisionUnavailable.steps[0] as Record<string, unknown>)?.retry_blocked, true);
});

test('resolveDelivery sends the same-revision retry as an explicit operator decision', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    const view = toPublicDeliveryView(
      {
        id: 'delivery-1',
        revisionId: 'revision-1',
        businessNumber: 'ORC-20260001',
        clientName: 'Cliente',
        phone: '5511900000001',
        flowId: 'flow-1',
        flowName: 'Fluxo',
        state: 'queued',
        completionSource: null,
        publicError: null,
        nextAttemptAt: null,
        actionDeadline: null,
        reconciliationDeadline: null,
        deliveredAt: null,
        createdAt: new Date(updatedAt),
        updatedAt: new Date(updatedAt),
        steps: [],
      } as never,
      { includePhone: true }
    );
    return new Response(JSON.stringify(view), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const resolved = await resolveDelivery(
      'delivery-1',
      'retry_same_revision',
      'Provedor rejeitou antes do envio.'
    );
    assert.equal(resolved.id, 'delivery-1');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, '/api/quotation-deliveries?id=delivery-1');
  assert.deepEqual(calls[0]?.body, {
    decision: 'retry_same_revision',
    note: 'Provedor rejeitou antes do envio.',
  });
});
