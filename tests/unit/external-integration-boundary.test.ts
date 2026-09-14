import assert from 'node:assert/strict';
import test from 'node:test';
import { findExternalIntegrationBoundaryViolations } from '../../scripts/check-external-integration-boundary.mjs';

const source = (path: string, content: string) => ({ path, content });

test('reports direct provider imports, env reads, and OpenRouter endpoint access', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source('api/_modules/a.ts', "import { kv } from '@vercel/kv';\n"),
      source('api/_shared/b.ts', 'const key = process.env.OPENROUTER_API_KEY;\n'),
      source('api/_modules/c.ts', "fetch('https://openrouter.ai/api/v1/chat/completions');\n"),
    ]),
    [
      { path: 'api/_modules/a.ts', line: 1, target: '@vercel/kv' },
      { path: 'api/_modules/c.ts', line: 1, target: 'openrouter endpoint' },
      { path: 'api/_shared/b.ts', line: 1, target: 'OPENROUTER_API_KEY' },
    ]
  );
});

test('rejects static and dynamic imports for every provider SDK entrypoint', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source(
        'api/_modules/static-blob.ts',
        "import { head } from '@vercel/blob';\nimport type { HeadBlobResult } from '@vercel/blob';\n"
      ),
      source('api/_modules/static-blob-client.ts', "import '@vercel/blob/client';\n"),
      source('api/_modules/static-kv.ts', "import { kv } from '@vercel/kv';\n"),
      source('api/_modules/dynamic-blob.ts', "const load = () => import('@vercel/blob');\n"),
      source(
        'api/_modules/dynamic-blob-client.ts',
        "const load = () => import('@vercel/blob/client');\n"
      ),
      source('api/_modules/dynamic-kv.ts', "const load = () => import('@vercel/kv');\n"),
    ]),
    [
      { path: 'api/_modules/dynamic-blob-client.ts', line: 1, target: '@vercel/blob/client' },
      { path: 'api/_modules/dynamic-blob.ts', line: 1, target: '@vercel/blob' },
      { path: 'api/_modules/dynamic-kv.ts', line: 1, target: '@vercel/kv' },
      { path: 'api/_modules/static-blob-client.ts', line: 1, target: '@vercel/blob/client' },
      { path: 'api/_modules/static-blob.ts', line: 1, target: '@vercel/blob' },
      { path: 'api/_modules/static-blob.ts', line: 2, target: '@vercel/blob' },
      { path: 'api/_modules/static-kv.ts', line: 1, target: '@vercel/kv' },
    ]
  );
});

test('rejects provider environment reads through properties and literal keys', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source(
        'api/_modules/env.ts',
        [
          'process.env.EVOLUTION_BASE_URL;',
          'process.env.OPENROUTER_MODEL;',
          'process.env.BLOB_READ_WRITE_TOKEN;',
          'process.env.QUOTATION_BLOB_READ_WRITE_TOKEN;',
          'process.env.VERCEL_OIDC_TOKEN;',
          "process.env['KV_REST_API_URL'];",
          'process.env["KV_REST_API_TOKEN"];',
        ].join('\n') + '\n'
      ),
    ]),
    [
      { path: 'api/_modules/env.ts', line: 1, target: 'EVOLUTION_BASE_URL' },
      { path: 'api/_modules/env.ts', line: 2, target: 'OPENROUTER_MODEL' },
      { path: 'api/_modules/env.ts', line: 3, target: 'BLOB_READ_WRITE_TOKEN' },
      { path: 'api/_modules/env.ts', line: 4, target: 'QUOTATION_BLOB_READ_WRITE_TOKEN' },
      { path: 'api/_modules/env.ts', line: 5, target: 'VERCEL_OIDC_TOKEN' },
      { path: 'api/_modules/env.ts', line: 6, target: 'KV_REST_API_URL' },
      { path: 'api/_modules/env.ts', line: 7, target: 'KV_REST_API_TOKEN' },
    ]
  );
});

test('reports Resend and QStash transports and credentials in TSX runtime modules', () => {
  const path = 'api/_modules/renderer.tsx';
  assert.deepEqual(findExternalIntegrationBoundaryViolations([source(path, [
    "fetch('https://api.resend.com/emails');",
    "fetch('https://qstash.upstash.io/v2/publish');",
    'process.env.RESEND_API_KEY;',
    'process.env.QSTASH_TOKEN;',
  ].join('\n'))]), [
    { path, line: 1, target: 'resend endpoint' },
    { path, line: 2, target: 'qstash endpoint' },
    { path, line: 3, target: 'RESEND_API_KEY' },
    { path, line: 4, target: 'QSTASH_TOKEN' },
  ]);
});

test('sorts findings by path, line, and target', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source(
        'api/_shared/z.ts',
        [
          "fetch('https://openrouter.ai/api/v1/chat/completions');",
          'process.env.OPENROUTER_API_KEY;',
          "import { kv } from '@vercel/kv';",
        ].join('\n') + '\n'
      ),
      source('api/_modules/b.ts', 'process.env.EVOLUTION_API_KEY;\n'),
      source('api/_modules/a.ts', "import { kv } from '@vercel/kv';\n"),
    ]),
    [
      { path: 'api/_modules/a.ts', line: 1, target: '@vercel/kv' },
      { path: 'api/_modules/b.ts', line: 1, target: 'EVOLUTION_API_KEY' },
      { path: 'api/_shared/z.ts', line: 1, target: 'openrouter endpoint' },
      { path: 'api/_shared/z.ts', line: 2, target: 'OPENROUTER_API_KEY' },
      { path: 'api/_shared/z.ts', line: 3, target: '@vercel/kv' },
    ]
  );
});

test('ignores integration and script files outside runtime scope', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source(
        'api/_infrastructure/integrations/blob/client.ts',
        [
          "import { head } from '@vercel/blob';",
          'process.env.BLOB_READ_WRITE_TOKEN;',
          "fetch('https://openrouter.ai/api/v1/chat/completions');",
        ].join('\n')
      ),
      source(
        'scripts/provider-check.ts',
        [
          "import { kv } from '@vercel/kv';",
          'process.env.KV_REST_API_URL;',
          "fetch('https://openrouter.ai/api/v1/chat/completions');",
        ].join('\n')
      ),
    ]),
    []
  );
});

test('accepts integration imports and harmless provider labels in runtime files', () => {
  assert.deepEqual(
    findExternalIntegrationBoundaryViolations([
      source(
        'api/_modules/feature.ts',
        [
          "import { getEvolutionClient } from '../_infrastructure/integrations/evolution/client.js';",
          "import { getOpenRouterClient } from '../_infrastructure/integrations/openrouter/client.js';",
          "import { getBlobClient } from '../_infrastructure/integrations/blob/client.js';",
          "import { getKvClient } from '../_infrastructure/integrations/kv/client.js';",
          "const provider = 'evolution';",
          "const missing = 'EVOLUTION_BASE_URL';",
          'const environmentName = name; // process.env[name] is intentionally indirect',
        ].join('\n')
      ),
    ]),
    []
  );
});
