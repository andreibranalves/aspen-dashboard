export type FollowUpListView = 'ready' | 'waiting' | 'sent' | 'dismissed' | 'attention';
export type FollowUpState =
  | 'awaiting_receipt'
  | 'waiting'
  | 'ready'
  | 'held'
  | 'approved'
  | 'processing'
  | 'sent'
  | 'cancelled'
  | 'dismissed'
  | 'needs_review'
  | 'failed';
export type DismissReason =
  | 'already_handled'
  | 'do_not_contact'
  | 'no_continuity'
  | 'wrong_contact'
  | 'other';

export interface FollowUpView {
  quotationId: string;
  revisionId: string;
  deliveryId: string;
  businessNumber: string;
  clientName: string;
  amount: string;
  instance: string;
  providerConversationId: string;
  canonicalPhone: string;
  deliveryCreatedAt: string;
  firstProviderReceiptAt: string | null;
  dueAt: string | null;
  eligibilityVersion: string | null;
  state: FollowUpState;
  reason: string;
  reasonLabel: string;
  followUpId: string | null;
  messageSnapshot: string | null;
  closedReason: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
}

export interface FollowUpPage {
  data: FollowUpView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface FollowUpListFilters {
  view: FollowUpListView;
  page?: number;
  pageSize?: number;
}

export interface ApproveFollowUpInput {
  quotationId: string;
  eligibilityVersion: string;
  message: string;
}

export interface DismissFollowUpInput {
  quotationId: string;
  eligibilityVersion: string | null;
  reason: DismissReason;
}

export interface FollowUpMutationResult {
  followUpId: string;
  state: 'approved' | 'dismissed';
}

export class FollowUpApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'FollowUpApiError';
    this.status = status;
  }
}

const VIEWS = ['ready', 'waiting', 'sent', 'dismissed', 'attention'] as const;
const STATES = [
  'awaiting_receipt',
  'waiting',
  'ready',
  'held',
  'approved',
  'processing',
  'sent',
  'cancelled',
  'dismissed',
  'needs_review',
  'failed',
] as const;
const REASONS = ['already_handled', 'do_not_contact', 'no_continuity', 'wrong_contact', 'other'] as const;
const MAX_PAGE_SIZE = 100;
const MAX_TOTAL = 1_000_000;
const ISO_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new FollowUpApiError('Resposta inválida dos follow-ups.');
}

function invalidInput(message: string): never {
  throw new FollowUpApiError(message);
}

function text(value: unknown, required = true, maximum = 4000): string {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > maximum) invalidResponse();
  if ([...value].some((character) => {
    const code = character.charCodeAt(0);
    return (code <= 0x1f && code !== 0x09 && code !== 0x0a) || code === 0x7f;
  })) invalidResponse();
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string') invalidInput(`${label} inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || normalized.includes('/') || normalized.includes('\\')) {
    invalidInput(`${label} inválido.`);
  }
  return normalized;
}

function timestamp(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const result = text(value, true, 80);
  const match = ISO_TIMESTAMP.exec(result);
  if (!match || Number.isNaN(Date.parse(result))) invalidResponse();
  return result;
}

function optionalText(value: unknown, maximum = 4000): string | null {
  if (value === null || value === undefined) return null;
  return text(value, false, maximum);
}

function state(value: unknown): FollowUpState {
  if (typeof value !== 'string' || !(STATES as readonly string[]).includes(value)) invalidResponse();
  return value as FollowUpState;
}

function view(value: unknown): FollowUpListView {
  if (typeof value !== 'string' || !(VIEWS as readonly string[]).includes(value)) invalidInput('Visualização inválida.');
  return value as FollowUpListView;
}

function pageInteger(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalidResponse();
  return value;
}

function parseFollowUp(value: unknown): FollowUpView {
  if (!isRecord(value)) invalidResponse();
  const followUpIdValue = value.follow_up_id;
  const followUpId = followUpIdValue === null || followUpIdValue === undefined ? null : text(followUpIdValue, true, 255);
  const messageSnapshot = value.message_snapshot === null || value.message_snapshot === undefined
    ? null
    : text(value.message_snapshot, false, 4000);
  return {
    quotationId: text(value.quotation_id, true, 255),
    revisionId: text(value.revision_id, true, 255),
    deliveryId: text(value.delivery_id, true, 255),
    businessNumber: text(value.business_number, true, 255),
    clientName: text(value.client_name, true, 255),
    amount: text(value.amount, true, 100),
    instance: text(value.instance, true, 120),
    providerConversationId: text(value.provider_conversation_id, true, 255),
    canonicalPhone: text(value.canonical_phone, false, 255),
    deliveryCreatedAt: timestamp(value.delivery_created_at) as string,
    firstProviderReceiptAt: timestamp(value.first_provider_receipt_at, true),
    dueAt: timestamp(value.due_at, true),
    eligibilityVersion: value.eligibility_version === null
      ? null
      : text(value.eligibility_version, true, 128),
    state: state(value.state),
    reason: text(value.reason, true, 100),
    reasonLabel: text(value.reason_label, true, 255),
    followUpId,
    messageSnapshot,
    closedReason: optionalText(value.closed_reason, 100),
    approvedAt: timestamp(value.approved_at, true),
    sentAt: timestamp(value.sent_at, true),
    updatedAt: timestamp(value.updated_at) as string,
  };
}

export function parseFollowUpPage(value: unknown): FollowUpPage {
  if (!isRecord(value) || !Array.isArray(value.data) || value.data.length > MAX_PAGE_SIZE) invalidResponse();
  const page = pageInteger(value.page, 1, MAX_TOTAL);
  const pageSize = pageInteger(value.page_size, 1, MAX_PAGE_SIZE);
  const total = pageInteger(value.total, 0, MAX_TOTAL);
  if (value.data.length > pageSize || total < value.data.length) invalidResponse();
  return { data: value.data.map(parseFollowUp), total, page, pageSize };
}

export function parseFollowUpMutation(value: unknown): FollowUpMutationResult {
  if (!isRecord(value)) invalidResponse();
  const followUpId = text(value.follow_up_id, true, 255);
  const mutationState = value.state;
  if (mutationState !== 'approved' && mutationState !== 'dismissed') invalidResponse();
  return { followUpId, state: mutationState };
}

function errorMessage(value: unknown, fallback: string): string {
  return isRecord(value) && typeof value.error === 'string' && value.error.trim() ? value.error : fallback;
}

async function responseBody(response: Response): Promise<unknown> {
  return response.json().catch(() => ({}));
}

async function request<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await responseBody(response);
  if (!response.ok) throw new FollowUpApiError(errorMessage(body, fallback), response.status);
  return body as T;
}

export async function listFollowUps(filters: FollowUpListFilters): Promise<FollowUpPage> {
  const selectedView = view(filters.view);
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 25;
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_TOTAL) invalidInput('Página inválida.');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) invalidInput('Tamanho da página inválido.');
  const query = new URLSearchParams({ view: selectedView, page: String(page), page_size: String(pageSize) });
  const body = await request<unknown>(`/follow-ups?${query.toString()}`, { method: 'GET' }, 'Não foi possível carregar os follow-ups.');
  return parseFollowUpPage(body);
}

export async function approveFollowUp(input: ApproveFollowUpInput): Promise<FollowUpMutationResult> {
  const quotationId = identifier(input.quotationId, 'Orçamento');
  const eligibilityVersion = identifier(input.eligibilityVersion, 'Versão de elegibilidade');
  const message = input.message.trim();
  if (!message || message.length > 4000 || [...message].some((character) => character.charCodeAt(0) <= 0x1f && character !== '\n' && character !== '\t')) {
    invalidInput('Mensagem inválida.');
  }
  const body = await request<unknown>('/follow-ups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotation_id: quotationId, eligibility_version: eligibilityVersion, message }),
  }, 'Não foi possível aprovar o follow-up.');
  return parseFollowUpMutation(body);
}

export async function dismissFollowUp(input: DismissFollowUpInput): Promise<FollowUpMutationResult> {
  const quotationId = identifier(input.quotationId, 'Orçamento');
  const eligibilityVersion = input.eligibilityVersion ? identifier(input.eligibilityVersion, 'Versão de elegibilidade') : '';
  if (!(REASONS as readonly string[]).includes(input.reason)) invalidInput('Motivo inválido.');
  const body = await request<unknown>('/follow-ups', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quotation_id: quotationId, eligibility_version: eligibilityVersion, reason: input.reason }),
  }, 'Não foi possível dispensar o follow-up.');
  return parseFollowUpMutation(body);
}

export { parseFollowUp };
