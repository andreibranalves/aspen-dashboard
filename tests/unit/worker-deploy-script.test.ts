// deploy/worker/deploy-worker.sh contra um `docker` falso: valida o comando
// recebido pela chave restrita, o rollback automático e a retenção de imagens.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test, { afterEach } from 'node:test';

const SCRIPT = resolve('deploy/worker/deploy-worker.sh');
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const FAKE_DOCKER = `#!/bin/sh
printf '%s|%s\\n' "\${ASPEN_WORKER_TAG:-}" "$*" >> "$FAKE_LOG"
case "$1 $2" in
  "compose "*)
    case " $* " in
      *" up "*) [ "$ASPEN_WORKER_TAG" = "\${FAKE_UNHEALTHY_TAG:-}" ] && exit 1 ;;
    esac
    exit 0 ;;
  "build "*) cat > "$FAKE_BUILD_CONTEXT"; exit 0 ;;
  "image ls")
    case "$*" in
      *CreatedAt*) cat "$FAKE_IMAGES" ;;
      *) cut -f2 "$FAKE_IMAGES" ;;
    esac
    exit 0 ;;
  "image inspect") grep -q "	\${3#aspen-worker:}$" "$FAKE_IMAGES" ;;
  "image rm") exit 0 ;;
  *) exit 99 ;;
esac
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup({ current, images = [] }: { current?: string; images?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-deploy-'));
  dirs.push(root);
  const bin = join(root, 'bin');
  const workerDir = join(root, 'aspen-worker');
  for (const dir of [bin, workerDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(bin, 'docker'), FAKE_DOCKER);
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'docker'), 0o755);
  chmodSync(join(bin, 'flock'), 0o755);
  writeFileSync(join(workerDir, 'docker-compose.yml'), 'name: aspen-worker\n');
  if (current) writeFileSync(join(workerDir, 'current-tag'), `${current}\n`);
  // Mais nova primeiro não importa: o script ordena por data de criação.
  writeFileSync(
    join(root, 'images'),
    images.map((tag, index) => `2026-09-${10 + index} 12:00:00 +0000 UTC\t${tag}\n`).join('')
  );

  function run(command: string, input = '') {
    const result = spawnSync('sh', [SCRIPT], {
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env.PATH}`,
        SSH_ORIGINAL_COMMAND: command,
        ASPEN_WORKER_DIR: workerDir,
        ASPEN_WORKER_LOCK: join(root, 'lock'),
        FAKE_LOG: join(root, 'docker.log'),
        FAKE_IMAGES: join(root, 'images'),
        FAKE_BUILD_CONTEXT: join(root, 'context.tar'),
        FAKE_UNHEALTHY_TAG: process.env.FAKE_UNHEALTHY_TAG_FOR_TEST ?? '',
      },
    });
    const log = existsSync(join(root, 'docker.log'))
      ? readFileSync(join(root, 'docker.log'), 'utf8').trim().split('\n')
      : [];
    const currentTag = existsSync(join(workerDir, 'current-tag'))
      ? readFileSync(join(workerDir, 'current-tag'), 'utf8').trim()
      : null;
    return { status: result.status, stderr: result.stderr, log, currentTag, root };
  }
  return { run };
}

function withUnhealthy<T>(tag: string, fn: () => T): T {
  process.env.FAKE_UNHEALTHY_TAG_FOR_TEST = tag;
  try {
    return fn();
  } finally {
    delete process.env.FAKE_UNHEALTHY_TAG_FOR_TEST;
  }
}

test('deploy script: refuses anything but "deploy|rollback <sha>" before touching docker', () => {
  const { run } = setup();
  for (const command of [
    '',
    'bash',
    `deploy ${SHA_A.slice(0, 39)}`,
    `deploy ${SHA_A.toUpperCase()}`,
    `deploy ${SHA_A} extra`,
    `remove ${SHA_A}`,
    `deploy ${SHA_A};id`,
    `deploy *`,
  ]) {
    const result = run(command);
    assert.equal(result.status, 1, command);
    assert.deepEqual(result.log, [], command);
  }
});

test('deploy script: builds the commit from stdin and brings it up', () => {
  const { run } = setup({ current: SHA_A, images: [SHA_A] });
  const result = run(`deploy ${SHA_B}`, 'tar-bytes');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.log[0], new RegExp(`^\\|build .*--build-arg GIT_SHA=${SHA_B} -t aspen-worker:${SHA_B} -$`));
  assert.equal(readFileSync(join(result.root, 'context.tar'), 'utf8'), 'tar-bytes');
  assert.ok(result.log.some((line) => line.startsWith(`${SHA_B}|compose `) && line.includes(' up -d --wait ')));
  assert.equal(result.currentTag, SHA_B);
});

test('deploy script: an unhealthy commit goes back to the previous image', () => {
  const { run } = setup({ current: SHA_A, images: [SHA_A] });
  const result = withUnhealthy(SHA_B, () => run(`deploy ${SHA_B}`, 'tar'));
  assert.equal(result.status, 1);
  const ups = result.log.filter((line) => line.includes(' up -d --wait '));
  assert.deepEqual(
    ups.map((line) => line.split('|')[0]),
    [SHA_B, SHA_A]
  );
  assert.equal(result.currentTag, SHA_A);
  assert.match(result.stderr, /voltou para aspen-worker:a{40}/);
});

test('deploy script: an unhealthy build is discarded so it takes no rollback slot', () => {
  const { run } = setup({ current: SHA_A, images: [SHA_A] });
  const result = withUnhealthy(SHA_B, () => run(`deploy ${SHA_B}`, 'tar'));
  assert.equal(result.status, 1);
  assert.ok(result.log.includes(`|image rm aspen-worker:${SHA_B}`));
  assert.ok(!result.log.includes(`|image rm aspen-worker:${SHA_A}`));
});

test('deploy script: a failed first deploy leaves no worker running', () => {
  const { run } = setup();
  const result = withUnhealthy(SHA_A, () => run(`deploy ${SHA_A}`, 'tar'));
  assert.equal(result.status, 1);
  // O compose recusa qualquer comando sem a tag; o down precisa levá-la.
  assert.ok(result.log.some((line) => line.startsWith(`${SHA_A}|compose `) && / down$/.test(line)));
  assert.equal(result.currentTag, null);
});

test('deploy script: redeploying the running commit never takes it down', () => {
  const { run } = setup({ current: SHA_A, images: [SHA_A] });
  const result = withUnhealthy(SHA_A, () => run(`deploy ${SHA_A}`, 'tar'));
  assert.equal(result.status, 1);
  assert.equal(result.log.filter((line) => line.includes(' up -d --wait ')).length, 1);
  assert.ok(!result.log.some((line) => / down$/.test(line) || line.includes('|image rm ')));
  assert.equal(result.currentTag, SHA_A);
});

test('deploy script: a rollback that fails keeps its image', () => {
  const { run } = setup({ current: SHA_B, images: [SHA_A, SHA_B] });
  const result = withUnhealthy(SHA_A, () => run(`rollback ${SHA_A}`));
  assert.equal(result.status, 1);
  assert.ok(!result.log.some((line) => line.includes('|image rm ')));
  assert.equal(result.currentTag, SHA_B);
});

test('deploy script: rollback reuses a built image and never builds', () => {
  const { run } = setup({ current: SHA_B, images: [SHA_A, SHA_B] });
  const result = run(`rollback ${SHA_A}`);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.log.some((line) => line.includes('|build ')));
  assert.equal(result.currentTag, SHA_A);
});

test('deploy script: rollback to an image that is not on the VPS fails without changes', () => {
  const { run } = setup({ current: SHA_B, images: [SHA_B] });
  const result = run(`rollback ${SHA_A}`);
  assert.equal(result.status, 1);
  assert.ok(!result.log.some((line) => line.includes('compose')));
  assert.equal(result.currentTag, SHA_B);
  assert.match(result.stderr, /Disponíveis:\n(.*\n)?b{40}/);
});

test('deploy script: keeps the five newest images plus the current and previous ones', () => {
  const tags = ['1', '2', '3', '4', '5', '6', '7', '8'].map((digit) => digit.repeat(40));
  // tags[0] é a mais antiga e é a anterior; tags[7] é a nova.
  const { run } = setup({ current: tags[0], images: tags });
  const result = run(`rollback ${tags[7]}`);
  assert.equal(result.status, 0, result.stderr);
  const removed = result.log
    .filter((line) => line.includes('|image rm '))
    .map((line) => line.split('aspen-worker:')[1]);
  assert.deepEqual(removed.sort(), [tags[1], tags[2]].sort());
});
