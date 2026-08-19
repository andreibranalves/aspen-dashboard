import { randomUUID } from 'node:crypto';
import { kv } from '@vercel/kv';

export const WHATSAPP_SEND_RESERVATION_SCHEMA = 3 as const;
export const WHATSAPP_SEND_RESERVATION_PREFIX = 'aspen:whatsapp-send-reservation:';

// Reserved records are safe to reclaim only before transport starts.
export const WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS = 5 * 60 * 1000;
export const WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS = 30 * 24 * 60 * 60;
export const WHATSAPP_SEND_RESERVATION_RETRY_TTL_SECONDS = 30 * 24 * 60 * 60;
export const WHATSAPP_SEND_RESERVATION_COMPLETED_TTL_SECONDS = 90 * 24 * 60 * 60;
export const WHATSAPP_SEND_RESERVATION_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export const WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS = 64;
export const WHATSAPP_SEND_RESERVATION_MAX_ERROR_LENGTH = 240;
export const WHATSAPP_SEND_RESOLUTION_CONFIRMATION = 'CONFIRMAR_RECONCILIACAO';

export function canonicalWhatsappSendIdempotencyKey(
  quotationId: string,
  revisionId: string,
  flowId: string,
): string {
  return `aspen:whatsapp-flow:v2|${[quotationId, revisionId, flowId]
    .map((value) => encodeURIComponent(String(value).trim()))
    .join('|')}`;
}

export type WhatsappSendReservationPhase =
  | 'reserved'
  | 'transporting'
  | 'accepted_partial'
  | 'completed'
  | 'retryable';

export type WhatsappSendAcceptedStepKind = 'text' | 'image' | 'video' | 'document';

export interface WhatsappSendAcceptedStep {
  step: number;
  kind: WhatsappSendAcceptedStepKind;
  acceptedAt: number;
}

export interface WhatsappSendReservationInput {
  key: string;
  quotationId: string;
  revisionId: string;
  flowId: string;
  stepsCount: number;
}

export interface WhatsappSendReservationRecord extends WhatsappSendReservationInput {
  schema: typeof WHATSAPP_SEND_RESERVATION_SCHEMA;
  version: number;
  owner: string;
  phase: WhatsappSendReservationPhase;
  createdAt: number;
  updatedAt: number;
  reservedAt: number;
  transportStartedAt?: number;
  currentStep?: number;
  acceptedSteps: WhatsappSendAcceptedStep[];
  result?: Record<string, unknown>;
  errorMessage?: string;
  resolvedAt?: number;
  resolution?: 'operator_completed' | 'operator_retryable';
}

export type WhatsappSendReservationDecision =
  | { kind: 'reserved'; record: WhatsappSendReservationRecord }
  | { kind: 'existing'; record: WhatsappSendReservationRecord };

export interface WhatsappSendReservationCasInput {
  key: string;
  owner: string;
  expectedVersion?: number;
  version?: number;
  from: WhatsappSendReservationPhase | 'processing';
  to: WhatsappSendReservationPhase | 'processing';
  currentStep?: number;
  acceptedStep?: { step: number; kind: WhatsappSendAcceptedStepKind };
  result?: Record<string, unknown>;
  errorMessage?: string;
}

export type WhatsappSendReservationCasResult =
  | { ok: true; record: WhatsappSendReservationRecord }
  | {
    ok: false;
    reason: 'missing' | 'conflict' | 'invalid' | 'storage';
    record?: WhatsappSendReservationRecord;
  };

export interface WhatsappSendReservationResolutionInput {
  key: string;
  expectedVersion: number;
  to: 'completed' | 'retryable';
  confirmation: string;
}

export interface WhatsappSendReservationStore {
  reserve(input: WhatsappSendReservationInput): Promise<WhatsappSendReservationDecision>;
  /** Explicit owner/version CAS. A conflict is never represented as success. */
  compareAndSet(input: WhatsappSendReservationCasInput): Promise<WhatsappSendReservationCasResult>;
  /** Short alias for callers that use the CAS terminology. */
  cas(input: WhatsappSendReservationCasInput): Promise<WhatsappSendReservationCasResult>;
  /** Operator-only, version-guarded resolution for uncertain transport. */
  resolve(input: WhatsappSendReservationResolutionInput): Promise<WhatsappSendReservationCasResult>;
  transition(input: WhatsappSendReservationCasInput): Promise<WhatsappSendReservationCasResult>;
  get(key: string): Promise<WhatsappSendReservationRecord | null>;
}

export class WhatsappSendReservationStorageError extends Error {
  readonly statusCode = 503;

  constructor(message = 'Não foi possível consultar o estado durável do envio.') {
    super(message);
    this.name = 'WhatsappSendReservationStorageError';
  }
}

const PHASES = ['reserved', 'transporting', 'accepted_partial', 'completed', 'retryable'] as const;
const STEP_KINDS = ['text', 'image', 'video', 'document'] as const;
const TERMINAL_RESULT_KEYS = [
  'success',
  'dry_run',
  'send_status',
  'duplicate_warning',
  'duplicate_message',
  'flow_id',
  'flow_name',
  'quotation_id',
  'deal_id',
  'product_summary',
  'categories',
  'steps_count',
  'steps',
  'send_event_id',
] as const;
const RECORD_KEYS = new Set([
  'schema',
  'key',
  'quotationId',
  'revisionId',
  'flowId',
  'stepsCount',
  'version',
  'owner',
  'phase',
  'createdAt',
  'updatedAt',
  'reservedAt',
  'transportStartedAt',
  'currentStep',
  'acceptedSteps',
  'result',
  'errorMessage',
  'resolvedAt',
  'resolution',
]);

export const WHATSAPP_SEND_RESERVATION_CAS_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local decodedOk, record = pcall(cjson.decode, raw)
if not decodedOk or type(record) ~= 'table' then return {'invalid'} end
local currentVersion = record.version
local stepsCount = tonumber(record.stepsCount)
if currentVersion == nil or currentVersion == cjson.null or not stepsCount then return {'invalid', raw} end
if record.schema ~= 3
  or record.owner ~= ARGV[1]
  or tonumber(currentVersion) ~= tonumber(ARGV[2])
  or record.phase ~= ARGV[3] then
  return {'conflict', raw}
end
local acceptedSteps = record.acceptedSteps
if acceptedSteps == nil or acceptedSteps == cjson.null or type(acceptedSteps) ~= 'table' or #acceptedSteps > stepsCount then return {'invalid', raw} end
for index, entry in ipairs(acceptedSteps) do
  if type(entry) ~= 'table' or tonumber(entry.step) ~= index - 1 then return {'invalid', raw} end
end
local updatedAt = tonumber(ARGV[5])
if not updatedAt then return {'invalid'} end
local currentStep = nil
if ARGV[6] ~= '' then
  currentStep = tonumber(ARGV[6])
  if not currentStep or currentStep < 0 or currentStep >= stepsCount then return {'invalid', raw} end
  if ARGV[4] == 'transporting' and #acceptedSteps ~= currentStep then return {'invalid', raw} end
  if ARGV[4] == 'accepted_partial' and #acceptedSteps ~= currentStep then return {'invalid', raw} end
end
if ARGV[4] == 'transporting' and record.phase ~= 'reserved' and record.phase ~= 'accepted_partial' then return {'invalid', raw} end
if ARGV[4] == 'accepted_partial' and record.phase ~= 'transporting' then return {'invalid', raw} end
if ARGV[8] ~= '' then
  local acceptedOk, accepted = pcall(cjson.decode, ARGV[8])
  if not acceptedOk or type(accepted) ~= 'table' or not tonumber(accepted.step) or tonumber(accepted.step) ~= currentStep or tonumber(accepted.step) < 0 or tonumber(accepted.step) >= stepsCount then return {'invalid', raw} end
end
record.version = tonumber(currentVersion) + 1
record.phase = ARGV[4]
record.updatedAt = updatedAt
record.transportStartedAt = nil
record.currentStep = nil
record.result = nil
record.errorMessage = nil
record.resolvedAt = nil
record.resolution = nil
if currentStep ~= nil then record.currentStep = currentStep end
if ARGV[7] ~= '' then record.transportStartedAt = updatedAt end
if ARGV[8] ~= '' then
  local accepted = cjson.decode(ARGV[8])
  table.insert(acceptedSteps, accepted)
  record.acceptedSteps = acceptedSteps
end
if ARGV[9] ~= '' then
  local resultOk, result = pcall(cjson.decode, ARGV[9])
  if not resultOk or result == cjson.null or type(result) ~= 'table' then return {'invalid'} end
  record.result = result
end
if ARGV[10] ~= '' then record.errorMessage = ARGV[10] end
local encoded = cjson.encode(record)
local ttl = tonumber(ARGV[11]) or 0
if ttl > 0 then redis.call('SET', KEYS[1], encoded, 'EX', tostring(ttl))
else redis.call('SET', KEYS[1], encoded) end
return {'updated', encoded}
`;

export const WHATSAPP_SEND_RESERVATION_RETRY_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local decodedOk, record = pcall(cjson.decode, raw)
if not decodedOk or type(record) ~= 'table' then return {'invalid'} end
local version = record.version
local stepsCount = tonumber(record.stepsCount)
if version == nil or version == cjson.null or not stepsCount then return {'invalid', raw} end
if record.schema ~= 3 or record.phase ~= 'retryable' or tonumber(version) ~= tonumber(ARGV[2]) then
  return {'conflict', raw}
end
local updatedAt = tonumber(ARGV[3])
if not updatedAt then return {'invalid'} end
record.owner = ARGV[1]
record.version = tonumber(version) + 1
record.phase = 'reserved'
record.reservedAt = updatedAt
record.updatedAt = updatedAt
record.transportStartedAt = nil
record.currentStep = nil
record.acceptedSteps = {}
record.result = nil
record.errorMessage = nil
record.resolvedAt = nil
record.resolution = nil
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[4])
return {'reserved', encoded}
`;

export const WHATSAPP_SEND_RESERVATION_TAKEOVER_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local decodedOk, record = pcall(cjson.decode, raw)
if not decodedOk or type(record) ~= 'table' then return {'invalid'} end
local version = record.version
local stepsCount = tonumber(record.stepsCount)
if version == nil or version == cjson.null or not stepsCount then return {'invalid', raw} end
local acceptedSteps = record.acceptedSteps
if record.schema ~= 3 or record.phase ~= 'reserved'
  or tonumber(version) ~= tonumber(ARGV[2])
  or record.transportStartedAt ~= nil and record.transportStartedAt ~= cjson.null
  or record.currentStep ~= nil and record.currentStep ~= cjson.null
  or acceptedSteps == nil or acceptedSteps == cjson.null or type(acceptedSteps) ~= 'table' or #acceptedSteps > 0 then
  return {'conflict', raw}
end
local updatedAt = tonumber(record.updatedAt)
local now = tonumber(ARGV[3])
if not updatedAt or not now or now - updatedAt < tonumber(ARGV[4]) then return {'conflict', raw} end
record.owner = ARGV[1]
record.version = tonumber(version) + 1
record.reservedAt = now
record.updatedAt = now
record.acceptedSteps = {}
record.result = nil
record.errorMessage = nil
record.resolvedAt = nil
record.resolution = nil
local encoded = cjson.encode(record)
redis.call('SET', KEYS[1], encoded, 'EX', ARGV[5])
return {'reserved', encoded}
`;

export const WHATSAPP_SEND_RESERVATION_RESOLVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {'missing'} end
local decodedOk, record = pcall(cjson.decode, raw)
if not decodedOk or type(record) ~= 'table' then return {'invalid'} end
local version = record.version
local stepsCount = tonumber(record.stepsCount)
if version == nil or version == cjson.null or not stepsCount then return {'invalid', raw} end
if record.schema ~= 3
  or tonumber(version) ~= tonumber(ARGV[1])
  or (record.phase ~= 'transporting' and record.phase ~= 'accepted_partial') then
  return {'conflict', raw}
end
local now = tonumber(ARGV[3])
if not now then return {'invalid'} end
record.version = tonumber(version) + 1
record.phase = ARGV[2]
record.updatedAt = now
record.resolvedAt = now
record.resolution = ARGV[4]
record.transportStartedAt = nil
record.currentStep = nil
record.result = nil
record.errorMessage = nil
if ARGV[5] ~= '' then
  local resultOk, result = pcall(cjson.decode, ARGV[5])
  if not resultOk or result == cjson.null or type(result) ~= 'table' then return {'invalid'} end
  record.result = result
end
if ARGV[6] ~= '' then record.errorMessage = ARGV[6] end
local encoded = cjson.encode(record)
local ttl = tonumber(ARGV[7]) or 0
if ttl > 0 then redis.call('SET', KEYS[1], encoded, 'EX', tostring(ttl))
else redis.call('SET', KEYS[1], encoded) end
return {'updated', encoded}
`;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlChars(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function canonicalText(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new WhatsappSendReservationStorageError(`${label} inválido.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || hasControlChars(normalized)) {
    throw new WhatsappSendReservationStorageError(`${label} inválido.`);
  }
  return normalized;
}

function canonicalKey(value: unknown): string {
  if (typeof value !== 'string') throw new WhatsappSendReservationStorageError('Chave de idempotência inválida.');
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || hasControlChars(normalized)) {
    throw new WhatsappSendReservationStorageError('Chave de idempotência inválida.');
  }
  return normalized;
}

function storageKey(key: string): string {
  return `${WHATSAPP_SEND_RESERVATION_PREFIX}${encodeURIComponent(key)}`;
}

function timestamp(value: unknown, label: string, now: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > now + WHATSAPP_SEND_RESERVATION_MAX_CLOCK_SKEW_MS) {
    throw new WhatsappSendReservationStorageError(`${label} inválido.`);
  }
  return value;
}

function acceptedKind(value: unknown): WhatsappSendAcceptedStepKind {
  if (!(STEP_KINDS as readonly unknown[]).includes(value)) {
    throw new WhatsappSendReservationStorageError('Etapa aceita inválida.');
  }
  return value as WhatsappSendAcceptedStepKind;
}

function parseAcceptedSteps(
  value: unknown,
  stepsCount: number,
  createdAt: number,
  updatedAt: number,
  now: number,
): WhatsappSendAcceptedStep[] {
  if (!Array.isArray(value) || value.length > WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS) {
    throw new WhatsappSendReservationStorageError();
  }
  const steps = value.map((entry) => {
    if (!isObject(entry) || Object.keys(entry).some((key) => !['step', 'kind', 'acceptedAt'].includes(key))) {
      throw new WhatsappSendReservationStorageError();
    }
    if (!Number.isSafeInteger(entry.step) || Number(entry.step) < 0 || Number(entry.step) >= stepsCount) {
      throw new WhatsappSendReservationStorageError();
    }
    const acceptedAt = timestamp(entry.acceptedAt, 'Data da aceitação', now);
    if (acceptedAt < createdAt || acceptedAt > updatedAt) {
      throw new WhatsappSendReservationStorageError();
    }
    return { step: Number(entry.step), kind: acceptedKind(entry.kind), acceptedAt };
  });
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index - 1].step >= steps[index].step) throw new WhatsappSendReservationStorageError();
  }
  return steps;
}

function safeNeutralText(value: unknown, label: string, max = 500): string {
  if (typeof value !== 'string' || value.length > max || hasControlChars(value)) {
    throw new WhatsappSendReservationStorageError(`${label} inválido.`);
  }
  return value;
}

function localNullable(value: unknown, label: string): string | null {
  if (value === null) return null;
  return canonicalText(value, label);
}

/** Strict terminal projection. Unknown keys, provider data, URLs, and PII fail closed. */
export function sanitizeWhatsappSendTerminalResult(
  value: unknown,
  expectedFlowId?: string,
): Record<string, unknown> {
  if (!isObject(value) || Object.keys(value).some((key) => !(TERMINAL_RESULT_KEYS as readonly string[]).includes(key))) {
    throw new WhatsappSendReservationStorageError();
  }
  if (value.success !== true || value.dry_run !== false || value.send_status !== 'completed') {
    throw new WhatsappSendReservationStorageError();
  }
  if (typeof value.duplicate_warning !== 'boolean') throw new WhatsappSendReservationStorageError();
  const duplicateMessage = safeNeutralText(value.duplicate_message, 'Mensagem de duplicidade');
  const flowId = canonicalText(value.flow_id, 'ID do fluxo');
  if (expectedFlowId !== undefined && flowId !== expectedFlowId) throw new WhatsappSendReservationStorageError();
  const flowName = canonicalText(value.flow_name, 'Nome do fluxo');
  const quotationId = localNullable(value.quotation_id, 'Identificador do orçamento');
  const dealId = localNullable(value.deal_id, 'Identificador da negociação');
  const productSummary = canonicalText(value.product_summary, 'Resumo de produtos');
  if (!Array.isArray(value.categories) || value.categories.length > WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS) {
    throw new WhatsappSendReservationStorageError();
  }
  const categories = value.categories.map((category) => canonicalText(category, 'Categoria'));
  if (!Number.isSafeInteger(value.steps_count) || Number(value.steps_count) < 0 || Number(value.steps_count) > 256) {
    throw new WhatsappSendReservationStorageError();
  }
  if (!Array.isArray(value.steps) || value.steps.length > WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS) {
    throw new WhatsappSendReservationStorageError();
  }
  if (Number(value.steps_count) !== value.steps.length) {
    throw new WhatsappSendReservationStorageError();
  }
  const steps = value.steps.map((step) => {
    if (!isObject(step) || Object.keys(step).some((key) => key !== 'type')) throw new WhatsappSendReservationStorageError();
    return { type: acceptedKind(step.type) };
  });
  if (value.send_event_id !== null && (typeof value.send_event_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.send_event_id))) {
    throw new WhatsappSendReservationStorageError();
  }
  return {
    success: true,
    dry_run: false,
    send_status: 'completed',
    duplicate_warning: value.duplicate_warning,
    duplicate_message: duplicateMessage,
    flow_id: flowId,
    flow_name: flowName,
    quotation_id: quotationId,
    deal_id: dealId,
    product_summary: productSummary,
    categories,
    steps_count: Number(value.steps_count),
    steps,
    send_event_id: value.send_event_id,
  };
}

function safeErrorMessage(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > WHATSAPP_SEND_RESERVATION_MAX_ERROR_LENGTH || hasControlChars(value)) {
    throw new WhatsappSendReservationStorageError();
  }
  const safe = new Set([
    'Falha antes do transporte.',
    'O transporte foi aceito e aguarda reconciliação.',
    'O transporte permanece em reconciliação.',
    'Reconciliação encerrada pelo operador.',
    'Envio confirmado como não entregue pelo operador.',
    'Reconciliação necessária.',
  ]);
  if (!safe.has(value)) throw new WhatsappSendReservationStorageError();
  return value;
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new WhatsappSendReservationStorageError();
  }
}

export function parseWhatsappSendReservationRecord(
  value: unknown,
  expectedKey?: string,
  now = Date.now(),
): WhatsappSendReservationRecord {
  const decoded = parseStoredValue(value);
  if (!isObject(decoded) || Object.keys(decoded).some((key) => !RECORD_KEYS.has(key))) {
    throw new WhatsappSendReservationStorageError();
  }
  const schema = decoded.schema;
  const key = canonicalKey(decoded.key);
  const quotationId = canonicalText(decoded.quotationId, 'Identificador do orçamento');
  const revisionId = canonicalText(decoded.revisionId, 'Identificador da revisão');
  const flowId = canonicalText(decoded.flowId, 'Identificador do fluxo');
  if (!Number.isSafeInteger(decoded.stepsCount) || Number(decoded.stepsCount) < 1 || Number(decoded.stepsCount) > WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS) {
    throw new WhatsappSendReservationStorageError();
  }
  const stepsCount = Number(decoded.stepsCount);
  if (
    schema !== WHATSAPP_SEND_RESERVATION_SCHEMA
    || (expectedKey !== undefined && key !== expectedKey)
    || key !== canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId)
  ) throw new WhatsappSendReservationStorageError();
  if (!Number.isSafeInteger(decoded.version) || Number(decoded.version) < 1) throw new WhatsappSendReservationStorageError();
  if (typeof decoded.owner !== 'string' || !decoded.owner.trim() || decoded.owner.length > 128 || hasControlChars(decoded.owner)) {
    throw new WhatsappSendReservationStorageError();
  }
  if (!(PHASES as readonly unknown[]).includes(decoded.phase)) throw new WhatsappSendReservationStorageError();
  const createdAt = timestamp(decoded.createdAt, 'Data de criação', now);
  const updatedAt = timestamp(decoded.updatedAt, 'Data de atualização', now);
  const reservedAt = timestamp(decoded.reservedAt, 'Data de reserva', now);
  if (updatedAt < createdAt || reservedAt < createdAt || reservedAt > updatedAt) throw new WhatsappSendReservationStorageError();
  const phase = decoded.phase as WhatsappSendReservationPhase;
  const transportStartedAt = decoded.transportStartedAt === undefined || decoded.transportStartedAt === null
    ? undefined
    : timestamp(decoded.transportStartedAt, 'Data de início do transporte', now);
  if (transportStartedAt !== undefined && (transportStartedAt < createdAt || transportStartedAt > updatedAt)) {
    throw new WhatsappSendReservationStorageError();
  }
  const currentStepValue = decoded.currentStep === undefined || decoded.currentStep === null
    ? undefined
    : decoded.currentStep;
  if (currentStepValue !== undefined && (!Number.isSafeInteger(currentStepValue) || Number(currentStepValue) < 0 || Number(currentStepValue) >= stepsCount)) {
    throw new WhatsappSendReservationStorageError();
  }
  const currentStep = currentStepValue === undefined ? undefined : Number(currentStepValue);
  const acceptedSteps = parseAcceptedSteps(decoded.acceptedSteps, stepsCount, createdAt, updatedAt, now);
  const result = decoded.result === undefined || decoded.result === null
    ? undefined
    : sanitizeWhatsappSendTerminalResult(decoded.result, flowId);
  const errorMessage = safeErrorMessage(decoded.errorMessage);
  const resolvedAt = decoded.resolvedAt === undefined || decoded.resolvedAt === null
    ? undefined
    : timestamp(decoded.resolvedAt, 'Data de reconciliação', now);
  const resolution = decoded.resolution === undefined || decoded.resolution === null
    ? undefined
    : decoded.resolution;
  if (resolution !== undefined && resolution !== 'operator_completed' && resolution !== 'operator_retryable') {
    throw new WhatsappSendReservationStorageError();
  }
  if (resolvedAt !== undefined && (resolvedAt < updatedAt || resolution === undefined)) {
    throw new WhatsappSendReservationStorageError();
  }
  const contiguousAccepted = acceptedSteps.every((entry, index) => entry.step === index);
  if (!contiguousAccepted) throw new WhatsappSendReservationStorageError();
  if (phase === 'reserved' || phase === 'retryable') {
    const operatorResolved = phase === 'retryable' && resolution === 'operator_retryable';
    if (transportStartedAt !== undefined || currentStep !== undefined || result !== undefined || (!operatorResolved && acceptedSteps.length > 0)) {
      throw new WhatsappSendReservationStorageError();
    }
  }
  if (phase === 'transporting') {
    if (transportStartedAt === undefined || currentStep === undefined || acceptedSteps.length !== currentStep || result !== undefined || resolution !== undefined) {
      throw new WhatsappSendReservationStorageError();
    }
  }
  if (phase === 'accepted_partial') {
    if (transportStartedAt !== undefined || currentStep === undefined || acceptedSteps.length !== currentStep + 1 || result !== undefined || resolution !== undefined) {
      throw new WhatsappSendReservationStorageError();
    }
  }
  if (phase === 'completed') {
    if (result === undefined || transportStartedAt !== undefined || currentStep !== undefined) {
      throw new WhatsappSendReservationStorageError();
    }
    if ((resolution === 'operator_completed') !== (resolvedAt !== undefined)) {
      throw new WhatsappSendReservationStorageError();
    }
  }
  if (phase === 'reserved' && resolution !== undefined) throw new WhatsappSendReservationStorageError();
  if (phase === 'retryable' && resolution !== undefined && (resolution !== 'operator_retryable' || resolvedAt === undefined)) {
    throw new WhatsappSendReservationStorageError();
  }
  if (phase !== 'completed' && phase !== 'retryable' && resolution !== undefined) {
    throw new WhatsappSendReservationStorageError();
  }
  return {
    schema: WHATSAPP_SEND_RESERVATION_SCHEMA,
    key,
    quotationId,
    revisionId,
    flowId,
    stepsCount,
    version: Number(decoded.version),
    owner: decoded.owner.trim(),
    phase,
    createdAt,
    updatedAt,
    reservedAt,
    ...(transportStartedAt === undefined ? {} : { transportStartedAt }),
    ...(currentStep === undefined ? {} : { currentStep: Number(currentStep) }),
    acceptedSteps,
    ...(result === undefined ? {} : { result }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    ...(resolution === undefined ? {} : { resolution }),
  };
}

export function isWhatsappSendReservationStale(
  record: Pick<WhatsappSendReservationRecord, 'phase' | 'updatedAt' | 'transportStartedAt' | 'currentStep' | 'acceptedSteps'>,
  now = Date.now(),
): boolean {
  return record.phase === 'reserved'
    && record.transportStartedAt === undefined
    && record.currentStep === undefined
    && record.acceptedSteps.length === 0
    && Number.isFinite(record.updatedAt)
    && Number.isFinite(now)
    && now - record.updatedAt >= WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS;
}

function phaseTtlSeconds(phase: WhatsappSendReservationPhase): number {
  if (phase === 'retryable') return WHATSAPP_SEND_RESERVATION_RETRY_TTL_SECONDS;
  if (phase === 'completed') return WHATSAPP_SEND_RESERVATION_COMPLETED_TTL_SECONDS;
  if (phase === 'reserved') return WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS;
  return 0;
}

function phase(value: WhatsappSendReservationPhase | 'processing'): WhatsappSendReservationPhase {
  return value === 'processing' ? 'reserved' : value;
}

function parseEvalResult(value: unknown, expectedKey?: string): { status: string; record?: WhatsappSendReservationRecord } {
  if (!Array.isArray(value) || typeof value[0] !== 'string') throw new WhatsappSendReservationStorageError();
  const status = value[0];
  if (status === 'missing') return { status };
  if (value[1] === undefined || value[1] === null || value[1] === '') return { status };
  return { status, record: parseWhatsappSendReservationRecord(value[1], expectedKey) };
}

function reservationRecord(input: WhatsappSendReservationInput): WhatsappSendReservationRecord {
  const now = Date.now();
  const quotationId = canonicalText(input.quotationId, 'Identificador do orçamento');
  const revisionId = canonicalText(input.revisionId, 'Identificador da revisão');
  const flowId = canonicalText(input.flowId, 'Identificador do fluxo');
  if (!Number.isSafeInteger(input.stepsCount) || input.stepsCount < 1 || input.stepsCount > WHATSAPP_SEND_RESERVATION_MAX_ACCEPTED_STEPS) {
    throw new WhatsappSendReservationStorageError('Quantidade de etapas inválida.');
  }
  const stepsCount = Number(input.stepsCount);
  const key = canonicalKey(input.key);
  if (key !== canonicalWhatsappSendIdempotencyKey(quotationId, revisionId, flowId)) {
    throw new WhatsappSendReservationStorageError('Chave de idempotência não corresponde ao orçamento, revisão e fluxo.');
  }
  return {
    schema: WHATSAPP_SEND_RESERVATION_SCHEMA,
    key,
    quotationId,
    revisionId,
    flowId,
    stepsCount,
    version: 1,
    owner: randomUUID(),
    phase: 'reserved',
    createdAt: now,
    updatedAt: now,
    reservedAt: now,
    acceptedSteps: [],
  };
}

function acceptedStepInput(input: WhatsappSendReservationCasInput, now: number): WhatsappSendAcceptedStep | undefined {
  if (!input.acceptedStep) return undefined;
  if (!Number.isSafeInteger(input.acceptedStep.step) || input.acceptedStep.step < 0 || input.acceptedStep.step > 255) {
    throw new WhatsappSendReservationStorageError();
  }
  return { step: input.acceptedStep.step, kind: acceptedKind(input.acceptedStep.kind), acceptedAt: now };
}

function expectedVersion(input: WhatsappSendReservationCasInput): number {
  const value = input.expectedVersion ?? input.version;
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new WhatsappSendReservationStorageError();
  return Number(value);
}

function safeTransitionInput(input: WhatsappSendReservationCasInput): {
  from: WhatsappSendReservationPhase;
  to: WhatsappSendReservationPhase;
} {
  const from = phase(input.from);
  const to = phase(input.to);
  if (!(PHASES as readonly unknown[]).includes(from) || !(PHASES as readonly unknown[]).includes(to)) {
    throw new WhatsappSendReservationStorageError();
  }
  const allowed = (
    (from === 'reserved' && (to === 'transporting' || to === 'retryable'))
    || (from === 'transporting' && to === 'accepted_partial')
    || (from === 'accepted_partial' && (to === 'transporting' || to === 'completed'))
  );
  if (!allowed) throw new WhatsappSendReservationStorageError();
  return { from, to };
}

export function createWhatsappSendReservationStore(
  client: Pick<typeof kv, 'get' | 'set' | 'eval'> = kv,
): WhatsappSendReservationStore {
  const read = async (key: string): Promise<WhatsappSendReservationRecord | null> => {
    const normalizedKey = canonicalKey(key);
    try {
      const value = await client.get(storageKey(normalizedKey));
      if (value === null || value === undefined) return null;
      return parseWhatsappSendReservationRecord(value, normalizedKey);
    } catch (error) {
      if (error instanceof WhatsappSendReservationStorageError) throw error;
      throw new WhatsappSendReservationStorageError();
    }
  };

  const compareAndSet = async (input: WhatsappSendReservationCasInput): Promise<WhatsappSendReservationCasResult> => {
    const key = canonicalKey(input.key);
    const owner = canonicalText(input.owner, 'Proprietário da reserva');
    const { from, to } = safeTransitionInput(input);
    const version = expectedVersion(input);
    const now = Date.now();
    const acceptedStep = acceptedStepInput(input, now);
    if ((to === 'transporting' || to === 'accepted_partial') && (!Number.isSafeInteger(input.currentStep) || Number(input.currentStep) < 0 || Number(input.currentStep) > 255)) {
      throw new WhatsappSendReservationStorageError();
    }
    if (acceptedStep && to !== 'accepted_partial') throw new WhatsappSendReservationStorageError();
    if (to === 'accepted_partial' && (!acceptedStep || acceptedStep.step !== input.currentStep)) throw new WhatsappSendReservationStorageError();
    const terminalResult = to === 'completed'
      ? sanitizeWhatsappSendTerminalResult(input.result, undefined)
      : undefined;
    const errorMessage = safeErrorMessage(input.errorMessage);
    const serializedAccepted = to === 'accepted_partial' && acceptedStep ? JSON.stringify(acceptedStep) : '';
    const serializedResult = terminalResult ? JSON.stringify(terminalResult) : '';
    try {
      const evalResult = parseEvalResult(await client.eval(
        WHATSAPP_SEND_RESERVATION_CAS_SCRIPT,
        [storageKey(key)],
        [
          owner,
          String(version),
          from,
          to,
          String(now),
          to === 'transporting' || to === 'accepted_partial' ? String(input.currentStep) : '',
          to === 'transporting' ? '1' : '',
          serializedAccepted,
          serializedResult,
          errorMessage || '',
          String(phaseTtlSeconds(to)),
        ],
      ), key);
      if (evalResult.status === 'updated' && evalResult.record) return { ok: true, record: evalResult.record };
      if (evalResult.status === 'conflict' && evalResult.record) return { ok: false, reason: 'conflict', record: evalResult.record };
      if (evalResult.status === 'missing') return { ok: false, reason: 'missing' };
      return { ok: false, reason: 'invalid' };
    } catch {
      return { ok: false, reason: 'storage' };
    }
  };

  const resolve = async (input: WhatsappSendReservationResolutionInput): Promise<WhatsappSendReservationCasResult> => {
    const key = canonicalKey(input.key);
    const version = input.expectedVersion;
    if (!Number.isSafeInteger(version) || version < 1) throw new WhatsappSendReservationStorageError();
    if (input.to !== 'completed' && input.to !== 'retryable') throw new WhatsappSendReservationStorageError();
    if (input.confirmation !== WHATSAPP_SEND_RESOLUTION_CONFIRMATION) throw new WhatsappSendReservationStorageError('Confirmação explícita obrigatória.');
    let current: WhatsappSendReservationRecord | null;
    try {
      current = await read(key);
    } catch {
      return { ok: false, reason: 'storage' };
    }
    if (!current) return { ok: false, reason: 'missing' };
    if (current.version !== version || (current.phase !== 'transporting' && current.phase !== 'accepted_partial')) {
      return { ok: false, reason: 'conflict', record: current };
    }
    const now = Date.now();
    const result = input.to === 'completed'
      ? {
        success: true,
        dry_run: false,
        send_status: 'completed',
        duplicate_warning: false,
        duplicate_message: '',
        flow_id: current.flowId,
        flow_name: 'Fluxo reconciliado',
        quotation_id: current.quotationId,
        deal_id: null,
        product_summary: 'produtos',
        categories: [],
        steps_count: current.acceptedSteps.length,
        steps: current.acceptedSteps.map((step) => ({ type: step.kind })),
        send_event_id: null,
      }
      : undefined;
    const serializedResult = result ? JSON.stringify(result) : '';
    try {
      const evalResult = parseEvalResult(await client.eval(
        WHATSAPP_SEND_RESERVATION_RESOLVE_SCRIPT,
        [storageKey(key)],
        [
          String(version),
          input.to,
          String(now),
          input.to === 'completed' ? 'operator_completed' : 'operator_retryable',
          serializedResult,
          input.to === 'completed' ? 'Reconciliação encerrada pelo operador.' : 'Envio confirmado como não entregue pelo operador.',
          String(phaseTtlSeconds(input.to)),
        ],
      ), key);
      if (evalResult.status === 'updated' && evalResult.record) return { ok: true, record: evalResult.record };
      if (evalResult.status === 'conflict' && evalResult.record) return { ok: false, reason: 'conflict', record: evalResult.record };
      if (evalResult.status === 'missing') return { ok: false, reason: 'missing' };
      return { ok: false, reason: 'invalid' };
    } catch {
      return { ok: false, reason: 'storage' };
    }
  };

  return {
    async reserve(input) {
      const record = reservationRecord(input);
      try {
        const setResult: unknown = await client.set(storageKey(record.key), record, {
          nx: true,
          ex: WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS,
        });
        if (setResult === 'OK' || setResult === true) return { kind: 'reserved', record };
        if (setResult !== null && setResult !== undefined && setResult !== false) throw new WhatsappSendReservationStorageError();
        const existing = await read(record.key);
        if (!existing) throw new WhatsappSendReservationStorageError();
        if (existing.phase === 'retryable') {
          const evalResult = parseEvalResult(await client.eval(
            WHATSAPP_SEND_RESERVATION_RETRY_SCRIPT,
            [storageKey(record.key)],
            [record.owner, String(existing.version), String(Date.now()), String(WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS)],
          ), record.key);
          if (evalResult.status === 'reserved' && evalResult.record) return { kind: 'reserved', record: evalResult.record };
          if (evalResult.status === 'conflict' && evalResult.record) return { kind: 'existing', record: evalResult.record };
          if (evalResult.status === 'missing') throw new WhatsappSendReservationStorageError();
          throw new WhatsappSendReservationStorageError();
        }
        if (isWhatsappSendReservationStale(existing)) {
          const evalResult = parseEvalResult(await client.eval(
            WHATSAPP_SEND_RESERVATION_TAKEOVER_SCRIPT,
            [storageKey(record.key)],
            [record.owner, String(existing.version), String(Date.now()), String(WHATSAPP_SEND_RESERVATION_RESERVED_LEASE_MS), String(WHATSAPP_SEND_RESERVATION_RESERVED_TTL_SECONDS)],
          ), record.key);
          if (evalResult.status === 'reserved' && evalResult.record) return { kind: 'reserved', record: evalResult.record };
          if (evalResult.status === 'conflict' && evalResult.record) return { kind: 'existing', record: evalResult.record };
          if (evalResult.status === 'missing') throw new WhatsappSendReservationStorageError();
          throw new WhatsappSendReservationStorageError();
        }
        return { kind: 'existing', record: existing };
      } catch (error) {
        if (error instanceof WhatsappSendReservationStorageError) throw error;
        throw new WhatsappSendReservationStorageError();
      }
    },

    compareAndSet,
    cas: compareAndSet,
    resolve,
    async transition(input) {
      const current = await read(input.key);
      if (!current) return { ok: false, reason: 'missing' };
      const safeInput = {
        ...input,
        from: phase(input.from),
        to: phase(input.to),
        expectedVersion: input.expectedVersion ?? input.version ?? current.version,
      };
      return compareAndSet(safeInput);
    },
    get: read,
  };
}

export const defaultWhatsappSendReservationStore = createWhatsappSendReservationStore();
