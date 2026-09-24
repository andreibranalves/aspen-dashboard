// Captures sanitized contract fixtures from the installed Evolution (#296, #308).
// Read-only by default and scoped to ONE test conversation owned by the operator.
//
//   FIXTURE_PHONE=5511999999999 DOTENV_CONFIG_PATH=~/.config/aspen-dashboard/.env.local \
//     node scripts/capture-evolution-fixtures.mjs [--since-hours 6] [--jid <jid>] [--send-media]
//
// --send-media sends a tiny generated PNG and PDF to FIXTURE_PHONE (external send:
// requires explicit operator authorization). Nothing raw is written: every phone,
// JID, ID, name, text, URL and media key is replaced before the file is saved, and
// the output is checked for leaks before writing. Review the diff before committing.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocalEnv } from './load-env.mjs';

loadLocalEnv();

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const baseUrl = (process.env.EVOLUTION_BASE_URL || '').trim().replace(/\/+$/, '');
const apiKey = (process.env.EVOLUTION_API_KEY || '').trim();
const instance = (process.env.EVOLUTION_INSTANCE || '').trim();
const phone = (process.env.FIXTURE_PHONE || '').replace(/\D/g, '');
const sinceHours = Number(option('--since-hours') || 6);
const outDir = join(process.cwd(), 'tests/fixtures/evolution-installed');

if (!baseUrl || !apiKey || !instance) fail('EVOLUTION_BASE_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE são obrigatórios.');
if (!/^\d{12,13}$/.test(phone)) fail('FIXTURE_PHONE deve ter DDI+DDD+número (12 ou 13 dígitos).');
if (!Number.isFinite(sinceHours) || sinceHours <= 0 || sinceHours > 72) fail('--since-hours deve estar entre 0 e 72.');

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function evolution(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { apikey: apiKey, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = await response.json().catch(() => null);
  return { status: response.status, json };
}

// ---- sanitization -------------------------------------------------------

const secrets = [apiKey, instance, baseUrl, new URL(baseUrl).host, phone, phone.slice(2), phone.slice(-8)].filter(
  (value) => value && value.length >= 6
);
const synthetic = new Map();
let counter = 0;
function alias(kind, value) {
  const key = `${kind}:${value}`;
  if (!synthetic.has(key)) {
    counter += 1;
    const n = String(counter).padStart(4, '0');
    synthetic.set(
      key,
      {
        phone: `55110000${n}`,
        pn: `55110000${n}@s.whatsapp.net`,
        lid: `10000000${n}@lid`,
        group: `12036300000${n}@g.us`,
        id: `FIXTURE${n}ABCDEF`,
        uuid: `00000000-0000-4000-8000-00000000${n}`,
      }[kind]
    );
  }
  return synthetic.get(key);
}

const DROP_KEYS = /^(apikey|api_key|token|authorization|secret|password|cookie)$/i;
const BINARY_KEYS = /^(base64|media|url|directPath|mediaKey|fileSha256|fileEncSha256|jpegThumbnail|thumbnail\w*|streamingSidecar|waveform|mediaKeyTimestamp|messageSecret|contactVcard|vcard|profilePicUrl|serverUrl|server_url|senderKeyHash|recipientKeyHash)$/;
const TEXT_KEYS = /^(conversation|text|caption|fileName|title|pushName|name|verifiedBizName|body|description|displayName)$/;
const ID_KEYS = /^(id|keyId|messageId|stanzaId|_id|owner|instanceId|chatId|contactId|labelId|sessionId)$/;

function sanitizeString(value) {
  let result = value
    .replace(/\b(\d{10,15})@s\.whatsapp\.net\b/g, (_, digits) => alias('pn', digits))
    .replace(/\b(\d{6,20})@lid\b/g, (_, digits) => alias('lid', digits))
    .replace(/\b([\d-]{10,30})@g\.us\b/g, (_, digits) => alias('group', digits))
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (uuid) => alias('uuid', uuid.toLowerCase()));
  for (const secret of secrets) result = result.split(secret).join('[REMOVIDO]');
  return result;
}

function sanitize(value, key = '') {
  // Buffers arrive serialized as byte-index objects; drop them like base64 strings.
  if (BINARY_KEYS.test(key) && value !== null && value !== false && value !== '') return '[REMOVIDO]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [childKey, child] of Object.entries(value)) {
      if (DROP_KEYS.test(childKey)) continue;
      output[childKey] = sanitize(child, childKey);
    }
    return output;
  }
  if (typeof value !== 'string' || value === '') return value;
  if (BINARY_KEYS.test(key)) return '[REMOVIDO]';
  if (TEXT_KEYS.test(key)) return key === 'fileName' ? `arquivo-teste${value.match(/\.\w{2,5}$/)?.[0] || ''}` : 'Texto sintético';
  if (ID_KEYS.test(key) && !/@/.test(value) && !/^[0-9a-f-]{36}$/i.test(value)) return alias('id', value);
  if (key === 'sender' || key === 'wuid') return alias('pn', value.replace(/\D/g, ''));
  if (key === 'number') return alias('phone', value.replace(/\D/g, ''));
  return sanitizeString(value);
}

function assertClean(label, json) {
  const text = JSON.stringify(json);
  const leaks = secrets.filter((secret) => text.includes(secret));
  if (/https?:\/\//.test(text)) leaks.push('url');
  if (/"[A-Za-z0-9+/]{200,}={0,2}"/.test(text)) leaks.push('base64');
  if (/"(mediaKey|fileEncSha256|jpegThumbnail)":\s*\{/.test(text)) leaks.push('buffer');
  if (leaks.length) fail(`${label}: valor sensível ainda presente (${leaks.length}); nada foi gravado.`);
}

const fixtures = {};
function keep(name, source, payload) {
  const sanitized = sanitize(payload);
  assertClean(name, sanitized);
  fixtures[name] = { _meta: { source, evolution: meta.version, capturedOn: new Date().toISOString().slice(0, 10) }, payload: sanitized };
}

// ---- capture ------------------------------------------------------------

const meta = { version: 'desconhecida' };
const root = await evolution('GET', '/');
meta.version = root.json?.version || meta.version;

const instances = await evolution('GET', `/instance/fetchInstances?instanceName=${encodeURIComponent(instance)}`);
const webhook = await evolution('GET', `/webhook/find/${encodeURIComponent(instance)}`);
const events = Array.isArray(webhook.json?.events) ? webhook.json.events : [];

const pnJid = `${phone}@s.whatsapp.net`;
let remoteJid = option('--jid') || pnJid;
if (!option('--jid')) {
  // Most chats are LID-addressed; the phone appears only in remoteJidAlt.
  const chats = await evolution('POST', `/chat/findChats/${encodeURIComponent(instance)}`, {});
  const list = Array.isArray(chats.json) ? chats.json : [];
  const lidChat = list.find((chat) => chat?.lastMessage?.key?.remoteJidAlt === pnJid);
  if (lidChat?.remoteJid) remoteJid = lidChat.remoteJid;
}

const since = Math.floor(Date.now() / 1000) - sinceHours * 3600;
const pages = [];
for (const page of [1, 2]) {
  const result = await evolution('POST', `/chat/findMessages/${encodeURIComponent(instance)}`, {
    where: { key: { remoteJid } },
    page,
    offset: 10,
  });
  pages.push(result);
}
const firstPage = pages[0].json?.messages;
const records = (pages.flatMap((page) => page.json?.messages?.records || [])).filter(
  (record) => Number(record?.messageTimestamp) >= since
);
if (!records.length) fail('Nenhuma mensagem recente na conversa de teste. Envie as mensagens e rode de novo (ou use --jid).');

keep('instance', 'GET /instance/fetchInstances', {
  version: meta.version,
  webhookEvents: events,
  webhookEnabled: webhook.json?.enabled ?? null,
  webhookByEvents: webhook.json?.webhookByEvents ?? null,
  webhookBase64: webhook.json?.webhookBase64 ?? null,
  instanceKeys: Object.keys((Array.isArray(instances.json) ? instances.json[0] : instances.json) || {}).sort(),
});

keep('find-messages-pagination', 'POST /chat/findMessages (páginas 1 e 2, offset 10)', {
  request: { where: { key: { remoteJid } }, page: 2, offset: 10 },
  total: firstPage?.total ?? null,
  pages: firstPage?.pages ?? null,
  page1: (pages[0].json?.messages?.records || []).map((record) => ({ id: record?.key?.id, messageTimestamp: record?.messageTimestamp })),
  page2: (pages[1].json?.messages?.records || []).map((record) => ({ id: record?.key?.id, messageTimestamp: record?.messageTimestamp })),
  currentPage: pages.map((page) => page.json?.messages?.currentPage ?? null),
});

const newest = (predicate) => records.filter(predicate).sort((a, b) => Number(b.messageTimestamp) - Number(a.messageTimestamp))[0];
const kinds = {
  'upsert-inbound-text': (r) => !r.key?.fromMe && ['conversation', 'extendedTextMessage'].includes(r.messageType),
  'upsert-outbound-echo': (r) => r.key?.fromMe && ['conversation', 'extendedTextMessage'].includes(r.messageType),
  'upsert-inbound-image': (r) => !r.key?.fromMe && r.messageType === 'imageMessage',
  'upsert-inbound-pdf': (r) => !r.key?.fromMe && ['documentMessage', 'documentWithCaptionMessage'].includes(r.messageType),
  'upsert-inbound-audio': (r) => !r.key?.fromMe && r.messageType === 'audioMessage',
};
const missing = [];
for (const [name, predicate] of Object.entries(kinds)) {
  const record = newest(predicate);
  if (!record) {
    missing.push(name);
    continue;
  }
  keep(name, 'POST /chat/findMessages (registro armazenado; mesmo formato de data no webhook)', record);
  if (/image|pdf|audio/.test(name)) {
    const media = await evolution('POST', `/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
      message: { key: { id: record.key.id } },
      convertToMp4: false,
    });
    const base64 = typeof media.json?.base64 === 'string' ? media.json.base64 : '';
    keep(name.replace('upsert-inbound', 'media-base64'), 'POST /chat/getBase64FromMediaMessage', {
      status: media.status,
      responseKeys: Object.keys(media.json || {}).sort(),
      response: { ...media.json, base64: base64 ? '[REMOVIDO]' : media.json?.base64 },
      decodedBytes: base64 ? Buffer.from(base64, 'base64').length : 0,
      magic: base64 ? Buffer.from(base64, 'base64').subarray(0, 4).toString('hex') : null,
    });
  }
}

const statuses = await evolution('POST', `/chat/findStatusMessage/${encodeURIComponent(instance)}`, {
  where: { remoteJid },
  page: 1,
  offset: 20,
});
const statusRecords = Array.isArray(statuses.json) ? statuses.json : statuses.json?.messages?.records || statuses.json?.records || [];
if (statusRecords.length) keep('update-receipts', 'POST /chat/findStatusMessage', statusRecords.slice(0, 5));
else missing.push('update-receipts');

if (flag('--send-media')) {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pdf = Buffer.from(
    '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 72 72]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
  ).toString('base64');
  for (const [name, body] of [
    ['send-media-image', { number: phone, mediatype: 'image', mimetype: 'image/png', media: png, fileName: 'teste.png', caption: 'Teste de contrato' }],
    ['send-media-pdf', { number: phone, mediatype: 'document', mimetype: 'application/pdf', media: pdf, fileName: 'teste.pdf', caption: 'Teste de contrato' }],
  ]) {
    const result = await evolution('POST', `/message/sendMedia/${encodeURIComponent(instance)}`, body);
    keep(name, 'POST /message/sendMedia', { request: { ...body, media: '[REMOVIDO]' }, status: result.status, response: result.json });
  }
}

mkdirSync(outDir, { recursive: true });
for (const [name, fixture] of Object.entries(fixtures)) {
  writeFileSync(join(outDir, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}
console.log(`Gravadas: ${Object.keys(fixtures).sort().join(', ')}`);
if (missing.length) console.log(`Ausentes (envie e rode de novo): ${missing.join(', ')}`);
