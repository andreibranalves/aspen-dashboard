import type { HeadBlobResult } from '../_infrastructure/integrations/blob/client.js';
import { getKvClient } from '../_infrastructure/integrations/kv/client.js';
import { getBlobClient, type BlobClient } from '../_infrastructure/integrations/blob/client.js';
import { getBlobConfig } from '../_infrastructure/integrations/blob/config.js';
import { KV_KEY_MEDIA_PREFIX, ALLOWED_MIME_TYPES } from './media-schema.js';
import { createHttpError } from '../_shared/http-error.js';

const kv = getKvClient();

const PUBLIC_BLOB_HOST = /^(?:[a-z0-9-]+\.)?public\.blob\.vercel-storage\.com$/i;
export const MEDIA_INTERNAL_VERSION_FIELD = '_recordVersion';
export const MEDIA_INTERNAL_DELETING_FIELD = '_deleting';
export const MEDIA_INTERNAL_VERSION_ALIASES = [
  MEDIA_INTERNAL_VERSION_FIELD,
  'recordVersion',
  'version',
] as const;
export const MEDIA_INTERNAL_DELETING_ALIASES = [
  MEDIA_INTERNAL_DELETING_FIELD,
  'deleting',
] as const;

const MEDIA_INTERNAL_ALIAS_SET = new Set<string>([
  ...MEDIA_INTERNAL_VERSION_ALIASES,
  ...MEDIA_INTERNAL_DELETING_ALIASES,
]);

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 16 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MEDIA_DOWNLOAD_TIMEOUT_MS = 10_000;
export const MEDIA_BLOB_HEAD_TIMEOUT_MS = 5_000;

export type BlobHead = BlobClient['head'];
export type BlobHeadResult = HeadBlobResult;

const STEP_MIME_TYPES: Record<string, readonly string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4'],
  document: ['application/pdf'],
};

function applicationOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      !/^https?:$/.test(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return '';
    }
    return parsed.origin;
  } catch {
    return '';
  }
}

function isPrivateHostname(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'local' ||
    hostname.endsWith('.local') ||
    hostname === '0.0.0.0' ||
    hostname === '::' ||
    hostname === '::1'
  ) {
    return true;
  }

  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return hostname.includes(':');
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function canonicalBlobPathname(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Caminho do Blob inválido.');
  let decoded: string;
  try {
    decoded = decodeURIComponent(value.trim());
  } catch {
    throw new Error('Caminho do Blob inválido.');
  }
  if (!decoded.startsWith('/')) decoded = `/${decoded}`;
  const parts = decoded.slice(1).split('/');
  if (
    parts.length < 3 ||
    parts[0] !== 'aspen-media' ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Caminho do Blob inválido.');
  }
  return parts.join('/');
}

function pathnameFromBlobUrl(value: string): string {
  const parsed = new URL(value);
  return canonicalBlobPathname(parsed.pathname);
}

function parseUrl(value: unknown, origin: string): URL {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Mídia pública inválida.');
  const raw = value.trim();
  if (raw.startsWith('//') || /^data:/i.test(raw) || /^javascript:/i.test(raw)) {
    throw new Error('Mídia pública inválida.');
  }
  const base = applicationOrigin(origin);
  if (!base) throw new Error('Origem da aplicação inválida.');

  let parsed: URL;
  try {
    parsed = new URL(raw, base);
  } catch {
    throw new Error('Mídia pública inválida.');
  }
  if (
    !/^https?:$/.test(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    isPrivateHostname(parsed.hostname)
  ) {
    throw new Error('Mídia pública inválida.');
  }
  return parsed;
}

/**
 * Canonicalize a URL that came from a local Vercel Blob metadata record.
 * Host and pathname validation are intentionally strict. Ownership still
 * requires a matching active local metadata record.
 */
export function normalizeOwnedBlobUrl(value: unknown, origin: string): string {
  const parsed = parseUrl(value, origin);
  if (parsed.protocol !== 'https:' || !PUBLIC_BLOB_HOST.test(parsed.hostname)) {
    throw new Error('Mídia Blob inválida.');
  }
  canonicalBlobPathname(parsed.pathname);
  return parsed.href;
}

export function isOwnedBlobUrl(value: unknown, origin: string): boolean {
  try {
    normalizeOwnedBlobUrl(value, origin);
    return true;
  } catch {
    return false;
  }
}

export function ownedBlobPathname(value: unknown, origin: string): string {
  return pathnameFromBlobUrl(normalizeOwnedBlobUrl(value, origin));
}

/**
 * Accept only an exact URL already approved by a local media/revision lookup.
 * This function never treats an arbitrary same-origin path as media.
 */
export function normalizePostgresMediaUrl(
  value: unknown,
  origin: string,
  approvedUrls: Iterable<unknown> = [],
): string {
  const parsed = parseUrl(value, origin);
  const canonical = parsed.href;
  const approved = new Set<string>();
  for (const candidate of approvedUrls) {
    try {
      approved.add(parseUrl(candidate, origin).href);
    } catch {
      // Ignore malformed approval entries and fail closed below.
    }
  }
  if (!approved.has(canonical)) throw new Error('Mídia pública não autorizada.');
  if (!PUBLIC_BLOB_HOST.test(parsed.hostname)) {
    const sameOrigin = parsed.origin === applicationOrigin(origin);
    if (!sameOrigin || parsed.pathname !== '/api/public-quotation') {
      throw new Error('Mídia pública não autorizada.');
    }
    const token = parsed.searchParams.get('token') || '';
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(token)) {
      throw new Error('Mídia pública não autorizada.');
    }
  } else {
    canonicalBlobPathname(parsed.pathname);
  }
  return canonical;
}

export interface PostgresMediaRecord {
  id?: unknown;
  blob_url?: unknown;
  blobUrl?: unknown;
  pathname?: unknown;
  active?: unknown;
  product_group?: unknown;
  productGroup?: unknown;
  content_type?: unknown;
  contentType?: unknown;
  size_bytes?: unknown;
  sizeBytes?: unknown;
  kind?: unknown;
  _recordVersion?: unknown;
  recordVersion?: unknown;
  _deleting?: unknown;
  version?: unknown;
  deleting?: unknown;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function mediaRecordVersion(record: unknown): unknown {
  if (!isObjectRecord(record)) return undefined;
  for (const alias of MEDIA_INTERNAL_VERSION_ALIASES) {
    const value = record[alias];
    if (value !== null && value !== undefined) return value;
  }
  return undefined;
}

export function isMediaTombstone(record: unknown): boolean {
  if (!isObjectRecord(record)) return false;
  return MEDIA_INTERNAL_DELETING_ALIASES.some((alias) => record[alias] === true);
}

export function stripMediaInternals<T>(value: T): T {
  const strip = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(strip);
    if (!isObjectRecord(current)) return current;
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(current)) {
      if (!MEDIA_INTERNAL_ALIAS_SET.has(key)) result[key] = strip(child);
    }
    return result;
  };
  return strip(value) as T;
}

export function parseMediaScanCursor(value: unknown): string | number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Cursor de catálogo inválido.');
    }
    return value === 0 ? 0 : value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const normalized = value.replace(/^0+(?=\d)/, '');
    return normalized === '0' ? 0 : normalized;
  }
  throw new Error('Cursor de catálogo inválido.');
}

export class MediaStoreReadError extends Error {
  statusCode = 503;
  logMessage = 'Falha ao ler o catálogo local de mídias.';

  constructor(cause?: unknown) {
    super('Não foi possível validar as mídias cadastradas.');
    this.name = 'MediaStoreReadError';
    if (cause instanceof Error) this.cause = cause;
  }
}

type MediaCatalogStore = Pick<typeof kv, 'scan' | 'get'>;

function parseMediaCatalogRecord(value: unknown): PostgresMediaRecord | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as PostgresMediaRecord
    : null;
}

/**
 * Read all local media records. Any KV failure is surfaced so send paths fail
 * closed instead of silently sending a text-only partial flow.
 */
export async function readCommunicationMediaRecords(
  store: MediaCatalogStore = kv,
): Promise<PostgresMediaRecord[]> {
  try {
    const keys = new Set<string>();
    let cursor: string | number = 0;
    const seenCursors = new Set<string>();
    while (true) {
      const cursorKey = String(cursor);
      if (seenCursors.has(cursorKey)) throw new Error('Cursor de catálogo inválido.');
      seenCursors.add(cursorKey);
      const result = await store.scan(cursor, {
        match: `${KV_KEY_MEDIA_PREFIX}*`,
        count: 200,
      });
      if (!Array.isArray(result) || !Array.isArray(result[1]) || result[0] == null) {
        throw new Error('Resposta de catálogo inválida.');
      }
      for (const key of result[1]) keys.add(String(key));
      cursor = parseMediaScanCursor(result[0]);
      if (cursor === 0) break;
    }
    if (keys.size === 0) return [];
    const entries = await Promise.all([...keys].map((key) => store.get(key)));
    const records: PostgresMediaRecord[] = [];
    for (const entry of entries) {
      if (entry == null) continue;
      const record = parseMediaCatalogRecord(entry);
      if (!record || isMediaTombstone(record)) continue;
      records.push(stripMediaInternals(record));
    }
    return records;
  } catch (error) {
    if (error instanceof MediaStoreReadError) throw error;
    throw new MediaStoreReadError(error);
  }
}

export function recordContentType(record: PostgresMediaRecord): string {
  return String(record.content_type ?? record.contentType ?? '').trim().toLowerCase();
}

export function recordSize(record: PostgresMediaRecord): number {
  const value = Number(record.size_bytes ?? record.sizeBytes);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function recordProductGroup(record: PostgresMediaRecord): string {
  return String(record.product_group ?? record.productGroup ?? '').trim().toLowerCase();
}

function maxSizeForMimeType(contentType: string): number {
  return contentType === 'video/mp4' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

function assertCanonicalActiveRecord(
  record: PostgresMediaRecord,
  origin: string,
  requireActive = true,
): { url: string; pathname: string } {
  if (!record || isMediaTombstone(record) || (requireActive && record.active !== true)) {
    throw new Error('Mídia pública não autorizada.');
  }
  const url = normalizeOwnedBlobUrl(record.blob_url ?? record.blobUrl, origin);
  const pathname = ownedBlobPathname(url, origin);
  const declaredPath = canonicalBlobPathname(record.pathname);
  if (declaredPath !== pathname) throw new Error('Caminho do Blob não corresponde ao registro.');
  const productGroup = recordProductGroup(record);
  if (productGroup && pathname.split('/')[1] !== productGroup) {
    throw new Error('Caminho do Blob não corresponde ao grupo do registro.');
  }
  return { url, pathname };
}

export class BlobMetadataReadError extends Error {
  statusCode = 503;
  logMessage = 'Falha ao autenticar a mídia Blob.';

  constructor(cause?: unknown) {
    super('Não foi possível validar a mídia Blob.');
    this.name = 'BlobMetadataReadError';
    if (cause instanceof Error) this.cause = cause;
  }
}

export interface BlobVerificationOptions {
  headFn?: BlobHead;
  token?: string;
  storeId?: string;
  timeoutMs?: number;
  expectedProductGroup?: string;
  requireActive?: boolean;
}

export interface VerifiedOwnedBlobRecord {
  record: PostgresMediaRecord;
  url: string;
  pathname: string;
  contentType: string;
  sizeBytes: number;
}

function configuredMediaStoreHost(token?: string, storeId?: string): string {
  const config = getBlobConfig();
  const configuredStore = String(
    storeId ?? config.storeId ?? '',
  ).trim().replace(/^store_/i, '');
  const tokenStore = String(token ?? config.token ?? '')
    .trim()
    .split('_')[3] || '';
  const store = (configuredStore || tokenStore).trim().replace(/^store_/i, '');
  return store ? `${store}.public.blob.vercel-storage.com`.toLowerCase() : '';
}

function blobHeadOptions(
  signal: AbortSignal,
  options: BlobVerificationOptions,
): { abortSignal: AbortSignal; token?: string; storeId?: string; oidcToken?: string } {
  const config = getBlobConfig();
  const token = String(options.token ?? config.token ?? '').trim();
  const storeId = String(options.storeId ?? config.storeId ?? '').trim();
  const oidcToken = String(config.oidcToken ?? '').trim();
  return {
    abortSignal: signal,
    ...(token ? { token } : {}),
    ...(storeId ? { storeId } : {}),
    ...(oidcToken ? { oidcToken } : {}),
  };
}

async function authenticatedBlobHead(
  url: string,
  options: BlobVerificationOptions = {},
): Promise<HeadBlobResult> {
  const parsed = new URL(url);
  const expectedHost = configuredMediaStoreHost(options.token, options.storeId);
  if (expectedHost && parsed.hostname.toLowerCase() !== expectedHost) {
    throw createHttpError(400, 'Mídia Blob não pertence ao store configurado.');
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, options.timeoutMs ?? MEDIA_BLOB_HEAD_TIMEOUT_MS);
  let timedOut = false;
  let rejectTimeout: ((reason?: unknown) => void) | undefined;
  const timeout = new Promise<never>((_, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout?.(new Error('Blob HEAD timeout'));
  }, timeoutMs);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  try {
    return await Promise.race([
      (options.headFn || getBlobClient().head)(url, blobHeadOptions(controller.signal, options)),
      timeout,
    ]);
  } catch (error) {
    if (timedOut) throw new BlobMetadataReadError(new Error('Blob HEAD timeout'));
    throw new BlobMetadataReadError(error);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/**
 * Revalidate one local media record against the configured Blob store.
 * Structural checks and authenticated HEAD metadata checks live here so
 * preview and send cannot silently drift apart.
 */
export async function verifyOwnedBlobRecord(
  record: PostgresMediaRecord,
  origin: string,
  options: BlobVerificationOptions = {},
): Promise<VerifiedOwnedBlobRecord> {
  const { url, pathname } = assertCanonicalActiveRecord(
    record,
    origin,
    options.requireActive !== false,
  );
  const expectedProductGroup = String(options.expectedProductGroup || '').trim().toLowerCase();
  if (expectedProductGroup && pathname.split('/')[1] !== expectedProductGroup) {
    throw createHttpError(400, 'Caminho do Blob não corresponde ao grupo do registro.');
  }
  const contentType = recordContentType(record);
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw createHttpError(400, 'Tipo MIME de mídia inválido.');
  }
  const sizeBytes = recordSize(record);
  if (!sizeBytes || sizeBytes > maxSizeForMimeType(contentType)) {
    throw createHttpError(400, 'Tamanho de mídia inválido.');
  }
  const kind = String(record.kind || '').trim().toLowerCase();
  if (kind && ((contentType === 'video/mp4') !== (kind === 'video'))) {
    throw createHttpError(400, 'O tipo da mídia não corresponde ao MIME informado.');
  }

  const metadata = await authenticatedBlobHead(url, options);
  if (
    metadata.url !== url ||
    metadata.pathname !== pathname ||
    String(metadata.contentType || '').trim().toLowerCase() !== contentType ||
    metadata.size !== sizeBytes
  ) {
    throw createHttpError(400, 'Os metadados do Blob não correspondem ao cadastro.');
  }
  return { record, url, pathname, contentType, sizeBytes };
}

export function findOwnedPostgresMediaRecord(
  value: unknown,
  origin: string,
  records: Iterable<PostgresMediaRecord>,
): PostgresMediaRecord {
  const requested = normalizeOwnedBlobUrl(value, origin);
  for (const record of records) {
    try {
      const canonical = assertCanonicalActiveRecord(record, origin);
      if (canonical.url === requested) return record;
    } catch {
      // Ignore unrelated malformed records; the requested URL still fails closed.
    }
  }
  throw createHttpError(400, 'Mídia pública não autorizada.');
}

/**
 * Match requested URLs against active metadata records before a send.
 * Deleted, inactive, stale, malformed, and non-Blob records are rejected.
 */
export function resolveOwnedPostgresMediaUrls(
  candidates: Iterable<unknown>,
  origin: string,
  records: Iterable<PostgresMediaRecord>,
): string[] {
  const resolved: string[] = [];
  for (const candidate of candidates) {
    if (candidate == null || !String(candidate).trim()) {
      throw createHttpError(400, 'Mídia pública não autorizada.');
    }
    const record = findOwnedPostgresMediaRecord(candidate, origin, records);
    resolved.push(normalizeOwnedBlobUrl(record.blob_url ?? record.blobUrl, origin));
  }
  return resolved;
}

export type MediaStepType = 'image' | 'video' | 'document';

function mediaLimit(stepType: MediaStepType): number {
  if (stepType === 'video') return MAX_VIDEO_BYTES;
  if (stepType === 'document') return MAX_DOCUMENT_BYTES;
  return MAX_IMAGE_BYTES;
}

export function allowedMediaMimeTypes(stepType: MediaStepType): readonly string[] {
  return STEP_MIME_TYPES[stepType] || [];
}

const MEDIA_FILENAME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
};

export function safeMediaFilename(
  value: unknown,
  contentType: string,
  fallback = 'referencia',
): string {
  const extension = MEDIA_FILENAME_EXTENSIONS[contentType] || 'bin';
  const raw = String(value || '').split(/[\\/]/).pop() || '';
  const stem = raw
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100);
  const safeFallback = fallback.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 100) || 'referencia';
  return `${stem || safeFallback}.${extension}`;
}

function mediaError(statusCode: number, publicMessage: string, logMessage?: string) {
  return createHttpError(statusCode, publicMessage, logMessage || publicMessage);
}

export interface DownloadApprovedMediaInput {
  url: string;
  origin: string;
  stepType: MediaStepType;
  records?: Iterable<PostgresMediaRecord>;
  revisionUrls?: Iterable<unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  headFn?: BlobHead;
  blobToken?: string;
  blobStoreId?: string;
}

export interface DownloadedMedia {
  base64: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Fetch one already-authorized media URL with strict protocol, redirect, MIME,
 * timeout, and byte limits. The stream is bounded even without Content-Length.
 */
export async function downloadApprovedMedia(
  input: DownloadApprovedMediaInput,
): Promise<DownloadedMedia> {
  const parsed = parseUrl(input.url, input.origin);
  const canonical = parsed.href;
  if (parsed.protocol !== 'https:') {
    throw mediaError(400, 'A mídia deve usar HTTPS.');
  }

  const revisionUrls = new Set<string>();
  for (const value of input.revisionUrls || []) {
    try {
      const revision = parseUrl(value, input.origin);
      if (revision.protocol === 'https:' && revision.pathname === '/api/public-quotation') {
        revisionUrls.add(revision.href);
      }
    } catch {
      // Ignore malformed internal approvals and fail closed below.
    }
  }
  const isRevisionUrl = revisionUrls.has(canonical);
  let record: PostgresMediaRecord | undefined;
  if (!isRevisionUrl) {
    record = findOwnedPostgresMediaRecord(canonical, input.origin, input.records || []);
    await verifyOwnedBlobRecord(record, input.origin, {
      headFn: input.headFn,
      token: input.blobToken,
      storeId: input.blobStoreId,
    });
  } else if (parsed.origin !== applicationOrigin(input.origin)) {
    throw mediaError(400, 'Link público do orçamento não autorizado.');
  }

  const allowed = allowedMediaMimeTypes(input.stepType);
  if (!allowed.length) throw mediaError(400, 'Tipo de mídia não permitido.');
  if (record) {
    const declaredType = recordContentType(record);
    if (!allowed.includes(declaredType)) {
      throw mediaError(400, 'O tipo da mídia não corresponde à etapa do fluxo.');
    }
    const declaredSize = recordSize(record);
    if (!declaredSize || declaredSize > mediaLimit(input.stepType)) {
      throw mediaError(400, 'O tamanho da mídia cadastrada é inválido.');
    }
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(1, input.timeoutMs ?? MEDIA_DOWNLOAD_TIMEOUT_MS);
  let timedOut = false;
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let bodyConsumed = false;
  let bodyCancellation: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancelBody = (): Promise<void> => {
    if (bodyCancellation) return bodyCancellation;
    if (bodyConsumed || (!reader && !response?.body)) return Promise.resolve();
    bodyCancellation = (async () => {
      if (reader) {
        await reader.cancel().catch(() => undefined);
      } else if (response?.body) {
        await response.body.cancel().catch(() => undefined);
      }
    })();
    return bodyCancellation;
  };
  const cleanup = async () => {
    if (timer) clearTimeout(timer);
    controller.abort();
    await cancelBody();
  };
  timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    void cancelBody();
  }, timeoutMs);

  try {
    try {
      response = await (input.fetchImpl || fetch)(canonical, {
        redirect: 'manual',
        signal: controller.signal,
      });
      (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
      if (timedOut || controller.signal.aborted) {
        throw mediaError(504, 'A mídia demorou demais para ser baixada.');
      }
    } catch {
      if (timedOut || controller.signal.aborted) {
        throw mediaError(504, 'A mídia demorou demais para ser baixada.');
      }
      throw mediaError(502, 'Não foi possível baixar a mídia.');
    }

    if (response.status >= 300 && response.status < 400) {
      throw mediaError(502, 'Redirecionamentos de mídia não são permitidos.');
    }
    if (!response.ok || (response.url && response.url !== canonical)) {
      throw mediaError(502, 'Não foi possível baixar a mídia.');
    }

    const contentType = String(response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!allowed.includes(contentType)) {
      throw mediaError(502, 'O tipo retornado pela mídia não é permitido.');
    }
    if (record && recordContentType(record) !== contentType) {
      throw mediaError(502, 'O tipo retornado pela mídia não corresponde ao cadastro.');
    }

    const maxBytes = mediaLimit(input.stepType);
    const contentLengthHeader = response.headers.get('content-length');
    let contentLength: number | undefined;
    if (contentLengthHeader != null) {
      if (!/^\d+$/.test(contentLengthHeader.trim())) {
        throw mediaError(502, 'O tamanho informado pela mídia é inválido.');
      }
      contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength > maxBytes) {
        throw mediaError(413, 'A mídia excede o limite permitido.');
      }
      if (record && contentLength !== recordSize(record)) {
        throw mediaError(502, 'O tamanho retornado pela mídia não corresponde ao cadastro.');
      }
    }

    if (!response.body) throw mediaError(502, 'A mídia não retornou conteúdo.');
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const readChunk = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
      let readTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          readTimer = setTimeout(() => {
            timedOut = true;
            controller.abort();
            void cancelBody();
            reject(new Error('Media body read timeout'));
          }, timeoutMs);
        });
        return await Promise.race([reader!.read(), timeout]);
      } finally {
        if (readTimer) clearTimeout(readTimer);
      }
    };
    while (true) {
      const next = await readChunk();
      if (next.done) {
        bodyConsumed = true;
        break;
      }
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        throw mediaError(413, 'A mídia excede o limite permitido.');
      }
      chunks.push(chunk);
    }

    if (timedOut || controller.signal.aborted) {
      throw mediaError(504, 'A mídia demorou demais para ser baixada.');
    }
    if (!total || (contentLength !== undefined && total !== contentLength)) {
      throw mediaError(502, 'O tamanho real da mídia não corresponde ao informado.');
    }
    if (record && total !== recordSize(record)) {
      throw mediaError(502, 'O tamanho real da mídia não corresponde ao cadastro.');
    }
    return {
      base64: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('base64'),
      mimeType: contentType,
      sizeBytes: total,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    if (timedOut || controller.signal.aborted) {
      throw mediaError(504, 'A mídia demorou demais para ser baixada.');
    }
    throw mediaError(502, 'Falha ao ler a mídia.');
  } finally {
    await cleanup();
  }
}
