import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import {
  ClientDuplicateError,
  ClientInputError,
  ClientNotFoundError,
  ClientRepositoryError,
  normalizeClientAddressPatch,
  normalizeClientDocument,
  normalizeClientName,
  type ClientAddress,
  type ClientPatchInput,
  type ClientRecord,
  type ClientWriteInput,
} from './client-schema.js';
import type { ClientRepository } from './client-repository.js';

/** Stable rollout marker shared by all client endpoints. */
export type CoreMode = boolean;

export interface CoreMeta {
  core_mode: CoreMode;
  source: 'postgres' | 'frappe';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function jsonResponse(
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {}
): FunctionResult {
  return {
    statusCode,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  };
}

export function coreMeta(): CoreMeta {
  return { core_mode: true, source: 'postgres' };
}

export function legacyMeta(): CoreMeta {
  return { core_mode: false, source: 'frappe' };
}

export function isCoreClientsEnabled(): boolean {
  if (process.env.CRM_OPERATIONAL_MODE === 'true') return true;
  return process.env.CRM_CORE_CLIENTS_ENABLED === 'true';
}

export function withMeta(result: FunctionResult, meta: CoreMeta): FunctionResult {
  if (!result.body) return result;
  try {
    const parsed = JSON.parse(result.body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...result, body: JSON.stringify({ ...parsed, ...meta }) };
    }
  } catch {
    // Keep a non-JSON legacy response intact; this is only compatibility
    // decoration and must never turn a useful legacy error into a new one.
  }
  return result;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonBody(event: FunctionEvent): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(event.body || '{}');
  } catch {
    throw new ClientInputError('JSON inválido.');
  }
  if (!isRecord(parsed)) throw new ClientInputError('Corpo da requisição deve ser um objeto.');
  return parsed;
}

function firstDefined(payload: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (hasOwn(payload, key)) return payload[key];
  }
  return undefined;
}

/**
 * Document aliases are accepted for compatibility with the previous Lead /
 * Customer screen. Supplying conflicting aliases is an explicit client error;
 * silently choosing one would make a retry unexpectedly overwrite a document.
 */
export function readDocumentAlias(payload: Record<string, unknown>): {
  present: boolean;
  value: string | null;
} {
  const aliases = ['documento', 'document', 'cpf', 'cnpj', 'tax_id'];
  const present = aliases.filter((key) => hasOwn(payload, key));
  if (!present.length) return { present: false, value: null };

  const normalized = present.map((key) => {
    try {
      return normalizeClientDocument(payload[key]);
    } catch (error) {
      if (error instanceof ClientInputError) throw error;
      throw new ClientInputError('Documento inválido.');
    }
  });
  const first = normalized[0];
  if (normalized.some((value) => value !== first)) {
    throw new ClientInputError('Os documentos informados entram em conflito.');
  }
  return { present: true, value: first };
}

function readAddressPayload(payload: Record<string, unknown>): {
  present: boolean;
  value: unknown;
} {
  if (hasOwn(payload, 'address')) return { present: true, value: payload.address };
  if (hasOwn(payload, 'endereco')) return { present: true, value: payload.endereco };
  const directAliases = [
    'street',
    'number',
    'bairro',
    'neighborhood',
    'complement',
    'complemento',
    'city',
    'municipio',
    'uf',
    'cep',
  ];
  if (directAliases.some((key) => hasOwn(payload, key))) {
    return {
      present: true,
      value: Object.fromEntries(
        directAliases.filter((key) => hasOwn(payload, key)).map((key) => [key, payload[key]])
      ),
    };
  }
  return { present: false, value: undefined };
}

export function buildCreateInput(payload: Record<string, unknown>): ClientWriteInput {
  const document = readDocumentAlias(payload);
  const address = readAddressPayload(payload);
  const result: ClientWriteInput = {
    nome: normalizeClientName(firstDefined(payload, ['nome', 'name'])),
    documento: document.value,
    email: firstDefined(payload, ['email', 'email_id']) as string | null | undefined,
    telefone: firstDefined(payload, ['telefone', 'phone', 'mobile_no', 'celular']) as
      | string
      | null
      | undefined,
    notes: firstDefined(payload, ['notes', 'observacoes', 'observação']) as
      | string
      | null
      | undefined,
    address: address.present ? (address.value as ClientAddress | null) : null,
  };
  if (hasOwn(payload, 'arquivado') || hasOwn(payload, 'archived')) {
    const value = firstDefined(payload, ['arquivado', 'archived']);
    if (typeof value !== 'boolean') throw new ClientInputError('arquivado deve ser booleano.');
    result.arquivado = value;
  }
  return result;
}

export interface ParsedPatch {
  patch: ClientPatchInput;
  addressPresent: boolean;
  addressValue: unknown;
}

export function buildPatchInput(payload: Record<string, unknown>): ParsedPatch {
  const patch: ClientPatchInput = {};
  if (hasOwn(payload, 'nome') || hasOwn(payload, 'name')) {
    const value = firstDefined(payload, ['nome', 'name']);
    // Leave null/empty for repository validation so the stable required-name
    // error is returned instead of treating it as an omitted field.
    patch.nome = value as string | null;
  }

  const document = readDocumentAlias(payload);
  if (document.present) patch.documento = document.value;
  if (hasOwn(payload, 'email') || hasOwn(payload, 'email_id')) {
    patch.email = firstDefined(payload, ['email', 'email_id']) as string | null;
  }
  if (
    hasOwn(payload, 'telefone') ||
    hasOwn(payload, 'phone') ||
    hasOwn(payload, 'mobile_no') ||
    hasOwn(payload, 'celular')
  ) {
    patch.telefone = firstDefined(payload, ['telefone', 'phone', 'mobile_no', 'celular']) as
      | string
      | null;
  }
  if (hasOwn(payload, 'notes') || hasOwn(payload, 'observacoes') || hasOwn(payload, 'observação')) {
    patch.notes = firstDefined(payload, ['notes', 'observacoes', 'observação']) as string | null;
  }
  if (hasOwn(payload, 'arquivado') || hasOwn(payload, 'archived')) {
    const value = firstDefined(payload, ['arquivado', 'archived']);
    if (typeof value !== 'boolean') throw new ClientInputError('arquivado deve ser booleano.');
    patch.arquivado = value;
  }

  const address = readAddressPayload(payload);
  return { patch, addressPresent: address.present, addressValue: address.value };
}

export function mergeAddressPatch(
  current: ClientAddress | null,
  raw: unknown
): ClientAddress | null {
  if (raw === null) return null;
  const patch = normalizeClientAddressPatch(raw);
  if (patch === null) return null;
  if (Object.keys(patch).length === 0) return current;
  return {
    endereco: patch.endereco === undefined ? current?.endereco || null : patch.endereco,
    numero: patch.numero === undefined ? current?.numero || null : patch.numero,
    bairro: patch.bairro === undefined ? current?.bairro || null : patch.bairro,
    complemento: patch.complemento === undefined ? current?.complemento || null : patch.complemento,
    municipio: patch.municipio === undefined ? current?.municipio || null : patch.municipio,
    uf: patch.uf === undefined ? current?.uf || null : patch.uf,
    cep: patch.cep === undefined ? current?.cep || null : patch.cep,
  };
}

export function mapClientRow(record: ClientRecord): Record<string, unknown> {
  return {
    id: record.id,
    nome: record.nome,
    email: record.email,
    telefone: record.telefone,
    documento: record.documento,
    tax_id: record.documento,
    cnpj: record.documento && record.documento.length === 14 ? record.documento : null,
    notes: record.notes,
    observacoes: record.notes,
    tipo: 'cliente',
    data_criacao: record.createdAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    arquivado: record.arquivado,
    archived: record.arquivado,
    archived_at: record.archivedAt,
    status: record.arquivado ? 'archived' : 'active',
  };
}

function qualityFlags(record: ClientRecord): string[] {
  const flags: string[] = [];
  if (!record.telefone) flags.push('sem_telefone');
  if (!record.email) flags.push('sem_email');
  if (!record.documento) flags.push('sem_cnpj');
  if (!record.address || !record.address.endereco || !record.address.municipio)
    flags.push('endereco_incompleto');
  return flags;
}

export function mapClientDetail(record: ClientRecord): Record<string, unknown> {
  const personType = record.documento ? (record.documento.length === 11 ? 'pf' : 'pj') : null;
  const address = record.address
    ? {
        ...record.address,
        // Canonical English aliases make the storage/API seam explicit while
        // retaining the Portuguese names consumed by the existing UI.
        street: record.address.endereco,
        number: record.address.numero,
        complement: record.address.complemento,
        city: record.address.municipio,
      }
    : null;
  return {
    success: true,
    ...coreMeta(),
    doctype: 'Customer',
    tipo: 'cliente',
    name: record.id,
    id: record.id,
    display_name: record.nome,
    nome: record.nome,
    email: record.email,
    telefone: record.telefone,
    person_type: personType,
    tax_id: record.documento,
    documento: record.documento,
    cpf: record.documento && record.documento.length === 11 ? record.documento : null,
    cnpj: record.documento && record.documento.length === 14 ? record.documento : null,
    notes: record.notes,
    observacoes: record.notes,
    address,
    arquivado: record.arquivado,
    archived: record.arquivado,
    status: record.arquivado ? 'archived' : 'active',
    archived_at: record.archivedAt,
    creation: record.createdAt,
    modified: record.updatedAt,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    erp_url: null,
    erp: null,
    latest_quotation: null,
    quote: null,
    deal: null,
    quality_flags: qualityFlags(record),
  };
}

export function getQuery(event: FunctionEvent, key: string): string | undefined {
  const value = event.queryStringParameters?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function parseListOptions(event: FunctionEvent) {
  const query = event.queryStringParameters || {};
  const pageRaw = query.page;
  const limitRaw = query.limit;
  const parsedPage = Number(pageRaw || 1);
  const parsedLimit = Number(limitRaw || 50);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(200, Math.floor(parsedLimit)) : 50;
  const status = String(query.status || 'active')
    .trim()
    .toLowerCase();
  if (!['active', 'archived', 'all'].includes(status)) {
    throw new ClientInputError('Status inválido. Valores aceitos: active, archived, all.');
  }
  const tipo = String(query.tipo || 'todos')
    .trim()
    .toLowerCase();
  if (!['todos', 'cliente', 'lead'].includes(tipo)) {
    throw new ClientInputError('Tipo inválido. Valores aceitos: cliente, lead, todos.');
  }
  return {
    page,
    limit,
    status: status as 'active' | 'archived' | 'all',
    search: String(query.search || query.q || ''),
  };
}

export function normalizeCoreError(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  if (error instanceof ClientInputError) {
    return {
      statusCode: 400,
      body: { error: error.message, ...(error.fields ? { fields: error.fields } : {}) },
    };
  }
  if (error instanceof ClientDuplicateError)
    return { statusCode: 409, body: { error: error.message } };
  if (error instanceof ClientNotFoundError)
    return { statusCode: 404, body: { error: error.message } };
  if (error instanceof ClientRepositoryError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.expose
          ? error.message
          : 'Não foi possível acessar os clientes. Tente novamente.',
      },
    };
  }
  if (
    error instanceof Error &&
    Number.isInteger((error as Error & { statusCode?: unknown }).statusCode)
  ) {
    const statusCode = Number((error as Error & { statusCode: number }).statusCode);
    if (statusCode >= 400 && statusCode < 600)
      return { statusCode, body: { error: error.message } };
  }
  return { statusCode: 500, body: { error: 'Não foi possível concluir a operação de clientes.' } };
}

export async function findRequiredClient(
  repository: ClientRepository,
  id: string
): Promise<ClientRecord> {
  const record = await repository.get(id);
  if (!record) throw new ClientNotFoundError();
  return record;
}
