import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appSettings,
  quoteRevisions,
  quotationTemplates,
  quotationTemplateVersions,
} from '../../api/_db/schema.js';

test('quotation template schema exposes versioned templates and snapshots', () => {
  assert.equal(appSettings.quotationSections.name, 'quotation_sections');
  assert.equal(quoteRevisions.templateVersionId.name, 'template_version_id');
  assert.equal(quoteRevisions.sectionsSnapshot.name, 'sections_snapshot');
  assert.equal(quotationTemplates.key.name, 'key');
  assert.equal(quotationTemplateVersions.sourceHash.name, 'source_hash');
});
