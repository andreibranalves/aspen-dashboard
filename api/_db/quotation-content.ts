import Handlebars from 'handlebars';

export const QUOTATION_SECTION_SCHEMA_VERSION = 1 as const;
export const MAX_SECTION_TITLE_LENGTH = 120;
export const MAX_SECTION_BODY_LENGTH = 4000;

export type QuotationSectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais';

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

export const DEFAULT_QUOTATION_SECTIONS: QuotationSectionsSettings = {
  schema_version: 1,
  prazo_producao: { enabled: true, title: 'Prazo de produção' },
  pagamento: { enabled: true, title: 'Pagamento', body: '' },
  condicoes_gerais: { enabled: true, title: 'Condições Gerais', body: '' },
};

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
  const lines = value
    .split('\n')
    .map((line) =>
      line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    );
  return new Handlebars.SafeString(lines.join('<br>'));
}

function normalizeSection(
  input: unknown,
  defaults: QuotationSectionSettings
): QuotationSectionSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return deepCopy(defaults);
  }
  const obj = input as Record<string, unknown>;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : defaults.enabled,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : defaults.title,
    body: typeof obj.body === 'string' ? obj.body : defaults.body,
  };
}

function normalizeSectionWithBody(
  input: unknown,
  defaults: QuotationSectionSettings & { body: string }
): QuotationSectionSettings & { body: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return deepCopy(defaults);
  }
  const obj = input as Record<string, unknown>;
  return {
    enabled: typeof obj.enabled === 'boolean' ? obj.enabled : defaults.enabled,
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title : defaults.title,
    body: typeof obj.body === 'string' ? obj.body : defaults.body,
  };
}

export function normalizeQuotationSections(
  input: unknown,
  legacy?: { pagamento?: string; entrega?: string; observacoes?: string }
): QuotationSectionsSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    const result = deepCopy(DEFAULT_QUOTATION_SECTIONS);
    if (legacy?.pagamento) result.pagamento.body = legacy.pagamento;
    if (legacy?.entrega || legacy?.observacoes) {
      result.condicoes_gerais.body = combineLegacyConditions(
        legacy.entrega || '',
        legacy.observacoes || ''
      );
    }
    return result;
  }

  const obj = input as Record<string, unknown>;

  const pagamento = normalizeSectionWithBody(obj.pagamento, DEFAULT_QUOTATION_SECTIONS.pagamento);
  const condicoes_gerais = normalizeSectionWithBody(
    obj.condicoes_gerais,
    DEFAULT_QUOTATION_SECTIONS.condicoes_gerais
  );

  // Derive legacy conditions only if condicoes_gerais not in input
  if (!obj.condicoes_gerais && (legacy?.entrega || legacy?.observacoes)) {
    condicoes_gerais.body = combineLegacyConditions(legacy.entrega || '', legacy.observacoes || '');
  }

  return {
    schema_version: QUOTATION_SECTION_SCHEMA_VERSION,
    prazo_producao: normalizeSection(obj.prazo_producao, DEFAULT_QUOTATION_SECTIONS.prazo_producao),
    pagamento,
    condicoes_gerais,
  };
}

export function createQuotationSectionsSnapshot(settings: QuotationSectionsSettings): {
  schema_version: typeof QUOTATION_SECTION_SCHEMA_VERSION;
  base: QuotationSectionsSettings;
  current: QuotationSectionsSettings;
} {
  return {
    schema_version: settings.schema_version,
    base: deepCopy(settings),
    current: deepCopy(settings),
  };
}

export function validateQuotationSections(input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Seções devem ser um objeto.');
  }
  const obj = input as Record<string, unknown>;

  for (const key of ['prazo_producao', 'pagamento', 'condicoes_gerais'] as const) {
    const section = obj[key];
    if (section !== undefined) {
      if (!section || typeof section !== 'object' || Array.isArray(section)) {
        throw new Error(`Seção "${key}" deve ser um objeto.`);
      }
      const s = section as Record<string, unknown>;
      if (typeof s.enabled !== 'boolean') {
        throw new Error(`Campo "enabled" da seção "${key}" deve ser booleano.`);
      }
      if (typeof s.title !== 'string' || !s.title.trim()) {
        throw new Error(`Título da seção "${key}" não pode ser vazio.`);
      }
      if (s.title.length > MAX_SECTION_TITLE_LENGTH) {
        throw new Error(`Título da seção "${key}" excede ${MAX_SECTION_TITLE_LENGTH} caracteres.`);
      }
      if (s.body !== undefined && typeof s.body !== 'string') {
        throw new Error(`Campo "body" da seção "${key}" deve ser string.`);
      }
      if (typeof s.body === 'string' && s.body.length > MAX_SECTION_BODY_LENGTH) {
        throw new Error(`Corpo da seção "${key}" excede ${MAX_SECTION_BODY_LENGTH} caracteres.`);
      }
    }
  }
}
