import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCrmMatchName } from '../../api/_modules/whatsapp-crm-match.js';

describe('whatsapp-crm-match', () => {
  it('uses explicit CRM whitespace normalization and preserves NBSP literally', () => {
    assert.equal(normalizeCrmMatchName('  Ana\t\n  Silva  '), 'ana silva');
    assert.equal(normalizeCrmMatchName('\fAna\vSilva\f'), 'ana silva');
    assert.equal(normalizeCrmMatchName('  Ana\u00a0Silva  '), 'ana\u00a0silva');
  });
});
