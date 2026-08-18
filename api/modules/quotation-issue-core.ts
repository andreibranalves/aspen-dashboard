import {
  createPostgresQuotationIssueRepository,
  quotationIssueFingerprint,
  type QuotationIssueInput,
  type QuotationIssueResult,
  type QuotationIssueStatus,
} from '../infrastructure/db/repositories/quotation-issue-repository.js';

export type { QuotationIssueInput, QuotationIssueResult, QuotationIssueStatus } from '../infrastructure/db/repositories/quotation-issue-repository.js';
export { quotationIssueFingerprint };

export function createQuotationIssueCore() {
  const repository = createPostgresQuotationIssueRepository();
  return {
    issueQuotation(input: QuotationIssueInput): Promise<QuotationIssueResult> { return repository.issue(input); },
    readQuotationIssue(idempotencyKey: string): Promise<QuotationIssueStatus | null> { return repository.read(idempotencyKey); },
  };
}

export const { issueQuotation, readQuotationIssue } = createQuotationIssueCore();
