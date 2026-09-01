import { randomUUID } from 'node:crypto';

import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';

import { getDatabase, type AppDatabase } from '../client.js';
import { clients, type ClientRow } from '../client-schema.js';
import {
  ClientDuplicateError,
  ClientInputError,
  ClientNotFoundError,
  ClientRepositoryError,
  normalizeClientAddress,
  normalizeClientAddressPatch,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientNotes,
  normalizeClientPhone,
  type ClientAddress,
  type ClientListOptions,
  type ClientListResult,
  type ClientPatchInput,
  type ClientRecord,
  type ClientWriteInput,
} from '../../../_modules/client-schema.js';
import { cancelClientFollowUpsForArchive } from './quotation-follow-up-facts.js';
import type { ClientRepository } from '../../../_modules/client-repository.js';

export type {
  ClientRepository,
  MemoryClientRepositoryOptions,
} from '../../../_modules/client-repository.js';
export type {
  ClientAddress,
  ClientCreateInput,
  ClientListOptions,
  ClientListResult,
  ClientPatchInput,
  ClientRecord,
  ClientStatus,
  ClientUpdateInput,
  ClientWriteInput,
} from '../../../_modules/client-schema.js';

type DatabaseProvider = () => AppDatabase;

function asDate(value: Date | string | null | undefined, fallback = new Date()): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime()))
    return new Date(value).toISOString();
  return fallback.toISOString();
}

function toAddress(row: ClientRow): ClientAddress | null {
  const hasValue = [
    row.endereco,
    row.numero,
    row.bairro,
    row.complemento,
    row.municipio,
    row.uf,
    row.cep,
  ].some(Boolean);
  if (!hasValue) return null;
  return {
    endereco: row.endereco || null,
    numero: row.numero || null,
    bairro: row.bairro || null,
    complemento: row.complemento || null,
    municipio: row.municipio || null,
    uf: row.uf || null,
    cep: row.cep || null,
  };
}

function toRecord(row: ClientRow): ClientRecord {
  const createdAt = asDate(row.createdAt);
  const updatedAt = asDate(row.updatedAt, new Date(createdAt));
  return {
    id: row.id,
    nome: row.nome,
    documento: row.documento || null,
    email: row.email || null,
    telefone: row.telefone || null,
    notes: row.notes || null,
    address: toAddress(row),
    arquivado: Boolean(row.arquivado),
    createdAt,
    updatedAt,
    archivedAt: row.archivedAt ? asDate(row.archivedAt) : null,
  };
}

function normalizePage(value: unknown, fallback: number, maximum?: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.max(1, Math.floor(parsed));
  return maximum === undefined ? integer : Math.min(maximum, integer);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Drizzle/postgres-js may wrap a constraint error several times in `cause`.
 * Walk a bounded, cycle-safe chain and inspect metadata only; never expose
 * driver messages or SQL in the public response.
 */
function isClientDocumentDuplicate(error: unknown): boolean {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  let depth = 0;
  while (pending.length > 0 && depth < 12) {
    const current = pending.shift();
    depth += 1;
    if (!isRecord(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const code = String(current.code ?? current.sqlState ?? current.sqlstate ?? '');
    const constraint = String(current.constraint ?? current.constraint_name ?? '');
    const detail = String(current.detail ?? '');
    if (
      code === '23505' &&
      (!constraint ||
        constraint === 'clients_documento_unique' ||
        constraint.includes('documento') ||
        detail.includes('documento'))
    )
      return true;
    if (constraint === 'clients_documento_unique') return true;
    if (isRecord(current.cause)) pending.push(current.cause);
  }
  return false;
}

function normalizeError(error: unknown): never {
  if (
    error instanceof ClientInputError ||
    error instanceof ClientDuplicateError ||
    error instanceof ClientNotFoundError ||
    error instanceof ClientRepositoryError
  )
    throw error;
  if (isClientDocumentDuplicate(error)) throw new ClientDuplicateError();
  throw new ClientRepositoryError();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/** Match the memory seam: only valid formatted numeric terms receive a
 * digits-only fallback; `%` and `_` remain literal search characters. */
function normalizedDigitsSearchTerm(value: string): string | null {
  try {
    return normalizeClientPhone(value);
  } catch {
    return null;
  }
}

function clientListWhere(options: ClientListOptions): SQL | undefined {
  const filters: SQL[] = [];
  if (options.status === 'active' || !options.status) filters.push(eq(clients.arquivado, false));
  if (options.status === 'archived') filters.push(eq(clients.arquivado, true));
  const search = typeof options.search === 'string' ? options.search.trim() : '';
  if (search) {
    const pattern = `%${escapeLike(search)}%`;
    const digits = normalizedDigitsSearchTerm(search);
    filters.push(
      or(
        ilike(clients.nome, pattern),
        ilike(clients.documento, pattern),
        ilike(clients.email, pattern),
        ilike(clients.telefone, pattern),
        ilike(clients.notes, pattern),
        ilike(clients.endereco, pattern),
        ilike(clients.numero, pattern),
        ilike(clients.bairro, pattern),
        ilike(clients.complemento, pattern),
        ilike(clients.municipio, pattern),
        ilike(clients.uf, pattern),
        ilike(clients.cep, pattern),
        ...(digits ? [ilike(clients.documento, `%${escapeLike(digits)}%`)] : []),
        ...(digits ? [ilike(clients.telefone, `%${escapeLike(digits)}%`)] : [])
      )!
    );
  }
  return filters.length ? and(...filters) : undefined;
}

export async function listClientsForExport(
  options: ClientListOptions,
  limit: number,
  getDb: DatabaseProvider = getDatabase
) {
  return getDb()
    .select({
      id: clients.id,
      nome: clients.nome,
      documento: clients.documento,
      email: clients.email,
      telefone: clients.telefone,
      endereco: clients.endereco,
      numero: clients.numero,
      bairro: clients.bairro,
      complemento: clients.complemento,
      municipio: clients.municipio,
      uf: clients.uf,
      cep: clients.cep,
      arquivado: clients.arquivado,
      createdAt: clients.createdAt,
      updatedAt: clients.updatedAt,
      archivedAt: clients.archivedAt,
    })
    .from(clients)
    .where(clientListWhere(options))
    .orderBy(desc(clients.updatedAt))
    .limit(limit);
}

function dataForWrite(input: ClientWriteInput | ClientPatchInput, existing?: ClientRecord) {
  const result: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(input, 'nome'))
    result.nome = normalizeClientName(input.nome);
  if (Object.prototype.hasOwnProperty.call(input, 'documento'))
    result.documento = normalizeClientDocument(input.documento);
  if (Object.prototype.hasOwnProperty.call(input, 'email'))
    result.email = normalizeClientEmail(input.email);
  if (Object.prototype.hasOwnProperty.call(input, 'telefone'))
    result.telefone = normalizeClientPhone(input.telefone);
  if (
    Object.prototype.hasOwnProperty.call(input, 'notes') ||
    Object.prototype.hasOwnProperty.call(input, 'observacoes')
  ) {
    result.notes = normalizeClientNotes(
      Object.prototype.hasOwnProperty.call(input, 'notes') ? input.notes : input.observacoes
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, 'address')) {
    const address =
      input.address === null
        ? null
        : (() => {
            const patch = normalizeClientAddressPatch(input.address);
            if (!patch || Object.keys(patch).length === 0) return existing?.address || null;
            return {
              endereco:
                patch?.endereco === undefined
                  ? existing?.address?.endereco || null
                  : patch.endereco,
              numero:
                patch?.numero === undefined ? existing?.address?.numero || null : patch.numero,
              bairro:
                patch?.bairro === undefined ? existing?.address?.bairro || null : patch.bairro,
              complemento:
                patch?.complemento === undefined
                  ? existing?.address?.complemento || null
                  : patch.complemento,
              municipio:
                patch?.municipio === undefined
                  ? existing?.address?.municipio || null
                  : patch.municipio,
              uf: patch?.uf === undefined ? existing?.address?.uf || null : patch.uf,
              cep: patch?.cep === undefined ? existing?.address?.cep || null : patch.cep,
            } satisfies ClientAddress;
          })();
    result.endereco = address?.endereco || null;
    result.numero = address?.numero || null;
    result.bairro = address?.bairro || null;
    result.complemento = address?.complemento || null;
    result.municipio = address?.municipio || null;
    result.uf = address?.uf || null;
    result.cep = address?.cep || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'arquivado')) {
    if (typeof input.arquivado !== 'boolean')
      throw new ClientInputError('arquivado deve ser booleano.');
    result.arquivado = input.arquivado;
    result.archivedAt = input.arquivado ? new Date() : null;
  }
  if (
    existing &&
    Object.prototype.hasOwnProperty.call(input, 'arquivado') &&
    input.arquivado === true &&
    existing.arquivado
  ) {
    result.archivedAt = existing.archivedAt ? new Date(existing.archivedAt) : new Date();
  }
  return result;
}

/** PostgreSQL implementation used by production core mode. */
export function createPostgresClientRepository(
  getDb: DatabaseProvider = getDatabase
): ClientRepository {
  return {
    async list(options: ClientListOptions = {}): Promise<ClientListResult> {
      try {
        const db = getDb() as AppDatabase;
        const page = normalizePage(options.page, 1);
        const limit = normalizePage(options.limit, 50, 200);
        const where = clientListWhere(options);
        const rows = await db
          .select()
          .from(clients)
          .where(where)
          .orderBy(desc(clients.updatedAt))
          .limit(limit)
          .offset((page - 1) * limit);
        const [{ count }] = await db
          .select({ count: sql<number>`count(*)` })
          .from(clients)
          .where(where);
        const total = Number(count || 0);
        return { data: rows.map(toRecord), total, page, limit };
      } catch (error) {
        normalizeError(error);
      }
    },

    async get(id: string): Promise<ClientRecord | null> {
      if (!isUuid(id)) return null;
      try {
        const db = getDb() as AppDatabase;
        const [row] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
        return row ? toRecord(row) : null;
      } catch (error) {
        normalizeError(error);
      }
    },

    async create(input: ClientWriteInput): Promise<ClientRecord> {
      try {
        const db = getDb() as AppDatabase;
        const data = dataForWrite({
          ...input,
          nome: normalizeClientName(input.nome),
          documento: normalizeClientDocument(input.documento),
          email: normalizeClientEmail(input.email),
          telefone: normalizeClientPhone(input.telefone),
          notes: normalizeClientNotes(
            Object.prototype.hasOwnProperty.call(input, 'notes') ? input.notes : input.observacoes
          ),
          address: normalizeClientAddress(input.address),
        });
        const archived = Boolean(input.arquivado);
        const [row] = await db
          .insert(clients)
          .values({
            id: randomUUID(),
            ...data,
            arquivado: archived,
            archivedAt: archived ? new Date() : null,
          } as never)
          .returning();
        if (!row) throw new ClientRepositoryError('Não foi possível criar o cliente.');
        return toRecord(row as ClientRow);
      } catch (error) {
        normalizeError(error);
      }
    },

    async update(id: string, patch: ClientPatchInput): Promise<ClientRecord> {
      if (!isUuid(id)) throw new ClientNotFoundError();
      try {
        const db = getDb() as AppDatabase;
        const [existingRow] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
        if (!existingRow) throw new ClientNotFoundError();
        const existing = toRecord(existingRow);
        const data = dataForWrite(patch, existing);
        data.updatedAt = new Date();
        const [row] = await db
          .update(clients)
          .set(data as never)
          .where(eq(clients.id, id))
          .returning();
        if (!row) throw new ClientNotFoundError();
        const updated = toRecord(row as ClientRow);
        if (!existing.arquivado && updated.arquivado) {
          await cancelClientFollowUpsForArchive(db, id, new Date(updated.updatedAt));
        }
        return updated;
      } catch (error) {
        normalizeError(error);
      }
    },

    async archive(id: string): Promise<ClientRecord> {
      const existing = await this.get(id);
      if (!existing) throw new ClientNotFoundError();
      if (existing.arquivado) return existing;
      return this.update(id, { arquivado: true });
    },
  };
}
