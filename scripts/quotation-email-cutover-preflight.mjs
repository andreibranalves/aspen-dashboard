#!/usr/bin/env node

import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-env.mjs';

export function evaluateQuotationEmailCutover({ legacyPendingCount }) {
  const count = Number.isInteger(legacyPendingCount) && legacyPendingCount >= 0
    ? legacyPendingCount
    : 0;
  return { ok: count === 0, legacyPendingCount: count };
}

export function formatQuotationEmailCutoverPreflight(result, now = () => new Date()) {
  const timestamp = now().toISOString();
  if (result.ok) {
    return [
      `timestamp: ${timestamp}`,
      'PASS nenhuma tentativa pendente usa snapshot legado',
    ].join('\n') + '\n';
  }
  return [
    `timestamp: ${timestamp}`,
    `FAIL ${result.legacyPendingCount} tentativa(s) pendente(s) usam snapshot legado; reconcilie antes do cutover`,
  ].join('\n') + '\n';
}

export async function runQuotationEmailCutoverPreflight({
  env = process.env,
  createClient = postgres,
  now = () => new Date(),
} = {}) {
  loadLocalEnv(env);
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  if (!databaseUrl) throw new Error('DATABASE_URL ausente.');

  const client = createClient(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 20,
    onnotice: () => undefined,
  });
  try {
    const [row] = await client`
      SELECT count(*)::int AS count
      FROM quotation_email_deliveries
      WHERE state = 'pending'
        AND NOT (
          jsonb_typeof(template_snapshot) = 'object'
          AND jsonb_object_length(template_snapshot) = 3
          AND jsonb_typeof(template_snapshot -> 'subject') = 'string'
          AND jsonb_typeof(template_snapshot -> 'html') = 'string'
          AND jsonb_typeof(template_snapshot -> 'text') = 'string'
          AND char_length(btrim(template_snapshot ->> 'subject')) > 0
          AND char_length(btrim(template_snapshot ->> 'html')) > 0
          AND char_length(btrim(template_snapshot ->> 'text')) > 0
        )
    `;
    return {
      ...evaluateQuotationEmailCutover({ legacyPendingCount: Number(row?.count || 0) }),
      timestamp: now().toISOString(),
    };
  } finally {
    await client.end({ timeout: 5 });
  }
}

const SCRIPT_PATH = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    const result = await runQuotationEmailCutoverPreflight();
    process.stdout.write(formatQuotationEmailCutoverPreflight(result, () => new Date(result.timestamp)));
    if (!result.ok) process.exitCode = 1;
  } catch {
    process.stderr.write('FAIL preflight do e-mail: não foi possível consultar as tentativas pendentes.\n');
    process.exitCode = 1;
  }
}
