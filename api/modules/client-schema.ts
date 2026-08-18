/**
 * Canonical application-client model and validation helpers.
 *
 * This module is intentionally free of persistence/ERP concerns. The
 * repository seam can be exercised in memory by unit tests while production
 * uses the PostgreSQL implementation without changing the HTTP contract.
 */

export const CLIENT_NAME_MAX_LENGTH = 200;
export const CLIENT_DOCUMENT_LENGTHS = [11, 14] as const;
export const CLIENT_EMAIL_MAX_LENGTH = 254;
export const CLIENT_PHONE_MIN_LENGTH = 10;
export const CLIENT_PHONE_MAX_LENGTH = 15;
export const CLIENT_NOTES_MAX_LENGTH = 4000;

export const ADDRESS_LIMITS = Object.freeze({
  street: 255,
  number: 30,
  bairro: 120,
  complement: 120,
  city: 120,
  uf: 2,
  cep: 8,
});

export interface ClientAddress {
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  complemento: string | null;
  municipio: string | null;
  uf: string | null;
  cep: string | null;
}

export interface ClientRecord {
  id: string;
  nome: string;
  documento: string | null;
  email: string | null;
  telefone: string | null;
  notes: string | null;
  address: ClientAddress | null;
  arquivado: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type ClientStatus = 'active' | 'archived' | 'all';

export interface ClientListOptions {
  page?: number;
  limit?: number;
  search?: string;
  status?: ClientStatus;
}

export interface ClientListResult {
  data: ClientRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ClientWriteInput {
  nome: string;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  notes?: string | null;
  /** Public Portuguese alias for the internal `notes` column. */
  observacoes?: string | null;
  address?: ClientAddress | null;
  arquivado?: boolean;
}

export interface ClientPatchInput {
  nome?: string | null;
  documento?: string | null;
  email?: string | null;
  telefone?: string | null;
  notes?: string | null;
  /** Public Portuguese alias for the internal `notes` column. */
  observacoes?: string | null;
  address?: Partial<ClientAddress> | ClientAddress | null;
  arquivado?: boolean;
}

// Naming aliases mirror the other repository modules and keep external tests
// independent from this file's wording.
export type ClientCreateInput = ClientWriteInput;
export type ClientUpdateInput = ClientPatchInput;

export class ClientInputError extends Error {
  readonly statusCode = 400;
  readonly fields?: Record<string, string>;

  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ClientInputError';
    this.fields = fields;
  }
}

export class ClientNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(message = 'Cliente não encontrado.') {
    super(message);
    this.name = 'ClientNotFoundError';
  }
}

export class ClientDuplicateError extends Error {
  readonly statusCode = 409;

  constructor(message = 'Documento já cadastrado para outro cliente.') {
    super(message);
    this.name = 'ClientDuplicateError';
  }
}

export class ClientRepositoryError extends Error {
  readonly statusCode = 500;
  readonly expose: boolean;

  constructor(message = 'Não foi possível acessar os clientes.', expose = false) {
    super(message);
    this.name = 'ClientRepositoryError';
    this.expose = expose;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueAsText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new ClientInputError('Informe valores de texto válidos.');
  }
  return value;
}

/** Trims a name while preserving interior whitespace and enforcing the limit. */
export function normalizeClientName(value: unknown): string {
  if (typeof value !== 'string') throw new ClientInputError('Nome é obrigatório.');
  const normalized = value.trim();
  if (!normalized) throw new ClientInputError('Nome é obrigatório.');
  if (normalized.length > CLIENT_NAME_MAX_LENGTH) {
    throw new ClientInputError(`Nome deve ter no máximo ${CLIENT_NAME_MAX_LENGTH} caracteres.`);
  }
  return normalized;
}

/**
 * Canonical document value: punctuation and spaces are removed and only CPF
 * (11) or CNPJ (14) lengths are accepted. Checksum validation is intentionally
 * left to the business layer; the unified model only promises shape/uniqueness.
 */
export function normalizeClientDocument(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ClientInputError('Documento deve ser texto.');
  }
  const raw = String(value).trim();
  if (raw && !/^[0-9\s()./-]+$/.test(raw)) {
    throw new ClientInputError('Documento deve conter apenas dígitos e formatação válida.');
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (!(CLIENT_DOCUMENT_LENGTHS as readonly number[]).includes(digits.length)) {
    throw new ClientInputError('Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos.');
  }
  return digits;
}

export function normalizeClientEmail(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = valueAsText(value);
  if (text === null) return null;
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.length > CLIENT_EMAIL_MAX_LENGTH) {
    throw new ClientInputError(`E-mail deve ter no máximo ${CLIENT_EMAIL_MAX_LENGTH} caracteres.`);
  }
  // Deliberately conservative validation: enough to reject malformed input
  // while accepting the normal international addresses used by the app.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ClientInputError('E-mail inválido.');
  }
  return normalized;
}

export function normalizeClientPhone(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = valueAsText(value);
  if (text === null) return null;
  const raw = text.trim();
  if (raw && !/^[0-9\s()+./-]+$/.test(raw)) {
    throw new ClientInputError('Telefone deve conter apenas dígitos e formatação válida.');
  }
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < CLIENT_PHONE_MIN_LENGTH || digits.length > CLIENT_PHONE_MAX_LENGTH) {
    throw new ClientInputError(
      `Telefone deve ter entre ${CLIENT_PHONE_MIN_LENGTH} e ${CLIENT_PHONE_MAX_LENGTH} dígitos.`
    );
  }
  return digits;
}

export function normalizeClientNotes(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = valueAsText(value);
  if (text === null) return null;
  const normalized = text.trim();
  if (!normalized) return null;
  if (normalized.length > CLIENT_NOTES_MAX_LENGTH) {
    throw new ClientInputError(`Observações devem ter no máximo ${CLIENT_NOTES_MAX_LENGTH} caracteres.`);
  }
  return normalized;
}

const ADDRESS_KEYS: Record<keyof ClientAddress, readonly string[]> = {
  endereco: ['endereco', 'street', 'address_line1'],
  numero: ['numero', 'number'],
  bairro: ['bairro', 'neighborhood'],
  complemento: ['complemento', 'complement', 'address_line2'],
  municipio: ['municipio', 'cidade', 'city'],
  uf: ['uf', 'state'],
  cep: ['cep', 'postal_code', 'postalCode', 'pincode'],
};

function readAlias(input: Record<string, unknown>, aliases: readonly string[]): unknown {
  for (const key of aliases) {
    if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  }
  return undefined;
}

function normalizeAddressField(
  value: unknown,
  field: keyof ClientAddress,
  maxLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  const text = valueAsText(value);
  if (text === null) return null;
  const normalized = field === 'uf' ? text.trim().toUpperCase() : text.trim();
  if (!normalized) return null;
  if (field === 'cep') {
    if (!/^[0-9\s-]+$/.test(normalized)) throw new ClientInputError('CEP deve conter apenas dígitos.');
    const digits = normalized.replace(/\D/g, '');
    if (digits.length !== maxLength) throw new ClientInputError('CEP deve ter 8 dígitos.');
    return digits;
  }
  if (normalized.length > maxLength) {
    throw new ClientInputError(`Campo de endereço "${field}" deve ter no máximo ${maxLength} caracteres.`);
  }
  if (field === 'uf' && !/^[A-Z]{2}$/.test(normalized)) {
    throw new ClientInputError('UF deve ter 2 letras.');
  }
  return normalized;
}

/**
 * Normalizes a complete address. `undefined` means no address was supplied;
 * callers implementing PATCH use `normalizeClientAddressPatch` to preserve
 * omitted fields.
 */
export function normalizeClientAddress(value: unknown): ClientAddress | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new ClientInputError('Endereço inválido.');

  const normalized: ClientAddress = {
    endereco: normalizeAddressField(readAlias(value, ADDRESS_KEYS.endereco), 'endereco', ADDRESS_LIMITS.street),
    numero: normalizeAddressField(readAlias(value, ADDRESS_KEYS.numero), 'numero', ADDRESS_LIMITS.number),
    bairro: normalizeAddressField(readAlias(value, ADDRESS_KEYS.bairro), 'bairro', ADDRESS_LIMITS.bairro),
    complemento: normalizeAddressField(readAlias(value, ADDRESS_KEYS.complemento), 'complemento', ADDRESS_LIMITS.complement),
    municipio: normalizeAddressField(readAlias(value, ADDRESS_KEYS.municipio), 'municipio', ADDRESS_LIMITS.city),
    uf: normalizeAddressField(readAlias(value, ADDRESS_KEYS.uf), 'uf', ADDRESS_LIMITS.uf),
    cep: normalizeAddressField(readAlias(value, ADDRESS_KEYS.cep), 'cep', ADDRESS_LIMITS.cep),
  };
  return Object.values(normalized).some((field) => field !== null) ? normalized : null;
}

/** Applies only fields explicitly present in an address patch. */
export function normalizeClientAddressPatch(value: unknown): Partial<ClientAddress> | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new ClientInputError('Endereço inválido.');
  const patch: Partial<ClientAddress> = {};
  (Object.keys(ADDRESS_KEYS) as Array<keyof ClientAddress>).forEach((field) => {
    if (ADDRESS_KEYS[field].some((alias) => Object.prototype.hasOwnProperty.call(value, alias))) {
      patch[field] = normalizeAddressField(
        readAlias(value, ADDRESS_KEYS[field]),
        field,
        ADDRESS_LIMITS[
          field === 'endereco'
            ? 'street'
            : field === 'numero'
              ? 'number'
              : field === 'complemento'
                ? 'complement'
                : field === 'municipio'
                  ? 'city'
                  : field
        ],
      );
    }
  });
  return patch;
}

export function cloneClientAddress(address: ClientAddress | null): ClientAddress | null {
  return address ? { ...address } : null;
}

export function cloneClientRecord(record: ClientRecord): ClientRecord {
  return { ...record, address: cloneClientAddress(record.address) };
}

export function isClientStatus(value: unknown): value is ClientStatus {
  return value === 'active' || value === 'archived' || value === 'all';
}

/** Converts old/new address field spellings to the stable UI representation. */
export function addressToCompat(address: ClientAddress | null): ClientAddress | null {
  return cloneClientAddress(address);
}
