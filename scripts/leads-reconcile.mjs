#!/usr/bin/env node

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSanityQuoteRequestsPageReader } from '../api/_infrastructure/integrations/sanity/quote-requests.js';

const PAGE_SIZE = 100;
const MAX_RECORDS = 5_000;
const SAFE_SANITY_ID = /^[A-Za-z0-9_.-]{1,255}$/;

export function parseReconcileArgs(argv) {
  const values = {};
  let mode = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run' || argument === '--apply') {
      if (mode) throw new Error('Escolha somente --dry-run ou --apply.');
      mode = argument.slice(2);
    } else if (['--from', '--to', '--target'].includes(argument)) {
      values[argument.slice(2)] = argv[++index];
    } else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  if (!values.from) throw new Error('--from é obrigatório.');
  if (!values.to) throw new Error('--to é obrigatório.');
  if (!mode) throw new Error('Escolha explicitamente --dry-run ou --apply.');
  const fromDate = new Date(values.from);
  const toDate = new Date(values.to);
  if (
    !Number.isFinite(fromDate.getTime()) ||
    !Number.isFinite(toDate.getTime()) ||
    fromDate >= toDate
  ) {
    throw new Error('O intervalo [from,to) é inválido.');
  }
  if (mode === 'apply' && !values.target) throw new Error('--target é obrigatório no apply.');
  return {
    from: fromDate.toISOString(),
    to: toDate.toISOString(),
    mode,
    target: values.target || null,
  };
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function legacyFingerprint(document) {
  const canonical = JSON.stringify({
    nome: text(document.name).replace(/\s+/g, ' '),
    email: text(document.email).toLowerCase(),
    wa: text(document.whatsapp).replace(/\D/g, ''),
    produto: text(document.product).replace(/\s+/g, ' '),
    qtd: String(document.quantity ?? '').trim(),
    prazo: text(document.deadline).replace(/\s+/g, ' '),
    msg: text(document.message).replace(/\s+/g, ' '),
    consentGiven: document.consentGiven === true,
    source: text(document.utmSource),
    medium: text(document.utmMedium),
    campaign: text(document.utmCampaign),
    utmContent: text(document.utmContent),
    utmTerm: text(document.utmTerm),
    gclid: text(document.gclid),
    gbraid: text(document.gbraid),
    wbraid: text(document.wbraid),
    fbclid: text(document.fbclid),
    pageUrl: text(document.pageUrl),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export function sanityDocumentToIngestInput(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document))
    throw new Error('invalid_document');
  const id = text(document._id);
  const originalCreatedAt = text(document.createdAt);
  const date = new Date(originalCreatedAt);
  if (
    !SAFE_SANITY_ID.test(id) ||
    id.startsWith('drafts.') ||
    id.startsWith('versions.') ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString() !== originalCreatedAt
  )
    throw new Error('invalid_document');
  const nome = text(document.name);
  const email = text(document.email);
  const whatsapp = text(document.whatsapp).replace(/\D/g, '');
  const produto = text(document.product);
  const quantidade = String(document.quantity ?? '').trim();
  if (!nome || !email || !/^\d{10,15}$/.test(whatsapp) || !produto || !quantidade)
    throw new Error('invalid_document');
  const suppliedFingerprint = text(document.payloadFingerprint);
  const payloadFingerprint = /^[0-9a-f]{64}$/.test(suppliedFingerprint)
    ? suppliedFingerprint
    : legacyFingerprint(document);
  return {
    source: 'site_form',
    externalId: id,
    payloadFingerprint,
    originalCreatedAt,
    nome,
    email,
    whatsapp,
    produto,
    quantidade,
    prazo: text(document.deadline) || null,
    mensagem: text(document.message) || null,
    utm_source: text(document.utmSource) || null,
    utm_medium: text(document.utmMedium) || null,
    utm_campaign: text(document.utmCampaign) || null,
    utm_content: text(document.utmContent) || null,
    utm_term: text(document.utmTerm) || null,
    gclid: text(document.gclid) || null,
    gbraid: text(document.gbraid) || null,
    wbraid: text(document.wbraid) || null,
    fbclid: text(document.fbclid) || null,
    page_url: text(document.pageUrl) || null,
    consent: { given: document.consentGiven === true, source: 'site_quote_form' },
  };
}

export async function runReconciliation(options, dependencies) {
  const counts = {
    lidos: 0,
    created: 0,
    deduplicated: 0,
    rejeitados: 0,
    erros: 0,
    conflitos: 0,
  };
  let cursorDate = options.from;
  let cursorId = '';
  while (counts.lidos < MAX_RECORDS) {
    let page;
    try {
      page = await dependencies.readPage({
        from: options.from,
        to: options.to,
        cursorDate,
        cursorId,
        limit: Math.min(PAGE_SIZE, MAX_RECORDS - counts.lidos),
      });
    } catch {
      counts.erros += 1;
      break;
    }
    if (!Array.isArray(page) || page.length === 0) break;
    for (const document of page) {
      counts.lidos += 1;
      let input;
      try {
        input = sanityDocumentToIngestInput(document);
      } catch {
        counts.rejeitados += 1;
        continue;
      }
      try {
        if (options.mode === 'dry-run') {
          const result = await dependencies.inspect(input);
          if (result === 'create') counts.created += 1;
          else if (result === 'deduplicate') counts.deduplicated += 1;
          else counts.conflitos += 1;
        } else {
          const result = await dependencies.ingest(input);
          if (result.result === 'created') counts.created += 1;
          else counts.deduplicated += 1;
        }
      } catch (error) {
        if (typeof error === 'object' && error !== null && Number(error.statusCode) === 409)
          counts.conflitos += 1;
        else counts.erros += 1;
      }
    }
    const last = page.at(-1);
    const nextDate = text(last?.createdAt);
    const nextId = text(last?._id);
    if (!nextDate || !nextId || (nextDate === cursorDate && nextId <= cursorId)) {
      counts.erros += 1;
      break;
    }
    cursorDate = nextDate;
    cursorId = nextId;
  }
  if (counts.lidos >= MAX_RECORDS) counts.erros += 1;
  const common = {
    lidos: counts.lidos,
    rejeitados: counts.rejeitados,
    erros: counts.erros,
    conflitos: counts.conflitos,
  };
  return options.mode === 'dry-run'
    ? { ...common, criaria: counts.created, deduplicaria: counts.deduplicated }
    : { ...common, criados: counts.created, deduplicados: counts.deduplicated };
}

function targetFingerprint(databaseUrl) {
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error('DATABASE_URL inválida.');
  const identity = `${url.hostname.toLowerCase()}|${url.port || '5432'}|${decodeURIComponent(url.pathname.slice(1))}`;
  return createHash('sha256').update(identity).digest('hex');
}

export function assertApplyPreflight(options, environment) {
  if (options.mode !== 'apply') return;
  const required = [
    'APP_ENV',
    'LEADS_RECONCILE_APPROVED_TARGET',
    'LEADS_RECONCILE_APPLY_APPROVED',
    'DATABASE_URL',
    'LEADS_RECONCILE_DATABASE_FINGERPRINT',
    'SANITY_PROJECT_ID',
    'SANITY_DATASET',
    'LEADS_RECONCILE_SANITY_PROJECT_ID',
    'LEADS_RECONCILE_SANITY_DATASET',
  ];
  if (required.some((key) => !text(environment[key])))
    throw new Error('Preflight de apply incompleto.');
  if (
    environment.LEADS_RECONCILE_APPLY_APPROVED !== '1' ||
    options.target !== environment.APP_ENV ||
    options.target !== environment.LEADS_RECONCILE_APPROVED_TARGET ||
    targetFingerprint(environment.DATABASE_URL) !==
      environment.LEADS_RECONCILE_DATABASE_FINGERPRINT ||
    environment.SANITY_PROJECT_ID !== environment.LEADS_RECONCILE_SANITY_PROJECT_ID ||
    environment.SANITY_DATASET !== environment.LEADS_RECONCILE_SANITY_DATASET
  ) {
    throw new Error('Preflight de apply não comprovou o alvo aprovado.');
  }
}

async function main() {
  const { loadLocalEnv } = await import('./load-env.mjs');
  loadLocalEnv(process.env);
  const options = parseReconcileArgs(process.argv.slice(2));
  assertApplyPreflight(options, process.env);
  const { createPostgresQuoteLeadRepository } =
    await import('../api/_infrastructure/db/repositories/quote-leads-repository.js');
  const { closeDatabase } = await import('../api/_infrastructure/db/client.js');
  const repository = createPostgresQuoteLeadRepository();
  const metadata = (record) => record?.raw?.siteSubmission;
  try {
    const report = await runReconciliation(options, {
      readPage: createSanityQuoteRequestsPageReader(process.env),
      inspect: async (input) => {
        const existing = await repository.findByExternalId(input.externalId, 'site_form');
        if (!existing) return 'create';
        return metadata(existing)?.payloadFingerprint === input.payloadFingerprint
          ? 'deduplicate'
          : 'conflict';
      },
      ingest: async (input) => {
        const result = await repository.ingestSiteSubmission(input);
        return { result: result.created ? 'created' : 'deduplicated' };
      },
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (report.erros || report.conflitos || report.rejeitados) process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(() => {
    process.stderr.write('Falha sanitizada na reconciliação de leads.\n');
    process.exitCode = 1;
  });
}
