import {
  createPostgresQuotationFollowUpRepository,
  ConflictError,
  InputError,
  NotFoundError,
  RepositoryError,
  type ApproveInput,
  type DismissInput,
  type FollowUpListInput,
  type FollowUpListResult,
  type FollowUpRecord,
  type FollowUpProjection,
  type QuotationFollowUpRepository,
  type ClaimedFollowUp,
} from '../_infrastructure/db/repositories/quotation-follow-up-repository.js';
import { followUpExternalWritesEnabled, type DismissReason, type FollowUpListView } from './quotation-follow-up-state.js';

export { ConflictError, InputError, NotFoundError, RepositoryError };
export type { FollowUpListResult, FollowUpProjection, FollowUpRecord, ClaimedFollowUp };

export interface QuotationFollowUpModuleDependencies {
  repository?: QuotationFollowUpRepository;
  repositoryFactory?: () => QuotationFollowUpRepository;
  env?: { APP_ENV?: string; EXTERNAL_WRITES_ENABLED?: string; QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED?: string };
}
export interface QuotationFollowUpModule {
  list(input?: { view?: FollowUpListView; page?: number; pageSize?: number }): Promise<FollowUpListResult>;
  approve(input: { quotationId: string; eligibilityVersion: string; message: string }): Promise<FollowUpRecord>;
  dismiss(input: { quotationId: string; eligibilityVersion: string; reason: DismissReason }): Promise<FollowUpRecord>;
  claimApproved(id?: string): Promise<ClaimedFollowUp | null>;
  markTransportStarted(id: string, leaseToken: string): Promise<boolean>;
  completeSent(input: { id: string; leaseToken: string; providerMessageId: string }): Promise<FollowUpRecord | null>;
  completeFailed(input: { id: string; leaseToken: string; reason: 'provider_rejected' | 'rate_limited' }): Promise<FollowUpRecord | null>;
  completeNeedsReview(input: { id: string; leaseToken: string; reason?: 'transport_ambiguous' | 'lease_expired_after_transport' }): Promise<FollowUpRecord | null>;
  reapExpiredLeases(limit?: number): Promise<number>;
  countApprovalsTodayUtc(now?: Date): Promise<number>;
}

const DISMISS_REASONS = new Set<DismissReason>(['already_handled', 'do_not_contact', 'no_continuity', 'wrong_contact', 'other']);
const defaultEnv = () => ({
  APP_ENV: process.env.APP_ENV,
  EXTERNAL_WRITES_ENABLED: process.env.EXTERNAL_WRITES_ENABLED,
  QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED: process.env.QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED,
});

export function createQuotationFollowUpModule(dependencies: QuotationFollowUpModuleDependencies = {}): QuotationFollowUpModule {
  const repository = dependencies.repository || (dependencies.repositoryFactory || createPostgresQuotationFollowUpRepository)();
  const env = dependencies.env || defaultEnv();
  return {
    list(input = {}) {
      return repository.list(input as FollowUpListInput);
    },
    approve(input) {
      if (!followUpExternalWritesEnabled(env)) throw new ConflictError('Envio de follow-up desativado neste ambiente.');
      return repository.approve(input as ApproveInput);
    },
    dismiss(input) {
      if (!DISMISS_REASONS.has(input.reason)) throw new InputError('Motivo de dispensa inválido.');
      return repository.dismiss(input as DismissInput);
    },
    claimApproved(id) {
      return repository.claimApproved(id);
    },
    markTransportStarted(id, leaseToken) {
      return repository.markTransportStarted(id, leaseToken);
    },
    completeSent(input) {
      return repository.completeSent(input);
    },
    completeFailed(input) {
      return repository.completeFailed(input);
    },
    completeNeedsReview(input) {
      return repository.completeNeedsReview(input);
    },
    reapExpiredLeases(limit) {
      return repository.reapExpiredLeases(limit);
    },
    countApprovalsTodayUtc(now) {
      return repository.countApprovalsTodayUtc(now);
    },
  };
}
