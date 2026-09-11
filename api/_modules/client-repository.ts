import { randomUUID } from 'node:crypto';

import { createPostgresClientRepository as postgresFactory } from '../_infrastructure/db/repositories/client-repository.js';

import {
  ClientDuplicateError,
  ClientInputError,
  ClientNotFoundError,
  ClientRepositoryError,
  type ClientListOptions,
  type ClientListResult,
  type ClientPatchInput,
  type ClientRecord,
  type ClientWriteInput,
  cloneClientRecord,
  normalizeClientAddress,
  normalizeClientAddressPatch,
  normalizeClientCompany,
  normalizeClientDocument,
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientNotes,
  normalizeClientPhone,
} from './client-schema.js';

/**
 * Repository boundary used by the unified handlers. Keeping it deliberately
 * small lets tests use an isolated memory implementation while production
 * lazily uses PostgreSQL without changing the HTTP contract.
 */
export interface ClientRepository {
  list(options?: ClientListOptions): Promise<ClientListResult>;
  get(id: string): Promise<ClientRecord | null>;
  create(input: ClientWriteInput): Promise<ClientRecord>;
  update(id: string, patch: ClientPatchInput): Promise<ClientRecord>;
  archive(id: string): Promise<ClientRecord>;
  delete(id: string): Promise<void>;
}

export interface MemoryClientRepositoryOptions {
  /** Seed records (useful for deterministic unit tests). */
  initial?: ClientRecord[];
  /** Inject time/id generation to make tests deterministic. */
  now?: () => Date;
  idFactory?: () => string;
  /** Persist dependent commercial projections when a client is archived. */
  onArchived?: (clientId: string, archivedAt: string) => void | Promise<void>;
}

function cloneInputRecord(record: ClientRecord): ClientRecord {
  if (typeof record.arquivado !== 'boolean')
    throw new ClientInputError('arquivado deve ser booleano.');
  const fallbackNow = new Date().toISOString();
  const createdAt =
    typeof record.createdAt === 'string' && !Number.isNaN(new Date(record.createdAt).getTime())
      ? new Date(record.createdAt).toISOString()
      : fallbackNow;
  const updatedAt =
    typeof record.updatedAt === 'string' && !Number.isNaN(new Date(record.updatedAt).getTime())
      ? new Date(record.updatedAt).toISOString()
      : createdAt;
  return cloneClientRecord({
    ...record,
    id: String(record.id || randomUUID()),
    nome: normalizeClientName(record.nome),
    empresa: normalizeClientCompany(record.empresa),
    documento: normalizeClientDocument(record.documento),
    email: normalizeClientEmail(record.email),
    telefone: normalizeClientPhone(record.telefone),
    notes: normalizeClientNotes(record.notes),
    address: normalizeClientAddress(record.address),
    arquivado: record.arquivado === true,
    createdAt,
    updatedAt,
    archivedAt: record.arquivado ? record.archivedAt || updatedAt : null,
  });
}

function normalizePage(value: unknown, fallback: number, maximum?: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const integer = Math.trunc(parsed);
  const bounded = Math.max(1, integer || fallback);
  return maximum === undefined ? bounded : Math.min(maximum, bounded);
}

function normalizeSearch(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('pt-BR') : '';
}

/** Only formatted numeric terms with a valid phone/document length get a
 * digits-only fallback. Characters such as `%` and `_` stay literal. */
function normalizedDigitsSearchTerm(value: string): string | null {
  try {
    return normalizeClientPhone(value);
  } catch {
    return null;
  }
}

function searchable(record: ClientRecord, search: string): boolean {
  if (!search) return true;
  const digits = normalizedDigitsSearchTerm(search);
  const address = record.address;
  return (
    [
      record.nome,
      record.empresa,
      record.documento,
      record.email,
      record.telefone,
      record.notes,
      address?.endereco,
      address?.numero,
      address?.bairro,
      address?.complemento,
      address?.municipio,
      address?.uf,
      address?.cep,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLocaleLowerCase('pt-BR').includes(search)) ||
    Boolean(digits && (record.documento?.includes(digits) || record.telefone?.includes(digits)))
  );
}

function sameDocument(left: string | null, right: string | null): boolean {
  return Boolean(left && right && left === right);
}

/**
 * In-memory repository for deterministic tests. Production never selects this
 * implementation implicitly; all values crossing the seam are cloned to avoid
 * accidental test/global state mutation.
 */
export class MemoryClientRepository implements ClientRepository {
  private readonly records = new Map<string, ClientRecord>();
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly onArchived?: (clientId: string, archivedAt: string) => void | Promise<void>;

  constructor(options: MemoryClientRepositoryOptions = {}) {
    this.now = options.now || (() => new Date());
    this.idFactory = options.idFactory || randomUUID;
    this.onArchived = options.onArchived;
    for (const initial of options.initial || []) {
      const record = cloneInputRecord(initial);
      if (this.records.has(record.id)) {
        throw new ClientRepositoryError('Não foi possível carregar clientes duplicados.');
      }
      if (record.documento && this.hasDocument(record.documento)) {
        throw new ClientDuplicateError();
      }
      this.records.set(record.id, record);
    }
  }

  private timestamp(): string {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new ClientRepositoryError('Relógio inválido para o cadastro de clientes.');
    }
    return value.toISOString();
  }

  private hasDocument(documento: string, exceptId?: string): boolean {
    for (const record of this.records.values()) {
      if (record.id !== exceptId && sameDocument(record.documento, documento)) return true;
    }
    return false;
  }

  async list(options: ClientListOptions = {}): Promise<ClientListResult> {
    const status = options.status || 'active';
    const search = normalizeSearch(options.search);
    const page = normalizePage(options.page, 1);
    const limit = normalizePage(options.limit, 50, 200);

    let values = [...this.records.values()];
    if (status === 'active') values = values.filter((record) => !record.arquivado);
    if (status === 'archived') values = values.filter((record) => record.arquivado);
    values = values.filter((record) => searchable(record, search));
    values.sort((left, right) => {
      const modified = right.updatedAt.localeCompare(left.updatedAt);
      return modified || right.id.localeCompare(left.id);
    });

    const total = values.length;
    const start = (page - 1) * limit;
    return {
      data: values.slice(start, start + limit).map(cloneClientRecord),
      total,
      page,
      limit,
    };
  }

  async get(id: string): Promise<ClientRecord | null> {
    const record = this.records.get(id);
    return record ? cloneClientRecord(record) : null;
  }

  async create(input: ClientWriteInput): Promise<ClientRecord> {
    const now = this.timestamp();
    const nome = normalizeClientName(input.nome);
    const empresa = normalizeClientCompany(input.empresa);
    const documento = normalizeClientDocument(input.documento);
    const email = normalizeClientEmail(input.email);
    const telefone = normalizeClientPhone(input.telefone);
    const notes = normalizeClientNotes(
      Object.prototype.hasOwnProperty.call(input, 'notes') ? input.notes : input.observacoes
    );
    const address = normalizeClientAddress(input.address);

    if (input.arquivado !== undefined && typeof input.arquivado !== 'boolean') {
      throw new ClientInputError('arquivado deve ser booleano.');
    }

    if (documento && this.hasDocument(documento)) throw new ClientDuplicateError();

    let id = this.idFactory();
    // A bad/inadvertently duplicated injected id should never overwrite a
    // record. Keep trying the injectable factory a few times, then fail safely.
    for (let attempts = 0; this.records.has(id) && attempts < 5; attempts += 1)
      id = this.idFactory();
    if (this.records.has(id))
      throw new ClientRepositoryError('Não foi possível gerar o identificador do cliente.');

    const record: ClientRecord = {
      id,
      nome,
      empresa,
      documento,
      email,
      telefone,
      notes,
      address,
      arquivado: input.arquivado === true,
      createdAt: now,
      updatedAt: now,
      archivedAt: input.arquivado === true ? now : null,
    };
    this.records.set(id, record);
    return cloneClientRecord(record);
  }

  async update(id: string, patch: ClientPatchInput): Promise<ClientRecord> {
    const current = this.records.get(id);
    if (!current) throw new ClientNotFoundError();

    const next: ClientRecord = cloneClientRecord(current);
    if (Object.prototype.hasOwnProperty.call(patch, 'nome')) {
      // A null/empty name is not a clear operation: names are required.
      next.nome = normalizeClientName(patch.nome);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'empresa')) {
      next.empresa = normalizeClientCompany(patch.empresa);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'documento')) {
      next.documento = normalizeClientDocument(patch.documento);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'email')) {
      next.email = normalizeClientEmail(patch.email);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'telefone')) {
      next.telefone = normalizeClientPhone(patch.telefone);
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'notes') ||
      Object.prototype.hasOwnProperty.call(patch, 'observacoes')
    ) {
      next.notes = normalizeClientNotes(
        Object.prototype.hasOwnProperty.call(patch, 'notes') ? patch.notes : patch.observacoes
      );
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'address')) {
      if (patch.address === null) {
        next.address = null;
      } else {
        const addressPatch = normalizeClientAddressPatch(patch.address);
        if (addressPatch && Object.keys(addressPatch).length > 0) {
          next.address = {
            endereco:
              addressPatch.endereco === undefined
                ? current.address?.endereco || null
                : addressPatch.endereco,
            numero:
              addressPatch.numero === undefined
                ? current.address?.numero || null
                : addressPatch.numero,
            bairro:
              addressPatch.bairro === undefined
                ? current.address?.bairro || null
                : addressPatch.bairro,
            complemento:
              addressPatch.complemento === undefined
                ? current.address?.complemento || null
                : addressPatch.complemento,
            municipio:
              addressPatch.municipio === undefined
                ? current.address?.municipio || null
                : addressPatch.municipio,
            uf: addressPatch.uf === undefined ? current.address?.uf || null : addressPatch.uf,
            cep: addressPatch.cep === undefined ? current.address?.cep || null : addressPatch.cep,
          };
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'arquivado')) {
      if (typeof patch.arquivado !== 'boolean')
        throw new ClientInputError('arquivado deve ser booleano.');
      next.arquivado = patch.arquivado;
    }

    if (next.documento && this.hasDocument(next.documento, id)) throw new ClientDuplicateError();

    const now = this.timestamp();
    next.updatedAt = now;
    if (next.arquivado) next.archivedAt = current.arquivado ? current.archivedAt || now : now;
    else next.archivedAt = null;

    this.records.set(id, next);
    if (!current.arquivado && next.arquivado) {
      await this.onArchived?.(id, next.archivedAt || next.updatedAt);
    }
    return cloneClientRecord(next);
  }

  async archive(id: string): Promise<ClientRecord> {
    const current = this.records.get(id);
    if (!current) throw new ClientNotFoundError();
    if (current.arquivado) return cloneClientRecord(current);
    return this.update(id, { arquivado: true });
  }

  async delete(id: string): Promise<void> {
    if (!this.records.delete(id)) throw new ClientNotFoundError();
  }
}

export function createMemoryClientRepository(
  options: MemoryClientRepositoryOptions = {}
): ClientRepository {
  return new MemoryClientRepository(options);
}

let defaultRepository: ClientRepository | undefined;

/** Lazy singleton for production PostgreSQL core mode. */
export function getClientRepository(): ClientRepository {
  if (!defaultRepository) {
    // Keep the production path on PostgreSQL while resolving the connection
    // lazily. Unit/browser tests inject createMemoryClientRepository(), so no
    // DATABASE_URL is needed merely to import the handlers.
    defaultRepository = createPostgresRepository();
  }
  return defaultRepository;
}

function createPostgresRepository(): ClientRepository {
  // Imported lazily at call time to preserve safe module import in local tests.
  // The module itself does not open a connection until its repository methods
  // call getDatabase().
  return postgresFactory();
}

/** Test seam; production code should rely on the lazy singleton. */
export function setClientRepository(repository: ClientRepository | undefined): void {
  defaultRepository = repository;
}
