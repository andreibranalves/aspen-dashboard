import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  quotationFollowUps,
  whatsappContactActivity,
  whatsappFollowUpIngestionHealth,
} from '../../api/_infrastructure/db/schema.js';

test('follow-up schema exposes activity, health, and attempt tables', () => {
  assert.equal(whatsappContactActivity.providerConversationId.name, 'provider_conversation_id');
  assert.equal(whatsappContactActivity.canonicalPhone.name, 'canonical_phone');
  assert.equal(whatsappFollowUpIngestionHealth.instance.name, 'instance');
  assert.equal(whatsappFollowUpIngestionHealth.blockedEventKey.name, 'blocked_event_key');
  assert.equal(quotationFollowUps.eligibilityVersion.name, 'eligibility_version');
  assert.equal(quotationFollowUps.messageSnapshot.name, 'message_snapshot');
  assert.equal(quotationFollowUps.firstProviderReceiptAt.name, 'first_provider_receipt_at');
  assert.equal(quotationFollowUps.transportStartedAt.name, 'transport_started_at');

  const followUp = getTableConfig(quotationFollowUps);
  const activity = getTableConfig(whatsappContactActivity);
  const health = getTableConfig(whatsappFollowUpIngestionHealth);

  assert.ok(followUp.foreignKeys.every((fk) => fk.onDelete !== 'cascade'));
  assert.ok(
    followUp.indexes.some((index) => index.config.name === 'quotation_follow_ups_quotation_id_unique')
  );
  assert.ok(
    activity.indexes.some(
      (index) => index.config.name === 'whatsapp_contact_activity_instance_conversation_unique'
    )
  );
  assert.equal(health.columns.length, 7);
  assert.equal(quotationFollowUps.eligibilityVersion.notNull, false);
  assert.equal(quotationFollowUps.messageSnapshot.notNull, false);
  assert.equal(quotationFollowUps.firstProviderReceiptAt.notNull, false);
  assert.equal(quotationFollowUps.dueAt.notNull, false);
  assert.ok(
    followUp.checks.some((check) => check.name === 'quotation_follow_ups_state_check'),
  );
});

test('acceptance recovery can retry a newer delivery over a reopenable cancelled row', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.ts'),
    'utf8',
  );
  const listFn = source.slice(
    source.indexOf('async listAcceptedDeliveriesMissingFollowUp'),
    source.indexOf('async upsertFromDeliveryReceipt'),
  );
  assert.match(listFn, /f\.state IN \('awaiting_receipt', 'waiting', 'ready', 'held'\)/);
  assert.match(listFn, /f\.state = 'cancelled'/);
  assert.match(listFn, /delivery_incomplete/);
  assert.match(listFn, /missing_provider_receipt/);
  assert.match(listFn, /newer_delivery_in_flight/);
  assert.match(listFn, /f\.delivery_id IS DISTINCT FROM d\.id/);
  assert.match(listFn, /\(d\.created_at, d\.id\) > \(current_delivery\.created_at, current_delivery\.id\)/);
  assert.doesNotMatch(
    listFn,
    /AND NOT EXISTS \(\s*SELECT 1 FROM quotation_follow_ups f WHERE f\.quotation_id = q\.id\s*\)/,
  );
});

test('follow-up writers serialize with client archive and protect started transport', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.ts'),
    'utf8',
  );
  assert.equal((source.match(/FOR UPDATE OF cl/g) || []).length, 2);
  const activityUpdate = source.slice(
    source.indexOf('async applyConversationToOpenFollowUps'),
    source.indexOf('async promoteDueWaitingToReady'),
  );
  assert.match(activityUpdate, /state = 'processing' AND f\.transport_started_at IS NULL/);
});

test('LID without a phone persists as an identity_unresolved attention candidate', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../api/_infrastructure/db/repositories/quotation-follow-up-repository.ts'),
    'utf8',
  );
  const upsert = source.slice(
    source.indexOf('async upsertAwaitingReceiptFromAcceptedDelivery'),
    source.indexOf('async listAcceptedDeliveriesMissingFollowUp'),
  );
  assert.match(upsert, /acceptedLidConversation/);
  assert.match(upsert, /identityUnresolved/);
  assert.match(upsert, /THEN 'held'/);
  assert.match(source, /identity_unresolved/);
  assert.match(source, /OR d\.phone ILIKE '%@lid'/);
});
