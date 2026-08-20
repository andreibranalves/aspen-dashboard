# Migrations HIGH Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar guardrails estáticos e operacionais para migrations HIGH sem aplicar migrations automaticamente nem alterar o fluxo local existente.

**Architecture:** Um módulo pequeno concentra parsing e comparação de alvos PostgreSQL já usados pelo backup. Um preflight read-only prova que URL staging, serviço nomeado e database efetivo representam o mesmo alvo não produtivo. Um check Git independente preserva migrations históricas e exige classificação de risco em arquivos novos.

**Tech Stack:** Node.js 22 ESM, APIs nativas `node:child_process`, `node:fs`, `node:path`, `node:test`, Git, PostgreSQL `psql`, Drizzle Kit, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-18-migrations-high-risk-design.md`

## Global Constraints

- PostgreSQL continua sendo a fonte de verdade.
- Drizzle continua sendo a camada de acesso e migration.
- Não adicionar dependências.
- Não alterar, remover, renomear ou regenerar migrations históricas em `drizzle/`.
- Não alterar `public/`.
- Não executar `npm run db:migrate`, `npm run test:e2e:staging` ou operação externa.
- Não carregar `.env` do checkout no preflight operacional.
- Não imprimir URLs, hosts, usuários, senhas, credenciais, PII, payloads ou linhas de dados.
- `npm run db:migrate` deve permanecer explícito, genérico e ausente de startup, build e CI padrão.
- CI padrão pode executar somente o gate estático, sem banco ou segredos.
- Migrations novas aceitam somente `-- migration-risk: additive` ou `-- migration-risk: destructive` como primeiro conteúdo não vazio.
- Quando houver dúvida de classificação, usar `destructive`.
- Migration destrutiva exige expand, deploy compatível, migrate data e contract em mudanças separadas quando necessário.
- Erros operacionais retornam código não zero e mensagens em português sem stderr bruto de ferramentas externas.
- Toda saída de evidência deve conter somente commit, timestamp, caminho, status, risco e resultado redigido.

---

### Task 1: Extrair o contrato compartilhado de alvo PostgreSQL

**Files:**

- Create: `scripts/postgres-target.mjs`
- Modify: `scripts/backup-crm.mjs:1-355`
- Modify: `tests/unit/backup-crm.test.ts:1-235`

**Interfaces:**

- Consumes: URLs PostgreSQL, arquivos `PGSERVICEFILE`/`PGPASSFILE` e ambiente Node.
- Produces: `parsePostgresUrl(raw, name)`, `postgresIdentity(connection)`, `assertProtectedFile(filepath, label)`, `readPostgresServiceTarget(options)`, `assertSamePostgresTarget(connection, service, message)` e `postgresServiceEnvironment(service, inheritedEnv)`.
- Preserves: exports `parseConnectionUrl` e `postgresEnv` de `scripts/backup-crm.mjs`.

- [ ] **Step 1: Executar a regressão atual do backup**

Run:

```bash
npm run build:api
node --test tests/unit/backup-crm.test.ts
```

Expected: todos os testes atuais passam antes da extração.

- [ ] **Step 2: Adicionar testes de caracterização da identidade pública do backup**

Adicionar:

```ts
test('PostgreSQL target parser normalizes the credential-free identity fields', () => {
  const first = parseConnectionUrl(
    'postgresql://first-user:first-pass@STAGING.TEST:5433/aspen_test'
  );
  const second = parseConnectionUrl(
    'postgresql://second-user:second-pass@staging.test:5433/aspen_test'
  );

  assert.deepEqual(
    [first.host, first.port, first.database],
    [second.host, second.port, second.database]
  );
});

test('PostgreSQL target parser rejects non-PostgreSQL and incomplete URLs', () => {
  assert.throws(() => parseConnectionUrl('https://staging.test/aspen_test'), /PostgreSQL/);
  assert.throws(() => parseConnectionUrl('postgresql:///aspen_test'), /host e database/);
  assert.throws(() => parseConnectionUrl('postgresql://staging.test'), /host e database/);
});
```

- [ ] **Step 3: Executar os testes de caracterização**

Run:

```bash
node --test tests/unit/backup-crm.test.ts
```

Expected: PASS, confirmando o contrato que a extração deve preservar.

- [ ] **Step 4: Criar o helper compartilhado**

Criar `scripts/postgres-target.mjs` com estas interfaces e sem saída própria:

```js
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function parsePostgresUrl(raw, name = 'DATABASE_URL') {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${name} inválida.`);
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`${name} deve usar o esquema PostgreSQL.`);
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database || !parsed.hostname) {
    throw new Error(`${name} precisa informar host e database.`);
  }
  return {
    raw,
    host: parsed.hostname,
    port: parsed.port || '5432',
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database,
    sslmode: parsed.searchParams.get('sslmode') || undefined,
  };
}

export function postgresIdentity(connection) {
  return [connection.host, connection.port, connection.database]
    .map((value) => value.toLowerCase())
    .join('|');
}

export function assertProtectedFile(filepath, label) {
  let stat;
  try {
    stat = lstatSync(resolve(filepath));
  } catch {
    throw new Error(`${label} não pôde ser lido.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} deve ser arquivo regular com permissão 0600.`);
  }
}

export function readPostgresServiceTarget({ serviceName, serviceFile, expectedDatabase, label }) {
  let active = false;
  const values = {};
  try {
    for (const rawLine of readFileSync(serviceFile, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        active = section[1].trim() === serviceName;
        continue;
      }
      if (!active || !line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator !== -1) {
        values[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
    }
  } catch {
    throw new Error('PGSERVICEFILE não pôde ser lido.');
  }
  const target = {
    host: values.host,
    port: values.port || '5432',
    database: values.dbname || values.database,
  };
  if (values.hostaddr && values.hostaddr !== target.host) {
    throw new Error(`${label} não pode sobrescrever host com hostaddr.`);
  }
  if (!target.host || !target.database) {
    throw new Error(`${label} não informa host e database.`);
  }
  if (expectedDatabase && target.database !== expectedDatabase) {
    throw new Error(`Database esperado não corresponde a ${label}.`);
  }
  return { name: serviceName, file: serviceFile, expectedDatabase, target };
}

export function assertSamePostgresTarget(connection, service, message) {
  const serviceIdentity = [service.target.host, service.target.port, service.target.database]
    .map((value) => value.toLowerCase())
    .join('|');
  if (postgresIdentity(connection) !== serviceIdentity) throw new Error(message);
}

export function postgresServiceEnvironment(service, inheritedEnv = process.env) {
  const env = { ...inheritedEnv };
  const passFile = env.PGPASSFILE;
  for (const key of Object.keys(env)) {
    if (key.startsWith('PG')) delete env[key];
  }
  for (const key of [
    'DATABASE_URL',
    'TEST_DATABASE_URL',
    'RESTORE_DATABASE_URL',
    'STAGING_DATABASE_URL',
    'PRODUCTION_DATABASE_URL',
  ]) {
    delete env[key];
  }
  env.PGSERVICEFILE = service.file;
  env.PGSERVICE = service.name;
  if (passFile) env.PGPASSFILE = passFile;
  return env;
}
```

Use JSDoc only where TypeScript inference from JavaScript is insufficient.

Do not add classes, schemas, factories or dependencies.

- [ ] **Step 5: Substituir duplicação no backup sem alterar o contrato**

Em `scripts/backup-crm.mjs`, importar:

```js
import {
  assertProtectedFile,
  assertSamePostgresTarget,
  parsePostgresUrl,
  postgresIdentity,
  postgresServiceEnvironment,
  readPostgresServiceTarget,
} from './postgres-target.mjs';
```

Preservar o export existente e manter a identidade como detalhe interno:

```js
export const parseConnectionUrl = parsePostgresUrl;
const connectionIdentity = postgresIdentity;
```

Remover as implementações locais de `parseConnectionUrl`, `connectionIdentity`, `readServiceTarget` e `assertProtectedFile`.

Substituir `serviceEnvironment(service)` por:

```js
function serviceEnvironment(service) {
  return postgresServiceEnvironment(service);
}
```

Substituir as chamadas de `readServiceTarget(...)` por:

```js
return readPostgresServiceTarget({
  serviceName,
  serviceFile,
  expectedDatabase,
  label: 'RESTORE_PG_SERVICE',
});
```

ou pelo mesmo objeto com `label: 'CUTOVER_PG_SERVICE'`.

Substituir comparações repetidas entre URL e serviço por:

```js
assertSamePostgresTarget(
  connection,
  service,
  'DATABASE_URL e CUTOVER_PG_SERVICE não apontam para o mesmo destino.'
);
```

No restore, usar a mensagem existente:

```js
assertSamePostgresTarget(
  restore,
  service,
  'RESTORE_DATABASE_URL e RESTORE_PG_SERVICE não apontam para o mesmo destino.'
);
```

Não mover `postgresEnv`, porque ele representa conexão por URL e não serviço nomeado.

- [ ] **Step 6: Validar regressão e diagnostics**

Run:

```bash
node --test tests/unit/backup-crm.test.ts
```

Expected: PASS, inclusive mensagens e proteções existentes.

Run:

```bash
npm run typecheck
npm run lint
```

Expected: exit `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/postgres-target.mjs scripts/backup-crm.mjs tests/unit/backup-crm.test.ts
git commit -m "refactor(db): share PostgreSQL target checks"
```

---

### Task 2: Implementar preflight operacional read-only

**Files:**

- Create: `scripts/migration-preflight.mjs`
- Create: `tests/unit/migration-preflight.test.js`

**Interfaces:**

- Consumes: helpers de `scripts/postgres-target.mjs` produzidos pela Task 1.
- Produces: `runMigrationPreflight({ env, execute, now })`, `formatMigrationPreflight(result)` e `formatMigrationPreflightFailure(error, now)`.
- CLI: `node scripts/migration-preflight.mjs` retorna `0` somente quando todos os gates passam.

- [ ] **Step 1: Criar harness isolado de arquivos protegidos**

Criar `tests/unit/migration-preflight.test.js` com imports e helpers:

```js
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formatMigrationPreflight,
  formatMigrationPreflightFailure,
  runMigrationPreflight,
} from '../../scripts/migration-preflight.mjs';

const secret = 'sentinel-secret-value';
const fixedNow = () => new Date('2026-08-18T12:00:00.000Z');

function withProtectedFiles(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-preflight-'));
  const serviceFile = path.join(root, 'pg_service.conf');
  const passFile = path.join(root, '.pgpass');
  writeFileSync(serviceFile, '[staging]\nhost=staging.test\nport=5433\ndbname=aspen_stage\n');
  writeFileSync(passFile, `staging.test:5433:aspen_stage:operator:${secret}\n`);
  chmodSync(serviceFile, 0o600);
  chmodSync(passFile, 0o600);
  try {
    return callback({ serviceFile, passFile });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function completeEnv(serviceFile, passFile) {
  return {
    STAGING_DATABASE_URL: `postgresql://operator:${secret}@staging.test:5433/aspen_stage`,
    STAGING_PG_SERVICE: 'staging',
    PRODUCTION_DATABASE_URL: `postgresql://operator:${secret}@prod.test:5433/aspen_prod`,
    PGSERVICEFILE: serviceFile,
    PGPASSFILE: passFile,
    DATABASE_URL: `postgresql://operator:${secret}@prod.test:5433/aspen_prod`,
    TEST_DATABASE_URL: `postgresql://operator:${secret}@wrong.test/wrong`,
  };
}
```

- [ ] **Step 2: Escrever os testes de falha do contrato**

Adicionar:

```js
test('requires every staging target input', () => {
  for (const missing of [
    'STAGING_DATABASE_URL',
    'STAGING_PG_SERVICE',
    'PRODUCTION_DATABASE_URL',
    'PGSERVICEFILE',
    'PGPASSFILE',
  ]) {
    const env = {
      STAGING_DATABASE_URL: 'postgresql://staging.test/aspen_stage',
      STAGING_PG_SERVICE: 'staging',
      PRODUCTION_DATABASE_URL: 'postgresql://prod.test/aspen_prod',
      PGSERVICEFILE: '/missing/service',
      PGPASSFILE: '/missing/pass',
    };
    delete env[missing];
    assert.throws(
      () => runMigrationPreflight({ env, execute: () => '', now: fixedNow }),
      new RegExp(missing)
    );
  }
});

test('rejects insecure PostgreSQL files', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    chmodSync(passFile, 0o644);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: completeEnv(serviceFile, passFile),
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /PGPASSFILE.*0600/
    );
  });
});

test('rejects a divergent hostaddr override', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    writeFileSync(
      serviceFile,
      '[staging]\nhost=staging.test\nhostaddr=192.0.2.10\nport=5433\ndbname=aspen_stage\n'
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env: completeEnv(serviceFile, passFile),
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /não pode sobrescrever host com hostaddr/
    );
  });
});

test('rejects missing service section and URL-service divergence', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: { ...env, STAGING_PG_SERVICE: 'missing' },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /STAGING_PG_SERVICE não informa host e database/
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env: {
            ...env,
            STAGING_DATABASE_URL: `postgresql://operator:${secret}@other.test:5433/aspen_stage`,
          },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /não apontam para o mesmo destino/
    );
  });
});

test('rejects production identity and unexpected current database', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env: { ...env, PRODUCTION_DATABASE_URL: env.STAGING_DATABASE_URL },
          execute: () => 'aspen_stage\n',
          now: fixedNow,
        }),
      /produção/
    );
    assert.throws(
      () =>
        runMigrationPreflight({
          env,
          execute: () => 'unexpected_database\n',
          now: fixedNow,
        }),
      /database inesperado/
    );
  });
});

test('hides tool failures and all sensitive values', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    assert.throws(
      () =>
        runMigrationPreflight({
          env,
          execute: () => {
            throw new Error(`psql leaked ${secret} staging.test`);
          },
          now: fixedNow,
        }),
      (error) => {
        assert.match(error.message, /Falha ao validar database efetivo/);
        const output = formatMigrationPreflightFailure(error, fixedNow);
        assert.match(output, /2026-08-18T12:00:00.000Z/);
        assert.match(output, /FAIL preflight de migration/);
        assert.doesNotMatch(output, new RegExp(secret));
        assert.doesNotMatch(output, /staging\.test/);
        return true;
      }
    );
  });
});
```

- [ ] **Step 3: Escrever o teste de sucesso read-only e ambiente sanitizado**

Adicionar:

```js
test('runs one read-only database identity query and emits redacted evidence', () => {
  withProtectedFiles(({ serviceFile, passFile }) => {
    const env = completeEnv(serviceFile, passFile);
    let calls = 0;
    const result = runMigrationPreflight({
      env,
      now: fixedNow,
      execute(file, args, options) {
        calls += 1;
        assert.equal(file, 'psql');
        assert.deepEqual(args, [
          '--no-psqlrc',
          '--quiet',
          '--tuples-only',
          '--no-align',
          '--set=ON_ERROR_STOP=1',
          '--dbname',
          'service=staging',
          '--command',
          'SELECT current_database();',
        ]);
        for (const key of [
          'DATABASE_URL',
          'TEST_DATABASE_URL',
          'RESTORE_DATABASE_URL',
          'STAGING_DATABASE_URL',
          'PRODUCTION_DATABASE_URL',
        ]) {
          assert.equal(options.env[key], undefined);
        }
        assert.equal(options.env.PGSERVICE, 'staging');
        assert.equal(options.env.PGSERVICEFILE, serviceFile);
        assert.equal(options.env.PGPASSFILE, passFile);
        return 'aspen_stage\n';
      },
    });

    assert.equal(calls, 1);
    const output = formatMigrationPreflight(result);
    assert.match(output, /2026-08-18T12:00:00.000Z/);
    assert.match(output, /PASS arquivos PostgreSQL protegidos/);
    assert.match(output, /PASS staging difere de produção/);
    assert.match(output, /PASS database efetivo confirmado/);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.doesNotMatch(output, /staging\.test|operator|aspen_stage/);
  });
});
```

- [ ] **Step 4: Executar os testes para confirmar RED**

Run:

```bash
node --test tests/unit/migration-preflight.test.js
```

Expected: FAIL porque `scripts/migration-preflight.mjs` ainda não existe.

- [ ] **Step 5: Implementar o preflight mínimo**

Criar `scripts/migration-preflight.mjs`.

A API deve seguir esta estrutura:

```js
#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertProtectedFile,
  assertSamePostgresTarget,
  parsePostgresUrl,
  postgresIdentity,
  postgresServiceEnvironment,
  readPostgresServiceTarget,
} from './postgres-target.mjs';

const REQUIRED_KEYS = [
  'STAGING_DATABASE_URL',
  'STAGING_PG_SERVICE',
  'PRODUCTION_DATABASE_URL',
  'PGSERVICEFILE',
  'PGPASSFILE',
];

function requiredEnvironment(env) {
  for (const key of REQUIRED_KEYS) {
    if (!String(env[key] || '').trim()) {
      throw new Error(`${key} é obrigatória para o preflight de migration.`);
    }
  }
}

export function runMigrationPreflight({
  env = process.env,
  execute = execFileSync,
  now = () => new Date(),
} = {}) {
  requiredEnvironment(env);
  assertProtectedFile(env.PGSERVICEFILE, 'PGSERVICEFILE');
  assertProtectedFile(env.PGPASSFILE, 'PGPASSFILE');

  const staging = parsePostgresUrl(env.STAGING_DATABASE_URL, 'STAGING_DATABASE_URL');
  const production = parsePostgresUrl(env.PRODUCTION_DATABASE_URL, 'PRODUCTION_DATABASE_URL');
  const service = readPostgresServiceTarget({
    serviceName: env.STAGING_PG_SERVICE,
    serviceFile: env.PGSERVICEFILE,
    expectedDatabase: staging.database,
    label: 'STAGING_PG_SERVICE',
  });
  assertSamePostgresTarget(
    staging,
    service,
    'STAGING_DATABASE_URL e STAGING_PG_SERVICE não apontam para o mesmo destino.'
  );
  if (postgresIdentity(staging) === postgresIdentity(production)) {
    throw new Error('STAGING_DATABASE_URL não pode apontar para produção.');
  }

  let currentDatabase;
  try {
    currentDatabase = execute(
      'psql',
      [
        '--no-psqlrc',
        '--quiet',
        '--tuples-only',
        '--no-align',
        '--set=ON_ERROR_STOP=1',
        '--dbname',
        `service=${service.name}`,
        '--command',
        'SELECT current_database();',
      ],
      {
        env: postgresServiceEnvironment(service, env),
        encoding: 'utf8',
      }
    ).trim();
  } catch {
    throw new Error('Falha ao validar database efetivo no serviço PostgreSQL.');
  }
  if (currentDatabase !== staging.database) {
    throw new Error('STAGING_PG_SERVICE apontou para database inesperado.');
  }

  return {
    timestamp: now().toISOString(),
    checks: [
      'arquivos PostgreSQL protegidos',
      'URL staging corresponde ao serviço nomeado',
      'staging difere de produção',
      'database efetivo confirmado',
    ],
  };
}

export function formatMigrationPreflight(result) {
  return (
    [`timestamp: ${result.timestamp}`, ...result.checks.map((check) => `PASS ${check}`)].join(
      '\n'
    ) + '\n'
  );
}

export function formatMigrationPreflightFailure(error, now = () => new Date()) {
  const message = error instanceof Error ? error.message : 'Falha inesperada.';
  return `timestamp: ${now().toISOString()}\nFAIL preflight de migration: ${message}\n`;
}

function isCli() {
  return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCli()) {
  try {
    process.stdout.write(formatMigrationPreflight(runMigrationPreflight()));
  } catch (error) {
    process.stderr.write(formatMigrationPreflightFailure(error));
    process.exitCode = 1;
  }
}
```

Não adicionar modo `--apply`.

Não importar Drizzle.

Não executar qualquer SQL além de `SELECT current_database();`.

- [ ] **Step 6: Executar os testes para confirmar GREEN**

Run:

```bash
node --test tests/unit/migration-preflight.test.js tests/unit/backup-crm.test.ts
```

Expected: PASS.

- [ ] **Step 7: Verificar lint e diagnostics**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: exit `0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/migration-preflight.mjs tests/unit/migration-preflight.test.js
git commit -m "feat(db): add staging migration preflight"
```

---

### Task 3: Implementar gate Git para migrations versionadas

**Files:**

- Create: `scripts/check-db-migrations.mjs`
- Create: `tests/unit/check-db-migrations.test.js`

**Interfaces:**

- Consumes: repositório Git e `MIGRATION_BASE_REF` opcional.
- Produces: `migrationRisk(content)`, `parseNameStatus(raw)`, `runMigrationCheck({ projectRoot, baseRef, executeGit, readContent, now })` e `formatMigrationCheck(result)`.
- CLI: `node scripts/check-db-migrations.mjs` retorna `1` para alteração histórica ou classificação inválida.

- [ ] **Step 1: Criar helpers de repositório temporário nos testes**

Criar `tests/unit/check-db-migrations.test.js` com:

```js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  formatMigrationCheck,
  migrationRisk,
  runMigrationCheck,
} from '../../scripts/check-db-migrations.mjs';

const fixedNow = () => new Date('2026-08-18T12:00:00.000Z');

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function withRepository(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-check-'));
  mkdirSync(path.join(root, 'drizzle'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.name', 'Migration Test');
  git(root, 'config', 'user.email', 'migration-test@example.invalid');
  writeFileSync(path.join(root, 'drizzle/0000_history.sql'), 'CREATE TABLE history (id int);\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  try {
    return callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function check(root, baseRef) {
  return runMigrationCheck({
    projectRoot: root,
    baseRef,
    now: fixedNow,
    executeGit: (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }),
    readContent: (file) => readFileSync(path.join(root, file), 'utf8'),
  });
}
```

- [ ] **Step 2: Escrever testes puros do cabeçalho**

Adicionar:

```js
test('accepts exactly one risk header as the first non-empty line', () => {
  assert.deepEqual(migrationRisk('\n-- migration-risk: additive\nCREATE TABLE x ();\n'), {
    risk: 'additive',
    valid: true,
  });
  assert.deepEqual(migrationRisk('-- migration-risk: destructive\nDROP TABLE x;\n'), {
    risk: 'destructive',
    valid: true,
  });
});

test('rejects missing, unknown and duplicate risk headers', () => {
  for (const content of [
    'CREATE TABLE x ();\n',
    '-- migration-risk: safe\nCREATE TABLE x ();\n',
    '-- comment\n-- migration-risk: additive\nCREATE TABLE x ();\n',
    '-- migration-risk: additive\n-- migration-risk: destructive\nCREATE TABLE x ();\n',
  ]) {
    assert.equal(migrationRisk(content).valid, false);
  }
});
```

- [ ] **Step 3: Escrever testes Git de adição e workspace limpo**

Adicionar:

```js
test('passes a clean workspace without reading historical migration headers', () => {
  withRepository((root) => {
    const result = check(root);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.violations, []);
    assert.match(formatMigrationCheck(result), /PASS migrations: nenhuma mudança/);
  });
});

test('accepts a classified untracked migration and redacts SQL contents', () => {
  withRepository((root) => {
    const secret = 'sentinel-secret-value';
    writeFileSync(
      path.join(root, 'drizzle/0001_additive.sql'),
      `\n-- migration-risk: additive\nSELECT '${secret}';\n`
    );
    const result = check(root);
    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.changes, [
      { path: 'drizzle/0001_additive.sql', previousPath: null, status: 'A' },
    ]);
    const output = formatMigrationCheck(result);
    assert.match(output, /status=A risk=additive result=PASS/);
    assert.doesNotMatch(output, new RegExp(secret));
  });
});

test('rejects new migrations with missing, unknown or duplicate headers', () => {
  withRepository((root) => {
    for (const [name, content] of [
      ['0001_missing.sql', 'CREATE TABLE x ();\n'],
      ['0002_unknown.sql', '-- migration-risk: safe\nCREATE TABLE x ();\n'],
      [
        '0003_duplicate.sql',
        '-- migration-risk: additive\n-- migration-risk: destructive\nCREATE TABLE x ();\n',
      ],
    ]) {
      writeFileSync(path.join(root, `drizzle/${name}`), content);
    }
    const result = check(root);
    assert.equal(result.violations.length, 3);
    assert.ok(result.violations.every((violation) => violation.reason === 'invalid-risk'));
  });
});
```

- [ ] **Step 4: Escrever testes de imutabilidade histórica**

Adicionar:

```js
test('rejects modification and deletion of historical migrations', () => {
  withRepository((root) => {
    const historical = path.join(root, 'drizzle/0000_history.sql');
    writeFileSync(historical, 'ALTER TABLE history ADD COLUMN changed int;\n');
    let result = check(root);
    assert.deepEqual(
      result.violations.map(({ status }) => status),
      ['M']
    );

    git(root, 'restore', 'drizzle/0000_history.sql');
    unlinkSync(historical);
    result = check(root);
    assert.deepEqual(
      result.violations.map(({ status }) => status),
      ['D']
    );
  });
});

test('rejects rename or copy of a historical migration', () => {
  withRepository((root) => {
    renameSync(
      path.join(root, 'drizzle/0000_history.sql'),
      path.join(root, 'drizzle/0001_renamed.sql')
    );
    let result = check(root);
    assert.ok(result.violations.some(({ status }) => status.startsWith('R') || status === 'D'));

    git(root, 'reset', '--hard', 'HEAD');
    writeFileSync(
      path.join(root, 'drizzle/0001_copy.sql'),
      readFileSync(path.join(root, 'drizzle/0000_history.sql'), 'utf8')
    );
    git(root, 'add', '.');
    result = check(root);
    assert.ok(
      result.violations.some(({ status }) => status.startsWith('C')) ||
        result.violations.some(({ reason }) => reason === 'invalid-risk')
    );
  });
});
```

A cópia deve falhar mesmo quando a heurística Git não a classificar como `C`, porque o conteúdo histórico copiado não possui cabeçalho novo.

- [ ] **Step 5: Escrever teste do ref base sobre commits da branch**

Adicionar:

```js
test('uses MIGRATION_BASE_REF semantics across committed branch changes', () => {
  withRepository((root) => {
    const base = git(root, 'rev-parse', 'HEAD').trim();
    writeFileSync(
      path.join(root, 'drizzle/0001_committed.sql'),
      '-- migration-risk: destructive\nDROP TABLE future_contract;\n'
    );
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'add migration');

    const result = check(root, base);
    assert.deepEqual(result.violations, []);
    assert.equal(result.changes[0].path, 'drizzle/0001_committed.sql');
    assert.match(formatMigrationCheck(result), /risk=destructive result=PASS/);
  });
});
```

- [ ] **Step 6: Executar os testes para confirmar RED**

Run:

```bash
node --test tests/unit/check-db-migrations.test.js
```

Expected: FAIL porque `scripts/check-db-migrations.mjs` ainda não existe.

- [ ] **Step 7: Implementar parser de header e status Git**

Criar `scripts/check-db-migrations.mjs`.

Usar somente APIs nativas.

Implementar o parser de risco:

```js
export function migrationRisk(content) {
  const lines = content.split(/\r?\n/);
  const declarations = lines.filter((line) => /^\s*--\s*migration-risk\s*:/.test(line));
  const firstContent = lines.find((line) => line.trim() !== '')?.trim() || '';
  const match = firstContent.match(/^-- migration-risk: (additive|destructive)$/);
  if (declarations.length !== 1 || !match) return { risk: 'invalid', valid: false };
  return { risk: match[1], valid: true };
}
```

Implementar `parseNameStatus(raw)` para o formato NUL de `git diff --name-status -z`.

Status `R*` e `C*` consomem caminho anterior e caminho novo.

Outros status consomem somente um caminho.

Normalizar separadores para `/`.

- [ ] **Step 8: Implementar coleta de mudanças Git**

O comando de diff deve ser equivalente a:

```bash
git diff --name-status -z --find-renames --find-copies --find-copies-harder "${MIGRATION_BASE_REF:-HEAD}" -- 'drizzle/*.sql'
```

A chamada real deve usar `execFileSync('git', args)` sem shell.

Também coletar:

```bash
git ls-files --others --exclude-standard -z -- 'drizzle/*.sql'
```

Adicionar arquivos não rastreados como status `A`.

Deduplicar por `status`, `previousPath` e `path`.

Para cada mudança:

- `A`: ler o conteúdo atual e validar `migrationRisk`.
- `M`, `D`, `R*`, `C*` e qualquer status diferente de `A`: registrar violação `historical-change`.

Não ler conteúdo removido.

Não inspecionar arquivos fora de `drizzle/*.sql`.

- [ ] **Step 9: Implementar resultado e saída redigida**

`runMigrationCheck` deve retornar:

```js
{
  commit: 'abc1234',
  timestamp: '2026-08-18T12:00:00.000Z',
  changes: [],
  violations: [],
  assessments: [],
}
```

Obter `commit` com `git rev-parse --short HEAD`.

Cada assessment deve conter somente:

```js
{
  path,
  previousPath,
  status,
  risk: 'additive' | 'destructive' | 'invalid' | 'historical',
  result: 'PASS' | 'FAIL',
}
```

`formatMigrationCheck` deve imprimir:

```text
commit: abc1234
timestamp: 2026-08-18T12:00:00.000Z
PASS drizzle/0001_additive.sql status=A risk=additive result=PASS
```

Para workspace limpo:

```text
commit: abc1234
timestamp: 2026-08-18T12:00:00.000Z
PASS migrations: nenhuma mudança
```

Não imprimir conteúdo SQL ou mensagens Git brutas.

No CLI, passar o ref base explicitamente e nunca escolher um ref remoto por heurística:

```js
const result = runMigrationCheck({
  projectRoot: PROJECT_ROOT,
  baseRef: process.env.MIGRATION_BASE_REF?.trim() || 'HEAD',
});
process.stdout.write(formatMigrationCheck(result));
if (result.violations.length > 0) process.exitCode = 1;
```

Capturar falhas de Git e emitir somente timestamp e erro genérico:

```js
process.stderr.write(
  `timestamp: ${new Date().toISOString()}\nFAIL check de migrations: não foi possível inspecionar o diff Git.\n`
);
process.exitCode = 1;
```

Definir `PROJECT_ROOT` com `fileURLToPath(new URL('../', import.meta.url))`.

Definir `process.exitCode = 1` quando houver violação ou falha do Git.

- [ ] **Step 10: Executar os testes para confirmar GREEN**

Run:

```bash
node --test tests/unit/check-db-migrations.test.js
```

Expected: PASS.

- [ ] **Step 11: Executar o gate no workspace real**

Run:

```bash
node scripts/check-db-migrations.mjs
```

Expected: exit `0` e `PASS migrations: nenhuma mudança`, porque nenhuma migration desta fase foi criada ou alterada.

- [ ] **Step 12: Verificar lint e diagnostics**

Run:

```bash
npm run lint
npm run typecheck
```

Expected: exit `0`.

- [ ] **Step 13: Commit**

```bash
git add scripts/check-db-migrations.mjs tests/unit/check-db-migrations.test.js
git commit -m "feat(db): guard versioned migrations"
```

---

### Task 4: Integrar comandos, CI e documentação operacional

**Files:**

- Modify: `package.json:5-35`
- Modify: `.github/workflows/ci.yml`
- Modify: `.env.example:1-22`
- Create: `docs/database-migrations.md`
- Modify: `docs/release-lanes.md:48-92`
- Modify: `docs/postgresql-drizzle-boundary.md:30-64`

**Interfaces:**

- Consumes: CLIs produzidos pelas Tasks 2 e 3.
- Produces: scripts npm `check:db-migrations` e `db:migration:preflight`, job CI `migrations` e runbook ativo.
- Preserves: `db:migrate` continua exatamente `drizzle-kit migrate`.

- [ ] **Step 1: Adicionar scripts npm sem acoplar apply**

Em `package.json`, manter:

```json
"db:migrate": "drizzle-kit migrate"
```

Adicionar:

```json
"check:db-migrations": "node scripts/check-db-migrations.mjs",
"db:migration:preflight": "node scripts/migration-preflight.mjs"
```

Atualizar `verify:fast` para incluir ambos os checks estáticos, mas não o preflight operacional:

```json
"verify:fast": "npm run lint && npm run typecheck && npm run check:db-boundary && npm run check:db-migrations && npm run test:unit"
```

Confirmar que `build`, `dev`, `server`, `test:unit` e CI padrão não chamam `db:migrate` ou `db:migration:preflight`.

- [ ] **Step 2: Adicionar job CI estático**

Adicionar a `.github/workflows/ci.yml`:

```yaml
migrations:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      with:
        persist-credentials: false
        fetch-depth: 0
    - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
      with:
        node-version: 22
        cache: npm
    - run: npm run check:db-migrations
      env:
        MIGRATION_BASE_REF: ${{ github.event.pull_request.base.sha }}
```

Atualizar o build:

```yaml
needs: [lint, types, unit, boundary, migrations]
```

Não adicionar secrets, PostgreSQL service, `npm run db:migrate`, preflight operacional ou E2E staging ao workflow.

- [ ] **Step 3: Documentar nomes operacionais no exemplo de ambiente**

Em `.env.example`, manter valores vazios e agrupar:

```dotenv
# Protected libpq files supplied by the approved operator environment.
PGSERVICEFILE=
PGPASSFILE=

# Staging migration target. Never inherit DATABASE_URL for a HIGH migration.
STAGING_DATABASE_URL=
STAGING_PG_SERVICE=
PRODUCTION_DATABASE_URL=
```

Não adicionar URL real, host, database, usuário ou senha.

Não criar `STAGING_EXPECTED_DATABASE`, porque o database esperado vem de `STAGING_DATABASE_URL` e é confirmado por `current_database()`.

- [ ] **Step 4: Criar o runbook ativo de migrations**

Criar `docs/database-migrations.md` com estas seções e comandos exatos:

````markdown
# Migrations PostgreSQL

## Regra principal

Migrations são mudanças HIGH e nunca executam implicitamente no startup, build ou CI padrão.

`npm run db:migrate` continua sendo o único apply e deve ser invocado explicitamente.

## Classificação

Toda migration nova começa com `-- migration-risk: additive` ou `-- migration-risk: destructive`.

Additive acrescenta estrutura compatível.

Destructive remove, renomeia ou torna estrutura ou dados incompatíveis.

O cabeçalho declara risco, mas não substitui review humano.

## Expand-contract

Mudança destructive segue `expand -> deploy compatível -> migrate data -> contract`.

Contract não ocorre antes de a aplicação deixar de depender da estrutura antiga e a migração de dados estar validada.

## Gate estático

Execute `npm run check:db-migrations`.

O gate recusa alteração de migration histórica e classificação inválida.

## Gate staging

O shell operacional aprovado fornece `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `PRODUCTION_DATABASE_URL`, `PGSERVICEFILE` e `PGPASSFILE`.

`PGSERVICEFILE` e `PGPASSFILE` devem ter modo `0600`.

Execute, nesta ordem:

```bash
npm run check:db-migrations
node scripts/cutover-env-status.mjs
npm run db:migration:preflight
TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

Pare na primeira falha.

Nunca execute o apply usando somente `DATABASE_URL`.

## Evidência

Salve stdout dos gates em diretório operacional protegido fora do checkout.

A evidência contém commit, timestamp, migration, risco e resultados redigidos.

Nunca salve URL, host, usuário, senha, PII, payload ou linha de dados.

## Falhas

O preflight é read-only e executa somente `SELECT current_database()`.

Falha de preflight não chama migration.

Falha de migration não libera E2E, Preview ou Production.

Não existe rollback automático para SQL arbitrário.

Restore usa o procedimento de backup existente e um alvo explicitamente isolado.
````

Escrever frases completas em linhas físicas separadas.

- [ ] **Step 5: Atualizar a lane HIGH**

Em `docs/release-lanes.md`, substituir o bloco de checks HIGH por:

```bash
npm run verify:full
npm run check:db-migrations
node scripts/cutover-env-status.mjs
npm run db:migration:preflight
TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

Adicionar referência a `docs/database-migrations.md`.

Declarar que:

- o check estático roda no CI;
- o preflight, apply e E2E staging são opt-in;
- URL e serviço nomeado precisam representar o mesmo staging;
- a identidade staging não pode igualar produção;
- stdout redigido fica fora do checkout;
- falha interrompe a lane;
- destructive segue expand-contract.

Remover o comando antigo baseado somente em teste de presença de `STAGING_DATABASE_URL`.

- [ ] **Step 6: Atualizar o boundary PostgreSQL + Drizzle**

Em `docs/postgresql-drizzle-boundary.md`, trocar a referência futura da Fase 16 por link ativo:

```markdown
A política operacional HIGH está em [Migrations PostgreSQL](./database-migrations.md).
```

Adicionar os checks obrigatórios:

```bash
npm run check:db-boundary
npm run check:db-migrations
```

Esclarecer que nenhum check executa migration ou abre escrita no banco.

- [ ] **Step 7: Executar testes focados**

Run:

```bash
node --test \
  tests/unit/backup-crm.test.ts \
  tests/unit/migration-preflight.test.js \
  tests/unit/check-db-migrations.test.js
```

Expected: PASS.

Run:

```bash
npm run check:db-boundary
npm run check:db-migrations
```

Expected: exit `0`.

- [ ] **Step 8: Executar diagnostics antes dos builds**

Run diagnostics nos arquivos JavaScript, TypeScript, JSON e YAML alterados.

Expected: nenhum erro bloqueante.

Não tratar ausência de language server Markdown como falha.

- [ ] **Step 9: Executar validação completa sem operação externa**

Run:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm test
node scripts/check-no-legacy-provider.mjs
npx prettier --check \
  scripts/postgres-target.mjs \
  scripts/migration-preflight.mjs \
  scripts/check-db-migrations.mjs \
  tests/unit/backup-crm.test.ts \
  tests/unit/migration-preflight.test.js \
  tests/unit/check-db-migrations.test.js \
  package.json \
  .github/workflows/ci.yml \
  .env.example \
  docs/database-migrations.md \
  docs/release-lanes.md \
  docs/postgresql-drizzle-boundary.md
git diff --check
```

Expected: todos exit `0`.

Não executar `npm run db:migration:preflight` no ambiente real durante esta validação, porque credenciais operacionais não estão aprovadas para execução.

Não executar `npm run db:migrate` ou `npm run test:e2e:staging`.

Remover somente outputs JavaScript gerados pelo build em `api/` que não sejam rastreados.

Não remover qualquer arquivo em `drizzle/`.

- [ ] **Step 10: Confirmar ausência de migration implícita**

Run:

```bash
rg -n 'db:migrate|db:migration:preflight|drizzle-kit migrate' \
  package.json .github scripts api
```

Expected:

- `db:migrate` aparece somente como script explícito e referências operacionais intencionais;
- `db:migration:preflight` não aparece em build, dev, startup ou CI padrão;
- `drizzle-kit migrate` não foi adicionado ao runtime.

- [ ] **Step 11: Commit**

```bash
git add \
  package.json \
  .github/workflows/ci.yml \
  .env.example \
  docs/database-migrations.md \
  docs/release-lanes.md \
  docs/postgresql-drizzle-boundary.md
git commit -m "ci(db): wire migration HIGH gates"
```

- [ ] **Step 12: Revisar o range completo**

Run:

```bash
git status --short
git log --oneline -5
git diff --stat 3883f7e..HEAD
git diff --check 3883f7e..HEAD
```

Expected:

- worktree limpo;
- quatro commits de implementação após a spec;
- nenhum arquivo histórico em `drizzle/` no diff;
- nenhum arquivo em `public/` no diff;
- `git diff --check` sem saída.
