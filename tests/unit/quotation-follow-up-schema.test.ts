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
});
