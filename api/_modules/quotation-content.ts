import Handlebars from 'handlebars';

export const QUOTATION_SECTION_SCHEMA_VERSION = 1 as const;
export const MAX_SECTION_TITLE_LENGTH = 120;
export const MAX_SECTION_BODY_LENGTH = 4000;

export type QuotationSectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais';

const SECTION_KEYS: readonly QuotationSectionKey[] = [
  'prazo_producao',
  'pagamento',
  'condicoes_gerais',
];

export interface QuotationSectionSettings {
  enabled: boolean;
  title: string;
  body?: string;
}

export interface QuotationSectionsSettings {
  schema_version: typeof QUOTATION_SECTION_SCHEMA_VERSION;
  prazo_producao: QuotationSectionSettings;
  pagamento: QuotationSectionSettings & { body: string };
  condicoes_gerais: QuotationSectionSettings & { body: string };
}

export interface QuotationSectionsSnapshot {
  schema_version: typeof QUOTATION_SECTION_SCHEMA_VERSION;
  prazo_producao: { base: QuotationSectionSettings; current: QuotationSectionSettings };
  pagamento: {
    base: QuotationSectionSettings & { body: string };
    current: QuotationSectionSettings & { body: string };
  };
  condicoes_gerais: {
    base: QuotationSectionSettings & { body: string };
    current: QuotationSectionSettings & { body: string };
  };
}

export const DEFAULT_QUOTATION_SECTIONS: Readonly<QuotationSectionsSettings> = Object.freeze({
  schema_version: 1,
  prazo_producao: Object.freeze({ enabled: true, title: 'Prazo de produção' }),
  pagamento: Object.freeze({ enabled: true, title: 'Pagamento', body: '' }),
  condicoes_gerais: Object.freeze({ enabled: true, title: 'Condições Gerais', body: '' }),
});

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

export function combineLegacyConditions(entrega: string, observacoes: string): string {
  const parts: string[] = [];
  if (entrega) parts.push(`Prazo de entrega:\n${entrega}`);
  if (observacoes) parts.push(`Observações:\n${observacoes}`);
  return parts.join('\n\n');
}

export function toSafeMultilineHtml(value: string): Handlebars.SafeString {
  if (!value) return new Handlebars.SafeString('');
  const lines = value.split('\n').map((line) => Handlebars.Utils.escapeExpression(line));
  return new Handlebars.SafeString(lines.join('<br>'));
}

/**
 * Validate a single section object. Throws on any invalid present value.
 * Returns the validated section merged with defaults for missing fields.
 */
function validateAndNormalizeSection(
  key: QuotationSectionKey,
  input: unknown,
  defaults: QuotationSectionSettings & { body?: string }
): QuotationSectionSettings & { body?: string } {
  // Missing section: fill from defaults
  if (input === undefined) return deepCopy(defaults);

  // Present but not a plain object: reject
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Seção "${key}" deve ser um objeto.`);
  }
  const obj = input as Record<string, unknown>;

  // Reject unknown keys
  const allowedKeys =
    key === 'prazo_producao' ? ['enabled', 'title'] : ['enabled', 'title', 'body'];
  for (const k of Object.keys(obj)) {
    if (!allowedKeys.includes(k)) {
      throw new Error(`Campo desconhecido "${k}" na seção "${key}".`);
    }
  }

  // enabled must be boolean
  if (typeof obj.enabled !== 'boolean') {
    throw new Error(`Campo "enabled" da seção "${key}" deve ser booleano.`);
  }

  // title must be non-blank string within bounds
  if (typeof obj.title !== 'string' || !obj.title.trim()) {
    throw new Error(`Título da seção "${key}" não pode ser vazio.`);
  }
  if (obj.title.length > MAX_SECTION_TITLE_LENGTH) {
    throw new Error(`Título da seção "${key}" excede ${MAX_SECTION_TITLE_LENGTH} caracteres.`);
  }

  // body: only allowed on pagamento/condicoes_gerais, must be string within bounds
  if (key === 'prazo_producao') {
    if (obj.body !== undefined) {
      throw new Error(`Seção "prazo_producao" não possui campo "body".`);
    }
  } else {
    if (obj.body !== undefined && typeof obj.body !== 'string') {
      throw new Error(`Campo "body" da seção "${key}" deve ser string.`);
    }
    if (typeof obj.body === 'string' && obj.body.length > MAX_SECTION_BODY_LENGTH) {
      throw new Error(`Corpo da seção "${key}" excede ${MAX_SECTION_BODY_LENGTH} caracteres.`);
    }
  }

  const result: Record<string, unknown> = {
    enabled: obj.enabled,
    title: obj.title,
  };
  if (key !== 'prazo_producao') {
    result.body = typeof obj.body === 'string' ? obj.body : (defaults.body ?? '');
  }
  return result as unknown as QuotationSectionSettings & { body?: string };
}

export function normalizeQuotationSections(
  input: unknown,
  legacy?: { pagamento?: string; entrega?: string; observacoes?: string }
): QuotationSectionsSettings {
  // No input: build from defaults + legacy
  if (input === undefined || input === null) {
    const result = deepCopy(DEFAULT_QUOTATION_SECTIONS) as QuotationSectionsSettings;
    if (legacy?.pagamento) result.pagamento.body = legacy.pagamento;
    if (legacy?.entrega || legacy?.observacoes) {
      result.condicoes_gerais.body = combineLegacyConditions(
        legacy.entrega || '',
        legacy.observacoes || ''
      );
    }
    return result;
  }

  // Non-object input: reject
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Seções devem ser um objeto.');
  }

  const obj = input as Record<string, unknown>;

  // Reject unknown top-level keys
  const knownKeys = new Set<string>(['schema_version', ...SECTION_KEYS]);
  for (const k of Object.keys(obj)) {
    if (!knownKeys.has(k)) {
      throw new Error(`Campo desconhecido "${k}" nas seções.`);
    }
  }

  const pagamento = validateAndNormalizeSection(
    'pagamento',
    obj.pagamento,
    DEFAULT_QUOTATION_SECTIONS.pagamento
  );
  const condicoes_gerais = validateAndNormalizeSection(
    'condicoes_gerais',
    obj.condicoes_gerais,
    DEFAULT_QUOTATION_SECTIONS.condicoes_gerais
  );

  // Derive legacy conditions ONLY when condicoes_gerais key is absent
  if (!('condicoes_gerais' in obj) && (legacy?.entrega || legacy?.observacoes)) {
    condicoes_gerais.body = combineLegacyConditions(legacy.entrega || '', legacy.observacoes || '');
  }

  const result: QuotationSectionsSettings = {
    schema_version: QUOTATION_SECTION_SCHEMA_VERSION,
    prazo_producao: validateAndNormalizeSection(
      'prazo_producao',
      obj.prazo_producao,
      DEFAULT_QUOTATION_SECTIONS.prazo_producao
    ),
    pagamento: pagamento as QuotationSectionsSettings['pagamento'],
    condicoes_gerais: condicoes_gerais as QuotationSectionsSettings['condicoes_gerais'],
  };

  // The migration adds this exact JSON as a non-null database default. Treat
  // it as an empty marker so old mirror columns are not hidden after upgrade.
  const isEmptySchemaDefault = JSON.stringify(result) === JSON.stringify(DEFAULT_QUOTATION_SECTIONS);
  if (isEmptySchemaDefault && (legacy?.pagamento || legacy?.entrega || legacy?.observacoes)) {
    if (legacy.pagamento) result.pagamento.body = legacy.pagamento;
    result.condicoes_gerais.body = combineLegacyConditions(
      legacy.entrega || '',
      legacy.observacoes || ''
    );
  }

  return result;
}

export function createQuotationSectionsSnapshot(
  settings: QuotationSectionsSettings
): QuotationSectionsSnapshot {
  return {
    schema_version: settings.schema_version,
    prazo_producao: {
      base: deepCopy(settings.prazo_producao),
      current: deepCopy(settings.prazo_producao),
    },
    pagamento: {
      base: deepCopy(settings.pagamento),
      current: deepCopy(settings.pagamento),
    },
    condicoes_gerais: {
      base: deepCopy(settings.condicoes_gerais),
      current: deepCopy(settings.condicoes_gerais),
    },
  };
}

export function validateQuotationSections(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Seções devem ser um objeto.');
  }
  const obj = input as Record<string, unknown>;

  // Reject unknown keys
  const knownKeys = new Set<string>(['schema_version', ...SECTION_KEYS]);
  for (const k of Object.keys(obj)) {
    if (!knownKeys.has(k)) {
      throw new Error(`Campo desconhecido "${k}" nas seções.`);
    }
  }

  // Reject schema_version if present and not exactly 1
  if (obj.schema_version !== undefined && obj.schema_version !== 1) {
    throw new Error('schema_version deve ser exatamente 1.');
  }

  for (const key of SECTION_KEYS) {
    const section = obj[key];
    if (section !== undefined) {
      // Delegate to the same validation used by normalization
      validateAndNormalizeSection(key, section, DEFAULT_QUOTATION_SECTIONS[key]);
    }
  }
}
