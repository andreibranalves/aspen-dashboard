import { createHash } from 'node:crypto';

import { QUOTATION_TEMPLATES } from './quotation-template-catalog.js';

export interface TemplateSeed {
  key: string;
  name: string;
  version: 2;
  contract_version: 2;
  source: string;
  source_hash: string;
}

export function templateSeedPlan(): TemplateSeed[] {
  return QUOTATION_TEMPLATES.map((template) => ({
    key: template.key,
    name: template.name,
    version: 2 as const,
    contract_version: 2 as const,
    source: template.source,
    source_hash: createHash('sha256').update(template.source, 'utf8').digest('hex'),
  }));
}
