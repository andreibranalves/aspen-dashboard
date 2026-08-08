#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATASET_FIELDS = ['items', 'pricingRules', 'itemPrices', 'customers', 'leads', 'quotations'];
const OPTIONAL_DATASET_FIELDS = DATASET_FIELDS.slice(1);
const IDENTITY_KEYS = new Set(['name', 'id', 'source_id', 'sourceid']);
const ITEM_REF_KEYS = new Set(['item_code', 'item', 'sku', 'itemcode', 'product_sku', 'codigo']);
const CUSTOMER_REF_KEYS = new Set(['customer', 'customer_id', 'linked_customer', 'party', 'party_name']);
const LEAD_REF_KEYS = new Set(['lead', 'lead_id', 'linked_lead']);
const QUOTATION_REF_KEYS = new Set(['quotation', 'quotation_id']);
const OMIT_KEYS = /(?:^|_)(?:api_key|api_token|auth|authorization|token|secret|password|passwd|cookie|headers?|payload|raw_payload)(?:$|_)/i;
const DATE_KEYS = new Set([
  'creation', 'created', 'created_on', 'modified', 'modified_at', 'updated', 'updated_at',
  'updated_on', 'last_modified', 'source_updated_at', 'valid_till', 'expiry', 'validade',
]);
const NUMERIC_KEYS = new Set([
  'idx', 'position', 'qty', 'quantidade', 'min_qty', 'minimum_quantity', 'minimum_qty',
  'quantidade_minima', 'max_qty', 'maximum_quantity', 'rate', 'price_list_rate', 'unit_price',
  'price', 'preco', 'valor', 'preco_sugerido', 'preco_aplicado', 'amount', 'total_linha',
  'total', 'net_total', 'subtotal', 'grand_total', 'shipping_amount', 'frete', 'valor_frete',
  'frete_padrao', 'pdf_size_bytes', 'pdf_size', 'size_bytes', 'docstatus',
]);
const PRESERVED_STRING_KEYS = new Set([
  'doctype', 'status', 'workflow_state', 'order_status', 'quotation_to', 'party_type',
  'uom', 'stock_uom', 'unidade', 'unit', 'currency', 'price_list', 'price_list_name',
  'disabled', 'inativo',
]);
const HASH_KEYS = /(?:checksum|sha256|hash)/i;
const DOCUMENT_KEYS = /(?:tax|cpf|cnpj|document|pincode|postal|zip|cep)/i;
const PHONE_KEYS = /(?:phone|mobile|telefone|celular|whatsapp)/i;
const EMAIL_KEYS = /(?:email|e_mail)/i;
const ADDRESS_KEYS = /(?:address|endereco|street|city|municip|bairro|neighborhood|district|complement|state|uf|province|territory|number|numero)/i;

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function keyName(key) {
  return String(key).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}

function canonicalField(key) {
  return keyName(key).replace(/[_-]/g, '');
}

function hasAlias(aliases, key) {
  const candidate = canonicalField(key);
  return [...aliases].some((alias) => canonicalField(alias) === candidate);
}

function isOmittedKey(key) {
  return OMIT_KEYS.test(keyName(key));
}

function hash(salt, scope, value) {
  return createHash('sha256').update(`${salt}\0${scope}\0${value}`).digest('hex');
}

function token(salt, scope, value, prefix = 'REF') {
  return `${prefix}-${hash(salt, scope, value).slice(0, 12).toUpperCase()}`;
}

function digits(salt, scope, value, length) {
  const modulus = 10n ** BigInt(length);
  const number = BigInt(`0x${hash(salt, scope, value).slice(0, 15)}`) % modulus;
  return number.toString().padStart(length, '0');
}

function register(map, salt, scope, prefix, value) {
  const original = text(value);
  if (!original) return '';
  if (!map.has(original)) map.set(original, token(salt, scope, original, prefix));
  return map.get(original);
}

function quotationYear(row, original) {
  const date = text(row?.creation ?? row?.created ?? row?.created_on);
  const yearMatch = date.match(/(?:^|[-/ ])(20\d{2})(?:[-/ ]|$)/) || text(original).match(/(20\d{2})/);
  return yearMatch ? yearMatch[1] : '2000';
}

export function quotationSequenceSeed(salt, year, original) {
  return Number(BigInt(`0x${hash(salt, `quotation-sequence:${year}`, original).slice(0, 15)}`) % 9999n) + 1;
}

function quotationTokens(salt, rows) {
  const entries = [];
  for (const row of rows || []) {
    for (const value of scalarAliasValues(row, [...IDENTITY_KEYS, 'quotation_id'])) {
      const original = text(value);
      if (original) entries.push({ original, row, year: quotationYear(row, original) });
    }
  }
  const byYear = new Map();
  for (const entry of entries) {
    const key = `${entry.year}:${entry.original}`;
    if (!byYear.has(entry.year)) byYear.set(entry.year, new Map());
    byYear.get(entry.year).set(key, entry);
  }
  const result = new Map();
  for (const [year, yearEntries] of byYear) {
    const used = new Set();
    for (const entry of [...yearEntries.values()].sort((left, right) => left.original.localeCompare(right.original))) {
      let sequence = quotationSequenceSeed(salt, year, entry.original);
      const start = sequence;
      while (used.has(sequence)) {
        sequence = sequence === 9999 ? 1 : sequence + 1;
        if (sequence === start) throw new Error('Snapshot Frappe inválido: capacidade anual de quotations excedida.');
      }
      used.add(sequence);
      result.set(entry.original, `QTN-${year}-${String(sequence).padStart(4, '0')}`);
    }
  }
  return result;
}

function quotationToken(salt, row, value, tokens) {
  const original = text(value);
  return tokens.get(original) || `QTN-${quotationYear(row, original)}-${String(quotationSequenceSeed(salt, quotationYear(row, original), original)).padStart(4, '0')}`;
}

function scalarAliasValues(record, aliases) {
  if (!isRecord(record)) return [];
  return Object.entries(record)
    .filter(([key]) => hasAlias(aliases, key))
    .map(([, value]) => value)
    .filter((value) => value !== null && value !== undefined && (typeof value === 'string' || typeof value === 'number'));
}

function makeContext(dataset, salt) {
  const maps = {
    itemRef: new Map(),
    customerRef: new Map(),
    leadRef: new Map(),
    quotationRef: new Map(),
    pricingRuleRef: new Map(),
    itemPriceRef: new Map(),
  };
  const addRows = (rows, map, scope, prefix) => {
    for (const row of rows || []) {
      for (const value of scalarAliasValues(row, [...IDENTITY_KEYS])) register(map, salt, scope, prefix, value);
    }
  };
  const addItemReferences = (rows) => {
    for (const row of rows || []) {
      for (const value of scalarAliasValues(row, [...IDENTITY_KEYS, ...ITEM_REF_KEYS])) {
        register(maps.itemRef, salt, 'item-reference', 'ITEM', value);
      }
      for (const child of Array.isArray(row?.items) ? row.items : []) {
        if (!isRecord(child)) continue;
        for (const value of scalarAliasValues(child, [...ITEM_REF_KEYS])) {
          register(maps.itemRef, salt, 'item-reference', 'ITEM', value);
        }
      }
    }
  };
  addRows(dataset.items, maps.itemRef, 'item-reference', 'ITEM');
  addRows(dataset.customers, maps.customerRef, 'customer-reference', 'CUST');
  addRows(dataset.leads, maps.leadRef, 'lead-reference', 'LEAD');
  const quotationMap = quotationTokens(salt, dataset.quotations || []);
  for (const row of dataset.quotations || []) {
    for (const value of scalarAliasValues(row, [...IDENTITY_KEYS, 'quotation_id'])) {
      const original = text(value);
      if (original && !maps.quotationRef.has(original)) maps.quotationRef.set(original, quotationToken(salt, row, original, quotationMap));
    }
  }
  addRows(dataset.pricingRules, maps.pricingRuleRef, 'pricing-rule-reference', 'PR');
  addRows(dataset.itemPrices, maps.itemPriceRef, 'item-price-reference', 'IP');
  addItemReferences(dataset.items);
  addItemReferences(dataset.pricingRules);
  addItemReferences(dataset.itemPrices);
  addItemReferences(dataset.quotations);
  return { maps, salt };
}

function mapped(map, value, salt, scope, prefix) {
  const original = text(value);
  if (!original) return original;
  return map.get(original) || token(salt, scope, original, prefix);
}

function partyType(record) {
  return (text(record?.quotation_to) || text(record?.party_type)).toLowerCase();
}

function entityKind(kind, record) {
  if (kind === 'quotation' && partyType(record) === 'lead') return 'lead-quotation';
  return kind;
}

function idMapForKind(kind, maps) {
  if (kind === 'item' || kind === 'item-child' || kind === 'quotation-item') return [maps.itemRef, 'item-reference', 'ITEM'];
  if (kind === 'customer') return [maps.customerRef, 'customer-reference', 'CUST'];
  if (kind === 'lead') return [maps.leadRef, 'lead-reference', 'LEAD'];
  if (kind === 'quotation' || kind === 'lead-quotation') return [maps.quotationRef, 'quotation-reference', 'QTN'];
  if (kind === 'pricingRule') return [maps.pricingRuleRef, 'pricing-rule-reference', 'PR'];
  if (kind === 'itemPrice') return [maps.itemPriceRef, 'item-price-reference', 'IP'];
  return [null, `${kind}-reference`, 'REF'];
}

function sanitizePrimitive(key, value, kind, context, arrayIndex = '') {
  if (isOmittedKey(key)) return undefined;
  if (value === null || typeof value === 'boolean') return value;
  const canonical = keyName(key);
  const scope = `${kind}.${canonical}${arrayIndex === '' ? '' : `.array.${arrayIndex}`}`;
  const original = text(value);
  if (!original) return typeof value === 'string' ? '' : value;

  if (hasAlias(ITEM_REF_KEYS, key)) return mapped(context.maps.itemRef, value, context.salt, 'item-reference', 'ITEM');
  if (hasAlias(LEAD_REF_KEYS, key)) return mapped(context.maps.leadRef, value, context.salt, 'lead-reference', 'LEAD');
  if (hasAlias(CUSTOMER_REF_KEYS, key)) {
    const useLead = (canonical === 'party' || canonical === 'party_name') && kind === 'lead-quotation';
    return mapped(useLead ? context.maps.leadRef : context.maps.customerRef, value, context.salt, useLead ? 'lead-reference' : 'customer-reference', useLead ? 'LEAD' : 'CUST');
  }
  if (hasAlias(QUOTATION_REF_KEYS, key)) return mapped(context.maps.quotationRef, value, context.salt, 'quotation-reference', 'QTN');
  if (hasAlias(IDENTITY_KEYS, key)) {
    const [map, mapScope, prefix] = idMapForKind(kind, context.maps);
    return map ? mapped(map, value, context.salt, mapScope, prefix) : token(context.salt, scope, original);
  }
  if (canonical === 'customer_name' && kind === 'lead-quotation') return mapped(context.maps.leadRef, value, context.salt, 'lead-reference', 'LEAD');
  if (canonical === 'customer_name' && kind === 'quotation') return mapped(context.maps.customerRef, value, context.salt, 'customer-reference', 'CUST');
  if (hasAlias(PRESERVED_STRING_KEYS, key) || hasAlias(DATE_KEYS, key) || hasAlias(NUMERIC_KEYS, key)) return value;
  if (HASH_KEYS.test(canonical) && /^[0-9a-f]{64}$/i.test(original)) return value;
  if (EMAIL_KEYS.test(canonical)) return `${hash(context.salt, `${kind}-email`, original).slice(0, 12)}@example.invalid`;
  if (PHONE_KEYS.test(canonical)) return `11${digits(context.salt, `${kind}-phone`, original, 9)}`;
  if (canonical === 'uf' || canonical === 'state' || canonical === 'province') return 'SP';
  if (canonical === 'pincode' || canonical === 'postal_code' || canonical === 'zip' || canonical === 'cep') return digits(context.salt, `${kind}-postal`, original, 8);
  if (DOCUMENT_KEYS.test(canonical)) return digits(context.salt, `${kind}-document`, original, canonical.includes('cpf') ? 11 : 14);
  if (ADDRESS_KEYS.test(canonical)) return `Endereço Teste ${hash(context.salt, `${kind}-address`, original).slice(0, 10).toUpperCase()}`;
  if (canonical === 'customer_name' || canonical === 'lead_name' || canonical === 'contact_name' || canonical === 'full_name') {
    return `${kind === 'lead' ? 'Lead' : 'Cliente'} Teste ${hash(context.salt, `${kind}-name`, original).slice(0, 10).toUpperCase()}`;
  }
  if (canonical === 'item_name' || canonical === 'nome') return `Produto ${hash(context.salt, `${kind}-name`, original).slice(0, 10).toUpperCase()}`;
  if ((canonical === 'title' || canonical === 'rule_title') && kind === 'pricingRule') {
    const itemReferences = [...context.maps.itemRef.keys()].sort((left, right) => right.length - left.length);
    const exact = itemReferences.find((item) => item === original);
    const suffixMatch = itemReferences
      .filter((item) => original.startsWith(`${item}-`))
      .map((item) => ({ item, suffix: original.slice(item.length + 1) }))
      .filter(({ suffix }) => /^\d+(?:[.,]\d+)?$/.test(suffix) && Number(suffix.replace(',', '.')) > 0)[0];
    const base = exact || suffixMatch?.item || original;
    const suffix = exact ? '' : suffixMatch ? `-${suffixMatch.suffix}` : '';
    return `${mapped(context.maps.itemRef, base, context.salt, 'item-reference', 'ITEM')}${suffix}`;
  }
  if (canonical === 'description' || canonical === 'descricao' || canonical === 'notes' || canonical === 'observacoes' || canonical === 'terms' || canonical === 'remarks' || canonical === 'subject' || canonical === 'title' || canonical === 'rule_title') {
    return `Texto sanitizado ${hash(context.salt, `${kind}-${canonical}`, original).slice(0, 10).toUpperCase()}`;
  }
  if (typeof value === 'number') return token(context.salt, scope, original, 'NUM');
  return token(context.salt, scope, original, 'VAL');
}

function sanitizeValue(key, value, kind, context) {
  if (isOmittedKey(key)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (isRecord(entry)) return sanitizeRecord(entry, `${kind}-child`, context);
      return sanitizePrimitive(key, entry, kind, context, index);
    }).filter((entry) => entry !== undefined);
  }
  if (isRecord(value)) return sanitizeRecord(value, `${kind}-child`, context);
  return sanitizePrimitive(key, value, kind, context);
}

function sanitizeRecord(record, kind, context) {
  if (!isRecord(record)) throw new Error('Snapshot Frappe inválido: registro deve ser objeto.');
  const actualKind = entityKind(kind, record);
  const output = {};
  for (const [key, value] of Object.entries(record)) {
    const sanitized = sanitizeValue(key, value, actualKind, context);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function validateSnapshotShape(value) {
  if (!isRecord(value)) throw new Error('Snapshot Frappe inválido: dataset deve ser objeto.');
  if (!Array.isArray(value.items)) throw new Error('Snapshot Frappe inválido: items deve ser lista.');
  for (const field of OPTIONAL_DATASET_FIELDS) {
    if (value[field] !== undefined && !Array.isArray(value[field])) {
      throw new Error('Snapshot Frappe inválido: coleções devem ser listas.');
    }
  }
  for (const field of DATASET_FIELDS) {
    const rows = value[field];
    if (!Array.isArray(rows)) continue;
    if (rows.some((row) => !isRecord(row))) throw new Error('Snapshot Frappe inválido: registros devem ser objetos.');
  }
  return value;
}

export function anonymizeSnapshot(dataset, salt) {
  validateSnapshotShape(dataset);
  if (!text(salt)) throw new Error('FRAPPE_SNAPSHOT_SALT é obrigatório somente no processo.');
  const context = makeContext(dataset, salt);
  const output = {};
  for (const field of DATASET_FIELDS) {
    if (dataset[field] === undefined) continue;
    const kind = field === 'pricingRules' ? 'pricingRule'
      : field === 'itemPrices' ? 'itemPrice'
        : field === 'customers' ? 'customer'
          : field === 'leads' ? 'lead'
            : field === 'quotations' ? 'quotation'
              : 'item';
    output[field] = dataset[field].map((record) => sanitizeRecord(record, kind, context));
  }
  return output;
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== '--input' || argv[2] !== '--output') {
    throw new Error('Uso: anonymize-frappe-snapshot.mjs --input <arquivo> --output <arquivo>.');
  }
  if (!argv[1] || !argv[3] || argv[1].startsWith('--') || argv[3].startsWith('--')) {
    throw new Error('Opção ou caminho inválido.');
  }
  return { input: argv[1], output: argv[3] };
}

function safeAnonymizerError(error) {
  const message = error instanceof Error ? error.message : '';
  const safe = [
    'Uso: anonymize-frappe-snapshot.mjs --input <arquivo> --output <arquivo>.',
    'Opção ou caminho inválido.',
    'Input e output devem ser arquivos diferentes.',
    'FRAPPE_SNAPSHOT_SALT é obrigatório somente no processo.',
    'Snapshot Frappe inválido: dataset deve ser objeto.',
    'Snapshot Frappe inválido: items deve ser lista.',
    'Snapshot Frappe inválido: coleções devem ser listas.',
    'Snapshot Frappe inválido: registros devem ser objetos.',
    'Arquivo de entrada do snapshot não pôde ser lido.',
    'JSON do snapshot inválido.',
    'Arquivo de saída do snapshot já existe.',
    'Arquivo de saída do snapshot não pôde ser criado.',
  ];
  return safe.includes(message) ? message : 'Falha ao anonimizar snapshot Frappe.';
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const { input, output } = parseArgs(argv);
  const inputPath = resolve(input);
  const outputPath = resolve(output);
  if (inputPath === outputPath) throw new Error('Input e output devem ser arquivos diferentes.');
  let raw;
  try {
    raw = JSON.parse(await readFile(inputPath, 'utf8'));
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') throw new Error('Arquivo de entrada do snapshot não pôde ser lido.', { cause: error });
    throw new Error('JSON do snapshot inválido.', { cause: error });
  }
  const anonymized = anonymizeSnapshot(raw, env.FRAPPE_SNAPSHOT_SALT);
  try {
    await mkdir(resolve(outputPath, '..'), { recursive: true, mode: 0o700 });
    await writeFile(outputPath, `${JSON.stringify(anonymized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    await chmod(outputPath, 0o600);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'EEXIST') throw new Error('Arquivo de saída do snapshot já existe.', { cause: error });
    throw new Error('Arquivo de saída do snapshot não pôde ser criado.', { cause: error });
  }
  return { outputPath };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`${safeAnonymizerError(error)}\n`);
    process.exitCode = 2;
  }
}
