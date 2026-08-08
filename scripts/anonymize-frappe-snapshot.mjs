#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATASET_FIELDS = ['items', 'pricingRules', 'itemPrices', 'customers', 'leads', 'quotations'];
const OMIT_KEYS = /(?:legacy.?payload|raw.?payload|authorization|bearer|token|secret|password|cookie|headers?)/i;
const DATE_KEYS = /^(?:creation|modified|modified_at|updated|updated_at|last_modified|source_updated_at|valid_till)$/i;
const NUMBER_KEYS = /^(?:idx|qty|min_qty|max_qty|rate|price_list_rate|amount|net_total|grand_total|pdf_size_bytes|docstatus)$/i;
const HASH_KEYS = /(?:checksum|sha256|hash)/i;
const STATUS_KEYS = /^(?:status|quotation_to|uom|stock_uom|currency|price_list|price_list_name)$/i;
const DOCUMENT_KEYS = /(?:tax|cpf|cnpj|document|pincode|postal|zip)/i;
const PHONE_KEYS = /(?:phone|mobile|telefone|celular|whatsapp)/i;
const EMAIL_KEYS = /(?:email|e_mail)/i;
const ADDRESS_KEYS = /(?:address|endereco|street|city|municip|bairro|complement|state|uf|territory)/i;

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function hash(salt, scope, value) {
  return createHash('sha256').update(`${salt}\0${scope}\0${value}`).digest('hex');
}

function token(salt, scope, value, prefix) {
  return `${prefix}-${hash(salt, scope, value).slice(0, 12).toUpperCase()}`;
}

function digits(salt, scope, value, length) {
  const number = BigInt(`0x${hash(salt, scope, value).slice(0, 15)}`) % 10n ** BigInt(length);
  return number.toString().padStart(length, '0');
}

function makeContext(dataset, salt) {
  const maps = {
    itemId: new Map(),
    itemCode: new Map(),
    customerId: new Map(),
    leadId: new Map(),
    quotationId: new Map(),
    pricingRuleId: new Map(),
    itemPriceId: new Map(),
  };
  const register = (map, scope, prefix, value) => {
    const original = text(value);
    if (!original) return '';
    if (!map.has(original)) map.set(original, token(salt, scope, original, prefix));
    return map.get(original);
  };
  const registerRows = (rows, map, scope, prefix) => {
    for (const row of rows || []) {
      const original = row && (row.name ?? row.id ?? row.source_id ?? row.sourceId);
      register(map, scope, prefix, original);
    }
  };
  const registerCodes = (rows) => {
    for (const row of rows || []) {
      const code = row && row.item_code;
      register(maps.itemCode, 'item-code', 'SKU', code);
      register(maps.itemId, 'item-id', 'ITEM', row && (row.name ?? row.id ?? row.source_id ?? row.sourceId));
    }
  };
  registerRows(dataset.items, maps.itemId, 'item-id', 'ITEM');
  registerCodes(dataset.items);
  registerRows(dataset.pricingRules, maps.pricingRuleId, 'pricing-rule-id', 'PR');
  registerRows(dataset.itemPrices, maps.itemPriceId, 'item-price-id', 'IP');
  registerRows(dataset.customers, maps.customerId, 'customer-id', 'CUST');
  registerRows(dataset.leads, maps.leadId, 'lead-id', 'LEAD');
  registerRows(dataset.quotations, maps.quotationId, 'quotation-id', 'QTN');
  registerCodes(dataset.pricingRules);
  registerCodes(dataset.itemPrices);
  return { maps, salt };
}

function mapped(map, value, fallbackScope, fallbackPrefix, context) {
  const original = text(value);
  if (!original) return original;
  return map.get(original) || token(context.salt, fallbackScope, original, fallbackPrefix);
}

function sanitizeString(key, value, kind, context) {
  const original = text(value);
  if (!original) return original;
  const lower = key.toLowerCase();
  const { maps } = context;

  if (lower === 'quotation_to' || STATUS_KEYS.test(lower) || DATE_KEYS.test(lower) || NUMBER_KEYS.test(lower)) return value;
  if (HASH_KEYS.test(lower) && /^[0-9a-f]{64}$/i.test(original)) return original;
  if (lower === 'item_code') return mapped(maps.itemCode, original, 'item-code', 'SKU', context);
  if (lower === 'item_name') return `Produto ${hash(context.salt, 'item-name', original).slice(0, 10).toUpperCase()}`;
  if (lower === 'customer' || lower === 'party' || lower === 'party_name' || lower === 'customer_id') {
    const isLead = kind === 'lead' || kind === 'lead-reference' || kind === 'lead-quotation';
    const map = isLead ? maps.leadId : maps.customerId;
    return mapped(map, original, isLead ? 'lead-id' : 'customer-id', isLead ? 'LEAD' : 'CUST', context);
  }
  if (lower === 'lead' || lower === 'lead_id') return mapped(maps.leadId, original, 'lead-id', 'LEAD', context);
  if (lower === 'quotation_id' || lower === 'quotation') return mapped(maps.quotationId, original, 'quotation-id', 'QTN', context);
  if (lower === 'name' || lower === 'id' || lower === 'source_id' || lower === 'sourceid') {
    const entityKind = kind === 'lead-quotation' ? 'quotation' : kind;
    const map = entityKind === 'item' ? maps.itemId
      : entityKind === 'customer' ? maps.customerId
        : entityKind === 'lead' ? maps.leadId
          : entityKind === 'quotation' ? maps.quotationId
            : entityKind === 'pricingRule' ? maps.pricingRuleId
              : entityKind === 'itemPrice' ? maps.itemPriceId
                : undefined;
    const prefix = entityKind === 'item' ? 'ITEM' : entityKind === 'customer' ? 'CUST' : entityKind === 'lead' ? 'LEAD' : entityKind === 'quotation' ? 'QTN' : entityKind === 'pricingRule' ? 'PR' : 'IP';
    return map ? mapped(map, original, `${entityKind}-id`, prefix, context)
      : token(context.salt, `${entityKind}-id`, original, 'REF');
  }
  if (EMAIL_KEYS.test(lower)) return `${hash(context.salt, `${kind}-email`, original).slice(0, 12)}@example.invalid`;
  if (PHONE_KEYS.test(lower)) return `11${digits(context.salt, `${kind}-phone`, original, 9)}`;
  if (lower === 'uf' || lower === 'state') return 'SP';
  if (lower === 'pincode' || lower === 'postal_code' || lower === 'zip') return digits(context.salt, `${kind}-postal`, original, 8);
  if (DOCUMENT_KEYS.test(lower)) return digits(context.salt, `${kind}-document`, original, lower.includes('cpf') ? 11 : 14);
  if (ADDRESS_KEYS.test(lower)) return `Endereço Teste ${hash(context.salt, `${kind}-address`, original).slice(0, 10).toUpperCase()}`;
  if (lower === 'customer_name' || lower === 'lead_name' || lower === 'contact_name' || lower === 'full_name') {
    return `${kind === 'lead' ? 'Lead' : 'Cliente'} Teste ${hash(context.salt, `${kind}-name`, original).slice(0, 10).toUpperCase()}`;
  }
  if (lower === 'description' || lower === 'notes' || lower === 'terms' || lower === 'subject' || lower === 'title') {
    return `Texto sanitizado ${hash(context.salt, `${kind}-${lower}`, original).slice(0, 10).toUpperCase()}`;
  }
  if (lower === 'doctype') return value;
  return `Valor sanitizado ${hash(context.salt, `${kind}-${lower}`, original).slice(0, 12).toUpperCase()}`;
}

function sanitizeValue(key, value, kind, context) {
  if (OMIT_KEYS.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => (entry && typeof entry === 'object' ? sanitizeRecord(entry, `${kind}-child`, context) : entry));
  }
  if (value && typeof value === 'object') return sanitizeRecord(value, `${kind}-child`, context);
  if (typeof value === 'string') return sanitizeString(key, value, kind, context);
  if (typeof value === 'number' && (DOCUMENT_KEYS.test(key) || PHONE_KEYS.test(key) || EMAIL_KEYS.test(key))) {
    return sanitizeString(key, String(value), kind, context);
  }
  return value;
}

function sanitizeRecord(record, kind, context) {
  const quotationKind = kind === 'quotation' && text(record?.quotation_to).toLowerCase() === 'lead'
    ? 'lead-quotation'
    : kind;
  const output = {};
  for (const [key, value] of Object.entries(record || {})) {
    const sanitized = sanitizeValue(key, value, quotationKind, context);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function anonymizeSnapshot(dataset, salt) {
  if (!dataset || typeof dataset !== 'object' || Array.isArray(dataset)) throw new Error('Snapshot Frappe inválido.');
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
              : field === 'items' ? 'item'
                : field;
    output[field] = Array.isArray(dataset[field])
      ? dataset[field].map((record) => sanitizeRecord(record, kind, context))
      : dataset[field];
  }
  return output;
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} exige um caminho.`);
  return argv[index + 1];
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 4 || !argv.includes('--input') || !argv.includes('--output')) {
    throw new Error('Uso: anonymize-frappe-snapshot.mjs --input <arquivo> --output <arquivo>.');
  }
  const inputPath = resolve(optionValue(argv, '--input'));
  const outputPath = resolve(optionValue(argv, '--output'));
  if (inputPath === outputPath) throw new Error('Input e output devem ser arquivos diferentes.');
  const raw = JSON.parse(await readFile(inputPath, 'utf8'));
  const anonymized = anonymizeSnapshot(raw, env.FRAPPE_SNAPSHOT_SALT);
  await mkdir(resolve(outputPath, '..'), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(anonymized, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await chmod(outputPath, 0o600);
  return { outputPath };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'Falha ao anonimizar snapshot Frappe.'}\n`);
    process.exitCode = 2;
  }
}
