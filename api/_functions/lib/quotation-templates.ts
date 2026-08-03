import { createHash } from 'node:crypto';

import Handlebars, { type TemplateDelegate } from 'handlebars';

/**
 * Repository-versioned quote templates.  Keep the source strings in this
 * module so a deployment always renders with the same source that produced a
 * persisted template hash.  Template interpolation deliberately uses normal
 * Handlebars escaping; templates must never use triple-stash expressions.
 */
const PADRAO_SOURCE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Orçamento {{quote_number}}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #172033; }
    body { margin: 0; padding: 32px; background: #fff; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #172033; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; }
    .muted { color: #5c667a; font-size: 13px; }
    .section { margin-top: 24px; }
    .client { border: 1px solid #d9deea; border-radius: 8px; padding: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e5e8ef; text-align: left; }
    th { background: #f4f6fa; font-size: 12px; text-transform: uppercase; }
    .number { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: min(360px, 100%); margin-top: 16px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .grand-total { border-top: 2px solid #172033; font-size: 18px; font-weight: 700; padding-top: 8px !important; }
    .terms { white-space: pre-line; }
  </style>
</head>
<body>
  <header class="header">
    <div><h1>Orçamento</h1><div class="muted">{{quote_number}} · Revisão {{revision}}</div></div>
    <div class="muted">Emitido em {{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="section client">
    <strong>Cliente</strong><br>
    {{client.name}}<br>
    {{#if client.document}}Documento: {{client.document}}<br>{{/if}}
    {{#if client.email}}E-mail: {{client.email}}<br>{{/if}}
    {{#if client.phone}}Telefone: {{client.phone}}<br>{{/if}}
    {{#if client.address}}{{client.address}}{{/if}}
  </section>
  <section class="section">
    <strong>Itens</strong>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Qtd.</th><th>Un.</th><th class="number">Unitário</th><th class="number">Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{unit}}</td><td class="number">{{display.unit_price}}</td><td class="number">{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <section class="section terms">
    {{#if terms.pagamento}}<strong>Pagamento:</strong> {{terms.pagamento}}<br>{{/if}}
    {{#if terms.entrega}}<strong>Entrega:</strong> {{terms.entrega}}<br>{{/if}}
    {{#if terms.production_deadline}}<strong>Prazo de produção:</strong> {{terms.production_deadline}}<br>{{/if}}
    {{#if terms.observations}}<strong>Observações:</strong> {{terms.observations}}{{/if}}
  </section>
</body>
</html>`;

const MINIMAL_SOURCE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>{{quote_number}} — {{client.name}}</title>
  <style>
    body { margin: 0; padding: 28px; font: 14px/1.5 Georgia, serif; color: #222; }
    header { display: flex; justify-content: space-between; border-bottom: 1px solid #222; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 23px; font-weight: 500; }
    .meta { text-align: right; font-size: 12px; }
    h2 { font-size: 15px; margin: 22px 0 5px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border-bottom: 1px solid #ddd; padding: 7px 3px; text-align: left; }
    th { font-size: 11px; text-transform: uppercase; }
    .right { text-align: right; }
    .summary { margin: 14px 0 0 auto; width: 260px; }
    .summary p { display: flex; justify-content: space-between; margin: 4px 0; }
    .summary .total { border-top: 1px solid #222; padding-top: 7px; font-size: 17px; }
    .terms { margin-top: 24px; white-space: pre-line; }
  </style>
</head>
<body>
  <header><h1>Proposta comercial</h1><div class="meta">{{quote_number}} · Rev. {{revision}}<br>{{display.quote_date}} — válida até {{display.validity_date}}</div></header>
  <h2>Cliente</h2><div>{{client.name}}{{#if client.document}} · {{client.document}}{{/if}}{{#if client.email}} · {{client.email}}{{/if}}</div>
  <h2>Itens</h2>
  <table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Un.</th><th class="right">Preço</th><th class="right">Total</th></tr></thead><tbody>{{#each items}}<tr><td>{{name}}</td><td>{{quantity}}</td><td>{{unit}}</td><td class="right">{{display.unit_price}}</td><td class="right">{{display.line_total}}</td></tr>{{/each}}</tbody></table>
  <div class="summary"><p><span>Subtotal</span><span>{{display.subtotal}}</span></p><p><span>Frete</span><span>{{display.freight}}</span></p><p class="total"><strong>Total</strong><strong>{{display.total}}</strong></p></div>
  <div class="terms">{{#if terms.pagamento}}Pagamento: {{terms.pagamento}}\n{{/if}}{{#if terms.entrega}}Entrega: {{terms.entrega}}\n{{/if}}{{#if terms.production_deadline}}Prazo de produção: {{terms.production_deadline}}\n{{/if}}{{#if terms.observations}}Observações: {{terms.observations}}{{/if}}</div>
</body>
</html>`;

export interface QuotationTemplateDefinition {
  key: string;
  name: string;
  is_default: boolean;
  source: string;
}

export interface QuotationTemplateMetadata {
  key: string;
  name: string;
  is_default: boolean;
  hash: string;
}

export interface QuotationTemplate extends QuotationTemplateMetadata {
  source: string;
}

function sourceHash(source: string): string {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

const DEFINITIONS: readonly QuotationTemplateDefinition[] = [
  { key: 'padrao', name: 'Padrão Aspen', is_default: true, source: PADRAO_SOURCE },
  { key: 'minimalista', name: 'Minimalista', is_default: false, source: MINIMAL_SOURCE },
];

const ALLOWED_HELPERS = new Set(['if', 'each']);
const DISALLOWED_BUILTIN_HELPERS = new Set([
  'log',
  'lookup',
  'with',
  'unless',
  'helperMissing',
  'blockHelperMissing',
]);

type AstRecord = Record<string, unknown> & { type?: string };

function isAstRecord(value: unknown): value is AstRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function astPathName(value: unknown): string | null {
  if (!isAstRecord(value) || value.type !== 'PathExpression') return null;
  return typeof value.original === 'string' ? value.original : null;
}

function astArray(value: unknown): AstRecord[] {
  return Array.isArray(value) ? value.filter(isAstRecord) : [];
}

function validateAstExpression(expression: unknown, templateKey: string): void {
  if (!isAstRecord(expression)) throw new Error(`Expressão inválida no template: ${templateKey}`);
  if (expression.type === 'SubExpression') {
    throw new Error(`Subexpressões não são permitidas no template: ${templateKey}`);
  }
  if (
    expression.type === 'PathExpression' ||
    expression.type === 'StringLiteral' ||
    expression.type === 'NumberLiteral' ||
    expression.type === 'BooleanLiteral' ||
    expression.type === 'UndefinedLiteral' ||
    expression.type === 'NullLiteral'
  ) return;
  throw new Error(`Expressão não permitida no template: ${templateKey}`);
}

function validateAstHash(hash: unknown, templateKey: string): void {
  if (!isAstRecord(hash)) return;
  for (const pair of astArray(hash.pairs)) validateAstExpression(pair.value, templateKey);
}

function validateAstProgram(program: unknown, templateKey: string): void {
  if (!isAstRecord(program)) throw new Error(`Bloco inválido no template: ${templateKey}`);
  for (const node of astArray(program.body)) validateAstNode(node, templateKey);
}

function validateAstNode(node: AstRecord, templateKey: string): void {
  switch (node.type) {
    case 'Program':
      validateAstProgram(node, templateKey);
      return;
    case 'MustacheStatement': {
      if (node.escaped === false) throw new Error(`Saída sem escape não é permitida no template: ${templateKey}`);
      const params = astArray(node.params);
      const hash = node.hash;
      const hasHash = isAstRecord(hash) && astArray(hash.pairs).length > 0;
      const pathName = astPathName(node.path);
      if ((params.length > 0 || hasHash) && (!pathName || !ALLOWED_HELPERS.has(pathName))) {
        throw new Error(`Helper não permitido no template: ${templateKey}`);
      }
      if (params.length === 0 && !hasHash && pathName && DISALLOWED_BUILTIN_HELPERS.has(pathName)) {
        throw new Error(`Helper não permitido no template: ${templateKey}`);
      }
      for (const parameter of params) validateAstExpression(parameter, templateKey);
      validateAstHash(hash, templateKey);
      validateAstExpression(node.path, templateKey);
      return;
    }
    case 'BlockStatement': {
      const pathName = astPathName(node.path);
      if (!pathName || !ALLOWED_HELPERS.has(pathName)) {
        throw new Error(`Bloco helper não permitido no template: ${templateKey}`);
      }
      for (const parameter of astArray(node.params)) validateAstExpression(parameter, templateKey);
      validateAstHash(node.hash, templateKey);
      validateAstProgram(node.program, templateKey);
      if (node.inverse) validateAstProgram(node.inverse, templateKey);
      return;
    }
    case 'PartialStatement':
    case 'PartialBlockStatement':
    case 'Decorator':
    case 'DecoratorBlock':
      throw new Error(`Parciais e decorators não são permitidos no template: ${templateKey}`);
    case 'ContentStatement':
    case 'CommentStatement':
      return;
    default:
      throw new Error(`Nó não permitido no template: ${templateKey}`);
  }
}

export function validateQuotationTemplateSource(source: string, templateKey = 'desconhecido'): void {
  const ast = Handlebars.parse(source) as unknown as AstRecord;
  validateAstProgram(ast, templateKey);
}

function validateDefinitions(definitions: readonly QuotationTemplateDefinition[]): void {
  const keys = new Set<string>();
  let defaults = 0;
  for (const definition of definitions) {
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(definition.key)) {
      throw new Error(`Chave de template inválida: ${definition.key}`);
    }
    if (keys.has(definition.key)) throw new Error(`Chave de template duplicada: ${definition.key}`);
    keys.add(definition.key);
    if (!definition.name.trim() || !definition.source.trim()) throw new Error(`Template incompleto: ${definition.key}`);
    validateQuotationTemplateSource(definition.source, definition.key);
    if (definition.is_default) defaults += 1;
  }
  if (defaults !== 1) throw new Error(`Manifesto de templates deve ter exatamente um padrão (encontrados ${defaults}).`);
}

validateDefinitions(DEFINITIONS);

const TEMPLATES: readonly QuotationTemplate[] = Object.freeze(DEFINITIONS.map((definition) => Object.freeze({
  ...definition,
  hash: sourceHash(definition.source),
})));
const BY_KEY = new Map(TEMPLATES.map((template) => [template.key, template]));
const DEFAULT_TEMPLATE = TEMPLATES.find((template) => template.is_default)!;

export const QUOTATION_TEMPLATES = TEMPLATES;
export const DEFAULT_QUOTATION_TEMPLATE = DEFAULT_TEMPLATE;

export function getQuotationTemplateManifest(): QuotationTemplateMetadata[] {
  return TEMPLATES.map(({ key, name, is_default, hash }) => ({ key, name, is_default, hash }));
}

export function getQuotationTemplate(key: unknown): QuotationTemplate | null {
  if (typeof key !== 'string') return null;
  return BY_KEY.get(key.trim()) || null;
}

export function resolveQuotationTemplate(key: unknown): QuotationTemplate {
  return getQuotationTemplate(key) || DEFAULT_TEMPLATE;
}

const HELPER_NAMES = Object.freeze({
  if: true,
  each: true,
});

function parseCents(value: unknown): bigint {
  const raw = String(value ?? '0').trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0') || '0');
  return match[1] ? -cents : cents;
}

function formatCurrency(value: unknown): string {
  const cents = parseCents(value);
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const decimal = (absolute % 100n).toString().padStart(2, '0');
  return `${sign}R$ ${integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ,${decimal}`.replace(' ,', ',');
}

function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function createEnvironment(): typeof Handlebars {
  const environment = Handlebars.create();
  for (const helperName of Object.keys(environment.helpers)) {
    if (!ALLOWED_HELPERS.has(helperName)) environment.unregisterHelper(helperName);
  }
  for (const decoratorName of Object.keys(environment.decorators)) {
    environment.unregisterDecorator(decoratorName);
  }
  return environment;
}

export interface QuotationTemplateViewModel {
  [key: string]: unknown;
}

export function renderQuotationTemplate(template: QuotationTemplate, viewModel: QuotationTemplateViewModel): string {
  const environment = createEnvironment();
  let compiled: TemplateDelegate;
  try {
    validateQuotationTemplateSource(template.source, template.key);
    compiled = environment.compile(template.source, {
      knownHelpers: HELPER_NAMES,
      knownHelpersOnly: true,
      noEscape: false,
      strict: true,
    });
  } catch (error) {
    console.error(`[quotation-templates] compile failed (${template.key})`, error instanceof Error ? error.message : error);
    throw new Error('Não foi possível preparar o template do orçamento.', { cause: error });
  }
  try {
    return compiled(viewModel, {
      allowProtoMethodsByDefault: false,
      allowProtoPropertiesByDefault: false,
      allowCallsToHelperMissing: false,
    });
  } catch (error) {
    console.error(`[quotation-templates] render failed (${template.key})`, error instanceof Error ? error.message : error);
    throw new Error('Não foi possível renderizar o orçamento.', { cause: error });
  }
}

export { formatCurrency as formatQuotationCurrency, formatDate as formatQuotationDate };
