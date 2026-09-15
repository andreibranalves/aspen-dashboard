#!/usr/bin/env node
/**
 * Commercial record transition CLI (#253).
 * Default mode is preview-only. Apply requires explicit authorization and
 * never sends messages, enables workers, or replays historical backlog.
 *
 * Usage:
 *   node scripts/commercial-record-transition.mjs preview
 *   COMMERCIAL_TRANSITION_APPLY_AUTHORIZED=1 node scripts/commercial-record-transition.mjs apply
 */

import { randomUUID } from 'node:crypto';

import { getDatabase } from '../api/_infrastructure/db/client.js';
import {
  applyCommercialRecordTransition,
  previewCommercialRecordTransition,
} from '../api/_infrastructure/db/repositories/commercial-record-transition-repository.js';

function usage() {
  console.error(
    'Uso: node scripts/commercial-record-transition.mjs <preview|apply>\n' +
      'Apply exige COMMERCIAL_TRANSITION_APPLY_AUTHORIZED=1.',
  );
}

const mode = String(process.argv[2] || '').trim();
if (mode !== 'preview' && mode !== 'apply') {
  usage();
  process.exit(2);
}

const database = getDatabase();

if (mode === 'preview') {
  const preview = await previewCommercialRecordTransition(database);
  console.log(JSON.stringify({ mode: 'preview', ...preview }, null, 2));
  process.exit(0);
}

const authorized = process.env.COMMERCIAL_TRANSITION_APPLY_AUTHORIZED === '1';
if (!authorized) {
  console.error(
    'Apply recusado: defina COMMERCIAL_TRANSITION_APPLY_AUTHORIZED=1 após autorização operacional.',
  );
  process.exit(3);
}

const result = await applyCommercialRecordTransition(database, {
  authorization: { applyAuthorized: true },
  occurredAt: new Date(),
  idFactory: () => randomUUID(),
});

console.log(
  JSON.stringify(
    {
      mode: 'apply',
      appliedOpportunityIds: result.appliedOpportunityIds,
      skippedOpportunityIds: result.skippedOpportunityIds,
      messagesSent: result.messagesSent,
      workerEnabled: result.workerEnabled,
      historicalBacklogReprocessed: result.historicalBacklogReprocessed,
      counts: result.preview.counts,
      unmergedClientGroups: result.preview.unmergedClientGroups,
    },
    null,
    2,
  ),
);
