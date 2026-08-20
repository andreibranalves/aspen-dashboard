import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  appSettings,
  quoteRevisions,
  quotationDeliveries,
  quotationEmailDeliveries,
  quotationDeliverySteps,
  quotationIssueRequests,
  quotations,
  quotationTemplates,
  quotationTemplateVersions,
} from '../../api/_infrastructure/db/schema.js';

test('quotation template schema exposes versioned templates and snapshots', () => {
  assert.equal(appSettings.quotationSections.name, 'quotation_sections');
  assert.equal(quoteRevisions.templateVersionId.name, 'template_version_id');
  assert.equal(quoteRevisions.sectionsSnapshot.name, 'sections_snapshot');
  assert.equal(quotationTemplates.key.name, 'key');
  assert.equal(quotationTemplateVersions.sourceHash.name, 'source_hash');
  assert.ok(quotationIssueRequests.idempotencyKey);
  assert.ok(quotationIssueRequests.fingerprint);
  assert.ok(quotationDeliveries.revisionId);
  assert.ok(quotations.issuedAt);
  assert.ok(quotations.lossReason);
  assert.ok(quoteRevisions.issuedAt);

  const quotationConfig = getTableConfig(quotations);
  const issueConfig = getTableConfig(quotationIssueRequests);
  const deliveryConfig = getTableConfig(quotationDeliveries);
  const emailDeliveryConfig = getTableConfig(quotationEmailDeliveries);
  assert.equal(quotationIssueRequests.idempotencyKey.isUnique, true);
  assert.equal(quotationEmailDeliveries.id.name, 'id');
  assert.equal(quotationEmailDeliveries.revisionId.name, 'revision_id');
  assert.equal(quotationEmailDeliveries.providerEmailId.name, 'provider_email_id');
  assert.equal(quotationEmailDeliveries.publicToken.name, 'public_token');
  assert.equal(quotationEmailDeliveries.providerEmailId.isUnique, true);
  assert.equal(quotationDeliveries.revisionId.isUnique, false);
  const renderCheck = (check: (typeof issueConfig.checks)[number]) =>
    check.value.queryChunks
      .map((chunk) => {
        const part = chunk as { value?: unknown; name?: unknown } | undefined;
        if (Array.isArray(part?.value)) return part.value.join('');
        if (typeof part?.name === 'string') return part.name;
        return '';
      })
      .join('');
  const issueStateCheck = issueConfig.checks.find(
    (item) => item.name === 'quotation_issue_requests_state_check'
  );
  const deliveryStateCheck = deliveryConfig.checks.find(
    (item) => item.name === 'quotation_deliveries_state_check'
  );
  const emailStateCheck = emailDeliveryConfig.checks.find(
    (item) => item.name === 'quotation_email_deliveries_state_check'
  );
  const lossReasonCheck = quotationConfig.checks.find(
    (item) => item.name === 'quotations_loss_reason_check'
  );
  assert.ok(issueStateCheck);
  assert.ok(deliveryStateCheck);
  assert.ok(emailStateCheck);
  assert.ok(lossReasonCheck);
  assert.equal(renderCheck(issueStateCheck), "state IN ('processing', 'retryable', 'completed')");
  assert.equal(
    renderCheck(deliveryStateCheck),
    "state IN ('queued', 'processing', 'provider_accepted', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'failed')"
  );
  assert.equal(renderCheck(emailStateCheck), "state IN ('pending', 'accepted', 'failed')");
  const deliveryCompletionSourceCheck = deliveryConfig.checks.find(
    (item) => item.name === 'quotation_deliveries_completion_source_check'
  );
  const stepStateCheck = getTableConfig(quotationDeliverySteps).checks.find(
    (item) => item.name === 'quotation_delivery_steps_state_check'
  );
  assert.ok(deliveryCompletionSourceCheck);
  assert.ok(stepStateCheck);
  assert.equal(
    renderCheck(deliveryCompletionSourceCheck),
    "completion_source IS NULL OR completion_source IN ('provider_receipt', 'operator', 'legacy_provider_ack')"
  );
  assert.equal(
    renderCheck(stepStateCheck),
    "state IN ('queued', 'sending', 'server_ack', 'reconciling', 'retry_scheduled', 'needs_review', 'delivered', 'read', 'failed')"
  );
  const deliveryUniqueIndex = deliveryConfig.indexes.find(
    (item) => item.config.name === 'quotation_deliveries_revision_flow_unique'
  );
  const stepUniqueIndex = getTableConfig(quotationDeliverySteps).indexes.find(
    (item) => item.config.name === 'quotation_delivery_steps_delivery_position_unique'
  );
  assert.ok(deliveryUniqueIndex);
  assert.ok(stepUniqueIndex);
  assert.equal(quotationDeliverySteps.providerMessageId.isUnique, true);
  assert.match(renderCheck(lossReasonCheck), /status = 'perdido'/);
  assert.match(renderCheck(lossReasonCheck), /btrim\(loss_reason\) <> ''/);
  assert.match(renderCheck(lossReasonCheck), /loss_reason IS NULL/);
});

test('delivery outbox schema exposes leases, manual resolution and steps', () => {
  const delivery = getTableColumns(quotationDeliveries);
  const step = getTableColumns(quotationDeliverySteps);
  for (const key of [
    'flowName',
    'attemptCount',
    'nextAttemptAt',
    'leaseToken',
    'leaseUntil',
    'reconciliationDeadline',
    'completionSource',
    'resolvedBy',
    'resolvedAt',
    'resolutionNote',
    'deliveredAt',
  ]) {
    assert.ok(delivery[key as keyof typeof delivery], `missing delivery column ${key}`);
  }
  for (const key of [
    'deliveryId',
    'position',
    'type',
    'payloadSnapshot',
    'state',
    'providerMessageId',
    'attemptCount',
    'nextAttemptAt',
    'reconciliationDeadline',
  ]) {
    assert.ok(step[key as keyof typeof step], `missing step column ${key}`);
  }
});
