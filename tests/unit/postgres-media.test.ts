import assert from 'node:assert/strict';
import test from 'node:test';

import {
  downloadApprovedMedia,
  MAX_IMAGE_BYTES,
  normalizeOwnedBlobUrl,
  isMediaTombstone,
  mediaRecordVersion,
  parseMediaScanCursor,
  readCommunicationMediaRecords,
  stripMediaInternals,
  verifyOwnedBlobRecord,
} from '../../api/_modules/postgres-media.js';
import {
  compareAndSetMedia,
  deleteMediaIfCurrent,
  handler as communicationMedia,
  readMediaState,
  MEDIA_CAS_DELETE_SCRIPT,
  MEDIA_CAS_READ_SCRIPT,
  MEDIA_CAS_WRITE_SCRIPT,
  MEDIA_CREATE_SCRIPT,
  verifyBlobMetadata,
} from '../../api/_modules/communication-media.js';

const origin = 'https://app.test';
const blobUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg';
const pathname = 'aspen-media/canga/reference.jpg';
const records = [{
  id: 'media-1',
  blob_url: blobUrl,
  pathname,
  active: true,
  content_type: 'image/jpeg',
  size_bytes: 11,
}];

function responseEvent(
  body: Record<string, unknown>,
  method = 'POST',
  id = 'media-1',
) {
  return {
    httpMethod: method,
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: { id },
    body: JSON.stringify(body),
  } as any;
}

function headResult(overrides: Record<string, unknown> = {}) {
  return {
    url: blobUrl,
    pathname,
    contentType: 'image/jpeg',
    size: 11,
    ...overrides,
  } as any;
}

function fetchResponse(body = 'image-bytes', headers: Record<string, string> = {
  'Content-Type': 'image/jpeg',
  'Content-Length': '11',
}) {
  return new Response(body, { status: 200, headers });
}

const headBlob = async () => headResult();

const uuid = '11111111-1111-4111-8111-111111111111';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_KEYS = new Set(['_recordVersion', 'recordVersion', 'version', '_deleting', 'deleting']);

function assertNoMediaInternals(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertNoMediaInternals(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(INTERNAL_KEYS.has(key), false, `exposed internal key ${key}`);
    assertNoMediaInternals(child);
  }
}

function decodeCjson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

test('media internals recognize every alias and strip recursively', () => {
  const value = {
    id: 'media-internal',
    _recordVersion: 'canonical',
    recordVersion: 'legacy-record',
    version: 'legacy-version',
    _deleting: false,
    deleting: false,
    nested: [{
      _recordVersion: 'nested-version',
      recordVersion: 'nested-record-version',
      version: 'nested-public-version',
      _deleting: true,
      deleting: true,
    }],
  };
  assert.equal(mediaRecordVersion(value), 'canonical');
  assert.equal(mediaRecordVersion({ recordVersion: 'legacy-record' }), 'legacy-record');
  assert.equal(mediaRecordVersion({ version: 'legacy-version' }), 'legacy-version');
  assert.equal(isMediaTombstone({ _deleting: true }), true);
  assert.equal(isMediaTombstone({ deleting: true }), true);
  const stripped = stripMediaInternals(value);
  assert.deepEqual(stripped, { id: 'media-internal', nested: [{}] });
  assert.equal(JSON.stringify(stripped).match(/_recordVersion|recordVersion|version|_deleting|deleting/g), null);
});

test('media scan cursor parser is strict and preserves large strings', () => {
  assert.equal(parseMediaScanCursor(0), 0);
  assert.equal(parseMediaScanCursor(12), 12);
  assert.equal(parseMediaScanCursor('000'), 0);
  assert.equal(parseMediaScanCursor('00012'), '12');
  const large = '900719925474099312345678901234567890';
  assert.equal(parseMediaScanCursor(large), large);
  for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, -1, 1.5, null, true, {}, [], '', '1.2', '-1', 'abc'] as unknown[]) {
    assert.throws(() => parseMediaScanCursor(invalid), /Cursor de catálogo inválido/);
  }
});

function fakeMediaStore(initial: Record<string, unknown>[] = []) {
  const values = new Map<string, string>();
  for (const record of initial) {
    values.set(`aspen:communication:media-assets:${String(record.id)}`, JSON.stringify(record));
  }
  return {
    values,
    calls: [] as Array<{ script: string; keys: string[]; args: unknown[] }>,
    async eval(script: string, keys: string[], args: unknown[]) {
      this.calls.push({ script, keys, args });
      const key = keys[0];
      const raw = this.values.get(key);
      if (script === MEDIA_CAS_READ_SCRIPT) {
        if (raw == null) return ['', ''];
        const current = decodeCjson(raw);
        if (!current || typeof current !== 'object' || Array.isArray(current)) return 0;
        const value = current as Record<string, unknown>;
        return [raw, String(value._recordVersion ?? value.recordVersion ?? value.version ?? '')];
      }
      if (script === MEDIA_CAS_WRITE_SCRIPT) {
        if (raw == null) return 0;
        const current = decodeCjson(raw);
        if (!current || typeof current !== 'object' || Array.isArray(current)) return 0;
        const value = current as Record<string, unknown>;
        const currentVersion = value._recordVersion ?? value.recordVersion ?? value.version ?? '';
        if (String(currentVersion) !== String(args[0])) return 0;
        this.values.set(key, String(args[1]));
        return 1;
      }
      if (script === MEDIA_CAS_DELETE_SCRIPT) {
        if (raw == null) return 0;
        const current = decodeCjson(raw);
        if (!current || typeof current !== 'object' || Array.isArray(current)) return 0;
        const value = current as Record<string, unknown>;
        const currentVersion = value._recordVersion ?? value.recordVersion ?? value.version ?? '';
        if (String(currentVersion) !== String(args[0])) return 0;
        if (value._deleting !== true && value.deleting !== true) return 0;
        this.values.delete(key);
        return 1;
      }
      assert.equal(script, MEDIA_CREATE_SCRIPT);
      if (raw == null) {
        this.values.set(key, String(args[0]));
        return 1;
      }
      const id = String(args[1]);
      if (!id.endsWith(':version')) return 0;
      const decoded = decodeCjson(raw);
      const legacyVersion = typeof decoded === 'string' ? decoded : decoded === undefined ? raw : null;
      if (typeof legacyVersion !== 'string' || !UUID_PATTERN.test(legacyVersion)) return 0;
      this.values.set(key, String(args[0]));
      return 1;
    },
    async get(key: string) {
      return this.values.get(key) || null;
    },
    async set(key: string, value: unknown, options?: Record<string, unknown>) {
      if (options?.nx && this.values.has(key)) return null;
      this.values.set(key, String(value));
      return 'OK';
    },
    async scan(_cursor: string | number) {
      return [0, [...this.values.keys()]];
    },
    async del(key: string) {
      return this.values.delete(key);
    },
  };
}

test('API media list and get redact every internal alias recursively', async () => {
  const injected = {
    ...records[0],
    _recordVersion: 'canonical',
    recordVersion: 'record-version',
    version: 'public-version',
    _deleting: false,
    deleting: false,
    nested: [{
      _recordVersion: 'nested-canonical',
      recordVersion: 'nested-record-version',
      version: 'nested-version',
      _deleting: true,
      deleting: true,
    }],
  };
  const single = await communicationMedia(responseEvent({}, 'GET', 'media-1'), {
    readMedia: async () => injected,
  });
  assert.equal(single.statusCode, 200);
  assertNoMediaInternals(JSON.parse(single.body || '{}'));

  const store = fakeMediaStore([injected]);
  const listed = await communicationMedia(
    { httpMethod: 'GET', headers: { host: 'app.test' }, queryStringParameters: {} } as any,
    { kvClient: store as any },
  );
  assert.equal(listed.statusCode, 200);
  assertNoMediaInternals(JSON.parse(listed.body || '{}'));
});

test('metadata requires canonical owned pathname and matching Blob HEAD metadata', async () => {
  const payload = {
    title: 'Referência',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    content_type: 'image/jpeg',
    size_bytes: 11,
  };
  const verified = await verifyBlobMetadata(payload, 'canga', origin, async () => headResult());
  assert.deepEqual(verified, {
    blobUrl,
    pathname,
    contentType: 'image/jpeg',
    sizeBytes: 11,
  });

  await assert.rejects(
    verifyBlobMetadata({ ...payload, blob_url: 'http://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg' }, 'canga', origin, async () => headResult()),
    /URL do blob inválida|Mídia Blob inválida/,
  );
  await assert.rejects(
    verifyBlobMetadata({ ...payload, pathname: 'foreign/canga/reference.jpg' }, 'canga', origin, async () => headResult()),
    /caminho do Blob/i,
  );
  await assert.rejects(
    verifyBlobMetadata({ ...payload, size_bytes: 12 }, 'canga', origin, async () => headResult()),
    /metadados do Blob/i,
  );
  await assert.rejects(
    verifyBlobMetadata({ ...payload, content_type: 'image/png' }, 'canga', origin, async () => headResult()),
    /metadados do Blob/i,
  );
});

test('owned record HEAD is authenticated, store-scoped, and exact', async () => {
  let options: Record<string, unknown> | undefined;
  const verified = await verifyOwnedBlobRecord(
    { ...records[0], product_group: 'canga' },
    origin,
    {
      token: 'vercel_blob_rw_store_token',
      storeId: 'store',
      headFn: async (_url, headOptions) => {
        options = headOptions as Record<string, unknown>;
        return headResult();
      },
    },
  );
  assert.equal(verified.url, blobUrl);
  assert.equal(options?.token, 'vercel_blob_rw_store_token');
  assert.equal(options?.storeId, 'store');
  assert.ok(options?.abortSignal instanceof AbortSignal);

  await assert.rejects(
    verifyOwnedBlobRecord(
      { ...records[0], product_group: 'canga' },
      origin,
      { headFn: async () => headResult({ size: 12 }) },
    ),
    /metadados do Blob/i,
  );
});

test('Blob config is used unless explicit verification options override it', async () => {
  const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
  const previousStoreId = process.env.BLOB_STORE_ID;
  const previousOidcToken = process.env.VERCEL_OIDC_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_store_token';
  process.env.BLOB_STORE_ID = 'store';
  process.env.VERCEL_OIDC_TOKEN = 'vercel-oidc-token';
  try {
    let configuredOptions: Record<string, unknown> | undefined;
    await verifyOwnedBlobRecord(
      { ...records[0], product_group: 'canga' },
      origin,
      {
        headFn: async (_url, headOptions) => {
          configuredOptions = headOptions as Record<string, unknown>;
          return headResult();
        },
      },
    );
    assert.equal(configuredOptions?.token, 'vercel_blob_rw_store_token');
    assert.equal(configuredOptions?.storeId, 'store');
    assert.equal(configuredOptions?.oidcToken, 'vercel-oidc-token');

    const explicitUrl = 'https://explicit.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg';
    const explicitOptions = {
      token: 'vercel_blob_rw_explicit_token',
      storeId: 'explicit',
      headFn: async (_url: string, headOptions: unknown) => {
        configuredOptions = headOptions as Record<string, unknown>;
        return {
          ...headResult(),
          url: explicitUrl,
          pathname,
        };
      },
    };
    await verifyOwnedBlobRecord(
      { ...records[0], blob_url: explicitUrl, product_group: 'canga' },
      origin,
      explicitOptions,
    );
    assert.equal(configuredOptions?.token, 'vercel_blob_rw_explicit_token');
    assert.equal(configuredOptions?.storeId, 'explicit');
  } finally {
    if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
    if (previousStoreId === undefined) delete process.env.BLOB_STORE_ID;
    else process.env.BLOB_STORE_ID = previousStoreId;
    if (previousOidcToken === undefined) delete process.env.VERCEL_OIDC_TOKEN;
    else process.env.VERCEL_OIDC_TOKEN = previousOidcToken;
  }
});

test('foreign-store media records fail authenticated ownership validation', async () => {
  await assert.rejects(
    verifyOwnedBlobRecord(
      { ...records[0], product_group: 'canga' },
      origin,
      {
        storeId: 'current-store',
        headFn: async () => headResult({ url: blobUrl }),
      },
    ),
    /store configurado/i,
  );
  await assert.rejects(
    verifyOwnedBlobRecord(
      { ...records[0], product_group: 'canga' },
      origin,
      { headFn: async () => { throw new Error('BlobAccessError'); } },
    ),
    /validar a mídia Blob/i,
  );
});

test('metadata creation preserves upload callback path and rejects nonexistent Blob', async () => {
  let writes = 0;
  const payload = {
    title: 'Referência',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    content_type: 'image/jpeg',
    size_bytes: 11,
  };
  const response = await communicationMedia(responseEvent(payload), {
    headBlob: async () => headResult(),
    writeMedia: async () => { writes += 1; },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(writes, 1);

  const missing = await communicationMedia(responseEvent(payload), {
    headBlob: async () => { throw new Error('not found'); },
    writeMedia: async () => { writes += 1; },
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(writes, 1);
});

test('media PUT archives without Blob HEAD but validates reactivation and metadata changes', async () => {
  const existing = {
    id: 'media-1',
    title: 'Referência',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    active: true,
    content_type: 'image/jpeg',
    size_bytes: 11,
    kind: 'image',
  };
  let writes = 0;
  let heads = 0;
  let saved: Record<string, unknown> | undefined;
  const readMedia = async () => existing;
  const compareAndSetMediaForTest = async (
    _id: string,
    _expectedVersion: string,
    asset: Record<string, unknown>,
  ) => {
    writes += 1;
    saved = asset;
    return true;
  };

  const archived = await communicationMedia(responseEvent({ active: false }, 'PUT'), {
    readMedia,
    compareAndSetMedia: compareAndSetMediaForTest,
    headBlob: async () => {
      heads += 1;
      throw new Error('Blob should not be read while archiving');
    },
  });
  assert.equal(archived.statusCode, 200);
  assert.equal(saved?.active, false);
  assert.equal(heads, 0);
  assert.equal(writes, 1);

  const reactivated = await communicationMedia(responseEvent({ active: true }, 'PUT'), {
    readMedia: async () => ({ ...existing, active: false }),
    compareAndSetMedia: compareAndSetMediaForTest,
    headBlob: async () => {
      heads += 1;
      return headResult();
    },
  });
  assert.equal(reactivated.statusCode, 200);
  assert.equal(heads, 1);

  const changedWhileArchived = await communicationMedia(responseEvent({ active: false, size_bytes: 12 }, 'PUT'), {
    readMedia: async () => ({ ...existing, active: false }),
    compareAndSetMedia: compareAndSetMediaForTest,
    headBlob: async () => {
      heads += 1;
      return headResult();
    },
  });
  assert.equal(changedWhileArchived.statusCode, 400);
  assert.equal(heads, 2);
});

test('bounded downloader rejects HTTP, foreign, inactive, null-status, credentialed and custom-port URLs', async () => {
  const unsafe = [
    'http://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg',
    'https://evil.test/aspen-media/canga/reference.jpg',
    'https://user:pass@store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg',
    'https://store.public.blob.vercel-storage.com:444/aspen-media/canga/reference.jpg',
  ];
  for (const url of unsafe) {
    await assert.rejects(
      downloadApprovedMedia({ url, origin, stepType: 'image', records, headFn: headBlob, fetchImpl: async () => fetchResponse() }),
      /HTTPS|Mídia|não autorizada|inválida/,
    );
  }
  for (const active of [false, null, undefined]) {
    await assert.rejects(
      downloadApprovedMedia({
        url: blobUrl,
        origin,
        stepType: 'image',
        records: [{ ...records[0], active }],
        headFn: headBlob,
        fetchImpl: async () => fetchResponse(),
      }),
      /Mídia pública não autorizada/,
    );
  }
});

test('bounded downloader rejects redirects, unknown or mismatched MIME, and timeout', async () => {
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async () => new Response(null, { status: 302, headers: { location: blobUrl } }),
    }),
    /Redirecionamentos/,
  );
  for (const contentType of ['application/octet-stream', 'image/png']) {
    await assert.rejects(
      downloadApprovedMedia({
        url: blobUrl,
        origin,
        stepType: 'image',
        records,
        headFn: headBlob,
        fetchImpl: async () => fetchResponse('image-bytes', { 'Content-Type': contentType, 'Content-Length': '11' }),
      }),
      /tipo retornado|corresponde ao cadastro/,
    );
  }
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      timeoutMs: 5,
      fetchImpl: ((_, init): Promise<Response> => new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch,
    }),
    /demorou demais/,
  );
});

test('bounded downloader rejects zero and mismatched exact Content-Length', async () => {
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async () => fetchResponse('image-bytes', {
        'Content-Type': 'image/jpeg',
        'Content-Length': '0',
      }),
    }),
    /tamanho real|retornado pela mídia|cadastro/,
  );
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async () => fetchResponse('image-bytes', {
        'Content-Type': 'image/jpeg',
        'Content-Length': '10',
      }),
    }),
    /tamanho retornado|tamanho real/,
  );
});

test('bounded downloader aborts and cancels body after response validation failure', async () => {
  let cancelled = 0;
  let signal: AbortSignal | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled += 1;
    },
  });
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async (_url, init) => {
        signal = init?.signal;
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/octet-stream' },
        });
      },
    }),
    /tipo retornado/,
  );
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, 1);
});

test('bounded downloader body timeout interrupts reader and cancels stream', async () => {
  let cancelled = 0;
  const pendingReader = {
    read: () => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}),
    cancel: async () => { cancelled += 1; },
  };
  const body = {
    getReader: () => pendingReader,
  };
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      timeoutMs: 5,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        url: '',
        headers: new Headers({ 'Content-Type': 'image/jpeg' }),
        body,
      } as unknown as Response),
    }),
    /demorou demais/,
  );
  assert.equal(cancelled, 1);
});

test('bounded downloader rejects Content-Length and streamed byte caps before transport', async () => {
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records: [{ ...records[0], size_bytes: MAX_IMAGE_BYTES + 1 }],
      headFn: headBlob,
      fetchImpl: async () => fetchResponse('', {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(MAX_IMAGE_BYTES + 1),
      }),
    }),
    /excede o limite|tamanho da mídia cadastrada|Tamanho de mídia inválido/,
  );

  const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(oversized);
          controller.close();
        },
      }), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }),
    }),
    /excede o limite/,
  );
});

test('bounded downloader returns only bounded base64 for an exact active record', async () => {
  const result = await downloadApprovedMedia({
    url: blobUrl,
    origin,
    stepType: 'image',
    records,
    headFn: headBlob,
    fetchImpl: async () => fetchResponse(),
  });
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.sizeBytes, 11);
  assert.equal(result.base64, Buffer.from('image-bytes').toString('base64'));
  assert.equal(normalizeOwnedBlobUrl(blobUrl, origin), blobUrl);
});

test('create and PUT reject every nonboolean active value before Blob validation', async () => {
  const validPayload = {
    title: 'Referência',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    content_type: 'image/jpeg',
    size_bytes: 11,
    kind: 'image',
  };
  let heads = 0;
  const invalidValues = [null, 'true', 1, {}, []];
  for (const active of invalidValues) {
    const created = await communicationMedia(responseEvent({ ...validPayload, active }), {
      headBlob: async () => {
        heads += 1;
        return headResult();
      },
      writeMedia: async () => {},
    });
    assert.equal(created.statusCode, 400);
    assert.match(created.body || '', /active.*booleano/i);

    const updated = await communicationMedia(responseEvent({ active }, 'PUT'), {
      readMedia: async () => ({ ...records[0], kind: 'image' }),
      headBlob: async () => {
        heads += 1;
        return headResult();
      },
      writeMedia: async () => {},
    });
    assert.equal(updated.statusCode, 400);
    assert.match(updated.body || '', /active.*booleano/i);
  }
  assert.equal(heads, 0);

  const inactiveCreate = await communicationMedia(responseEvent({ ...validPayload, active: false }), {
    headBlob: async () => {
      heads += 1;
      return headResult();
    },
    writeMedia: async () => {},
  });
  assert.equal(inactiveCreate.statusCode, 400);
  assert.match(inactiveCreate.body || '', /criada como ativa/i);
  assert.equal(heads, 0);
});

test('inline CAS serializes one legacy update and rejects the stale archive race', async () => {
  const id = 'media-cas';
  const key = `aspen:communication:media-assets:${id}`;
  const fake = {
    records: new Map<string, string>(),
    calls: [] as Array<{ script: string; keys: string[]; args: unknown[] }>,
    async eval(script: string, keys: string[], args: unknown[]) {
      this.calls.push({ script, keys, args });
      assert.deepEqual(keys, [key]);
      const raw = this.records.get(key) || '';
      const current = raw ? JSON.parse(raw) : null;
      const currentVersion = String(current?._recordVersion || '');
      if (script === MEDIA_CAS_READ_SCRIPT) return [raw, currentVersion];
      assert.equal(script, MEDIA_CAS_WRITE_SCRIPT);
      if (currentVersion !== String(args[0])) return 0;
      this.records.set(key, String(args[1]));
      return 1;
    },
  };
  fake.records.set(key, JSON.stringify({
    ...records[0],
    id,
    title: 'Inicial',
    product_group: 'canga',
    kind: 'image',
  }));

  let releaseHead: (() => void) | undefined;
  let headStarted!: () => void;
  const headReady = new Promise<void>((resolve) => {
    headStarted = resolve;
  });
  const headForTitle = async () => new Promise((resolve) => {
    headStarted();
    releaseHead = () => resolve(headResult());
  });
  const titleUpdate = communicationMedia(responseEvent({ title: 'Título atrasado' }, 'PUT', id), {
    kvClient: fake as any,
    headBlob: headForTitle as any,
  });
  await headReady;
  const archive = await communicationMedia(responseEvent({ active: false }, 'PUT', id), {
    kvClient: fake as any,
    headBlob: async () => headResult(),
  });
  assert.equal(archive.statusCode, 200);
  releaseHead?.();
  const staleTitle = await titleUpdate;
  assert.equal(staleTitle.statusCode, 409);
  assert.match(staleTitle.body || '', /alterada por outra solicitação/i);

  const stored = JSON.parse(fake.records.get(key) || '{}');
  assert.equal(stored.active, false);
  assert.equal(stored.title, 'Inicial');
  assert.equal(typeof stored._recordVersion, 'string');
  assert.equal(fake.calls.every((call) => call.keys.length === 1), true);
  assert.match(MEDIA_CAS_READ_SCRIPT, /cjson\.decode/);
  assert.match(MEDIA_CAS_WRITE_SCRIPT, /cjson\.decode/);
  assert.doesNotMatch(MEDIA_CAS_WRITE_SCRIPT, /:version/);

  assert.equal(
    await compareAndSetMedia(id, '', { ...stored, title: 'outro', version: 'stale' }, fake as any),
    false,
  );
});

test('downloader rejects a delayed fetch that ignores AbortSignal and awaits body cancellation', async () => {
  let cancelled = false;
  let signal: AbortSignal | undefined;
  const responseBody = {
    cancel: async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      cancelled = true;
    },
  };
  const started = Date.now();
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      timeoutMs: 5,
      fetchImpl: async (_url, init) => {
        signal = init?.signal;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          status: 200,
          ok: true,
          url: '',
          headers: new Headers({ 'Content-Type': 'image/jpeg' }),
          body: responseBody,
        } as unknown as Response;
      },
    }),
    /demorou demais/,
  );
  assert.equal(signal?.aborted, true);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - started >= 15);
});

test('downloader awaits delayed cancellation on response rejection and skips cancel after success', async () => {
  let rejectedCancelDone = false;
  const rejectedBody = {
    cancel: async () => {
      await new Promise((resolve) => setTimeout(resolve, 12));
      rejectedCancelDone = true;
    },
  };
  await assert.rejects(
    downloadApprovedMedia({
      url: blobUrl,
      origin,
      stepType: 'image',
      records,
      headFn: headBlob,
      fetchImpl: async () => ({
        status: 200,
        ok: true,
        url: '',
        headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
        body: rejectedBody,
      } as unknown as Response),
    }),
    /tipo retornado/,
  );
  assert.equal(rejectedCancelDone, true);

  let successfulCancelCalls = 0;
  let successfulReads = 0;
  const successfulReader = {
    read: async () => successfulReads++ === 0
      ? { value: new Uint8Array(11), done: false }
      : { value: undefined, done: true },
    cancel: async () => {
      successfulCancelCalls += 1;
    },
  };
  await downloadApprovedMedia({
    url: blobUrl,
    origin,
    stepType: 'image',
    records,
    headFn: headBlob,
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      url: '',
      headers: new Headers({ 'Content-Type': 'image/jpeg', 'Content-Length': '11' }),
      body: { getReader: () => successfulReader },
    } as unknown as Response),
  });
  assert.equal(successfulCancelCalls, 0);
});

test('POST uses atomic SET NX, preserves legacy IDs, and keeps colon IDs isolated', async () => {
  const legacy = {
    ...records[0],
    id: 'legacy-id',
    title: 'Legado',
    product_group: 'canga',
    kind: 'image',
    version: 'legacy-public-version',
  };
  const store = fakeMediaStore([legacy]);
  const payload = {
    title: 'Novo',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    content_type: 'image/jpeg',
    size_bytes: 11,
    kind: 'image',
    active: true,
  };
  const before = store.values.get('aspen:communication:media-assets:legacy-id');
  const conflict = await communicationMedia(responseEvent({ ...payload, id: 'legacy-id' }), {
    kvClient: store as any,
    headBlob,
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(store.values.get('aspen:communication:media-assets:legacy-id'), before);
  assert.equal(store.calls.some((call) => call.script === MEDIA_CREATE_SCRIPT), true);

  for (const id of ['colon:one', 'colon']) {
    const created = await communicationMedia(responseEvent({ ...payload, id }), {
      kvClient: store as any,
      headBlob,
    });
    assert.equal(created.statusCode, 201);
    const body = JSON.parse(created.body || '{}');
    assert.equal(body.item._recordVersion, undefined);
    assert.equal(body.item.version, undefined);
    assert.equal(body.item._deleting, undefined);
    const stored = JSON.parse(store.values.get(`aspen:communication:media-assets:${id}`) || '{}');
    assert.equal(typeof stored._recordVersion, 'string');
  }
  assert.ok(store.values.has('aspen:communication:media-assets:colon:one'));
  assert.ok(store.values.has('aspen:communication:media-assets:colon'));
  assert.equal(store.values.has('aspen:communication:media-assets:colon:one:version'), false);

  const legacyGet = await communicationMedia(responseEvent({}, 'GET', 'legacy-id'), {
    kvClient: store as any,
  });
  assert.equal(legacyGet.statusCode, 200);
  assert.equal(JSON.parse(legacyGet.body || '{}').item.version, undefined);
});

test('POST atomically reclaims only a stale legacy auxiliary UUID at an exact :version ID', async () => {
  const payload = {
    title: 'Novo',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    content_type: 'image/jpeg',
    size_bytes: 11,
    kind: 'image',
    active: true,
  };
  const legacyId = 'legacy:version';
  const store = fakeMediaStore();
  store.values.set(`aspen:communication:media-assets:${legacyId}`, uuid);
  const created = await communicationMedia(responseEvent({ ...payload, id: legacyId }), {
    kvClient: store as any,
    headBlob,
  });
  assert.equal(created.statusCode, 201);
  const stored = JSON.parse(store.values.get(`aspen:communication:media-assets:${legacyId}`) || '{}');
  assert.equal(stored.id, legacyId);
  assert.equal(typeof stored._recordVersion, 'string');
  assert.equal(store.calls.at(-1)?.script, MEDIA_CREATE_SCRIPT);

  for (const [id, value] of [
    ['object:version', JSON.stringify({ id: 'existing' })],
    ['scalar:version', 'not-a-uuid'],
    ['uuid-on-ordinary-id', uuid],
  ] as const) {
    const conflictStore = fakeMediaStore();
    conflictStore.values.set(`aspen:communication:media-assets:${id}`, value);
    const conflict = await communicationMedia(responseEvent({ ...payload, id }), {
      kvClient: conflictStore as any,
      headBlob,
    });
    assert.equal(conflict.statusCode, 409, id);
    assert.equal(conflictStore.values.get(`aspen:communication:media-assets:${id}`), value);
  }

  const concurrentStore = fakeMediaStore();
  concurrentStore.values.set(`aspen:communication:media-assets:${legacyId}`, uuid);
  const concurrent = await Promise.all([
    communicationMedia(responseEvent({ ...payload, id: legacyId }), { kvClient: concurrentStore as any, headBlob }),
    communicationMedia(responseEvent({ ...payload, id: legacyId }), { kvClient: concurrentStore as any, headBlob }),
  ]);
  assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [201, 409]);
});

test('catalog readers paginate string and numeric cursors without surfacing tombstones', async () => {
  const hidden = { ...records[0], id: 'hidden', active: false, _deleting: true, _recordVersion: 'hidden-v' };
  const inactive = { ...records[0], id: 'inactive', active: false, _recordVersion: 'inactive-v' };
  const visible = { ...records[0], id: 'visible', active: true, _recordVersion: 'visible-v' };
  const values = new Map([
    ['aspen:communication:media-assets:hidden', JSON.stringify(hidden)],
    ['aspen:communication:media-assets:inactive', JSON.stringify(inactive)],
    ['aspen:communication:media-assets:visible', JSON.stringify(visible)],
    ['aspen:communication:media-assets:legacy:version', 'old-version-key'],
  ]);
  const calls: Array<string | number> = [];
  const catalog = {
    async scan(cursor: string | number) {
      calls.push(cursor);
      return String(cursor) === '0'
        ? ['900719925474099312345678901234567890', [
            'aspen:communication:media-assets:hidden',
            'aspen:communication:media-assets:inactive',
            'aspen:communication:media-assets:legacy:version',
          ]]
        : [0, ['aspen:communication:media-assets:visible']];
    },
    async get(key: string) {
      return values.get(key) || null;
    },
  };
  const recordsFromCatalog = await readCommunicationMediaRecords(catalog as any);
  assert.deepEqual(recordsFromCatalog.map((item) => item.id), ['inactive', 'visible']);
  assert.equal(recordsFromCatalog.some((item) => item._recordVersion || item._deleting), false);
  assert.deepEqual(calls, [0, '900719925474099312345678901234567890']);

  const listed = await communicationMedia(
    {
      httpMethod: 'GET',
      headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
      queryStringParameters: { active: 'true' },
    } as any,
    { kvClient: catalog as any },
  );
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(JSON.parse(listed.body || '{}').items.map((item: any) => item.id), ['visible']);
});

test('media KV get, eval, scan, and catalog failures return Portuguese 503 responses', async () => {
  const scanFailure = { async scan() { throw new Error('KV scan secret'); } };
  const list = await communicationMedia(
    { httpMethod: 'GET', headers: { host: 'app.test' }, queryStringParameters: {} } as any,
    { kvClient: scanFailure as any },
  );
  assert.equal(list.statusCode, 503);
  assert.doesNotMatch(list.body || '', /KV scan secret/);

  const getFailure = { async get() { throw new Error('KV get secret'); } };
  const single = await communicationMedia(responseEvent({}, 'GET', 'media-1'), { kvClient: getFailure as any });
  assert.equal(single.statusCode, 503);
  assert.doesNotMatch(single.body || '', /KV get secret/);

  const evalFailure = { async eval() { throw new Error('KV eval secret'); } };
  const update = await communicationMedia(responseEvent({ active: false }, 'PUT', 'media-1'), { kvClient: evalFailure as any });
  assert.equal(update.statusCode, 503);
  assert.doesNotMatch(update.body || '', /KV eval secret/);

  await assert.rejects(
    readCommunicationMediaRecords(scanFailure as any),
    (error: any) => error.statusCode === 503 && /mídias cadastradas/i.test(error.message),
  );
});

test('DELETE leaves a hidden retryable tombstone after Blob failure and finalizes with CAS', async () => {
  const id = 'delete-retry';
  const store = fakeMediaStore([{ ...records[0], id, product_group: 'canga', kind: 'image', _recordVersion: 'v0' }]);
  let failBlob = true;
  let blobCalls = 0;
  const dependencies = {
    kvClient: store as any,
    blobDelete: async () => {
      blobCalls += 1;
      if (failBlob) throw new Error('Blob unavailable');
    },
  };
  const deleteEvent = () => ({
    httpMethod: 'DELETE',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: { id },
  } as any);
  const failed = await communicationMedia(deleteEvent(), dependencies);
  assert.equal(failed.statusCode, 503);
  assert.match(failed.body || '', /remover o Blob/i);
  const tombstone = JSON.parse(store.values.get(`aspen:communication:media-assets:${id}`) || '{}');
  assert.equal(tombstone.active, false);
  assert.equal(tombstone._deleting, true);
  assert.equal(typeof tombstone._recordVersion, 'string');

  const hidden = await communicationMedia(
    { httpMethod: 'GET', headers: { host: 'app.test' }, queryStringParameters: {} } as any,
    dependencies,
  );
  assert.equal(hidden.statusCode, 200);
  assert.deepEqual(JSON.parse(hidden.body || '{}').items, []);
  const rejectedPut = await communicationMedia(responseEvent({ active: true }, 'PUT', id), dependencies);
  assert.equal(rejectedPut.statusCode, 409);

  failBlob = false;
  const completed = await communicationMedia(deleteEvent(), dependencies);
  assert.equal(completed.statusCode, 200);
  assert.equal(store.values.has(`aspen:communication:media-assets:${id}`), false);
  assert.equal(blobCalls, 2);
  assert.equal(await deleteMediaIfCurrent(id, '', store as any), false);
  const deleteCall = store.calls.find((call) => call.script === MEDIA_CAS_DELETE_SCRIPT);
  assert.deepEqual(deleteCall?.keys, [`aspen:communication:media-assets:${id}`]);
  assert.equal(deleteCall?.args.length, 1);
  assert.match(MEDIA_CAS_DELETE_SCRIPT, /cjson\.decode/);
});

test('CAS scripts fail closed for null, scalar, and malformed current values', async () => {
  const id = 'cas-invalid';
  const key = `aspen:communication:media-assets:${id}`;
  for (const value of [undefined, 'null', '42', JSON.stringify('scalar'), '{malformed'] as const) {
    const store = fakeMediaStore();
    if (value !== undefined) store.values.set(key, value);
    assert.equal(await compareAndSetMedia(id, '', { ...records[0], id }, store as any), false);
    assert.equal(await deleteMediaIfCurrent(id, '', store as any), false);
    if (value === undefined) {
      assert.deepEqual(await readMediaState(id, store as any), { record: null, version: '' });
    } else {
      await assert.rejects(
        readMediaState(id, store as any),
        (error: any) => error.statusCode === 503,
      );
    }
    assert.equal(store.values.get(key), value);
  }
});

test('CAS scripts skip cjson.null version aliases and legacy tombstones retry deletion', async () => {
  assert.match(MEDIA_CAS_READ_SCRIPT, /version == cjson\.null/);
  assert.match(MEDIA_CAS_WRITE_SCRIPT, /version == cjson\.null/);
  assert.match(MEDIA_CAS_DELETE_SCRIPT, /version == cjson\.null/);

  const updateId = 'legacy-null-version-update';
  const updateStore = fakeMediaStore();
  updateStore.values.set(`aspen:communication:media-assets:${updateId}`, JSON.stringify({
    ...records[0],
    id: updateId,
    _recordVersion: null,
    recordVersion: uuid,
  }));
  assert.equal(await compareAndSetMedia(updateId, uuid, {
    ...records[0],
    id: updateId,
    _recordVersion: crypto.randomUUID(),
  }, updateStore as any), true);

  const id = 'legacy-delete-retry';
  const store = fakeMediaStore();
  store.values.set(`aspen:communication:media-assets:${id}`, JSON.stringify({
    ...records[0],
    id,
    product_group: 'canga',
    kind: 'image',
    _recordVersion: null,
    recordVersion: uuid,
    deleting: true,
    active: false,
  }));
  let blobCalls = 0;
  const completed = await communicationMedia({
    httpMethod: 'DELETE',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: { id },
  } as any, {
    kvClient: store as any,
    blobDelete: async () => { blobCalls += 1; },
  });
  assert.equal(completed.statusCode, 200);
  assert.equal(blobCalls, 1);
  assert.equal(store.values.has(`aspen:communication:media-assets:${id}`), false);
});

test('final CAS failure leaves a hidden tombstone and retry succeeds after idempotent Blob delete', async () => {
  const id = 'final-cas-retry';
  const store = fakeMediaStore([{ ...records[0], id, product_group: 'canga', kind: 'image', _recordVersion: uuid }]);
  let finalAttempts = 0;
  let blobCalls = 0;
  const dependencies = {
    kvClient: store as any,
    blobDelete: async () => { blobCalls += 1; },
    deleteMediaIfCurrent: async (recordId: string, version: string) => {
      finalAttempts += 1;
      if (finalAttempts === 1) return false;
      return deleteMediaIfCurrent(recordId, version, store as any);
    },
  };
  const event = {
    httpMethod: 'DELETE',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: { id },
  } as any;
  const failed = await communicationMedia(event, dependencies);
  assert.equal(failed.statusCode, 409);
  assert.equal(blobCalls, 1);
  const tombstone = JSON.parse(store.values.get(`aspen:communication:media-assets:${id}`) || '{}');
  assert.equal(tombstone._deleting, true);
  const retried = await communicationMedia(event, dependencies);
  assert.equal(retried.statusCode, 200);
  assert.equal(blobCalls, 2);
  assert.equal(store.values.has(`aspen:communication:media-assets:${id}`), false);
});

test('catalog readers reject malformed and repeated cursors with fail-closed 503s', async () => {
  for (const cursor of [NaN, Infinity, -1, 1.5, {}, null, '1.2', 'bad'] as unknown[]) {
    const catalog = { async scan() { return [cursor, []]; }, async get() { return null; } };
    const list = await communicationMedia(
      { httpMethod: 'GET', headers: { host: 'app.test' }, queryStringParameters: {} } as any,
      { kvClient: catalog as any },
    );
    assert.equal(list.statusCode, 503);
    await assert.rejects(readCommunicationMediaRecords(catalog as any), /mídias cadastradas/i);
  }
  let calls = 0;
  const repeated = {
    async scan() {
      calls += 1;
      return ['7', []];
    },
    async get() { return null; },
  };
  const list = await communicationMedia(
    { httpMethod: 'GET', headers: { host: 'app.test' }, queryStringParameters: {} } as any,
    { kvClient: repeated as any },
  );
  assert.equal(list.statusCode, 503);
  await assert.rejects(readCommunicationMediaRecords(repeated as any), /mídias cadastradas/i);
  assert.equal(calls, 4);
});

test('PUT and DELETE races have one CAS winner, and concurrent DELETE cannot resurrect', async () => {
  const id = 'delete-race';
  const store = fakeMediaStore([{ ...records[0], id, product_group: 'canga', kind: 'image', _recordVersion: 'v0' }]);
  let headRelease!: () => void;
  let headStarted!: () => void;
  const headReady = new Promise<void>((resolve) => { headStarted = resolve; });
  const pendingHead = new Promise<any>((resolve) => { headRelease = () => resolve(headResult()); });
  const update = communicationMedia(responseEvent({ title: 'atrasado' }, 'PUT', id), {
    kvClient: store as any,
    headBlob: (async () => {
      headStarted();
      return pendingHead;
    }) as any,
  });
  await headReady;
  const deleted = await communicationMedia(
    { httpMethod: 'DELETE', headers: { host: 'app.test', 'x-forwarded-proto': 'https' }, queryStringParameters: { id } } as any,
    { kvClient: store as any, blobDelete: async () => {} },
  );
  assert.equal(deleted.statusCode, 200);
  headRelease();
  const staleUpdate = await update;
  assert.equal(staleUpdate.statusCode, 409);
  assert.equal(store.values.has(`aspen:communication:media-assets:${id}`), false);

  const concurrentId = 'delete-concurrent';
  const concurrentStore = fakeMediaStore([{ ...records[0], id: concurrentId, product_group: 'canga', kind: 'image', _recordVersion: 'v0' }]);
  const bothBlobs = new Promise<void>((resolve) => setTimeout(resolve, 5));
  const concurrentDeps = {
    kvClient: concurrentStore as any,
    blobDelete: async () => {
      await bothBlobs;
    },
  };
  const concurrentEvent = {
    httpMethod: 'DELETE',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    queryStringParameters: { id: concurrentId },
  } as any;
  const concurrent = await Promise.all([
    communicationMedia(concurrentEvent, concurrentDeps),
    communicationMedia(concurrentEvent, concurrentDeps),
  ]);
  assert.deepEqual(concurrent.map((response) => response.statusCode).sort(), [200, 409]);
  assert.equal(concurrentStore.values.has(`aspen:communication:media-assets:${concurrentId}`), false);
});
