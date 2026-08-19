import assert from 'node:assert/strict';
import test from 'node:test';

import { handler } from '../../api/_modules/communication-flow-preview.js';
import type { PostgresMediaRecord } from '../../api/_modules/postgres-media.js';

const blobUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg';
const pathname = 'aspen-media/canga/reference.jpg';

function event(body: Record<string, unknown>) {
  return {
    httpMethod: 'POST',
    headers: { host: 'app.test', 'x-forwarded-proto': 'https' },
    body: JSON.stringify(body),
  } as any;
}

function record(overrides: Record<string, unknown> = {}): PostgresMediaRecord {
  return {
    id: 'media-1',
    product_group: 'canga',
    blob_url: blobUrl,
    pathname,
    active: true,
    content_type: 'image/jpeg',
    size_bytes: 11,
    kind: 'image',
    ...overrides,
  };
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

function dependencies(
  records: PostgresMediaRecord[],
  headBlob: (...args: any[]) => Promise<any> = async () => headResult(),
) {
  return {
    resolveFlow: async () => ({
      id: 'flow-preview',
      steps: [{ type: 'product_media', max_items: 1 }],
    }),
    resolvePostgresContext: async () => ({
      nome: 'Cliente Preview',
      quotationId: 'ORC-20260001',
      link: '',
      vendorName: 'Juliana',
      empresa: 'Aspen Estamparia',
      productSummary: 'cangas',
      categories: ['canga'],
    }),
    readMediaRecords: async () => records,
    headBlob,
    blobStoreId: 'store',
  };
}

const basePayload = {
  flow_id: 'flow-preview',
  quotation_id: 'ORC-20260001',
  revision_id: 'revision-1',
};

function assertNoMediaInternals(value: unknown): void {
  if (Array.isArray(value)) {
    for (const child of value) assertNoMediaInternals(child);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.equal(['_recordVersion', 'recordVersion', 'version', '_deleting', 'deleting'].includes(key), false);
    assertNoMediaInternals(child);
  }
}

test('preview redacts every injected media alias from nested output', async () => {
  const response = await handler(event(basePayload), dependencies([record({
    _recordVersion: 'canonical',
    recordVersion: 'legacy-record',
    version: 'legacy-version',
    _deleting: false,
    deleting: false,
    nested: [{ _recordVersion: 'nested-version', deleting: true }],
  })]));
  assert.equal(response.statusCode, 200);
  assertNoMediaInternals(JSON.parse(response.body || '{}'));
});

test('preview emits only an active record after canonical metadata and authenticated HEAD checks', async () => {
  let headUrl = '';
  let headOptions: Record<string, unknown> | undefined;
  const response = await handler(
    event(basePayload),
    dependencies(recordsForPreview(), async (url, options) => {
      headUrl = url;
      headOptions = options;
      return headResult();
    }),
  );
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.steps[0].url, blobUrl);
  assert.equal(headUrl, blobUrl);
  assert.equal(headOptions?.storeId, 'store');
  assert.ok(headOptions?.abortSignal instanceof AbortSignal);
});

test('preview rejects malformed, stale, inactive, and foreign-store records without exposing URL', async () => {
  const cases: Array<[string, PostgresMediaRecord, (...args: any[]) => Promise<any>]> = [
    ['malformed', record({ pathname: 'foreign/canga/reference.jpg' }), async () => headResult()],
    ['stale', record(), async () => headResult({ size: 12 })],
    [
      'foreign-store',
      record({ blob_url: 'https://other.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg' }),
      async () => headResult({ url: 'https://other.public.blob.vercel-storage.com/aspen-media/canga/reference.jpg' }),
    ],
  ];
  for (const [label, media, headBlob] of cases) {
    const response = await handler(event(basePayload), dependencies([media], headBlob));
    assert.notEqual(response.statusCode, 200, label);
    assert.doesNotMatch(response.body || '', /other\.public|store\.public|reference\.jpg/);
  }
  const inactive = await handler(event(basePayload), dependencies([record({ active: false })]));
  assert.equal(inactive.statusCode, 200);
  assert.deepEqual(JSON.parse(inactive.body || '{}').steps, []);
});

test('preview emits an authenticated video step with video behavior', async () => {
  const videoUrl = 'https://store.public.blob.vercel-storage.com/aspen-media/canga/reference.mp4';
  const videoPath = 'aspen-media/canga/reference.mp4';
  const response = await handler(event(basePayload), {
    ...dependencies([record({
      blob_url: videoUrl,
      pathname: videoPath,
      content_type: 'video/mp4',
      size_bytes: 11,
      kind: 'video',
    })], async () => ({
      url: videoUrl,
      pathname: videoPath,
      contentType: 'video/mp4',
      size: 11,
    })),
    resolveFlow: async () => ({ id: 'flow-video-preview', steps: [{ type: 'product_media', max_items: 1 }] }),
  });
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body || '{}');
  assert.equal(body.steps[0].type, 'video');
  assert.equal(body.steps[0].url, videoUrl);
});

test('preview fails closed on media catalog and Blob HEAD errors', async () => {
  const kvFailure = await handler(event(basePayload), {
    ...dependencies([]),
    readMediaRecords: async () => { throw new Error('KV down'); },
  });
  assert.equal(kvFailure.statusCode, 503);

  const headFailure = await handler(
    event(basePayload),
    dependencies(recordsForPreview(), async () => { throw new Error('BlobAccessError'); }),
  );
  assert.equal(headFailure.statusCode, 503);
  assert.doesNotMatch(headFailure.body || '', /reference\.jpg/);
});

function recordsForPreview() {
  return [record()];
}
