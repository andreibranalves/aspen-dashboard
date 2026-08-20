import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpError } from '../../api/_shared/http-error.js';
import { crmDeals, quoteLeads, salesOrders } from '../../api/_infrastructure/db/schema.js';

test('exposes first-party domain tables and a neutral HTTP error', () => {
  const error = createHttpError(409, 'Conflito.');
  assert.equal(error.statusCode, 409);
  assert.equal(error.logMessage, 'Conflito.');
  assert.ok(crmDeals.id);
  assert.ok(quoteLeads.identityKey);
  assert.ok(salesOrders.orderNumber);
});
