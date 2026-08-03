import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readdirSync,
  statSync,
  utimesSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { test, after } from 'node:test';

// ── Helpers ──────────────────────────────────────────────────────────────

const TEST_DIR = resolve('.scratch-backup-test');
const TEST_BACKUPS = join(TEST_DIR, 'backups');

function setupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_BACKUPS, { recursive: true });
}

function cleanupTestDir() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
}

function createFakeBackup(name: string, ageMs: number) {
  const filepath = join(TEST_BACKUPS, name);
  writeFileSync(filepath, '-- dump content');
  const future = new Date(Date.now() + ageMs);
  utimesSync(filepath, future, future);
}

// Minimal retention logic extracted for unit testing (mirrors the script logic
// without requiring pg_dump or DATABASE_URL).
function retentionCleanupWithDir(backupsDir: string, retentionDays: number): string[] {
  const now = Date.now();
  const msPerDay = 24 * 60 * 60 * 1000;
  const cutoff = now - retentionDays * msPerDay;
  const resolvedDir = resolve(backupsDir);
  const files = readdirSync(resolvedDir);
  const deleted: string[] = [];

  for (const file of files) {
    if (!file.startsWith('backup-') || !file.endsWith('.sql')) continue;
    const filepath = resolve(resolvedDir, file);
    if (!filepath.startsWith(resolvedDir + '/') && filepath !== resolvedDir) continue;

    const st = statSync(filepath);
    if (st.mtimeMs < cutoff) {
      deleted.push(file);
      rmSync(filepath);
    }
  }

  return deleted;
}

// Minimal preflight judgment logic for unit testing.
interface PreflightMetric {
  metric: string;
  status: string;
}

function preflightCheck({
  dbSizeBytes,
  connCount,
  blobSizeBytes,
  maxDbMb,
  maxBlobMb,
  maxConn,
}: {
  dbSizeBytes: number;
  connCount: number;
  blobSizeBytes: number | null;
  maxDbMb: number;
  maxBlobMb: number;
  maxConn: number;
}): PreflightMetric[] {
  const dbMb = dbSizeBytes / (1024 * 1024);
  const blobMb = blobSizeBytes !== null ? blobSizeBytes / (1024 * 1024) : 0;
  const results: PreflightMetric[] = [];

  results.push({
    metric: 'Tamanho do banco',
    status: dbMb > maxDbMb ? 'CRÍTICO' : 'OK',
  });

  results.push({
    metric: 'Conexões ativas',
    status: connCount > maxConn ? 'CRÍTICO' : 'OK',
  });

  if (blobSizeBytes === null) {
    results.push({ metric: 'Armazenamento de blobs', status: 'AVISO' });
  } else {
    results.push({
      metric: 'Armazenamento de blobs',
      status: blobMb > maxBlobMb ? 'CRÍTICO' : 'OK',
    });
  }

  return results;
}

// ── Tests ────────────────────────────────────────────────────────────────

after(() => cleanupTestDir());

// ─── Retention policy (no DB) ────────────────────────────────────────────

test('retenção deleta apenas backups mais antigos que o limite', () => {
  setupTestDir();

  // Create files: 1 day old, 15 days old, 45 days old, 60 days old
  createFakeBackup('backup-2025-07-29T00:00:00Z.sql', -1 * 24 * 60 * 60 * 1000);
  createFakeBackup('backup-2025-07-15T00:00:00Z.sql', -15 * 24 * 60 * 60 * 1000);
  createFakeBackup('backup-2025-06-19T00:00:00Z.sql', -45 * 24 * 60 * 60 * 1000);
  createFakeBackup('backup-2025-06-04T00:00:00Z.sql', -60 * 24 * 60 * 60 * 1000);

  const deleted = retentionCleanupWithDir(TEST_BACKUPS, 30);

  assert.ok(deleted.includes('backup-2025-06-19T00:00:00Z.sql'), '45-day file should be deleted');
  assert.ok(deleted.includes('backup-2025-06-04T00:00:00Z.sql'), '60-day file should be deleted');
  assert.ok(
    !deleted.includes('backup-2025-07-29T00:00:00Z.sql'),
    '1-day file should NOT be deleted'
  );
  assert.ok(
    !deleted.includes('backup-2025-07-15T00:00:00Z.sql'),
    '15-day file should NOT be deleted'
  );

  const remaining = readdirSync(TEST_BACKUPS);
  assert.equal(remaining.length, 2);
});

// ─── Retention safety (no DB) ────────────────────────────────────────────

test('retenção nunca deleta arquivos fora do diretório backups/', () => {
  setupTestDir();

  // Create a file outside backups/ but inside our test dir
  const outsideFile = join(TEST_DIR, 'backup-important.sql');
  writeFileSync(outsideFile, 'critical data');
  const outsideMtime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  utimesSync(outsideFile, outsideMtime, outsideMtime);

  // Also create a normal old backup inside backups/
  createFakeBackup('backup-2025-06-04T00:00:00Z.sql', -60 * 24 * 60 * 60 * 1000);

  const deleted = retentionCleanupWithDir(TEST_BACKUPS, 30);

  // The backup in backups/ should be deleted
  assert.ok(deleted.includes('backup-2025-06-04T00:00:00Z.sql'));

  // The file outside backups/ must still exist
  assert.ok(existsSync(outsideFile), 'File outside backups/ must NOT be deleted');
});

// ─── Blob token missing → AVISO (mock, no DB) ───────────────────────────

test('preflight retorna AVISO quando token de blob não está configurado', () => {
  // Save and restore env
  const origBlobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const origQuotToken = process.env.QUOTATION_BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.QUOTATION_BLOB_READ_WRITE_TOKEN;

  try {
    // Since no token is set, blobSizeBytes should be null
    const results = preflightCheck({
      dbSizeBytes: 10 * 1024 * 1024,
      connCount: 5,
      blobSizeBytes: null,
      maxDbMb: 512,
      maxBlobMb: 512,
      maxConn: 100,
    });

    const blobResult = results.find((r) => r.metric === 'Armazenamento de blobs');
    assert.equal(blobResult!.status, 'AVISO', 'Missing blob token should produce AVISO');
  } finally {
    if (origBlobToken) process.env.BLOB_READ_WRITE_TOKEN = origBlobToken;
    if (origQuotToken) process.env.QUOTATION_BLOB_READ_WRITE_TOKEN = origQuotToken;
  }
});

// ─── Preflight: OK when within limits ────────────────────────────────────

test('preflight retorna OK quando dentro dos limites', () => {
  const results = preflightCheck({
    dbSizeBytes: 50 * 1024 * 1024, // 50 MB
    connCount: 10,
    blobSizeBytes: 100 * 1024 * 1024, // 100 MB
    maxDbMb: 512,
    maxBlobMb: 512,
    maxConn: 100,
  });

  for (const r of results) {
    assert.equal(r.status, 'OK', `${r.metric} should be OK when within limits`);
  }
});

// ─── Preflight: CRÍTICO when DB size exceeds limit ───────────────────────

test('preflight retorna CRÍTICO quando tamanho do banco excede limite', () => {
  const results = preflightCheck({
    dbSizeBytes: 600 * 1024 * 1024, // 600 MB > 512
    connCount: 10,
    blobSizeBytes: 10 * 1024 * 1024,
    maxDbMb: 512,
    maxBlobMb: 512,
    maxConn: 100,
  });

  const dbResult = results.find((r) => r.metric === 'Tamanho do banco');
  assert.equal(dbResult!.status, 'CRÍTICO', 'Oversized DB should be CRÍTICO');
});

// ─── Preflight: CRÍTICO when blob exceeds limit ──────────────────────────

test('preflight retorna CRÍTICO quando armazenamento de blobs excede limite', () => {
  const results = preflightCheck({
    dbSizeBytes: 10 * 1024 * 1024,
    connCount: 10,
    blobSizeBytes: 700 * 1024 * 1024, // 700 MB > 512
    maxDbMb: 512,
    maxBlobMb: 512,
    maxConn: 100,
  });

  const blobResult = results.find((r) => r.metric === 'Armazenamento de blobs');
  assert.equal(blobResult!.status, 'CRÍTICO', 'Oversized blob should be CRÍTICO');
});

// ─── Preflight: CRÍTICO when connections exceed limit ────────────────────

test('preflight retorna CRÍTICO quando conexões excedem limite', () => {
  const results = preflightCheck({
    dbSizeBytes: 10 * 1024 * 1024,
    connCount: 150,
    blobSizeBytes: 10 * 1024 * 1024,
    maxDbMb: 512,
    maxBlobMb: 512,
    maxConn: 100,
  });

  const connResult = results.find((r) => r.metric === 'Conexões ativas');
  assert.equal(connResult!.status, 'CRÍTICO', 'Excess connections should be CRÍTICO');
});

// ─── Retention: no files to clean ────────────────────────────────────────

test('retenção não falha quando diretório está vazio', () => {
  setupTestDir();
  const deleted = retentionCleanupWithDir(TEST_BACKUPS, 30);
  assert.equal(deleted.length, 0, 'No files to delete from empty dir');
});

// ─── Retention: non-backup files are ignored ──────────────────────────────

test('retenção ignora arquivos que não são backups', () => {
  setupTestDir();

  // Create a non-backup file
  writeFileSync(join(TEST_BACKUPS, 'readme.txt'), 'not a backup');
  // Create an old backup
  createFakeBackup('backup-2025-06-04T00:00:00Z.sql', -60 * 24 * 60 * 60 * 1000);

  const deleted = retentionCleanupWithDir(TEST_BACKUPS, 30);

  assert.ok(deleted.includes('backup-2025-06-04T00:00:00Z.sql'));
  assert.ok(existsSync(join(TEST_BACKUPS, 'readme.txt')), 'Non-backup file should not be deleted');
});

// ─── Dump generation (requires TEST_DATABASE_URL) ────────────────────────

const TEST_DATABASE_URL: string | undefined = process.env.TEST_DATABASE_URL;

test('geração de dump cria arquivo .sql válido', { skip: !TEST_DATABASE_URL }, async () => {
  const { execSync } = await import('node:child_process');
  const { mkdtempSync, statSync: stSync, rmSync: rmR } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const tmpDir = mkdtempSync(j(tmpdir(), 'backup-test-'));
  const dumpFile = j(tmpDir, 'test-dump.sql');

  try {
    execSync(
      `pg_dump --no-owner --no-acl --clean --if-exists --format=plain -f ${dumpFile} ${TEST_DATABASE_URL}`,
      { stdio: 'pipe', timeout: 30_000 }
    );

    assert.ok(existsSync(dumpFile), 'Dump file should exist');
    const stat = stSync(dumpFile);
    assert.ok(stat.size > 0, 'Dump file should not be empty');
  } finally {
    rmR(tmpDir, { recursive: true, force: true });
  }
});

// ─── Preflight against real DB (requires TEST_DATABASE_URL) ──────────────

test('preflight retorna métricas reais do banco', { skip: !TEST_DATABASE_URL }, async () => {
  const { execSync } = await import('node:child_process');
  const parsedUrl = new URL(TEST_DATABASE_URL!);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || '5432';
  const user = parsedUrl.username;
  const dbName = parsedUrl.pathname.replace(/^\//, '');
  const password = parsedUrl.password;
  const envVars = { ...process.env, PGPASSWORD: password };

  const sizeResult = execSync(
    `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -t -A -c "SELECT pg_database_size(current_database());"`,
    { env: envVars, encoding: 'utf8', stdio: 'pipe' }
  );
  const sizeBytes = parseInt(sizeResult.trim(), 10);
  assert.ok(sizeBytes > 0, 'Database size should be positive');

  const connResult = execSync(
    `psql -h ${host} -p ${port} -U ${user} -d ${dbName} --no-psqlrc -t -A -c "SELECT count(*) FROM pg_stat_activity;"`,
    { env: envVars, encoding: 'utf8', stdio: 'pipe' }
  );
  const connCount = parseInt(connResult.trim(), 10);
  assert.ok(connCount > 0, 'Connection count should be positive');

  const results = preflightCheck({
    dbSizeBytes: sizeBytes,
    connCount,
    blobSizeBytes: null,
    maxDbMb: 512,
    maxBlobMb: 512,
    maxConn: 100,
  });

  // DB and conn should be OK on a test database
  const dbResult = results.find((r) => r.metric === 'Tamanho do banco');
  assert.equal(dbResult!.status, 'OK', 'Test DB should be within size limit');
  const connStatus = results.find((r) => r.metric === 'Conexões ativas');
  assert.equal(connStatus!.status, 'OK', 'Test DB should have few connections');
});

// ─── Restore validation detects missing table (requires TEST_DATABASE_URL) ─

test('validação de restore detecta tabela ausente', { skip: !TEST_DATABASE_URL }, async () => {
  const { execSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync: wf, rmSync: rmR } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join: j } = await import('node:path');

  const parsedUrl = new URL(TEST_DATABASE_URL!);
  const host = parsedUrl.hostname;
  const port = parsedUrl.port || '5432';
  const user = parsedUrl.username;
  const password = parsedUrl.password;
  const envVars = { ...process.env, PGPASSWORD: password };

  // Create a minimal invalid dump that has a nonexistent table
  const tmpDir = mkdtempSync(j(tmpdir(), 'restore-test-'));
  const dumpFile = j(tmpDir, 'bad-dump.sql');
  wf(dumpFile, 'CREATE TABLE nonexistent_table_xyz (id int);\n');

  const tempDbName = `restore_test_${Date.now()}`;

  try {
    execSync(`createdb -h ${host} -p ${port} -U user ${tempDbName}`, {
      env: envVars,
      stdio: 'pipe',
    });

    // Restore the invalid dump
    execSync(`psql -h ${host} -p ${port} -U ${user} -d ${tempDbName} --no-psqlrc -f ${dumpFile}`, {
      env: envVars,
      stdio: 'pipe',
    });

    // Try to count from a table that doesn't exist in the dump
    let tableMissing = false;
    try {
      execSync(
        `psql -h ${host} -p ${port} -U ${user} -d ${tempDbName} --no-psqlrc -t -A -c "SELECT count(*) FROM products;"`,
        { env: envVars, encoding: 'utf8', stdio: 'pipe' }
      );
    } catch {
      tableMissing = true;
    }

    assert.ok(tableMissing, 'Missing table should cause query to fail');
  } finally {
    try {
      execSync(`dropdb -h ${host} -p ${port} -U user ${tempDbName}`, {
        env: envVars,
        stdio: 'pipe',
      });
    } catch {
      // Ignore cleanup errors
    }
    rmR(tmpDir, { recursive: true, force: true });
  }
});
