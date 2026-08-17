export interface QuotationEmailTemplate {
  subject: string;
  greeting: string;
  message: string;
  button_label: string;
  signature: string;
}

export type QuotationEmailTemplateField = keyof QuotationEmailTemplate;

export interface QuotationEmailRenderInput {
  customerName: string;
  businessNumber: string;
  publicUrl: string;
}

export interface RenderedQuotationEmail {
  subject: string;
  html: string;
  text: string;
}

export type QuotationEmailTemplateValidation =
  | { ok: true; value: QuotationEmailTemplate }
  | { ok: false; fields: Partial<Record<QuotationEmailTemplateField | '_form', string>> };

const TEMPLATE_FIELDS: readonly QuotationEmailTemplateField[] = [
  'subject',
  'greeting',
  'message',
  'button_label',
  'signature',
];

const REQUIRED_TEMPLATE_FIELDS: readonly QuotationEmailTemplateField[] = [
  'subject',
  'message',
  'button_label',
];

export const QUOTATION_EMAIL_TEMPLATE_LIMITS = Object.freeze({
  subject: 200,
  greeting: 500,
  message: 4000,
  button_label: 80,
  signature: 500,
} satisfies Record<QuotationEmailTemplateField, number>);

export const QUOTATION_EMAIL_TEMPLATE_TOKENS = Object.freeze([
  '{{nome_cliente}}',
  '{{numero_orcamento}}',
] as const);

export const DEFAULT_QUOTATION_EMAIL_TEMPLATE: Readonly<QuotationEmailTemplate> = Object.freeze({
  subject: 'Orçamento {{numero_orcamento}} - Aspen',
  greeting: 'Olá, {{nome_cliente}}.',
  message: 'Segue o orçamento {{numero_orcamento}} em anexo.',
  button_label: 'Ver orçamento',
  signature: 'Atenciosamente,\nAspen',
});

const TEMPLATE_TOKEN_PATTERN = /{{[^{}]+}}/g;
const ALLOWED_TEMPLATE_TOKENS = new Set<string>(QUOTATION_EMAIL_TEMPLATE_TOKENS);

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function validationError(message: string): QuotationEmailTemplateValidation {
  return { ok: false, fields: { _form: message } };
}

export function validateQuotationEmailTemplate(value: unknown): QuotationEmailTemplateValidation {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return validationError('Informe um modelo de e-mail válido.');
  }

  const source = value as Record<string, unknown>;
  const unknownFields = Object.keys(source).filter(
    (field) => !TEMPLATE_FIELDS.includes(field as QuotationEmailTemplateField),
  );
  const fields: Partial<Record<QuotationEmailTemplateField | '_form', string>> = {};
  if (unknownFields.length > 0) {
    fields._form = `Campos não suportados: ${unknownFields.join(', ')}.`;
  }

  const normalized = {} as QuotationEmailTemplate;
  for (const field of TEMPLATE_FIELDS) {
    const raw = source[field];
    if (typeof raw !== 'string') {
      fields[field] = REQUIRED_TEMPLATE_FIELDS.includes(field)
        ? 'Campo obrigatório.'
        : 'Informe um texto válido.';
      continue;
    }

    const text = normalizeText(raw);
    normalized[field] = text;
    if (REQUIRED_TEMPLATE_FIELDS.includes(field) && !text) {
      fields[field] = 'Campo obrigatório.';
    } else if (text.length > QUOTATION_EMAIL_TEMPLATE_LIMITS[field]) {
      fields[field] = `Use no máximo ${QUOTATION_EMAIL_TEMPLATE_LIMITS[field]} caracteres.`;
    }

    const unknownToken = text.match(TEMPLATE_TOKEN_PATTERN)?.find(
      (token) => !ALLOWED_TEMPLATE_TOKENS.has(token),
    );
    if (unknownToken) {
      fields[field] = `Variável não suportada: ${unknownToken}.`;
    }
  }

  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value: normalized };
}

function replaceTokens(value: string, input: QuotationEmailRenderInput): string {
  return value.replace(TEMPLATE_TOKEN_PATTERN, (token) => {
    if (token === '{{nome_cliente}}') return input.customerName;
    if (token === '{{numero_orcamento}}') return input.businessNumber;
    return token;
  });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

function renderInlineHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

export function renderQuotationEmailTemplate(
  template: QuotationEmailTemplate,
  input: QuotationEmailRenderInput,
): RenderedQuotationEmail {
  const subject = replaceTokens(template.subject, input);
  const greeting = replaceTokens(template.greeting, input);
  const message = replaceTokens(template.message, input);
  const buttonLabel = replaceTokens(template.button_label, input);
  const signature = replaceTokens(template.signature, input);
  const escapedPublicUrl = escapeHtml(input.publicUrl);
  const htmlBlocks: string[] = [];

  if (greeting) htmlBlocks.push(`<p>${renderInlineHtml(greeting)}</p>`);
  for (const line of message.split('\n')) {
    if (line.trim()) htmlBlocks.push(`<p>${escapeHtml(line)}</p>`);
  }
  htmlBlocks.push(`<p><a href="${escapedPublicUrl}" style="display:inline-block;padding:12px 18px;background:#166534;color:#fff;text-decoration:none;border-radius:6px">${renderInlineHtml(buttonLabel)}</a></p>`);
  if (signature) htmlBlocks.push(`<p>${renderInlineHtml(signature)}</p>`);

  const text = [greeting, message, `${buttonLabel}: ${input.publicUrl}`, signature]
    .filter((block) => block.trim())
    .join('\n\n');

  return {
    subject,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937">${htmlBlocks.join('')}</body></html>`,
    text,
  };
}
