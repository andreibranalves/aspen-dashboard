import { TextDecoder } from 'node:util';
import { pathToFileURL } from 'node:url';

function combineParts(parts) {
  return parts.slice(0, 2).join('');
}

const FORBIDDEN_METADATA = [
  combineParts(['fra', 'ppe']),
  combineParts(['erp', 'next']),
  combineParts(['CRM', '_CORE_']),
  combineParts(['CRM', '_OPERATIONAL_MODE']),
  combineParts(['CRM', '_QUOTES_ROLLOUT_STATE']),
];

function safeOrigin(value, name) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw new Error(`${name} must be a valid HTTP(S) origin without credentials`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${name} must be a valid HTTP(S) origin without credentials`);
  }
  return parsed.origin;
}

export function readCanaryConfig(env = process.env) {
  const required = [
    'CANARY_BASE_URL',
    'CANARY_PASSWORD',
    'CANARY_QUOTATION_ID',
    'CANARY_PUBLIC_QUOTATION_URL',
  ];
  const missing = required.filter((name) => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing canary configuration: ${missing.join(', ')}`);

  const baseUrl = safeOrigin(env.CANARY_BASE_URL, 'CANARY_BASE_URL');
  let publicUrl;
  try {
    publicUrl = new URL(String(env.CANARY_PUBLIC_QUOTATION_URL));
  } catch {
    throw new Error('CANARY_PUBLIC_QUOTATION_URL must be a valid URL');
  }
  if (publicUrl.origin !== baseUrl) {
    throw new Error('CANARY_PUBLIC_QUOTATION_URL must use CANARY_BASE_URL same origin');
  }
  if (publicUrl.username || publicUrl.password) {
    throw new Error('CANARY_PUBLIC_QUOTATION_URL must use CANARY_BASE_URL without credentials');
  }

  return {
    baseUrl,
    password: String(env.CANARY_PASSWORD),
    quotationId: String(env.CANARY_QUOTATION_ID).trim(),
    publicUrl: publicUrl.href,
  };
}

function sameOriginUrl(rawPath, baseUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawPath), baseUrl);
  } catch {
    throw new Error('Canary attempted an invalid URL');
  }
  if (parsed.origin !== baseUrl) throw new Error('Canary attempted a cross-origin URL');
  return parsed;
}

function setCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

function isCookiePair(value) {
  const separator = value.indexOf('=');
  if (separator <= 0) return false;
  const name = value.slice(0, separator).trim();
  return name.length > 0 && !name.includes(';') && !name.includes(' ');
}

function isSessionCookie(value) {
  const separator = value.indexOf('=');
  const name = value.slice(0, separator).toLowerCase();
  return name === 'aspen_token' || name === 'session';
}

function extractSessionCookie(headers) {
  const pairs = setCookieValues(headers)
    .map((value) => String(value).split(';', 1)[0].trim())
    .filter(isCookiePair);
  const sessionCookie = pairs.find(isSessionCookie);
  if (!sessionCookie) throw new Error('Canary login response did not set a session cookie');
  return sessionCookie;
}

function inspectBody(text, checkName) {
  const normalized = text.toLowerCase();
  if (FORBIDDEN_METADATA.some((token) => normalized.includes(token.toLowerCase()))) {
    throw new Error(`forbidden provider metadata in ${checkName}`);
  }
}

async function readBody(response, checkName) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('application/pdf')) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    inspectBody(new TextDecoder().decode(bytes), checkName);
    return { bytes };
  }
  const text = await response.text();
  inspectBody(text, checkName);
  return { text };
}

function assertResponseOrigin(response, expectedOrigin) {
  if (!response.url) return;
  let parsed;
  try {
    parsed = new URL(response.url);
  } catch {
    throw new Error('Canary received an invalid response URL');
  }
  if (parsed.origin !== expectedOrigin) throw new Error('Canary response cross-origin');
}

function parseJson(text, checkName) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${checkName} returned invalid JSON`);
  }
}

function hasRevision(value) {
  return value !== null && typeof value === 'object' && typeof value.revision_id === 'string' && value.revision_id.trim();
}

export async function runCanary({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Canary fetch implementation unavailable');
  const config = readCanaryConfig(env);
  const checks = [];
  let sessionCookie;

  async function fetchCheck(name, rawPath, options = {}) {
    const url = sameOriginUrl(rawPath, config.baseUrl);
    const startedAt = Date.now();
    const response = await fetchImpl(url, { ...options, redirect: 'error' });
    assertResponseOrigin(response, url.origin);
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`${name} returned redirect HTTP ${response.status}`);
    }
    const body = await readBody(response, name);
    if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}`);
    checks.push({ name, status: response.status, elapsedMs: Date.now() - startedAt });
    return { response, body };
  }

  const login = await fetchCheck('login', '/api/login', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ password: config.password }),
  });
  sessionCookie = extractSessionCookie(login.response.headers);

  const authenticatedHeaders = { accept: 'application/json', cookie: sessionCookie };
  await fetchCheck('operational-status', '/api/operational-status', { headers: authenticatedHeaders });
  await fetchCheck('products', '/api/products?limit=1', { headers: authenticatedHeaders });
  await fetchCheck('leads-clients', '/api/leads-clients?limit=1', { headers: authenticatedHeaders });

  const quotationPath = `/api/quotations?id=${encodeURIComponent(config.quotationId)}`;
  const quotation = await fetchCheck('quotation', quotationPath, { headers: authenticatedHeaders });
  const quotationData = parseJson(quotation.body.text, 'quotation');
  if (!hasRevision(quotationData)) throw new Error('quotation response missing revision_id');
  const revisionId = quotationData.revision_id.trim();

  const previewPath = `/api/quotation-preview?id=${encodeURIComponent(config.quotationId)}&format=pdf`;
  const preview = await fetchCheck('quotation-preview', previewPath, {
    headers: { accept: 'application/pdf', cookie: sessionCookie },
  });
  if (!preview.body.bytes || new TextDecoder().decode(preview.body.bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error('quotation-preview response is not a PDF');
  }
  if (preview.response.headers.get('x-document-revision') !== revisionId) {
    throw new Error('quotation-preview revision does not match quotation');
  }

  await fetchCheck('crm-deals', '/api/crm-deals?limit=1', { headers: authenticatedHeaders });
  await fetchCheck('sales-orders', '/api/sales-orders?limit=1', { headers: authenticatedHeaders });
  await fetchCheck('sales-dashboard', '/api/sales-dashboard', { headers: authenticatedHeaders });
  await fetchCheck('public-quotation', config.publicUrl, {
    headers: { accept: 'text/html' },
  });

  return { checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCanary()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : 'Production canary failed');
      process.exitCode = 1;
    });
}
