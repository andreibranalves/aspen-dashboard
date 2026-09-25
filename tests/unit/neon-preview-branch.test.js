import assert from 'node:assert/strict';
import test from 'node:test';
import { URL } from 'node:url';
import { resolvePreviewDatabaseUrl } from '../../scripts/lib/neon-preview-branch.mjs';

const apiKey = 'neon-sentinel-key';
const env = {
  NEON_API_KEY: apiKey,
  PRODUCTION_DATABASE_URL: 'postgresql://neondb_owner:secret@ep-prod-1.sa-east-1.aws.neon.tech/neondb',
};
const previewUri = 'postgresql://neondb_owner:secret@ep-preview-2.sa-east-1.aws.neon.tech/neondb?sslmode=require';

function fakeNeon(branches, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: new URL(url), init });
    if (status !== 200) return { ok: false, status, json: async () => ({ message: 'corpo do erro' }) };
    const { pathname } = new URL(url);
    if (pathname.endsWith('/branches')) return { ok: true, status, json: async () => ({ branches }) };
    return { ok: true, status, json: async () => ({ uri: previewUri }) };
  };
  return { calls, fetchImpl };
}

test('resolves the exact preview/<branch> and asks for a direct URL with production database and role', async () => {
  const { calls, fetchImpl } = fakeNeon([
    { id: 'br-other', name: 'preview/fix/x-2', default: false, primary: false },
    { id: 'br-target', name: 'preview/fix/x', default: false, primary: false },
  ]);
  const uri = await resolvePreviewDatabaseUrl({ env, gitBranch: 'fix/x', fetchImpl });
  assert.equal(uri, previewUri);
  assert.equal(calls[0].url.searchParams.get('search'), 'preview/fix/x');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${apiKey}`);
  const query = calls[1].url.searchParams;
  assert.equal(query.get('branch_id'), 'br-target');
  assert.equal(query.get('database_name'), 'neondb');
  assert.equal(query.get('role_name'), 'neondb_owner');
  assert.equal(query.get('pooled'), 'false');
});

test('refuses master, detached HEAD, a missing branch and a non-disposable branch', async () => {
  for (const gitBranch of ['master', 'HEAD', '']) {
    await assert.rejects(resolvePreviewDatabaseUrl({ env, gitBranch, fetchImpl: fakeNeon([]).fetchImpl }), /branch Git do PR/);
  }
  await assert.rejects(
    resolvePreviewDatabaseUrl({ env, gitBranch: 'fix/x', fetchImpl: fakeNeon([]).fetchImpl }),
    /preview\/fix\/x não existe/,
  );
  for (const flag of ['default', 'primary', 'protected']) {
    const { fetchImpl } = fakeNeon([{ id: 'br-main', name: 'preview/fix/x', [flag]: true }]);
    await assert.rejects(resolvePreviewDatabaseUrl({ env, gitBranch: 'fix/x', fetchImpl }), /não é descartável/);
  }
});

test('API failures report only the status, never the body or the key', async () => {
  const { fetchImpl } = fakeNeon([], { status: 401 });
  await assert.rejects(resolvePreviewDatabaseUrl({ env, gitBranch: 'fix/x', fetchImpl }), (error) => {
    assert.match(error.message, /respondeu 401/);
    assert.doesNotMatch(error.message, /corpo do erro|neon-sentinel-key/);
    return true;
  });
});
