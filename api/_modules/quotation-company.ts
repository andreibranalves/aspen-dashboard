export const QUOTATION_COMPANY_SCHEMA_VERSION = 1 as const;

export interface QuotationCompanyConfiguration {
  schema_version: typeof QUOTATION_COMPANY_SCHEMA_VERSION;
  identity: {
    legal_name: string;
    document: string;
  };
  banking: {
    bank_name: string;
    bank_code: string;
    branch: string;
    account: string;
    pix_key: string;
  };
  contacts: {
    website: string;
    phone: string;
    email: string;
    instagram: string;
  };
}

export class QuotationCompanyConfigurationError extends Error {
  readonly statusCode = 400;
  readonly expose = true;

  constructor(message = 'Dados empresariais inválidos.') {
    super(message);
    this.name = 'QuotationCompanyConfigurationError';
  }
}

export const DEFAULT_QUOTATION_COMPANY_CONFIGURATION: Readonly<QuotationCompanyConfiguration> =
  Object.freeze({
    schema_version: QUOTATION_COMPANY_SCHEMA_VERSION,
    identity: {
      legal_name: 'ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA',
      document: '55.458.072/0001-79',
    },
    banking: {
      bank_name: 'Stone Pagamentos S.A.',
      bank_code: '197',
      branch: '0001',
      account: '35207618-6',
      pix_key: '55.458.072/0001-79',
    },
    contacts: {
      website: 'https://www.aspenestamparia.com',
      phone: '(21) 96924-1265',
      email: 'contato@aspenestamparia.com',
      instagram: 'https://www.instagram.com/aspenestamparia',
    },
  });

const MAX_LEGAL_NAME_LENGTH = 255;
const MAX_DOCUMENT_LENGTH = 18;
const MAX_BANKING_VALUE_LENGTH = 255;
const MAX_CONTACT_VALUE_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(
  value: unknown,
  field: string,
  maximum: number,
  fallback: string,
  required = false
): string {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== 'string') {
    throw new QuotationCompanyConfigurationError(`Informe ${field} como texto.`);
  }
  const normalized = candidate.trim();
  if (required && !normalized) {
    throw new QuotationCompanyConfigurationError(`Informe ${field}.`);
  }
  if (normalized.length > maximum) {
    throw new QuotationCompanyConfigurationError(
      `${field} deve ter no máximo ${maximum} caracteres.`
    );
  }
  return normalized;
}

function document(value: unknown, fallback: string): string {
  const normalized = text(value, 'o CNPJ', MAX_DOCUMENT_LENGTH, fallback, true);
  if (!/^[0-9\s()./-]+$/.test(normalized)) {
    throw new QuotationCompanyConfigurationError(
      'O CNPJ deve conter apenas dígitos e formatação válida.'
    );
  }
  const digits = normalized.replace(/\D/g, '');
  if (digits.length !== 14) {
    throw new QuotationCompanyConfigurationError('O CNPJ deve ter 14 dígitos.');
  }
  if (/^(\d)\1{13}$/.test(digits)) {
    throw new QuotationCompanyConfigurationError('O CNPJ informado é inválido.');
  }
  const firstWeights = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const secondWeights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const checkDigit = (weights: number[]) => {
    const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
    return (11 - (sum % 11)) % 10;
  };
  if (
    Number(digits[12]) !== checkDigit(firstWeights) ||
    Number(digits[13]) !== checkDigit(secondWeights)
  ) {
    throw new QuotationCompanyConfigurationError('O CNPJ informado é inválido.');
  }
  return normalized;
}

function url(value: unknown, field: string, fallback: string): string {
  const normalized = text(value, field, MAX_CONTACT_VALUE_LENGTH, fallback);
  if (!normalized) return normalized;
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new QuotationCompanyConfigurationError(`${field} deve usar uma URL https.`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new QuotationCompanyConfigurationError(`${field} deve usar uma URL https.`);
  }
  return normalized;
}

function email(value: unknown, fallback: string): string {
  const normalized = text(value, 'o e-mail institucional', MAX_CONTACT_VALUE_LENGTH, fallback);
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new QuotationCompanyConfigurationError('Informe um e-mail institucional válido.');
  }
  return normalized.toLowerCase();
}

function phone(value: unknown, fallback: string): string {
  const normalized = text(value, 'o telefone institucional', MAX_CONTACT_VALUE_LENGTH, fallback);
  if (normalized && !/^[0-9\s()+./-]+$/.test(normalized)) {
    throw new QuotationCompanyConfigurationError(
      'O telefone institucional contém caracteres inválidos.'
    );
  }
  const digits = normalized.replace(/\D/g, '');
  if (digits && (digits.length < 10 || digits.length > 15)) {
    throw new QuotationCompanyConfigurationError(
      'O telefone institucional deve ter entre 10 e 15 dígitos.'
    );
  }
  return normalized;
}

export function normalizeQuotationCompanyConfiguration(
  value: unknown,
  fallback: QuotationCompanyConfiguration = DEFAULT_QUOTATION_COMPANY_CONFIGURATION
): QuotationCompanyConfiguration {
  if (value === undefined || value === null) return cloneQuotationCompanyConfiguration(fallback);
  if (!isRecord(value)) throw new QuotationCompanyConfigurationError();
  if (
    value.schema_version !== undefined &&
    value.schema_version !== QUOTATION_COMPANY_SCHEMA_VERSION
  ) {
    throw new QuotationCompanyConfigurationError('Versão da configuração empresarial inválida.');
  }
  const group = (candidate: unknown, field: string): Record<string, unknown> => {
    if (candidate === undefined) return {};
    if (!isRecord(candidate)) {
      throw new QuotationCompanyConfigurationError(`Informe ${field} como objeto.`);
    }
    return candidate;
  };
  const identity = group(value.identity, 'a identidade empresarial');
  const banking = group(value.banking, 'os dados bancários');
  const contacts = group(value.contacts, 'os contatos institucionais');
  return {
    schema_version: QUOTATION_COMPANY_SCHEMA_VERSION,
    identity: {
      legal_name: text(
        identity.legal_name,
        'a razão social',
        MAX_LEGAL_NAME_LENGTH,
        fallback.identity.legal_name,
        true
      ),
      document: document(identity.document, fallback.identity.document),
    },
    banking: {
      bank_name: text(
        banking.bank_name,
        'o banco',
        MAX_BANKING_VALUE_LENGTH,
        fallback.banking.bank_name
      ),
      bank_code: text(
        banking.bank_code,
        'o código do banco',
        MAX_BANKING_VALUE_LENGTH,
        fallback.banking.bank_code
      ),
      branch: text(banking.branch, 'a agência', MAX_BANKING_VALUE_LENGTH, fallback.banking.branch),
      account: text(
        banking.account,
        'a conta bancária',
        MAX_BANKING_VALUE_LENGTH,
        fallback.banking.account
      ),
      pix_key: text(
        banking.pix_key,
        'a chave Pix',
        MAX_BANKING_VALUE_LENGTH,
        fallback.banking.pix_key
      ),
    },
    contacts: {
      website: url(contacts.website, 'o site institucional', fallback.contacts.website),
      phone: phone(contacts.phone, fallback.contacts.phone),
      email: email(contacts.email, fallback.contacts.email),
      instagram: url(contacts.instagram, 'o Instagram institucional', fallback.contacts.instagram),
    },
  };
}

const COMPLETE_COMPANY_FIELDS = {
  identity: ['legal_name', 'document'],
  banking: ['bank_name', 'bank_code', 'branch', 'account', 'pix_key'],
  contacts: ['website', 'phone', 'email', 'instagram'],
} as const;

const COMPLETE_COMPANY_GROUP_LABELS = {
  identity: 'a identidade empresarial',
  banking: 'os dados bancários',
  contacts: 'os contatos institucionais',
} as const;

/** Rejects omitted groups/fields before normalization can fill them from defaults. */
export function normalizeCompleteQuotationCompanyConfiguration(
  value: unknown
): QuotationCompanyConfiguration {
  if (!isRecord(value)) {
    throw new QuotationCompanyConfigurationError('Informe a empresa como objeto completo.');
  }
  if (value.schema_version !== QUOTATION_COMPANY_SCHEMA_VERSION) {
    throw new QuotationCompanyConfigurationError(
      'Informe uma versão válida da configuração empresarial.'
    );
  }
  for (const [groupName, fields] of Object.entries(COMPLETE_COMPANY_FIELDS)) {
    const group = value[groupName];
    if (!isRecord(group)) {
      throw new QuotationCompanyConfigurationError(
        `Informe ${COMPLETE_COMPANY_GROUP_LABELS[groupName as keyof typeof COMPLETE_COMPANY_GROUP_LABELS]} como objeto completo.`
      );
    }
    for (const field of fields) {
      if (!Object.prototype.hasOwnProperty.call(group, field)) {
        throw new QuotationCompanyConfigurationError(
          `Informe o campo empresarial ${groupName}.${field}.`
        );
      }
    }
  }
  return normalizeQuotationCompanyConfiguration(value);
}

export function cloneQuotationCompanyConfiguration(
  value: QuotationCompanyConfiguration
): QuotationCompanyConfiguration {
  return {
    schema_version: value.schema_version,
    identity: { ...value.identity },
    banking: { ...value.banking },
    contacts: { ...value.contacts },
  };
}

export interface QuotationCompanyBackfillVerification {
  total: number;
  valid_snapshots: number;
  missing_snapshots: number;
  invalid_snapshots: number;
  official_default_mismatches: number;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonical(nested)])
  );
}

export function verifyQuotationCompanyBackfill(
  snapshots: readonly unknown[]
): QuotationCompanyBackfillVerification {
  const expected = JSON.stringify(canonical(DEFAULT_QUOTATION_COMPANY_CONFIGURATION));
  let validSnapshots = 0;
  let missingSnapshots = 0;
  let invalidSnapshots = 0;
  let officialDefaultMismatches = 0;
  for (const value of snapshots) {
    if (value === null || value === undefined) {
      missingSnapshots += 1;
      continue;
    }
    try {
      const normalized = normalizeCompleteQuotationCompanyConfiguration(value);
      validSnapshots += 1;
      if (JSON.stringify(canonical(normalized)) !== expected) officialDefaultMismatches += 1;
    } catch {
      invalidSnapshots += 1;
    }
  }
  return {
    total: snapshots.length,
    valid_snapshots: validSnapshots,
    missing_snapshots: missingSnapshots,
    invalid_snapshots: invalidSnapshots,
    official_default_mismatches: officialDefaultMismatches,
  };
}

export function assertQuotationCompanyBackfill(
  verification: QuotationCompanyBackfillVerification
): void {
  // A mismatch is diagnostic only: revisions created after the migration may
  // legitimately capture a customized global configuration.
  if (verification.missing_snapshots || verification.invalid_snapshots) {
    throw new Error('Backfill de configuração empresarial contém snapshots incompletos.');
  }
}
