import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { DeliveryDiagnostics } from '../../src/lib/api/whatsappDeliveryDiagnosticsApi.ts';
import { deliveryAlarm } from '../../src/lib/deliveryAlarm.ts';

const idle = { steps: 0, followUps: 0, replies: 0, webhookEffects: 0 };

function diagnostics(fields: Partial<DeliveryDiagnostics> = {}): DeliveryDiagnostics {
  return {
    worker: {
      name: 'quotation-delivery-worker',
      lastRunAt: '2026-09-25T14:50:00.000Z',
      result: 'success',
      processed: 0,
      remaining: false,
    },
    messageSweep: null,
    reconcilingSteps: 0,
    pendingReceipts: 0,
    overdue: idle,
    workerStale: false,
    ...fields,
  };
}

describe('delivery alarm', () => {
  it('stays quiet while the worker runs and nothing is overdue', () => {
    assert.equal(deliveryAlarm(diagnostics()), null);
  });

  it('names a worker that never ran', () => {
    const alarm = deliveryAlarm(diagnostics({ worker: null, workerStale: true }));
    assert.equal(alarm?.title, 'Envios automáticos parados');
    assert.deepEqual(alarm?.lines, ['O worker de envios nunca rodou.']);
  });

  it('dates the last run of a stale worker', () => {
    const alarm = deliveryAlarm(
      diagnostics({
        worker: { ...diagnostics().worker!, lastRunAt: '2026-09-19T13:05:00.000Z' },
        workerStale: true,
      })
    );
    assert.deepEqual(alarm?.lines, ['O worker de envios não roda desde 19/09/2026, 10:05.']);
  });

  it('counts only the overdue sources, singular and plural', () => {
    const alarm = deliveryAlarm(
      diagnostics({ overdue: { steps: 13, followUps: 0, replies: 1, webhookEffects: 2 } })
    );
    assert.equal(alarm?.title, 'Envios automáticos parados');
    assert.deepEqual(alarm?.lines, [
      'Parados há mais de 10 min: 13 envios, 1 resposta do Atendimento, 2 efeitos do webhook.',
    ]);
  });

  it('reports both signals together', () => {
    const alarm = deliveryAlarm(
      diagnostics({ worker: null, workerStale: true, overdue: { ...idle, followUps: 1 } })
    );
    assert.deepEqual(alarm?.lines, [
      'O worker de envios nunca rodou.',
      'Parados há mais de 10 min: 1 retorno.',
    ]);
  });
});
