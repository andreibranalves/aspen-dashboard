import type { QuotationTemplateSnapshot } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import { quotationSnapshotViewModel } from '../_infrastructure/db/repositories/quotation-template-repository.js';
import {
  quotationTemplateFromVersion,
  renderQuotationTemplate,
  resolveQuotationTemplate,
  type QuotationTemplate,
  type QuotationTemplateViewModel,
} from './quotation-template-catalog.js';

export type QuotationDocumentSnapshot = QuotationTemplateSnapshot;

/** The one render seam for a persisted quotation revision and its exact template. */
export interface RenderedQuotationDocument {
  html: string;
  template: QuotationTemplate;
  viewModel: QuotationTemplateViewModel;
}

export type QuotationDocumentRenderer = (
  snapshot: QuotationTemplateSnapshot,
  template?: QuotationTemplate
) => RenderedQuotationDocument;

/**
 * Render the immutable revision snapshot with the exact template selected for it.
 * A caller may provide the resolved template explicitly; otherwise the stored
 * version is preferred and legacy revisions use their stored key/hash pair.
 */
export const renderQuotationDocument: QuotationDocumentRenderer = (snapshot, exactTemplate) => {
  const template =
    exactTemplate ||
    (snapshot.templateVersion
      ? quotationTemplateFromVersion(snapshot.templateVersion)
      : resolveQuotationTemplate(snapshot.revision.templatePadrao, snapshot.revision.templateHash));
  const viewModel = quotationSnapshotViewModel(snapshot);
  return {
    html: renderQuotationTemplate(template, viewModel),
    template,
    viewModel,
  };
};
