#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { isAbsolute, relative as relativePath, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const guardPath = 'scripts/check-no-legacy-provider.mjs';
const guardTestPath = 'tests/unit/check-no-legacy-provider.test.js';
const MAX_ACTIVE_SOURCE_BYTES = 1024 * 1024;
const MAX_STATIC_PARSER_BYTES = 256 * 1024;
const MAX_STATIC_CONSTRUCTOR_CANDIDATES = 1024;
const MAX_TEMPLATE_DELIMITERS = 4096;
const MAX_STATIC_CONSTRUCTOR_ARGS = 256;
const MAX_STATIC_CONSTRUCTOR_OUTPUT = 4096;
const MAX_STATIC_CODE_POINT = 0x10ffff;
const STATIC_FOLDING_BUDGET = Symbol('static folding budget');
const { O_RDONLY, O_NOFOLLOW } = constants;
// On platforms without O_NOFOLLOW, pre/post lstat and realpath checks remain the
// fallback. A path-component symlink can still race between those checks there.
const OPEN_FLAGS = O_RDONLY | (typeof O_NOFOLLOW === 'number' ? O_NOFOLLOW : 0);

// Historical plans and immutable migration SQL are not active runtime. Generated
// output and tool reports are excluded only at their known output roots below.
const excludedPrefixes = [
  'drizzle/',
  'docs/superpowers/',
  '.superpowers/',
  'node_modules/',
  '.git/',
  '.worktrees/',
  'public/assets/',
  'public/node_modules/',
  'playwright-report/',
  'test-results/',
  '.playwright/',
  '.pi-subagents/',
];
const staticFoldingExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.jsonc']);
const activeRoots = [
  'api',
  'scripts',
  'src',
  'tests',
  'docs',
  'public',
  'assets',
  '.env.example',
  'package.json',
  'vite.config.js',
  'vercel.json',
  'AGENTS.md',
];
// Forbidden definitions are stored as one-way hashes so this guard is scanned normally.
const providerTokenHashes = new Map([
  ['88ccab686a7b6a5c5615cf91f96036853635b6a7c3bc29521dd1622f882af9e0', 'provider name'],
  ['9ad0884adda0b06bda82ab0f9519489d989ea43c02ae442f955fe0df8ff1924e', 'provider name'],
  ['636396f02b6571e40d8fe91cba550515c0cdc0e7d314c210e00b02256375a796', 'provider name'],
  ['0a84beab5b34f28393df09f0dfbb0ab3667ac59024afb243a8a15390f02c1a8c', 'operational flag'],
  ['10a0f5fdf3647e78854913ee7404ce59a664b6e4460c17351ff822767eda601e', 'quotes rollout flag'],
  ['2edd2c87950404183609ce9d3f686df25b0c218127e4ab24852782f0752ff779', 'provider identifier'],
  ['8b41786e15bb497e39cf0a395fff377ad48b9ffca08aee2c89c2cdc59e60981e', 'provider identifier'],
  ['cae71080c61c6454028246b6142ed7c8adc7fa34e0d7631e42f2e03fc54de512', 'compatibility mode field'],
  ['cebb3b7dfbee1d6cfc5b6a311eb035457d5fe02325cc5e255a7b4a1582f4241a', 'compatibility mode field'],
  ['b857e1015a1ce04d00de50988195cf7e26806449d78ef32bf73abcdb548be16a', 'compatibility doctype'],
  ['1116d1c57f4bf562e45dbd70d2df34d6597cadc11def7895b5f2887bcf6e150b', 'provider-era legacy module'],
  ['56a36b6cda23f531e8dc45aaf5c9cee6ad4fe1d8dbd8d392561916fc6fa6f29d', 'provider-era legacy module'],
  ['27f1b9cd2213d9f05b96758a1048869fd6148b2cb74d4f19be2be408e2e72505', 'provider-era legacy module'],
  ['7c65f2a5454ad827ec5acb2aa6aa0c847c2df30fccc475a57cd9d34757c4e958', 'provider-era legacy module'],
  ['da3daa2f1c6d4564f7b7ddb9b500cca46174d2ae03912e25519afcdd1107be5e', 'provider-era legacy module'],
  ['d58057758e6c402fa4d7264903079b2968f3d44f48c332e8ba08cddd0439afa3', 'provider-era legacy module'],
  ['8ec086bfa08989ea309f0cbab047506548aa56954e91d8b496b1482ba3ee65ff', 'mode module or route'],
  ['6b115cd9242a4f62d1b5478776ec19f7763f1d4c3fe3801f869241a9d3262b27', 'mode module or route'],
  ['7ea5e4318e9b886cd0638ea8e4a33f8aee88cdb0b06c30516f4a511b0165f3b6', 'mode module or route'],
  ['b54c2a00bfff148e25cd754a069114cbf02e302dfe6212b9db232ec605e6622e', 'migration module or script'],
  ['c3e9c7506415e1599253cde03a29b3db2e8090e48816196f369b0f3b92cff926', 'migration module or script'],
  ['b3b0d412ba80aa7f829b70bf54cafd2f2c4d93ce408a6a7c30b6e88300b99b9b', 'migration module or script'],
  ['b1d5e215098444f9d672311b52a25164a77b06f602e25d4e784b464a8660b5b7', 'migration module or script'],
  ['90d2939c758bb3734a5fc21199533f7a4ab6390464a895940865d3e19e8fa4f4', 'migration module or script'],
  ['553e0ed6a0fe65d112fb240a1ee1680cfb387736f4bb1654191d300050b38f77', 'removed external outbox module'],
  ['7c9c9d506b9b97bb175e45ccade2eec6a90d6cf5c1941cecdcd6a09d43ae1e02', 'removed external outbox module'],
  ['84bf0cd276f31497434ad21d9f4c2734cabac1e2165dde1a95a10f2136c351df', 'removed external outbox module'],
]);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const componentHashes = {
  crm: '9261ceef0b969e70ac20f1510f07a1e0d8db05f20c75161a2ef43b4eba27a7aa',
  core: '0d45f5fd462b8c70bffb10021ac1bcff3f58f29b1faf7568595095427d42812c',
  outbox: '7772189a259534b293ca813cb5bdb069828abb2a15fd7f8e0aab0face30cda22',
  identity: 'd24f1f612642b77b75cdca5b84b6870c84b8d622801569749a1a31ba73bcb40f',
};
const contextHashes = new Set([
  '4d13c439c96a7de8f3108394aa63ce16ca928a50fa2a0c6d1ea295b468d99b2d',
  '94c8ca6ffe62372acd5bd144a5f4b2a49dcba103da1b054b0f9d3427bf0a260b',
  '1b6cc06a3b705be3221487299e66d57b058d166681a340e09c671adbcce123a0',
]);
const doctypeHash = 'b857e1015a1ce04d00de50988195cf7e26806449d78ef32bf73abcdb548be16a';
const definitionMarkerPattern = new RegExp(['guard', '[- ]', 'definitions', '\\s*:'].join(''), 'i');

function isExcluded(path) {
  return excludedPrefixes.some((prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix));
}

export function normalizeCandidatePath(rawPath, baseRoot = root) {
  const raw = String(rawPath || '');
  if (!raw || raw.includes('\0')) return { invalid: true, path: raw || '<empty>' };
  // Git normally emits slash-separated paths. A literal backslash is a valid
  // POSIX filename, but normalizing it would read a different file and skip it.
  if (raw.includes('\\')) return { invalid: true, path: raw };
  const slashPath = raw;
  if (slashPath.startsWith('/') || /^[A-Za-z]:\//.test(slashPath)) {
    return { invalid: true, path: slashPath };
  }
  const segments = [];
  let traversed = false;
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      traversed = true;
      if (segments.length === 0) return { invalid: true, path: slashPath };
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join('/');
  if (traversed || !normalized || normalized === '..' || normalized.startsWith('../')) {
    return { invalid: true, path: slashPath };
  }
  const absolute = resolve(baseRoot, normalized);
  const rootPrefix = `${resolve(baseRoot)}/`;
  if (absolute !== resolve(baseRoot) && !absolute.startsWith(rootPrefix)) {
    return { invalid: true, path: normalized };
  }
  return { invalid: false, path: normalized };
}

function isInActiveRoot(path) {
  return activeRoots.some((activeRoot) => path === activeRoot || path.startsWith(`${activeRoot}/`));
}

function scopedPaths() {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--ignored', '--exclude-standard', '-z'],
    { cwd: root },
  ).toString('utf8');
  const paths = new Set([...output.split('\0').filter(Boolean), guardPath, guardTestPath]);
  const walk = (directory, relativeDirectory = '') => {
    if (!existsSync(directory)) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isExcluded(`${relative}/`)) walk(absolute, relative);
      } else {
        paths.add(relative);
      }
    }
  };
  for (const activeRoot of activeRoots) {
    const absolute = resolve(root, activeRoot);
    if (existsSync(absolute) && lstatSync(absolute).isDirectory()) walk(absolute, activeRoot);
    else if (existsSync(absolute)) paths.add(activeRoot);
  }
  return paths;
}

function lineNumberAt(source, index) {
  return source.slice(0, Math.max(0, index)).split('\n').length;
}

function checkPath(path) {
  return detectForbidden(path).map(({ label }) => `${path}:0:${label}`);
}

function supportsStaticFolding(path) {
  if (path === 'package.json') return true;
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
  return staticFoldingExtensions.has(extension);
}

function codePointLiteral(value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_STATIC_CODE_POINT) return null;
  const units = value <= 0xffff
    ? [value]
    : [
      0xd800 + ((value - 0x10000) >> 10),
      0xdc00 + ((value - 0x10000) & 0x3ff),
    ];
  try {
    return JSON.parse(`"${units.map((unit) => `\\u${unit.toString(16).padStart(4, '0')}`).join('')}"`);
  } catch {
    return null;
  }
}

function decodeLiteral(value, raw = false) {
  if (raw) return value;
  try {
    let invalid = false;
    const decode = (hex, radix) => {
      const decoded = codePointLiteral(Number.parseInt(hex, radix));
      if (decoded === null) invalid = true;
      return decoded || '';
    };
    const decoded = value
      .replace(/\\(?:\r\n|[\n\r\u2028\u2029])/g, '')
      .replace(/\\x([0-9a-f]{2})/gi, (_, hex) => decode(hex, 16))
      .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex) => decode(hex, 16))
      .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => decode(hex, 16))
      .replace(/\\([\\'"`])/g, '$1');
    return invalid ? null : decoded;
  } catch {
    return null;
  }
}

function canStartRegex(source, index) {
  let cursor = index - 1;
  while (cursor >= 0 && /\s/.test(source[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  if ((source[cursor] === '+' || source[cursor] === '-') && source[cursor - 1] === source[cursor]) {
    let run = 1;
    while (cursor - run >= 0 && source[cursor - run] === source[cursor]) run += 1;
    if (run === 2) return false;
  }
  if (/[([{,:;=!?&|+\-*%^~`]/.test(source[cursor])) return true;
  const before = source.slice(Math.max(0, cursor - 12), cursor + 1);
  return /(?:^|\s)(?:return|throw|case|typeof|void|delete|in|of|else|do)$/.test(before);
}

function parserCopy(source) {
  const output = source.split('');
  const blank = (index) => {
    if (output[index] !== '\n' && output[index] !== '\r') output[index] = ' ';
  };
  const stack = [{ kind: 'code', braceDepth: null }];
  const templates = [];
  let templateDelimiters = 0;
  let index = 0;
  while (index < source.length) {
    const frame = stack[stack.length - 1];
    const current = source[index];
    const next = source[index + 1];
    if (frame.kind === 'line-comment') {
      blank(index);
      if (current === '\n') stack.pop();
      index += 1;
      continue;
    }
    if (frame.kind === 'block-comment') {
      blank(index);
      if (current === '*' && next === '/') {
        blank(index + 1);
        stack.pop();
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (frame.kind === 'regex') {
      if (current === '/' && !frame.inClass && !frame.escaped) {
        output[index] = current;
        stack.pop();
      } else {
        blank(index);
        if (frame.escaped) frame.escaped = false;
        else if (current === '\\') frame.escaped = true;
        else if (current === '[') frame.inClass = true;
        else if (current === ']') frame.inClass = false;
      }
      index += 1;
      continue;
    }
    if (frame.kind === 'quote') {
      if (index === frame.start || current === frame.quote) output[index] = current;
      else blank(index);
      if (frame.escaped) frame.escaped = false;
      else if (current === '\\') frame.escaped = true;
      else if (current === frame.quote && index !== frame.start) stack.pop();
      index += 1;
      continue;
    }
    if (frame.kind === 'template') {
      if (current === '`' && !frame.escaped) {
        output[index] = current;
        frame.end = index;
        templates.push(frame);
        stack.pop();
        index += 1;
        continue;
      }
      blank(index);
      if (frame.escaped) {
        frame.escaped = false;
      } else if (current === '\\') {
        frame.escaped = true;
      } else if (current === '$' && next === '{') {
        output[index] = '$';
        output[index + 1] = '{';
        templateDelimiters += 1;
        if (templateDelimiters > MAX_TEMPLATE_DELIMITERS) return { code: output.join(''), complete: false, tooManyTemplates: true, templates };
        const interpolation = { start: index + 2, end: null };
        frame.interpolations.push(interpolation);
        stack.push({ kind: 'code', braceDepth: 1, interpolation });
        index += 1;
      }
      index += 1;
      continue;
    }
    if (current === '/' && next === '/') {
      blank(index);
      blank(index + 1);
      stack.push({ kind: 'line-comment' });
      index += 2;
      continue;
    }
    if (current === '/' && next === '*') {
      blank(index);
      blank(index + 1);
      stack.push({ kind: 'block-comment' });
      index += 2;
      continue;
    }
    if (current === '/' && canStartRegex(source, index)) {
      output[index] = current;
      stack.push({ kind: 'regex', escaped: false, inClass: false });
      index += 1;
      continue;
    }
    if (current === "'" || current === '"') {
      output[index] = current;
      stack.push({ kind: 'quote', quote: current, escaped: false, start: index });
      index += 1;
      continue;
    }
    if (current === '`') {
      output[index] = current;
      stack.push({ kind: 'template', escaped: false, start: index, end: null, interpolations: [] });
      index += 1;
      continue;
    }
    if (frame.braceDepth !== null) {
      if (current === '{') frame.braceDepth += 1;
      else if (current === '}' && --frame.braceDepth === 0) {
        if (frame.interpolation) frame.interpolation.end = index;
        stack.pop();
        index += 1;
        continue;
      }
    }
    index += 1;
  }
  const complete = stack.length === 1 || (stack.length === 2 && stack[1].kind === 'line-comment');
  return { code: output.join(''), complete, tooManyTemplates: false, templates };
}

function skipTrivia(source, start, limit = source.length) {
  let index = start;
  let steps = 0;
  while (index < limit && steps++ <= 4096) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < limit && source[index] !== '\n') index += 1;
      continue;
    }
    if (source[index] === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0 || end + 2 > limit) return { index: limit, complete: false };
      index = end + 2;
      continue;
    }
    return { index, complete: true };
  }
  return { index, complete: steps <= 4096 };
}

function isDoctypeContext(source, start, end) {
  const lineStart = source.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = source.indexOf('\n', end);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const before = source.slice(lineStart, start);
  const after = source.slice(end, lineEnd < 0 ? source.length : lineEnd);
  if (/(?:^|[?&])\s*$/.test(before) && /^\s*(?:=|&|$)/.test(after)) return true;
  if (/^\s*:/.test(after)) return true;
  if (/^\s*<!\s*doctype\b/i.test(line)) return false;
  return contextHashes.has(hash(line.slice(0, start - lineStart).toLowerCase()));
}

function isPathToken(source, start, end) {
  const previous = source[start - 1];
  const next = source[end];
  return !previous || /[/."'`]/.test(previous) && (!next || /[./"'`]/.test(next));
}

function inspectForbiddenToken(rawToken, index, source, folded, add) {
  const token = rawToken.includes('\\u') ? decodeLiteral(rawToken) : rawToken;
  if (token === null || token === undefined) return;
  const normalized = token.toLowerCase();
  const label = providerTokenHashes.get(hash(normalized));
  const end = index + rawToken.length;
  if (label && label !== 'compatibility doctype' &&
      (folded || !label.includes('module') || isPathToken(source, index, end)))
    add(label, index);
  if (token.includes('-')) {
    for (const part of token.split('-')) {
      const partLabel = providerTokenHashes.get(hash(part));
      if (partLabel === 'provider name') add(partLabel, index);
    }
  }
  const parts = normalized.split('_');
  if (parts.length >= 3 && hash(parts[0]) === componentHashes.crm && hash(parts[1]) === componentHashes.core) {
    add('rollout flag', index);
  }
  if (parts.length >= 2 && hash(parts[0]) === componentHashes.outbox) {
    add('external environment variable', index);
  }
  if (hash(normalized) === componentHashes.identity && source[end] === ':') {
    add('provider identifier', index);
  }
  if (!folded && hash(normalized) === doctypeHash && isDoctypeContext(source, index, end)) {
    add('compatibility doctype', index);
  }
}

const escapedIdentifierPart = String.raw`(?:[A-Za-z0-9_$]|\\u(?:\\{[0-9a-fA-F]+\\}|[0-9a-fA-F]{4}))+`;
const escapedIdentifierPattern = new RegExp(`${escapedIdentifierPart}(?:-${escapedIdentifierPart})*`, 'g');

function detectForbidden(source, folded = false) {
  const findings = new Map();
  const add = (label, index) => {
    if (!findings.has(label)) findings.set(label, index);
  };
  for (const match of source.matchAll(/[A-Za-z0-9_$]+(?:-[A-Za-z0-9_$]+)*/g))
    inspectForbiddenToken(match[0], match.index, source, folded, add);
  for (const match of source.matchAll(escapedIdentifierPattern)) {
    if (match[0].includes('\\u')) inspectForbiddenToken(match[0], match.index, source, folded, add);
  }
  return [...findings.entries()].map(([label, index]) => ({ label, index }));
}

function parseStaticInteger(expression, declarations) {
  const value = expression.trim();
  const match = value.match(/^([+-]?)\s*(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/);
  if (match) {
    const number = Number(match[2]);
    if (!Number.isSafeInteger(number)) return undefined;
    return match[1] === '-' ? -number : number;
  }
  const identifier = value.match(/^([+-]?)\s*([A-Za-z_$][\w$]*)$/);
  if (!identifier || !declarations.has(identifier[2])) return undefined;
  const number = declarations.get(identifier[2]);
  return identifier[1] === '-' ? -number : number;
}

// One source-order pass is deliberate: recursive declaration expansion is both
// unnecessary for simple constants and an easy route to non-termination.
function staticNumericDeclarations(source) {
  const declarations = new Map();
  const declarationPattern = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)(?:;|(?=\n|$))/g;
  for (const match of source.matchAll(declarationPattern)) {
    const number = parseStaticInteger(match[2], declarations);
    if (number !== undefined && Number.isSafeInteger(number)) declarations.set(match[1], number);
  }
  return declarations;
}

function delimiterPairs(source) {
  const opening = new Map([[')', '('], [']', '['], ['}', '{']]);
  const stack = [];
  const closeToOpen = new Map();
  const openToClose = new Map();
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    if (current === '(' || current === '[' || current === '{') {
      stack.push([current, index]);
      continue;
    }
    const expected = opening.get(current);
    const top = stack[stack.length - 1];
    if (expected && top?.[0] === expected) {
      stack.pop();
      closeToOpen.set(index, top[1]);
      openToClose.set(top[1], index);
    }
  }
  return { closeToOpen, openToClose };
}

function splitStaticArguments(value) {
  if (!value.trim()) return [];
  const argumentsList = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(' || value[index] === '[' || value[index] === '{') depth += 1;
    else if (value[index] === ')' || value[index] === ']' || value[index] === '}') depth -= 1;
    else if (value[index] === ',' && depth === 0) {
      argumentsList.push(value.slice(start, index));
      start = index + 1;
    }
    if (depth < 0 || argumentsList.length > MAX_STATIC_CONSTRUCTOR_ARGS) return null;
  }
  argumentsList.push(value.slice(start));
  return argumentsList;
}

const staticIdentifierPart = String.raw`(?:[A-Za-z_$]|\\u(?:\\{[0-9a-fA-F]+\\}|[0-9a-fA-F]{4}))`;
const staticIdentifierContinuation = String.raw`(?:[A-Za-z0-9_$]|\\u(?:\\{[0-9a-fA-F]+\\}|[0-9a-fA-F]{4}))`;
const staticIdentifierSource = `${staticIdentifierPart}${staticIdentifierContinuation}*`;
const staticIdentifierPattern = new RegExp(staticIdentifierSource, 'g');
const staticIdentifierStartPattern = new RegExp(`^${staticIdentifierSource}`);

function staticIdentifierValue(rawIdentifier) {
  return rawIdentifier.includes('\\u') ? decodeLiteral(rawIdentifier) : rawIdentifier;
}

function readStaticIdentifier(source, start) {
  const match = source.slice(start).match(staticIdentifierStartPattern);
  if (!match) return null;
  return {
    raw: match[0],
    value: staticIdentifierValue(match[0]),
    end: start + match[0].length,
  };
}

function parseStringMember(source, start, receiverLength = 6) {
  let cursor = start + receiverLength;
  let trivia = skipTrivia(source, cursor);
  if (!trivia.complete) return { unsupported: true };
  cursor = trivia.index;
  let optional = false;
  if (source[cursor] === '?') {
    optional = true;
    cursor += 1;
    trivia = skipTrivia(source, cursor);
    if (!trivia.complete) return { unsupported: true };
    cursor = trivia.index;
    if (source[cursor] === '.') {
      trivia = skipTrivia(source, cursor + 1);
      if (!trivia.complete) return { unsupported: true };
      cursor = trivia.index;
    }
  }
  let parenthesized = false;
  while (source[cursor] === ')') {
    parenthesized = true;
    trivia = skipTrivia(source, cursor + 1);
    if (!trivia.complete) return { unsupported: true };
    cursor = trivia.index;
  }
  let method = null;
  if (source[cursor] === '.') {
    trivia = skipTrivia(source, cursor + 1);
    if (!trivia.complete) return { unsupported: true };
    cursor = trivia.index;
    const match = readStaticIdentifier(source, cursor);
    if (match && (match.value === 'fromCharCode' || match.value === 'fromCodePoint')) {
      method = match.value;
      cursor = match.end;
    }
  } else if (source[cursor] === '[') {
    const memberTrivia = skipTrivia(source, cursor + 1);
    if (!memberTrivia.complete) return { unsupported: true };
    cursor = memberTrivia.index;
    const quote = source[cursor];
    if (quote !== "'" && quote !== '"') return { unsupported: true };
    let end = cursor + 1;
    let escaped = false;
    while (end < source.length) {
      const current = source[end];
      if (!escaped && current === quote) break;
      if (!escaped && current === '\\') escaped = true;
      else escaped = false;
      end += 1;
    }
    if (end >= source.length) return { unsupported: true };
    const decoded = decodeLiteral(source.slice(cursor + 1, end));
    const closeTrivia = skipTrivia(source, end + 1);
    if (!closeTrivia.complete || source[closeTrivia.index] !== ']') return { unsupported: true };
    if (decoded === 'fromCharCode' || decoded === 'fromCodePoint') method = decoded;
    cursor = closeTrivia.index + 1;
  } else if (optional) {
    const match = readStaticIdentifier(source, cursor);
    if (match && (match.value === 'fromCharCode' || match.value === 'fromCodePoint')) {
      method = match.value;
      cursor = match.end;
    }
  }
  if (!method) return { method: null, optional, unsupported: parenthesized };
  const callTrivia = skipTrivia(source, cursor);
  if (!callTrivia.complete) return { unsupported: true };
  cursor = callTrivia.index;
  if (source[cursor] === '?')
    return { method, optional: true, memberEnd: cursor, callOpen: null, unsupported: true };
  const callOpen = source[cursor] === '(' ? cursor : null;
  const chainedMember = callOpen === null && (source[cursor] === '.' || source[cursor] === '[');
  return {
    method,
    optional,
    memberEnd: cursor,
    callOpen,
    unsupported: optional || parenthesized || chainedMember,
  };
}

function decodeStaticStringArgument(expression) {
  const value = expression.trim();
  const leading = skipTrivia(value, 0);
  if (!leading.complete) return undefined;
  const quote = value[leading.index];
  if (quote !== "'" && quote !== '"') return undefined;
  let escaped = false;
  let end = leading.index + 1;
  while (end < value.length) {
    const current = value[end];
    if (!escaped && current === quote) break;
    if (!escaped && current === '\\') escaped = true;
    else escaped = false;
    end += 1;
  }
  if (end >= value.length) return undefined;
  const trailing = skipTrivia(value, end + 1);
  if (!trailing.complete || trailing.index !== value.length) return undefined;
  return decodeLiteral(value.slice(leading.index + 1, end));
}

function staticDecoderArguments(expression) {
  const value = expression.trim();
  const match = value.match(/^(parseInt|parseFloat)\b/);
  if (!match) return undefined;
  const parsed = parserCopy(value);
  if (!parsed.complete) return undefined;
  const open = parsed.code.indexOf('(');
  if (open < 0) return undefined;
  const close = delimiterPairs(parsed.code).openToClose.get(open);
  if (close === undefined || parsed.code.slice(close + 1).trim()) return undefined;
  const argumentsList = splitStaticArguments(value.slice(open + 1, close));
  if (!argumentsList || argumentsList.length === 0 || argumentsList.length > 2) return undefined;
  return { name: match[1], argumentsList };
}

function staticDecoderValue(expression, declarations) {
  const parsed = staticDecoderArguments(expression);
  if (!parsed) return undefined;
  const { name, argumentsList } = parsed;
  const text = decodeStaticStringArgument(argumentsList[0]);
  if (text === undefined) return undefined;
  if (name === 'parseFloat') {
    if (argumentsList.length !== 1) return undefined;
    const number = Number.parseFloat(text);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  let radix;
  if (argumentsList.length === 2) {
    const radixCode = parserCopy(argumentsList[1]).code;
    radix = parseStaticInteger(radixCode, declarations);
    if (radix === undefined) return undefined;
  }
  const number = Number.parseInt(text, radix);
  return Number.isSafeInteger(number) ? number : undefined;
}

function staticArgumentValues(argumentsList, declarations, sourceArguments = argumentsList) {
  const values = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index].trim();
    const sourceArgument = sourceArguments[index]?.trim() ?? argument;
    if (!argument) continue;
    if (argument.startsWith('...')) {
      const spread = argument.slice(3).trim();
      if (!spread.startsWith('[') || !spread.endsWith(']')) return null;
      const spreadArguments = splitStaticArguments(spread.slice(1, -1));
      const sourceSpread = sourceArgument.slice(3).trim();
      const sourceSpreadArguments = sourceSpread.startsWith('[') && sourceSpread.endsWith(']')
        ? splitStaticArguments(sourceSpread.slice(1, -1))
        : null;
      if (!spreadArguments || !sourceSpreadArguments || spreadArguments.length !== sourceSpreadArguments.length) return null;
      for (let itemIndex = 0; itemIndex < spreadArguments.length; itemIndex += 1) {
        const value = parseStaticInteger(spreadArguments[itemIndex], declarations);
        if (value === undefined) return null;
        values.push(value);
        if (values.length > MAX_STATIC_CONSTRUCTOR_ARGS) return null;
      }
      continue;
    }
    const value = parseStaticInteger(argument, declarations);
    const decoded = value === undefined ? staticDecoderValue(sourceArgument, declarations) : value;
    if (decoded === undefined) return null;
    values.push(decoded);
    if (values.length > MAX_STATIC_CONSTRUCTOR_ARGS) return null;
  }
  return values;
}

function isStaticDecoderCall(expression) {
  return Boolean(staticDecoderArguments(expression));
}

function suspiciousStaticArguments(argumentSource) {
  return /\b(?:0[xX][0-9a-f]+|0[bB][01]+|0[oO][0-7]+|\d)/i.test(argumentSource) || /\.\.\.\s*\[/.test(argumentSource);
}

function staticDeclarationEntries(source, code) {
  const declarationPattern = new RegExp(`\\bconst\\s+(${staticIdentifierSource})\\s*=\\s*([^;\\n]+)`, 'g');
  return [...code.matchAll(declarationPattern)].map((match) => {
    const expressionOffset = match[0].indexOf(match[2]);
    const expressionStart = match.index + expressionOffset;
    const expressionEnd = expressionStart + match[2].length;
    return {
      name: staticIdentifierValue(match[1]),
      index: match.index,
      expression: source.slice(expressionStart, expressionEnd).trim(),
      expressionStart,
      expressionEnd,
    };
  });
}

function staticReferenceIdentifier(expression) {
  const leading = skipTrivia(expression, 0);
  if (!leading.complete) return null;
  const identifier = readStaticIdentifier(expression, leading.index);
  if (!identifier) return null;
  const trailing = skipTrivia(expression, identifier.end);
  if (!trailing.complete || trailing.index !== expression.length) return null;
  return identifier.value;
}

function staticMethodReference(expression, receivers) {
  const leading = skipTrivia(expression, 0);
  if (!leading.complete) return null;
  const receiver = readStaticIdentifier(expression, leading.index);
  if (!receiver || !receivers.has(receiver.value)) return null;
  const parsed = parseStringMember(expression, receiver.end - receiver.raw.length, receiver.raw.length);
  if (!parsed.method || parsed.callOpen !== null || parsed.unsupported) return null;
  const trailing = skipTrivia(expression, parsed.memberEnd);
  if (!trailing.complete || trailing.index !== expression.length) return null;
  return parsed.method;
}

function staticConstructorAliases(source, code) {
  const receivers = new Map([['String', { index: -1 }]]);
  const aliases = new Map();
  for (const declaration of staticDeclarationEntries(source, code)) {
    if (!declaration.name) continue;
    const receiver = staticReferenceIdentifier(declaration.expression);
    if (receiver && receivers.has(receiver)) {
      receivers.set(declaration.name, { index: declaration.index });
      continue;
    }
    const method = staticMethodReference(declaration.expression, receivers);
    if (method) aliases.set(declaration.name, { method, index: declaration.expressionStart });
  }
  return { receivers, aliases };
}

function splitStaticAdditions(expression) {
  const parsed = parserCopy(expression);
  if (!parsed.complete || parsed.tooManyTemplates) return null;
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < parsed.code.length; index += 1) {
    const current = parsed.code[index];
    if (current === '(' || current === '[' || current === '{') depth += 1;
    else if (current === ')' || current === ']' || current === '}') depth -= 1;
    else if (current === '+' && depth === 0 && parsed.code[index - 1] !== '+' && parsed.code[index + 1] !== '+') {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  if (!parts.length) return null;
  parts.push(expression.slice(start));
  return parts;
}

function staticStringValue(expression, declarations, consumeWork, depth = 0, seen = new Set()) {
  if (depth > 8 || !expression.trim()) return undefined;
  const value = expression.trim();
  if (seen.has(value)) return undefined;
  const nextSeen = new Set(seen).add(value);
  const additions = splitStaticAdditions(value);
  if (additions) {
    let output = '';
    for (const part of additions) {
      const item = staticStringValue(part, declarations, consumeWork, depth + 1, new Set(nextSeen));
      if (item === undefined) return undefined;
      output += item;
      if (output.length > MAX_STATIC_CONSTRUCTOR_OUTPUT) return undefined;
      consumeWork(Math.max(1, part.length));
    }
    return output;
  }
  const leading = skipTrivia(value, 0);
  if (!leading.complete) return undefined;
  const quote = value[leading.index];
  if (quote === "'" || quote === '"') return decodeStaticStringArgument(value);
  if (quote === '`') {
    const parsed = parserCopy(value);
    const template = parsed.templates?.[0];
    if (!parsed.complete || !template || template.end !== value.length - 1) return undefined;
    const rawTemplate = /String\.raw\s*`/.test(value.slice(0, template.start));
    let cursor = template.start + 1;
    let output = '';
    for (const interpolation of template.interpolations) {
      const chunk = decodeLiteral(value.slice(cursor, interpolation.start - 2), rawTemplate);
      if (chunk === null) return undefined;
      output += chunk;
      const item = staticStringValue(value.slice(interpolation.start, interpolation.end), declarations, consumeWork, depth + 1, new Set(nextSeen));
      if (item === undefined) return undefined;
      output += item;
      cursor = interpolation.end + 1;
      consumeWork(Math.max(1, item.length));
    }
    const tail = decodeLiteral(value.slice(cursor, template.end), rawTemplate);
    if (tail === null) return undefined;
    output += tail;
    return output.length <= MAX_STATIC_CONSTRUCTOR_OUTPUT ? output : undefined;
  }
  const identifier = staticReferenceIdentifier(value);
  if (identifier === null || !declarations.has(identifier)) return undefined;
  return declarations.get(identifier);
}

function staticStringDeclarations(source, code, consumeWork) {
  const declarations = new Map();
  const expressions = [];
  for (const declaration of staticDeclarationEntries(source, code)) {
    if (!declaration.name) continue;
    const value = staticStringValue(declaration.expression, declarations, consumeWork);
    if (value === undefined) continue;
    declarations.set(declaration.name, value);
    expressions.push({ value, start: declaration.expressionStart, end: declaration.expressionEnd });
  }
  return expressions;
}

function staticConstructorStrings(source, code, openToClose, consumeWork) {
  const declarations = staticNumericDeclarations(code);
  const { receivers, aliases } = staticConstructorAliases(source, code);
  const expressions = [];
  const calls = [];
  let suspicious = false;
  let unsupportedConstructor = false;
  let candidates = 0;

  for (const match of code.matchAll(staticIdentifierPattern)) {
    if (match.index > 0 && /[A-Za-z0-9_$\\]/.test(code[match.index - 1])) continue;
    const receiverName = staticIdentifierValue(match[0]);
    const receiver = receivers.get(receiverName);
    if (!receiver || (receiver.index >= 0 && match.index <= receiver.index)) continue;
    if (++candidates > MAX_STATIC_CONSTRUCTOR_CANDIDATES) {
      suspicious = true;
      unsupportedConstructor = true;
      break;
    }
    const parsed = parseStringMember(source, match.index, match[0].length);
    if (parsed.method && parsed.callOpen !== null) {
      calls.push({ index: match.index, open: parsed.callOpen, method: parsed.method, unsupported: parsed.unsupported });
    } else if (parsed.method) {
      const prefix = code.slice(Math.max(0, match.index - 256), match.index);
      const alias = prefix.match(new RegExp(`\\bconst\\s+(${staticIdentifierSource})\\s*=\\s*$`));
      const aliasName = alias && staticIdentifierValue(alias[1]);
      if (aliasName && !parsed.unsupported) {
        aliases.set(aliasName, { method: parsed.method, index: match.index });
      } else {
        suspicious = true;
        unsupportedConstructor = true;
      }
      if (parsed.unsupported) {
        suspicious = true;
        unsupportedConstructor = true;
      }
    } else if (parsed.unsupported) {
      suspicious = true;
      unsupportedConstructor = true;
    }
    const nearbySource = source.slice(Math.max(0, match.index - 32), match.index + 192);
    const parenthesizedMember = /\(\s*String\s*\)\s*(?:\.\s*(?:fromCharCode|fromCodePoint)\b|\[\s*(['"])(?:fromCharCode|fromCodePoint)\1\s*\])\s*\(/.test(nearbySource);
    if ((/\bString\s*(?:\?\s*\.\s*|\.\s*|\[\s*)['"]?\s*(?:fromCharCode|fromCodePoint)\b/.test(source.slice(match.index, match.index + 160)) || parenthesizedMember) && !parsed.method) {
      suspicious = true;
      unsupportedConstructor = true;
    }
  }

  const aliasCallPattern = new RegExp(`(${staticIdentifierSource})\\s*\\(`, 'g');
  for (const match of code.matchAll(aliasCallPattern)) {
    if (match.index > 0 && /[A-Za-z0-9_$\\\\]/.test(code[match.index - 1])) continue;
    const alias = aliases.get(staticIdentifierValue(match[1]));
    if (!alias || match.index <= alias.index) continue;
    calls.push({ index: match.index, open: match.index + match[0].lastIndexOf('('), method: alias.method, unsupported: false });
  }
  for (const [name, alias] of aliases) {
    for (const match of code.matchAll(staticIdentifierPattern)) {
      if (match.index > 0 && /[A-Za-z0-9_$\\\\]/.test(code[match.index - 1])) continue;
      if (staticIdentifierValue(match[0]) !== name || match.index <= alias.index) continue;
      const trivia = skipTrivia(source, match.index + match[0].length);
      if (!trivia.complete || source[trivia.index] !== '(') {
        suspicious = true;
        unsupportedConstructor = true;
      }
    }
  }

  calls.sort((left, right) => left.index - right.index);
  for (const call of calls) {
    if (call.unsupported) {
      suspicious = true;
      unsupportedConstructor = true;
      continue;
    }
    const close = openToClose.get(call.open);
    if (close === undefined || close - call.open > MAX_STATIC_CONSTRUCTOR_OUTPUT * 4) {
      suspicious = true;
      unsupportedConstructor = true;
      continue;
    }
    consumeWork(close - call.open || 1);
    const argumentsList = splitStaticArguments(code.slice(call.open + 1, close));
    const sourceArgumentsList = splitStaticArguments(source.slice(call.open + 1, close));
    if (!argumentsList || !sourceArgumentsList || argumentsList.length !== sourceArgumentsList.length || argumentsList.length > MAX_STATIC_CONSTRUCTOR_ARGS + 1) {
      suspicious = true;
      unsupportedConstructor = true;
      continue;
    }
    const values = staticArgumentValues(argumentsList, declarations, sourceArgumentsList);
    if (values === null) {
      const argumentSource = code.slice(call.open + 1, close);
      const sourceArgumentValues = sourceArgumentsList || [];
      const unknownDecoders = argumentsList
        .map((argument, index) => ({ argument, source: sourceArgumentValues[index] || argument, index }))
        .filter(({ argument, source }) =>
          parseStaticInteger(argument, declarations) === undefined && isStaticDecoderCall(source)
        );
      const allArgumentsAreKnownDynamicDecoders = unknownDecoders.length > 0 && argumentsList.every((argument, index) => {
        if (parseStaticInteger(argument, declarations) !== undefined) return true;
        const decoder = staticDecoderArguments(sourceArgumentValues[index] || argument);
        return decoder?.name === 'parseInt' && decoder.argumentsList.length === 2 &&
          parseStaticInteger(decoder.argumentsList[1], declarations) !== undefined;
      });
      if (allArgumentsAreKnownDynamicDecoders) continue;
      const hasDynamicSpread = /\.\.\.\s*[A-Za-z_$]/.test(argumentSource);
      const hasDynamicIdentifier = /\b[A-Za-z_$][\w$]*\b/.test(argumentSource.replace(/\b(?:fromCharCode|fromCodePoint|pdfResult|head|tail)\b/g, ''));
      const approvedPdfSpread = /^\s*\.\.\.\s*pdfResult\.(?:head|tail)\s*$/.test(argumentSource);
      if (hasDynamicIdentifier || (hasDynamicSpread && !approvedPdfSpread) || suspiciousStaticArguments(argumentSource)) {
        suspicious = true;
        unsupportedConstructor = true;
      }
      continue;
    }
    try {
      const value = call.method === 'fromCharCode'
        ? values.map((number) => codePointLiteral(((number % 65536) + 65536) % 65536) || '').join('')
        : values.some((number) => number < 0 || number > MAX_STATIC_CODE_POINT)
          ? null
          : values.map((number) => codePointLiteral(number)).join('');
      if (value !== null && value.length <= MAX_STATIC_CONSTRUCTOR_OUTPUT)
        expressions.push({ value, start: call.index, end: close + 1 });
    } catch {
      suspicious = true;
      unsupportedConstructor = true;
    }
  }
  return { expressions, suspicious, unsupportedConstructor };
}

function mergeStaticExpressions(expressionLists) {
  const indexes = expressionLists.map(() => 0);
  const ordered = [];
  const total = expressionLists.reduce((sum, list) => sum + list.length, 0);
  for (let remaining = total; remaining > 0; remaining -= 1) {
    let selectedList = -1;
    for (let index = 0; index < expressionLists.length; index += 1) {
      const candidate = expressionLists[index][indexes[index]];
      const selected = selectedList < 0 ? undefined : expressionLists[selectedList][indexes[selectedList]];
      if (candidate && (!selected || candidate.start < selected.start || (candidate.start === selected.start && candidate.end < selected.end))) {
        selectedList = index;
      }
    }
    if (selectedList < 0) break;
    ordered.push(expressionLists[selectedList][indexes[selectedList]]);
    indexes[selectedList] += 1;
  }
  return ordered;
}

function combineStaticExpressions(maskedSource, expressionLists) {
  const ordered = mergeStaticExpressions(expressionLists);
  const folded = [];
  for (const expression of ordered) {
    const previous = folded[folded.length - 1];
    if (
      previous &&
      previous.end <= expression.start &&
      maskedSource.slice(previous.end, expression.start).trim() === '+'
    ) {
      const value = previous.value + expression.value;
      if (value.length <= MAX_STATIC_CONSTRUCTOR_OUTPUT) {
        folded[folded.length - 1] = { value, start: previous.start, end: expression.end };
        continue;
      }
    }
    folded.push(expression);
  }
  return mergeStaticExpressions([ordered, folded]);
}

function staticStrings(source, depth = 0) {
  if (depth > 2 || source.length > MAX_STATIC_PARSER_BYTES) return { expressions: [], unavailable: true };
  const parsed = parserCopy(source);
  if (!parsed.complete || parsed.tooManyTemplates) return { expressions: [], unavailable: true };
  const code = parsed.code;
  const workLimit = Math.max(1, source.length * 4);
  let workUsed = source.length;
  const consumeWork = (amount) => {
    workUsed += Math.max(1, amount);
    if (workUsed > workLimit) throw STATIC_FOLDING_BUDGET;
  };
  const literals = [];
  const literalPattern = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/gs;
  for (const match of source.matchAll(literalPattern)) {
    consumeWork(match[0].length);
    const token = match[0];
    const quote = token[0];
    let value = token.slice(1, -1);
    if (quote === '`') {
      value = value.replace(/\$\{\s*(['"])([^}]*?)\1\s*\}/g, '$2');
      value = value.replace(/\$\{[^}]*\}/g, '');
    }
    const decoded = decodeLiteral(value, quote === '`' && /String\.raw\s*`/.test(source.slice(Math.max(0, match.index - 12), match.index)));
    if (decoded !== null) literals.push({ value: decoded, start: match.index, end: match.index + token.length });
  }
  const pairs = delimiterPairs(code);
  const joined = [];
  const joinPattern = /\]\s*\.\s*join\(\s*(['"])\s*\1\s*\)/g;
  for (const match of source.matchAll(joinPattern)) {
    const open = pairs.closeToOpen.get(match.index);
    if (open === undefined || match.index - open > MAX_STATIC_CONSTRUCTOR_OUTPUT * 4) continue;
    const bodyLength = match.index - open;
    consumeWork(bodyLength);
    const body = source.slice(open + 1, match.index);
    const bodyCode = code.slice(open + 1, match.index);
    const bodyLiterals = [...body.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g)];
    if (bodyLiterals.length === 0 || bodyLiterals.length > MAX_STATIC_CONSTRUCTOR_ARGS || bodyCode.replace(/[\s,'"\x5b\x5d]/g, '')) continue;
    const decodedParts = bodyLiterals.map((item) => decodeLiteral(item[0].slice(1, -1)));
    if (!decodedParts.some((part) => part === null))
      joined.push({ value: decodedParts.join(''), start: open, end: match.index + match[0].length });
  }
  const constructors = staticConstructorStrings(source, code, pairs.openToClose, consumeWork);
  const stringDeclarations = staticStringDeclarations(source, code, consumeWork);
  const templateExpressions = [];
  for (const template of parsed.templates || []) {
    if (!template.interpolations.length) continue;
    const rawTemplate = /String\.raw\s*`/.test(source.slice(Math.max(0, template.start - 16), template.start));
    let cursor = template.start + 1;
    let value = '';
    let completeTemplate = true;
    for (const interpolation of template.interpolations) {
      if (interpolation.end === null) {
        completeTemplate = false;
        break;
      }
      const chunk = decodeLiteral(source.slice(cursor, interpolation.start - 2), rawTemplate);
      if (chunk === null) {
        completeTemplate = false;
        break;
      }
      value += chunk;
      const nested = staticStrings(source.slice(interpolation.start, interpolation.end), depth + 1);
      if (nested.unavailable) {
        completeTemplate = false;
        break;
      }
      const candidate = nested.expressions
        .filter((expression) => expression.start === 0 && expression.end === interpolation.end - interpolation.start)
        .sort((left, right) => right.value.length - left.value.length)[0];
      if (!candidate) {
        completeTemplate = false;
        break;
      }
      value += candidate.value;
      cursor = interpolation.end + 1;
    }
    if (completeTemplate) {
      const tail = decodeLiteral(source.slice(cursor, template.end), rawTemplate);
      if (tail === null) completeTemplate = false;
      else value += tail;
    }
    if (completeTemplate && value.length <= MAX_STATIC_CONSTRUCTOR_OUTPUT) {
      templateExpressions.push({ value, start: template.start, end: template.end + 1 });
    }
  }
  const expressions = combineStaticExpressions(code, [literals, joined, constructors.expressions, stringDeclarations, templateExpressions]);
  return { expressions, unavailable: false, suspicious: constructors.suspicious, unsupportedConstructor: constructors.unsupportedConstructor };
}

function checkText(path, bytes) {
  if (bytes.byteLength > MAX_ACTIVE_SOURCE_BYTES) return [`${path}:0:source too large`];
  const source = bytes.includes(0) ? bytes.toString('latin1') : bytes.toString('utf8');
  const findings = definitionMarkerPattern.test(source)
    ? [`${path}:0:invalid guard definition markers`]
    : [];
  // Raw scan is intentionally first and never replaced by parser masking.
  for (const { label, index } of detectForbidden(source))
    findings.push(`${path}:${lineNumberAt(source, index)}:${label}`);
  if (supportsStaticFolding(path)) {
    try {
      const folded = staticStrings(source);
      if (folded.unavailable) {
        findings.push(`${path}:0:static folding unavailable`);
      } else {
        if (folded.unsupportedConstructor) findings.push(`${path}:0:unsupported static string construction`);
        for (const literal of folded.expressions) {
          for (const { label, index } of detectForbidden(literal.value, true))
            findings.push(`${path}:${lineNumberAt(source, literal.start + index)}:${label}`);
        }
      }
    } catch (error) {
      if (error !== STATIC_FOLDING_BUDGET) throw error;
      findings.push(`${path}:0:static folding budget exhausted`);
    }
  }
  return findings;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isContained(target, baseRoot) {
  const relative = relativePath(baseRoot, target);
  return relative === '' || (!relative.startsWith('..') && !isAbsolute(relative));
}

function readBounded(fd) {
  const chunks = [];
  let total = 0;
  while (total <= MAX_ACTIVE_SOURCE_BYTES) {
    const length = Math.min(64 * 1024, MAX_ACTIVE_SOURCE_BYTES + 1 - total);
    const chunk = Buffer.alloc(length);
    const count = readSync(fd, chunk, 0, length, null);
    if (count === 0) break;
    chunks.push(chunk.subarray(0, count));
    total += count;
  }
  if (total > MAX_ACTIVE_SOURCE_BYTES) return { kind: 'too-large' };
  return { kind: 'file', bytes: Buffer.concat(chunks, total) };
}

function classifyOpenError(error) {
  if (error && typeof error === 'object' && error.code === 'ELOOP') return 'symlink';
  if (error && typeof error === 'object' && error.code === 'ENOENT') return 'missing';
  return 'unreadable';
}

// beforeOpen is intentionally only consumed by direct test callers. The CLI
// never supplies it, so production execution has no race-injection surface.
export function safeReadCandidate(rawPath, { rootDir = root, beforeOpen } = {}) {
  const baseRoot = resolve(rootDir);
  const normalized = normalizeCandidatePath(rawPath, baseRoot);
  if (normalized.invalid) return { kind: 'invalid', path: normalized.path };
  const absolutePath = resolve(baseRoot, normalized.path);
  let beforeStat;
  try {
    beforeStat = lstatSync(absolutePath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { kind: 'missing', path: normalized.path };
    return { kind: 'unreadable', path: normalized.path };
  }
  if (beforeStat.isSymbolicLink()) return { kind: 'symlink', path: normalized.path };
  if (!beforeStat.isFile()) return { kind: 'skip', path: normalized.path };
  let beforeRealPath;
  try {
    beforeRealPath = realpathSync(absolutePath);
    const realRoot = realpathSync(baseRoot);
    if (!isContained(realRoot, realRoot) || !isContained(beforeRealPath, realRoot)) return { kind: 'outside', path: normalized.path };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return { kind: 'missing', path: normalized.path };
    return { kind: 'unreadable', path: normalized.path };
  }
  if (typeof beforeOpen === 'function') beforeOpen({ absolutePath, path: normalized.path });
  let fd;
  try {
    fd = openSync(absolutePath, OPEN_FLAGS);
  } catch (error) {
    return { kind: classifyOpenError(error), path: normalized.path };
  }
  try {
    const fdStat = fstatSync(fd);
    if (!fdStat.isFile()) return { kind: 'race', path: normalized.path };
    let afterOpenStat;
    let afterOpenRealPath;
    try {
      afterOpenStat = lstatSync(absolutePath);
      afterOpenRealPath = realpathSync(absolutePath);
    } catch {
      return { kind: 'race', path: normalized.path };
    }
    if (afterOpenStat.isSymbolicLink()) return { kind: 'symlink', path: normalized.path };
    if (!afterOpenStat.isFile() || !sameIdentity(beforeStat, fdStat) || !sameIdentity(fdStat, afterOpenStat)) {
      return { kind: 'race', path: normalized.path };
    }
    const realRoot = realpathSync(baseRoot);
    if (!isContained(afterOpenRealPath, realRoot) || afterOpenRealPath !== beforeRealPath) {
      return { kind: 'race', path: normalized.path };
    }
    const readResult = readBounded(fd);
    if (readResult.kind === 'too-large') return { kind: 'too-large', path: normalized.path };
    let afterReadStat;
    let afterReadRealPath;
    try {
      afterReadStat = lstatSync(absolutePath);
      afterReadRealPath = realpathSync(absolutePath);
    } catch {
      return { kind: 'race', path: normalized.path };
    }
    if (afterReadStat.isSymbolicLink()) return { kind: 'symlink', path: normalized.path };
    if (!afterReadStat.isFile() || !sameIdentity(fdStat, afterReadStat) || afterReadRealPath !== beforeRealPath) {
      return { kind: 'race', path: normalized.path };
    }
    return { kind: 'file', path: normalized.path, bytes: readResult.bytes };
  } catch {
    return { kind: 'unreadable', path: normalized.path };
  } finally {
    try {
      closeSync(fd);
    } catch {
      // The descriptor is already unusable; preserve the deterministic finding.
    }
  }
}

function scan() {
  const findings = [];
  for (const rawPath of scopedPaths()) {
    const normalized = normalizeCandidatePath(rawPath);
    if (normalized.invalid) {
      findings.push(`${normalized.path}:0:path traversal/outside roots`);
      continue;
    }
    const path = normalized.path;
    if (!isInActiveRoot(path) || isExcluded(path)) continue;
    findings.push(...checkPath(path));
    const result = safeReadCandidate(path);
    if (result.kind === 'missing' || result.kind === 'skip') continue;
    if (result.kind === 'symlink') {
      findings.push(`${path}:0:tracked symlink forbidden`);
      continue;
    }
    if (result.kind === 'too-large') {
      findings.push(`${path}:0:source too large`);
      continue;
    }
    if (result.kind === 'invalid' || result.kind === 'outside' || result.kind === 'race' || result.kind === 'unreadable') {
      findings.push(`${path}:0:unreadable active source`);
      continue;
    }
    findings.push(...checkText(path, result.bytes));
  }
  const uniqueFindings = [...new Set(findings)].sort();
  if (uniqueFindings.length > 0) {
    process.stderr.write(`${uniqueFindings.join('\n')}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) scan();
