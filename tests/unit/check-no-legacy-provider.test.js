import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
import { safeReadCandidate } from '../../scripts/check-no-legacy-provider.mjs';

const guardSourcePath = fileURLToPath(new URL('../../scripts/check-no-legacy-provider.mjs', import.meta.url));
const guardTestSourcePath = fileURLToPath(new URL('./check-no-legacy-provider.test.js', import.meta.url));
const guardPath = 'scripts/check-no-legacy-provider.mjs';
const guardTestPath = 'tests/unit/check-no-legacy-provider.test.js';
const text = (codes) => Buffer.from(codes).toString('latin1');
const providerName = text([102, 114, 97, 112, 112, 101]);
const otherProviderName = text([101, 114, 112, 110, 101, 120, 116]);
const coreFlag = `${text([67, 82, 77])}_${text([67, 79, 82, 69])}_${text([80, 82, 79, 68, 85, 67, 84, 83])}_${text([69, 78, 65, 66, 76, 69, 68])}`;
const operationalFlag = `${text([67, 82, 77])}_${text([79, 80, 69, 82, 65, 84, 73, 79, 78, 65, 76])}_${text([77, 79, 68, 69])}`;
const quotesRolloutFlag = `${text([67, 82, 77])}_${text([81, 85, 79, 84, 69, 83])}_${text([82, 79, 76, 76, 79, 85, 84])}_${text([83, 84, 65, 84, 69])}`;
const providerIdentifier = `${text([101, 114, 112])}_${text([117, 114, 108])}`;
const providerIdentityPrefix = `${text([101, 114, 112])}:`;
const legacyModule = `${text([112, 114, 111, 100, 117, 99, 116, 115])}-${text([108, 101, 103, 97, 99, 121])}`;
const modeModule = `${text([111, 112, 101, 114, 97, 116, 105, 111, 110, 97, 108])}-${text([109, 111, 100, 101])}`;
const migrationModule = `${providerName}-${text([109, 105, 103, 114, 97, 116, 105, 111, 110])}`;
const outboxVariable = text([79, 85, 84, 66, 79, 88, 95, 78, 56, 78, 95, 85, 82, 76]);
const operationalMode = text([79, 80, 69, 82, 65, 84, 73, 79, 78, 65, 76, 95, 77, 79, 68, 69]);
const coreMode = text([67, 79, 82, 69, 95, 77, 79, 68, 69]);
const templateConstructor = ["String[", "'fromCharCode'", "](110, 56, 110)"].join('');
const secret = 'cliente@example.invalid';

function git(root, args) {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'provider-guard-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(join(root, 'tests/unit'), { recursive: true });
  cpSync(guardSourcePath, join(root, guardPath));
  cpSync(guardTestSourcePath, join(root, guardTestPath));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'guard@example.invalid']);
  git(root, ['config', 'user.name', 'Guard Test']);
  return root;
}

function writeFixture(root, relativePath, content) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function appendFixture(root, relativePath, content) {
  appendFileSync(join(root, relativePath), content);
}

function commitFixture(root) {
  git(root, ['add', '-A', '-f']);
  git(root, ['commit', '-qm', 'fixture']);
}

function runGuard(root) {
  return spawnSync(process.execPath, [guardPath], {
    cwd: root,
    encoding: 'utf8',
  });
}

function withFixture(callback) {
  const root = createFixture();
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('checks tracked paths and text, including case-insensitive matches', () => {
  withFixture((root) => {
    writeFixture(root, `src/${providerName}-handler.ts`, 'export const safe = true;\n');
    writeFixture(root, 'src/content.ts', `const value = '${providerName}';\nconst ${coreFlag} = true;\n`);
    writeFixture(root, 'src/case.ts', `${providerName.toUpperCase()}\n`);
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`src/${providerName}-handler\\.ts:0:provider name`));
    assert.match(result.stderr, /src\/content\.ts:1:provider name/);
    assert.match(result.stderr, /src\/content\.ts:2:rollout flag/);
    assert.match(result.stderr, /src\/case\.ts:1:provider name/);
  });
});

test('checks every path-pattern family and every rollout flag', () => {
  withFixture((root) => {
    writeFixture(root, `src/${legacyModule}.ts`, 'export const safe = true;\n');
    writeFixture(root, `src/${modeModule}.ts`, 'export const safe = true;\n');
    writeFixture(root, `src/${migrationModule}.ts`, 'export const safe = true;\n');
    writeFixture(
      root,
      'src/flags.ts',
      `${operationalFlag}\n${quotesRolloutFlag}\n${otherProviderName}\n${providerIdentifier}\n${providerIdentityPrefix}value\n`,
    );
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`src/${legacyModule}\\.ts:0:provider-era legacy module`));
    assert.match(result.stderr, new RegExp(`src/${modeModule}\\.ts:0:mode module or route`));
    assert.match(result.stderr, new RegExp(`src/${migrationModule}\\.ts:0:migration module or script`));
    assert.match(result.stderr, /src\/flags\.ts:1:operational flag/);
    assert.match(result.stderr, /src\/flags\.ts:2:quotes rollout flag/);
    assert.match(result.stderr, /src\/flags\.ts:3:provider name/);
    assert.match(result.stderr, /src\/flags\.ts:4:provider identifier/);
    assert.doesNotMatch(result.stderr, /src\/flags\.ts:5:provider identifier/);
  });
});

test('uses only the approved historical exclusions', () => {
  withFixture((root) => {
    writeFixture(root, `drizzle/${providerName}-history.sql`, providerName);
    writeFixture(root, `docs/superpowers/${providerName}.md`, providerName);
    writeFixture(root, `.superpowers/${providerName}.md`, providerName);
    writeFixture(root, 'docs/active.md', providerName);
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /docs\/active\.md:1:provider name/);
    assert.doesNotMatch(result.stderr, /drizzle\//);
    assert.doesNotMatch(result.stderr, /docs\/superpowers\//);
    assert.doesNotMatch(result.stderr, /\.superpowers\//);
  });
});

test('scans binary content for forbidden tokens and checks its path', () => {
  withFixture((root) => {
    writeFixture(root, 'assets/logo.bin', Buffer.from([0, ...Buffer.from(providerName)]));
    writeFixture(root, `assets/${providerName}.bin`, Buffer.from([0, 1, 2]));
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`assets/${providerName}\\.bin:0:provider name`));
    assert.match(result.stderr, /assets\/logo\.bin:1:provider name/);
  });
});

test('ignores tracked files deleted from the worktree', () => {
  withFixture((root) => {
    writeFixture(root, `src/${providerName}-deleted.ts`, providerName);
    writeFixture(root, 'src/deleted-content.ts', providerName);
    commitFixture(root);
    rmSync(join(root, `src/${providerName}-deleted.ts`));
    rmSync(join(root, 'src/deleted-content.ts'));

    const result = runGuard(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('scans new files the same way as tracked files', () => {
  withFixture((root) => {
    writeFixture(root, 'src/tracked.ts', providerName);
    commitFixture(root);
    const trackedResult = runGuard(root);
    assert.equal(trackedResult.status, 1);
    assert.match(trackedResult.stderr, /src\/tracked\.ts:1:provider name/);

    rmSync(join(root, 'src/tracked.ts'));
    writeFixture(root, 'src/new.ts', providerName);
    const newResult = runGuard(root);
    assert.equal(newResult.status, 1);
    assert.match(newResult.stderr, /src\/new\.ts:1:provider name/);
  });
});

test('reports deterministic labels without matched content or PII', () => {
  withFixture((root) => {
    writeFixture(root, 'src/leak.ts', `${providerName} ${secret}\n`);
    commitFixture(root);

    const first = runGuard(root);
    const second = runGuard(root);
    assert.equal(first.status, 1);
    assert.equal(first.stdout, '');
    assert.equal(first.stderr, second.stderr);
    assert.equal(first.stderr, 'src/leak.ts:1:provider name\n');
    assert.doesNotMatch(first.stderr, new RegExp(secret));
  });
});

test('scans guard and test source without whole-file exclusions', () => {
  const source = readFileSync(guardSourcePath, 'utf8').toLowerCase();
  const testSource = readFileSync(guardTestSourcePath, 'utf8').toLowerCase();
  assert.doesNotMatch(source, /path === guardpath \|\| path === guardtestpath/);
  assert.doesNotMatch(source, new RegExp(['guard', '[- ]', 'definitions', '\\s*:', 'start'].join('')));
  assert.doesNotMatch(source, new RegExp(['guard', '[- ]', 'definitions', '\\s*:', 'end'].join('')));
  assert.doesNotMatch(testSource, new RegExp(['guard', '[- ]', 'definitions', '\\s*:', 'start'].join('')));
  assert.doesNotMatch(testSource, new RegExp(['guard', '[- ]', 'definitions', '\\s*:', 'end'].join('')));
  assert.equal(runGuard(process.cwd()).status, 0);

  withFixture((root) => {
    appendFixture(root, guardPath, `\nconst appended = '${providerName}';\n`);
    appendFixture(root, guardTestPath, `\nconst appended = '${providerName}';\n`);
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /scripts\/check-no-legacy-provider\.mjs:.*:provider name/);
    assert.match(result.stderr, /tests\/unit\/check-no-legacy-provider\.test\.js:.*:provider name/);
  });
});

test('fails closed for marker misuse', () => {
  const marker = (kind) => ['// guard-', `definitions:${kind}`].join('');
  for (const [path, label] of [[guardPath, 'scripts/check-no-legacy-provider.mjs'], [guardTestPath, 'tests/unit/check-no-legacy-provider.test.js']]) {
    withFixture((root) => {
      appendFixture(root, path, `\n${marker('start')}\n${marker('end')}\n`);
      commitFixture(root);
      const result = runGuard(root);
      assert.equal(result.status, 1, label);
      assert.match(result.stderr, new RegExp(`${label.replaceAll('/', '\\/')}:0:invalid guard definition markers`));
    });
  }
});

test('scans ignored active source and generated API JavaScript', () => {
  withFixture((root) => {
    writeFixture(root, '.gitignore', 'src/ignored.ts\napi/**/*.js\n');
    writeFixture(root, 'src/ignored.ts', "const url = 'n' + '8n';\n");
    writeFixture(root, 'api/generated.js', `const env = ['OU', '${outboxVariable.slice(2)}'].join('');\n`);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/ignored\.ts:1:/);
    assert.match(result.stderr, /api\/generated\.js:1:/);
  });
});

test('folds static strings, constructors and aliases without executing code', () => {
  withFixture((root) => {
    writeFixture(
      root,
      'src/obfuscated.ts',
      [
        "const one = 'n' /* split */ + '8n';",
        `const two = \`${providerName}\`;`,
        "const three = ['n', '8n'].join('');",
        `const four = String.raw\`${providerName}\`;`,
        `const five = ['OU', '${outboxVariable.slice(2)}'].join('');`,
        `const six = '${operationalMode.slice(0, 2)}' + '${operationalMode.slice(2)}';`,
        `const seven = ['${coreMode.slice(0, 4).toLowerCase()}', '${coreMode.slice(4).toLowerCase()}'].join('');`,
        `const direct = String.fromCharCode(110, 56, 110);`,
        `const hex = String.fromCodePoint(0x6e, 0x38, 0x6e);`,
        `const binary = String.fromCharCode(0b01101110, 0b00111000, 0b01101110);`,
        `const octal = String.fromCharCode(0o156, 0o70, 0o156);`,
        `const signed = String.fromCodePoint(+110, +56, +110);`,
        `const wrapped = String.fromCharCode(65646, 65592, 65646);`,
        `const bracket = String['fromCharCode'](110, 56, 110);`,
        `const alias = String.fromCharCode; const viaAlias = alias(110, 56, 110);`,
        ['const inTemplate = `', '${', templateConstructor, '}', '`;'].join(''),
        `const first = 110; const second = 56; const third = 110;`,
        `const identifiers = String.fromCharCode(first, second, third);`,
        `const mixed = 'fr' + String.fromCharCode(97, 112, 112, 101);`,
        `const imported = import(String.fromCharCode(112, 114, 111, 100, 117, 99, 116, 115, 45, 108, 101, 103, 97, 99, 121));`,
        `const dynamic = (value) => String.fromCharCode(value, 56, 110);`,
        `const invalid = String.fromCodePoint(-1);`,
        `const tooLarge = String.fromCodePoint(0x110000);`,
        '<!doctype html>',
        `const ordinary = 'dark mode';`,
        `const parserToken = 'doctype';`,
      ].join('\n'),
    );

    const result = runGuard(root);
    assert.equal(result.status, 1);
    for (const line of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20]) {
      assert.match(result.stderr, new RegExp(`src/obfuscated\\.ts:${line}:`));
    }
    for (const line of [17, 21, 22, 23, 24, 25, 26])
      assert.doesNotMatch(result.stderr, new RegExp(`src/obfuscated\\.ts:${line}:`));
  });
});

test('fails closed for unsupported constructors and nested template interpolation', () => {
  withFixture((root) => {
    writeFixture(root, 'src/unsupported.ts', [
      'String?.fromCharCode(102, 114, 97, 112, 112, 101);',
      '(String.fromCharCode)(102, 114, 97, 112, 112, 101);',
      'String.fromCharCode(value, 56, 110);',
      '`fr${String.fromCharCode(97, 112, 112, 101)}`;',
    ].join('\n'));
    commitFixture(root);
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/unsupported\.ts:0:unsupported static string construction/);
    assert.match(result.stderr, /src\/unsupported\.ts:4:provider name/);
  });
});

test('closes lexical and static-constructor bypass probes', () => {
  withFixture((root) => {
    const slash = text([92]);
    const continuedLiteral = ['const value = "fr', slash, '\nappe";'].join('');
    const escapedIdentifier = ['const ', slash, 'u0066rappe = true;'].join('');
    writeFixture(root, 'src/line-comment.ts', `// ${providerName}\n`);
    writeFixture(root, 'src/block-comment.ts', `/* ${providerName} */\n`);
    writeFixture(root, 'src/division.ts', 'let index = 1; index++ / String.fromCharCode(102,114,97,112,112,101) / 1;\n');
    writeFixture(root, 'src/parenthesized.ts', '((String)).fromCharCode(102,114,97,112,112,101);\n');
    writeFixture(root, 'src/member-comments.ts', 'String /* receiver */ . /* member */ fromCharCode(102,114,97,112,112,101);\n');
    writeFixture(root, 'src/optional-member-comments.ts', 'String /* receiver */ ?. /* member */ fromCharCode(102,114,97,112,112,101);\n');
    writeFixture(root, 'src/parse-int.ts', 'String.fromCharCode(parseInt("102", 10), 114, 97, 112, 112, 101);\n');
    writeFixture(root, 'src/parse-float.ts', 'String.fromCharCode(parseFloat("102"), 114, 97, 112, 112, 101);\n');
    writeFixture(root, 'src/line-continuation.ts', `${continuedLiteral}\n`);
    writeFixture(root, 'src/escaped-identifier.ts', `${escapedIdentifier}\n`);
    writeFixture(root, 'src/asi-alias.ts', 'const alias = String.fromCharCode\nconst value = alias(102, 114, 97, 112, 112, 101);\n');
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/line-comment\.ts:1:provider name/);
    assert.match(result.stderr, /src\/block-comment\.ts:1:provider name/);
    assert.match(result.stderr, /src\/division\.ts:1:provider name/);
    assert.match(result.stderr, /src\/parenthesized\.ts:0:unsupported static string construction/);
    assert.match(result.stderr, /src\/member-comments\.ts:1:provider name/);
    assert.match(result.stderr, /src\/optional-member-comments\.ts:0:unsupported static string construction/);
    assert.match(result.stderr, /src\/parse-int\.ts:1:provider name/);
    assert.match(result.stderr, /src\/parse-float\.ts:1:provider name/);
    assert.match(result.stderr, /src\/line-continuation\.ts:1:provider name/);
    assert.match(result.stderr, /src\/escaped-identifier\.ts:1:provider name/);
    assert.match(result.stderr, /src\/asi-alias\.ts:2:provider name/);
  });
});

test('closes Unicode-escaped static-constructor identifiers and aliases', () => {
  withFixture((root) => {
    const escapedString = String.raw`\u0053tring`;
    const escapedFromCharCode = String.raw`\u0066romCharCode`;
    const escapedAlias = String.raw`\u0061lias`;
    const constructorArguments = '102, 114, 97, 112, 112, 101';
    writeFixture(
      root,
      'src/unicode-constructors.ts',
      [
        `const directReceiver = ${escapedString}.fromCharCode(${constructorArguments});`,
        `const directMember = String.${escapedFromCharCode}(${constructorArguments});`,
        `const both = ${escapedString}.${escapedFromCharCode}(${constructorArguments});`,
        `const bracketReceiver = ${escapedString}['fromCharCode'](${constructorArguments});`,
        `const bracketMember = String['${escapedFromCharCode}'](${constructorArguments});`,
        `const ${escapedAlias} = ${escapedString}.${escapedFromCharCode};`,
        `const viaAlias = ${escapedAlias}(${constructorArguments});`,
        `const optional = ${escapedString}?.${escapedFromCharCode}(${constructorArguments});`,
        `const comments = ${escapedString} /* receiver */ . /* member */ ${escapedFromCharCode}(${constructorArguments});`,
        `const optionalComments = ${escapedString} /* receiver */ ?. /* member */ ${escapedFromCharCode}(${constructorArguments});`,
      ].join('\n'),
    );
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    for (const line of [1, 2, 3, 4, 5, 7, 9])
      assert.match(result.stderr, new RegExp(`src/unicode-constructors\\.ts:${line}:provider name`));
    for (const line of [8, 10])
      assert.match(result.stderr, new RegExp(`src/unicode-constructors\\.ts:0:unsupported static string construction`));
  });
});

test('closes receiver, method, apply, and constant string alias bypasses', () => {
  withFixture((root) => {
    const constructorArguments = '102, 114, 97, 112, 112, 101';
    const template = ['const templated = `', '${one}${two}', '`;'].join('');
    writeFixture(
      root,
      'src/round-seven.ts',
      [
        'const S = String;',
        'const Receiver = S;',
        `const directReceiver = S.fromCharCode(${constructorArguments});`,
        `const bracketReceiver = Receiver['fromCharCode'](${constructorArguments});`,
        'const methodAlias = Receiver.fromCharCode;',
        `const viaMethodAlias = methodAlias(${constructorArguments});`,
        `const directApply = String.fromCharCode.apply(null, [${constructorArguments}]);`,
        `const aliasApply = methodAlias.apply(null, [${constructorArguments}]);`,
        `const one = '${providerName.slice(0, 2)}';`,
        `const two = '${providerName.slice(2)}';`,
        'const concatenated = one + two;',
        template,
      ].join('\n'),
    );
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    for (const line of [3, 4, 6, 11, 12])
      assert.match(result.stderr, new RegExp(`src/round-seven\\.ts:${line}:provider name`));
    assert.match(result.stderr, /src\/round-seven\.ts:0:unsupported static string construction/);
  });
});

test('finishes bounded static folding on adversarial repeated declarations', () => {
  withFixture((root) => {
    const declarations = Array.from({ length: 200 }, (_, index) => `const value${index} = ${index};`).join(' ');
    writeFixture(root, 'src/performance.ts', `${declarations}\nconst text = String.fromCharCode(value199);\n`);
    commitFixture(root);
    const started = Date.now();
    const result = runGuard(root);
    assert.ok(Date.now() - started < 5000, `guard took too long: ${Date.now() - started}ms`);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('fails closed on static folding budget exhaustion and scans later files', () => {
  withFixture((root) => {
    let nested = "['safe']";
    for (let index = 0; index < 40; index += 1) nested = `[${nested}.join('')]`;
    writeFixture(root, 'src/budget.ts', `${nested}.join('')\n`);
    writeFixture(root, 'src/after-budget.ts', `${providerName}\n`);
    commitFixture(root);
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/budget\.ts:0:static folding budget exhausted/);
    assert.match(result.stderr, /src\/after-budget\.ts:1:provider name/);
  });
});

test('rejects malformed marker definitions in active non-guard files', () => {
  withFixture((root) => {
    writeFixture(root, 'src/malformed.ts', `${['// guard-', 'definitions:start'].join('')}\nconst safe = true;\n`);
    commitFixture(root);
    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/malformed\.ts:0:invalid guard definition markers/);
  });
});

test('fails closed for NUL-containing source and oversized active files', () => {
  withFixture((root) => {
    writeFixture(root, 'src/nul.ts', Buffer.from(`safe\0${providerName}\n`));
    writeFixture(root, 'src/nul-constructor.ts', Buffer.from('String.fromCharCode(102,114,97,112,112,101)\0\n'));
    writeFixture(root, 'src/too-large.ts', 'x'.repeat(2 * 1024 * 1024 + 1));

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/nul\.ts:1:/);
    assert.match(result.stderr, /src\/nul-constructor\.ts:1:/);
    assert.match(result.stderr, /src\/too-large\.ts:0:source too large/);
  });
});

test('rejects literal backslash paths and nested excluded directories', () => {
  withFixture((root) => {
    writeFixture(root, 'src/normal.ts', 'safe\n');
    writeFixture(root, 'src/node_modules/nested.ts', providerName);
    writeFixture(root, 'src/public/assets/generated.ts', providerName);
    writeFixture(root, `src/${providerName}\\literal.ts`, 'safe\n');
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(`src/${providerName}\\\\literal[.]ts:0:path traversal/outside roots`));
    assert.match(result.stderr, /src\/node_modules\/nested\.ts:1:provider name/);
    assert.match(result.stderr, /src\/public\/assets\/generated\.ts:1:provider name/);
  });
});

test('rejects tracked symlinks without following their targets', () => {
  withFixture((root) => {
    writeFixture(root, 'outside.ts', 'safe\n');
    mkdirSync(join(root, 'src'), { recursive: true });
    symlinkSync('../outside.ts', join(root, 'src/link.ts'));
    commitFixture(root);

    const result = runGuard(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /src\/link\.ts:0:tracked symlink forbidden/);
    assert.doesNotMatch(result.stderr, /outside\.ts:1:/);
  });
});

test('rejects a symlink replacement between discovery and open', () => {
  withFixture((root) => {
    writeFixture(root, 'src/race.ts', 'safe\n');
    writeFixture(root, 'outside.ts', `${providerName}\n`);
    const result = safeReadCandidate('src/race.ts', {
      rootDir: root,
      beforeOpen: ({ absolutePath }) => {
        rmSync(absolutePath);
        symlinkSync('../outside.ts', absolutePath);
      },
    });
    assert.ok(['symlink', 'race'].includes(result.kind), JSON.stringify(result));
    assert.equal(result.bytes, undefined);
  });
});
