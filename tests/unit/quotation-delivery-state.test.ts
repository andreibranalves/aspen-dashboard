import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateDeliveryState,
  applyReceipt,
  failureTargetState,
  retryDelayMs,
} from '../../api/_modules/quotation-delivery-state.js';

test('receipts advance monotonically and all steps must be delivered', () => {
  assert.equal(applyReceipt('queued', 'PENDING'), 'queued');
  assert.equal(applyReceipt('server_ack', 'READ'), 'read');
  assert.equal(applyReceipt('server_ack', 'PLAYED'), 'read');
  assert.equal(applyReceipt('server_ack', 'DELIVERY_ACK'), 'delivered');
  assert.equal(applyReceipt('delivered', 'SERVER_ACK'), 'delivered');
  assert.equal(applyReceipt('read', 'DELIVERY_ACK'), 'read');
  assert.equal(applyReceipt('server_ack', 'ERROR'), 'needs_review');
  assert.equal(applyReceipt('delivered', 'ERROR'), 'delivered');
  assert.equal(aggregateDeliveryState([]), 'queued');
  assert.equal(aggregateDeliveryState(['delivered', 'read']), 'delivered');
  assert.equal(aggregateDeliveryState(['delivered', 'server_ack']), 'provider_accepted');
});

test('only transient pre-transport failures retry', () => {
  assert.equal(failureTargetState('transient_pre_transport'), 'retry_scheduled');
  assert.equal(failureTargetState('permanent_pre_transport'), 'failed');
  assert.equal(failureTargetState('ambiguous'), 'reconciling');
  assert.deepEqual([1, 2, 3, 4].map(retryDelayMs), [60_000, 300_000, 900_000, null]);
});
