import assert from 'node:assert/strict';
import test from 'node:test';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  appSettings,
  quoteRevisions,
  quotationDeliveries,
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
  assert.equal(quotationIssueRequests.idempotencyKey.isUnique, true);
  assert.equal(quotationDeliveries.revisionId.isUnique, true);
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
  const lossReasonCheck = quotationConfig.checks.find(
    (item) => item.name === 'quotations_loss_reason_check'
  );
  assert.ok(issueStateCheck);
  assert.ok(deliveryStateCheck);
  assert.ok(lossReasonCheck);
  assert.equal(renderCheck(issueStateCheck), "state IN ('processing', 'retryable', 'completed')");
  assert.equal(
    renderCheck(deliveryStateCheck),
    "state IN ('pending', 'transporting', 'accepted_partial', 'completed', 'retryable', 'reconciling')"
  );
  assert.match(renderCheck(lossReasonCheck), /status = 'perdido'/);
  assert.match(renderCheck(lossReasonCheck), /btrim\(loss_reason\) <> ''/);
  assert.match(renderCheck(lossReasonCheck), /loss_reason IS NULL/);
});
