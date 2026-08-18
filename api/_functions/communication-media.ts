// GET    /api/communication-media        - list media assets (scan KV by prefix)
import type { FunctionEvent, FunctionResult, JsonResponseFn } from '../_http/types.js';
import { randomUUID } from 'node:crypto';
// GET    /api/communication-media/:id    - single media asset
// POST   /api/communication-media        - create media asset metadata (after Blob upload)
// PUT    /api/communication-media/:id    - update media asset
// DELETE /api/communication-media/:id    - delete media asset
//
// Storage: Vercel KV per-id keys: aspen:communication:media-assets:{id}
// Binary files: Vercel Blob (public store, URLs stored in KV metadata)

import { kv } from '@vercel/kv';
import { del as blobDelete, head as blobHead } from '@vercel/blob';
import { createHttpError } from '../_shared/http-error.js';
import {
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MEDIA_INTERNAL_DELETING_ALIASES,
  MEDIA_INTERNAL_DELETING_FIELD,
  MEDIA_INTERNAL_VERSION_ALIASES,
  MEDIA_INTERNAL_VERSION_FIELD,
  isMediaTombstone,
  mediaRecordVersion,
  ownedBlobPathname,
  normalizeOwnedBlobUrl,
  parseMediaScanCursor,
  stripMediaInternals,
  verifyOwnedBlobRecord,
  BlobMetadataReadError,
  type BlobHead,
  type PostgresMediaRecord,
} from './lib/postgres-media.js';
import {
  KV_KEY_MEDIA_PREFIX,
  PRODUCT_GROUPS,
  ALLOWED_MIME_TYPES,
  createMediaAsset,
} from '../modules/media-schema.js';

// ---------------------------------------------------------------------------
// Path extraction

function extractId(event: FunctionEvent & { rawUrl?: string }): string | null {
  const queryId = String(event.queryStringParameters?.id || '').trim();
  if (queryId) return queryId;

  try {
    const url = (event.url || event.rawUrl || '').split('?')[0];
    const parts = url.replace(/^\/api\/communication-media\/?/, '').split('/');
    const id = parts[0]?.trim();
    return id || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// KV helpers

export type MediaKvStore = {
  eval: (...args: unknown[]) => Promise<unknown>;
  get: (...args: unknown[]) => Promise<unknown>;
  set: (...args: unknown[]) => Promise<unknown>;
  scan: (...args: unknown[]) => Promise<unknown>;
  del: (...args: unknown[]) => Promise<unknown>;
};

const MEDIA_LUA_VERSION_LOOKUP = MEDIA_INTERNAL_VERSION_ALIASES
  .map((alias, index) => index === 0
    ? `local version = decoded['${alias}']`
    : `if version == nil or version == cjson.null then version = decoded['${alias}'] end`)
  .join('\n');
const MEDIA_LUA_VERSION_IS_ABSENT = 'version == nil or version == cjson.null';
const MEDIA_LUA_DELETING_CHECK = MEDIA_INTERNAL_DELETING_ALIASES
  .map((alias) => `decoded['${alias}'] == true`)
  .join(' or ');

export const MEDIA_CAS_READ_SCRIPT = `
local value = redis.call('GET', KEYS[1])
if not value then
  return { '', '' }
end
local decodedOk, decoded = pcall(cjson.decode, value)
if not decodedOk or type(decoded) ~= 'table' then
  return 0
end
${MEDIA_LUA_VERSION_LOOKUP}
return { value, (${MEDIA_LUA_VERSION_IS_ABSENT}) and '' or tostring(version) }
`;

export const MEDIA_CAS_WRITE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decodedOk, decoded = pcall(cjson.decode, current)
if not decodedOk or type(decoded) ~= 'table' then return 0 end
local currentVersion = ''
${MEDIA_LUA_VERSION_LOOKUP}
if not (${MEDIA_LUA_VERSION_IS_ABSENT}) then currentVersion = tostring(version) end
if currentVersion ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

export const MEDIA_CAS_DELETE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local decodedOk, decoded = pcall(cjson.decode, current)
if not decodedOk or type(decoded) ~= 'table' then return 0 end
${MEDIA_LUA_VERSION_LOOKUP}
local currentVersion = (${MEDIA_LUA_VERSION_IS_ABSENT}) and '' or tostring(version)
if currentVersion ~= ARGV[1] then return 0 end
if not (${MEDIA_LUA_DELETING_CHECK}) then return 0 end
redis.call('DEL', KEYS[1])
return 1
`;

export const MEDIA_CREATE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  local created = redis.call('SET', KEYS[1], ARGV[1], 'NX')
  return created and 1 or 0
end
local id = ARGV[2]
if string.sub(id, -8) ~= ':version' then return 0 end
local decodedOk, decoded = pcall(cjson.decode, current)
local legacyVersion = nil
if decodedOk and type(decoded) == 'string' then
  legacyVersion = decoded
elseif not decodedOk and type(current) == 'string' then
  -- Previous Lua SET stored UUIDs as raw strings, not JSON strings.
  legacyVersion = current
end
if type(legacyVersion) ~= 'string' or not string.match(
  legacyVersion,
  '^%x%x%x%x%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$'
) then
  return 0
end
redis.call('SET', KEYS[1], ARGV[1])
return 1
`;

export interface MediaState {
  record: Record<string, unknown> | null;
  version: string;
}

function mediaKey(id: string): string {
  return `${KV_KEY_MEDIA_PREFIX}${id}`;
}

function parseStoredMediaRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function storedMediaRecord(asset: Record<string, unknown>): Record<string, unknown> {
  const version = mediaRecordVersion(asset);
  const deleting = isMediaTombstone(asset);
  const record = stripMediaInternals(asset) as Record<string, unknown>;
  if (typeof version !== 'string' || !version) {
    record[MEDIA_INTERNAL_VERSION_FIELD] = randomUUID();
  } else {
    record[MEDIA_INTERNAL_VERSION_FIELD] = version;
  }
  if (deleting) record[MEDIA_INTERNAL_DELETING_FIELD] = true;
  return record;
}

function newMediaRecord(asset: Record<string, unknown>): Record<string, unknown> {
  const record = storedMediaRecord(asset);
  record[MEDIA_INTERNAL_VERSION_FIELD] = randomUUID();
  return record;
}

function publicMediaRecord(record: Record<string, unknown>): Record<string, unknown> {
  return stripMediaInternals(record as PostgresMediaRecord) as Record<string, unknown>;
}

function storeFor(dependencies: CommunicationMediaDependencies = {}): MediaKvStore {
  return (dependencies.kvClient || kv) as unknown as MediaKvStore;
}

function kvFailure(operation: string, id: string, error: unknown): never {
  throw createHttpError(
    503,
    'Não foi possível acessar o catálogo de mídias. Tente novamente.',
    `[communication-media] KV ${operation} ${id} failed: ${error instanceof Error ? error.message : String(error)}`
  );
}

export async function readMediaState(
  id: string,
  store: MediaKvStore = kv as unknown as MediaKvStore
): Promise<MediaState> {
  try {
    const result = await store.eval(MEDIA_CAS_READ_SCRIPT, [mediaKey(id)], []);
    if (!Array.isArray(result)) throw new Error('Resposta CAS inválida.');
    const rawRecord = result[0];
    const record = parseStoredMediaRecord(rawRecord);
    if (rawRecord !== '' && rawRecord != null && !record) {
      throw new Error('Registro de mídia inválido.');
    }
    const version = mediaRecordVersion(record) ?? result[1] ?? '';
    return {
      record,
      version: version == null ? '' : String(version),
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('CAS read', id, error);
  }
}

export async function compareAndSetMedia(
  id: string,
  expectedVersion: string,
  asset: Record<string, unknown>,
  store: MediaKvStore = kv as unknown as MediaKvStore
): Promise<boolean> {
  try {
    const record = storedMediaRecord(asset);
    const serialized = JSON.stringify(record);
    const result = await store.eval(
      MEDIA_CAS_WRITE_SCRIPT,
      [mediaKey(id)],
      [String(expectedVersion || ''), serialized]
    );
    return Number(result) === 1;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('CAS write', id, error);
  }
}

export async function deleteMediaIfCurrent(
  id: string,
  expectedVersion: string,
  store: MediaKvStore = kv as unknown as MediaKvStore
): Promise<boolean> {
  try {
    const result = await store.eval(
      MEDIA_CAS_DELETE_SCRIPT,
      [mediaKey(id)],
      [String(expectedVersion || '')]
    );
    return Number(result) === 1;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('CAS delete', id, error);
  }
}

async function scanMediaKeys(store: MediaKvStore): Promise<string[]> {
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
    return [...keys].sort();
  } catch (error) {
    kvFailure('scan', 'media', error);
  }
}

async function readMediaByKey(
  key: string,
  store: MediaKvStore,
  skipInvalid = false
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await store.get(key);
    if (raw == null) return null;
    const record = parseStoredMediaRecord(raw);
    if (!record) {
      if (skipInvalid) return null;
      throw new Error('Registro de mídia inválido.');
    }
    return record;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('get', key, error);
  }
}

async function readAllMedia(store: MediaKvStore): Promise<Record<string, unknown>[]> {
  const keys = await scanMediaKeys(store);
  if (keys.length === 0) return [];
  const entries = await Promise.all(keys.map((key) => readMediaByKey(key, store, true)));
  return entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && !isMediaTombstone(entry))
    .map(publicMediaRecord);
}

async function readMedia(id: string, store: MediaKvStore): Promise<Record<string, unknown> | null> {
  return readMediaByKey(mediaKey(id), store);
}

async function createMediaIfAbsent(
  asset: Record<string, unknown>,
  store: MediaKvStore
): Promise<boolean> {
  const id = String(asset.id);
  try {
    const result = await store.eval(
      MEDIA_CREATE_SCRIPT,
      [mediaKey(id)],
      [JSON.stringify(storedMediaRecord(asset)), id]
    );
    return Number(result) === 1;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('create', id, error);
  }
}

async function writeMedia(asset: Record<string, unknown>, store: MediaKvStore): Promise<void> {
  if (!(await createMediaIfAbsent(asset, store))) {
    throw createHttpError(
      409,
      'Já existe uma mídia com este ID.',
      `[communication-media] KV SET NX conflict ${String(asset.id)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers

const jsonResponse: JsonResponseFn = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

function requestOrigin(event: FunctionEvent): string {
  const host = String(event.headers?.host || 'localhost');
  const proto = String(
    event.headers?.['x-forwarded-proto'] || (host.startsWith('localhost') ? 'http' : 'https')
  )
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

function validateBlobUrl(value: unknown, productGroup: string, origin: string): string {
  try {
    const canonical = normalizeOwnedBlobUrl(value, origin);
    const pathname = ownedBlobPathname(canonical, origin);
    if (pathname.split('/')[1] !== productGroup) {
      throw createHttpError(400, 'URL do blob não pertence ao grupo de produto informado.');
    }
    return canonical;
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    throw createHttpError(400, 'URL do blob inválida.');
  }
}

export type CommunicationMediaDependencies = {
  headBlob?: BlobHead;
  blobDelete?: (url: string) => Promise<unknown>;
  blobToken?: string;
  blobStoreId?: string;
  kvClient?: MediaKvStore;
  readMedia?: (id: string) => Promise<Record<string, unknown> | null>;
  readMediaState?: (id: string) => Promise<MediaState>;
  compareAndSetMedia?: (
    id: string,
    expectedVersion: string,
    asset: Record<string, unknown>
  ) => Promise<boolean>;
  deleteMediaIfCurrent?: (id: string, expectedVersion: string) => Promise<boolean>;
  writeMedia?: (asset: Record<string, unknown>) => Promise<void>;
};

const ACTIVE_TYPE_ERROR = 'O campo active deve ser booleano.';
const MEDIA_CONFLICT_ERROR =
  'A mídia foi alterada por outra solicitação. Recarregue e tente novamente.';
const MEDIA_DELETING_ERROR = 'A mídia está sendo removida. Tente novamente.';
const MEDIA_BLOB_DELETE_ERROR = 'Não foi possível remover o Blob da mídia. Tente novamente.';
const MEDIA_DELETE_ERROR = 'Não foi possível finalizar a remoção da mídia. Tente novamente.';

function validateActiveField(payload: Record<string, unknown>): FunctionResult | null {
  if (
    Object.prototype.hasOwnProperty.call(payload, 'active') &&
    typeof payload.active !== 'boolean'
  ) {
    return jsonResponse(400, { error: ACTIVE_TYPE_ERROR });
  }
  return null;
}

function declaredSize(payload: Record<string, unknown>): number {
  const value = Number(payload.size_bytes ?? payload.sizeBytes ?? payload.size);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function declaredMime(payload: Record<string, unknown>): string {
  return String(payload.content_type ?? payload.contentType ?? payload.mimeType ?? '')
    .trim()
    .toLowerCase();
}

function maxSizeForMime(mimeType: string): number {
  return mimeType === 'video/mp4' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

export async function verifyBlobMetadata(
  payload: Record<string, unknown>,
  productGroup: string,
  origin: string,
  headFn: BlobHead = blobHead,
  blobOptions: {
    blobToken?: string;
    blobStoreId?: string;
    allowInactive?: boolean;
  } = {}
): Promise<{ blobUrl: string; pathname: string; contentType: string; sizeBytes: number }> {
  const blobUrl = validateBlobUrl(
    payload.blob_url || payload.blobUrl || payload.url,
    productGroup,
    origin
  );
  const pathname = String(payload.pathname || '').trim();
  if (!pathname || ownedBlobPathname(blobUrl, origin) !== pathname.replace(/^\/+/, '')) {
    throw createHttpError(400, 'O caminho do Blob não corresponde ao upload.');
  }
  const contentType = declaredMime(payload);
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw createHttpError(400, 'Tipo MIME de mídia inválido.');
  }
  const sizeBytes = declaredSize(payload);
  if (!sizeBytes || sizeBytes > maxSizeForMime(contentType)) {
    throw createHttpError(400, 'Tamanho de mídia inválido.');
  }
  if (!blobOptions.allowInactive && payload.active !== undefined && payload.active !== true) {
    throw createHttpError(400, 'A mídia deve ser criada como ativa.');
  }
  const kind = String(payload.kind || (contentType === 'video/mp4' ? 'video' : 'image'));
  if (
    (contentType === 'video/mp4' && kind !== 'video') ||
    (contentType !== 'video/mp4' && kind !== 'image')
  ) {
    throw createHttpError(400, 'O tipo da mídia não corresponde ao MIME informado.');
  }

  try {
    await verifyOwnedBlobRecord(
      {
        ...payload,
        blob_url: blobUrl,
        pathname,
        product_group: productGroup,
        content_type: contentType,
        size_bytes: sizeBytes,
        kind,
        active: true,
      },
      origin,
      {
        headFn,
        token: blobOptions.blobToken,
        storeId: blobOptions.blobStoreId,
        expectedProductGroup: productGroup,
      }
    );
  } catch (error) {
    if (error instanceof BlobMetadataReadError) {
      throw createHttpError(400, 'Blob não encontrado ou indisponível.');
    }
    throw error;
  }
  return { blobUrl, pathname: pathname.replace(/^\/+/, ''), contentType, sizeBytes };
}

function filterItems(items: Record<string, unknown>[], query: Record<string, string> = {}) {
  let filtered = items.filter((item) => !isMediaTombstone(item));
  if (query.product_group) {
    const group = String(query.product_group).trim().toLowerCase();
    filtered = filtered.filter((m) => m.product_group === group);
  }
  if (query.active !== undefined && query.active !== '') {
    const active = query.active === '1' || query.active === 'true';
    filtered = filtered.filter((m) => m.active === active);
  }
  if (query.kind && ALLOWED_MIME_TYPES.find((t) => t.startsWith(query.kind))) {
    filtered = filtered.filter((m) => m.kind === query.kind);
  }
  if (query.product_code) {
    const code = String(query.product_code).trim().toUpperCase();
    filtered = filtered.filter((m) => m.product_code === code);
  }
  return filtered;
}

function errorLog(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorResult(error: unknown, fallback: string, fallbackStatus = 503): FunctionResult {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const known = Number.isInteger(details.statusCode);
  return jsonResponse(known ? Number(details.statusCode) : fallbackStatus, {
    error: known && typeof details.message === 'string' ? details.message : fallback,
  });
}

async function readStateForMutation(
  id: string,
  dependencies: CommunicationMediaDependencies
): Promise<MediaState | null> {
  if (dependencies.readMediaState) return dependencies.readMediaState(id);
  if (dependencies.readMedia) return null;
  return readMediaState(id, storeFor(dependencies));
}

async function readFallbackMedia(
  id: string,
  dependencies: CommunicationMediaDependencies,
  store: MediaKvStore
): Promise<Record<string, unknown> | null> {
  try {
    return dependencies.readMedia ? dependencies.readMedia(id) : readMedia(id, store);
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error;
    kvFailure('get', id, error);
  }
}

function expectedRecordVersion(state: MediaState | null, record: Record<string, unknown>): string {
  return String(state?.version || mediaRecordVersion(record) || '');
}

// ---------------------------------------------------------------------------
// Handler

export async function handler(
  event: FunctionEvent,
  dependencies: CommunicationMediaDependencies = {}
): Promise<FunctionResult> {
  const method = event.httpMethod || 'GET';
  const id = extractId(event);
  const origin = requestOrigin(event);
  const store = storeFor(dependencies);

  if (method === 'GET' && !id) {
    try {
      let items = await readAllMedia(store);
      const q = (event.queryStringParameters || {}) as Record<string, string>;
      items = filterItems(items, q);
      items.sort(
        (a, b) =>
          Number(a.sort_order) - Number(b.sort_order) ||
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
      );
      return jsonResponse(200, { success: true, items });
    } catch (error) {
      console.error('[communication-media]', errorLog(error));
      return errorResult(error, 'Não foi possível listar as mídias. Tente novamente.');
    }
  }

  if (method === 'GET' && id) {
    try {
      const media = dependencies.readMedia
        ? await dependencies.readMedia(id)
        : await readMedia(id, store);
      if (!media || isMediaTombstone(media))
        return jsonResponse(404, { error: 'Mídia não encontrada.' });
      return jsonResponse(200, { success: true, item: publicMediaRecord(media) });
    } catch (error) {
      console.error('[communication-media]', errorLog(error));
      return errorResult(error, 'Não foi possível buscar a mídia. Tente novamente.');
    }
  }

  if (method === 'POST') {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(400, { error: 'Corpo da mídia inválido.' });
    }
    const activeError = validateActiveField(payload);
    if (activeError) return activeError;

    const errors: string[] = [];
    if (!payload.title || !String(payload.title).trim()) errors.push('Título é obrigatório.');
    if (
      !payload.product_group ||
      !PRODUCT_GROUPS.includes(String(payload.product_group).trim().toLowerCase())
    ) {
      errors.push(`Grupo de produto inválido. Use: ${PRODUCT_GROUPS.join(', ')}.`);
    }
    if (!payload.blob_url && !payload.blobUrl && !payload.url)
      errors.push('URL do blob é obrigatória.');
    if (errors.length > 0) return jsonResponse(400, { error: errors.join(' ') });

    try {
      const productGroup = String(payload.product_group).trim().toLowerCase();
      const metadata = await verifyBlobMetadata(
        payload,
        productGroup,
        origin,
        dependencies.headBlob,
        {
          blobToken: dependencies.blobToken,
          blobStoreId: dependencies.blobStoreId,
        }
      );
      payload.blob_url = metadata.blobUrl;
      payload.pathname = metadata.pathname;
      payload.content_type = metadata.contentType;
      payload.size_bytes = metadata.sizeBytes;
      const asset = newMediaRecord(createMediaAsset(payload));
      const writer =
        dependencies.writeMedia || ((value: Record<string, unknown>) => writeMedia(value, store));
      await writer(asset);
      return jsonResponse(201, { success: true, item: publicMediaRecord(asset) });
    } catch (error) {
      console.error('[communication-media]', errorLog(error));
      return errorResult(error, 'Não foi possível criar a mídia. Tente novamente.');
    }
  }

  if (method === 'PUT' && id) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(event.body || '{}');
    } catch {
      return jsonResponse(400, { error: 'JSON inválido.' });
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return jsonResponse(400, { error: 'Corpo da mídia inválido.' });
    }
    const activeError = validateActiveField(payload);
    if (activeError) return activeError;

    try {
      const state = await readStateForMutation(id, dependencies);
      const existing = state ? state.record : await readFallbackMedia(id, dependencies, store);
      if (!existing) return jsonResponse(404, { error: 'Mídia não encontrada.' });
      if (isMediaTombstone(existing)) throw createHttpError(409, MEDIA_DELETING_ERROR);

      const updatableFields = [
        'title',
        'description',
        'product_group',
        'product_code',
        'kind',
        'caption',
        'active',
        'sort_order',
        'blob_url',
        'pathname',
        'content_type',
        'size_bytes',
      ];
      const existingRecord = existing as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...existingRecord };
      for (const field of updatableFields) {
        if (payload[field] !== undefined) merged[field] = payload[field];
      }
      merged.updated_at = new Date().toISOString();

      const productGroup = String(merged.product_group || '')
        .trim()
        .toLowerCase();
      const blobMetadataFields = [
        'product_group',
        'kind',
        'blob_url',
        'blobUrl',
        'pathname',
        'content_type',
        'contentType',
        'size_bytes',
        'sizeBytes',
      ];
      const blobMetadataChanged = blobMetadataFields.some(
        (field) => payload[field] !== undefined && payload[field] !== existingRecord[field]
      );
      const requiresBlobHead = merged.active === true || blobMetadataChanged;
      if (requiresBlobHead) {
        const metadata = await verifyBlobMetadata(
          merged,
          productGroup,
          origin,
          dependencies.headBlob,
          {
            blobToken: dependencies.blobToken,
            blobStoreId: dependencies.blobStoreId,
            allowInactive: merged.active !== true,
          }
        );
        merged.blob_url = metadata.blobUrl;
        merged.pathname = metadata.pathname;
        merged.content_type = metadata.contentType;
        merged.size_bytes = metadata.sizeBytes;
      }
      const asset = newMediaRecord(createMediaAsset(merged));
      const expectedVersion = expectedRecordVersion(state, existingRecord);
      const compareAndSet =
        dependencies.compareAndSetMedia ||
        ((recordId: string, version: string, value: Record<string, unknown>) =>
          compareAndSetMedia(recordId, version, value, store));
      if (!(await compareAndSet(id, expectedVersion, asset)))
        throw createHttpError(409, MEDIA_CONFLICT_ERROR);
      return jsonResponse(200, { success: true, item: publicMediaRecord(asset) });
    } catch (error) {
      console.error('[communication-media]', errorLog(error));
      return errorResult(error, 'Não foi possível atualizar a mídia. Tente novamente.');
    }
  }

  if (method === 'PUT' && !id)
    return jsonResponse(400, { error: 'ID da mídia é obrigatório para atualização.' });

  if (method === 'DELETE' && id) {
    try {
      const state = await readStateForMutation(id, dependencies);
      const existing = state ? state.record : await readFallbackMedia(id, dependencies, store);
      if (!existing) return jsonResponse(404, { error: 'Mídia não encontrada.' });

      let tombstone: Record<string, unknown>;
      let tombstoneVersion: string;
      if (isMediaTombstone(existing)) {
        tombstone = { ...existing };
        tombstoneVersion = expectedRecordVersion(state, tombstone);
      } else {
        const expectedVersion = expectedRecordVersion(state, existing);
        tombstone = newMediaRecord({
          ...existing,
          active: false,
          [MEDIA_INTERNAL_DELETING_FIELD]: true,
          updated_at: new Date().toISOString(),
        });
        const compareAndSet =
          dependencies.compareAndSetMedia ||
          ((recordId: string, version: string, value: Record<string, unknown>) =>
            compareAndSetMedia(recordId, version, value, store));
        if (!(await compareAndSet(id, expectedVersion, tombstone))) {
          throw createHttpError(409, MEDIA_CONFLICT_ERROR);
        }
        tombstoneVersion = String(tombstone[MEDIA_INTERNAL_VERSION_FIELD]);
      }

      if (tombstone.blob_url) {
        let blobUrl: string;
        try {
          blobUrl = validateBlobUrl(
            tombstone.blob_url,
            String(tombstone.product_group || '')
              .trim()
              .toLowerCase(),
            origin
          );
        } catch (error) {
          console.warn(
            `[communication-media] Blob URL validation failed for ${id}:`,
            error instanceof Error ? error.message : String(error)
          );
          throw error;
        }
        try {
          await (dependencies.blobDelete || blobDelete)(blobUrl);
        } catch (error) {
          console.warn(
            `[communication-media] Blob delete failed for ${id}:`,
            error instanceof Error ? error.message : String(error)
          );
          throw createHttpError(
            503,
            MEDIA_BLOB_DELETE_ERROR,
            `[communication-media] Blob delete ${id} failed`
          );
        }
      }

      const deleteCurrent =
        dependencies.deleteMediaIfCurrent ||
        ((recordId: string, version: string) => deleteMediaIfCurrent(recordId, version, store));
      if (!(await deleteCurrent(id, tombstoneVersion))) {
        throw createHttpError(409, MEDIA_DELETE_ERROR);
      }
      return jsonResponse(200, { success: true, deleted: id });
    } catch (error) {
      console.error('[communication-media]', errorLog(error));
      return errorResult(error, MEDIA_DELETE_ERROR);
    }
  }

  return jsonResponse(405, { error: 'Método não permitido.' });
}
