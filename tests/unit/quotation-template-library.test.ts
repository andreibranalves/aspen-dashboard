import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQuotationTemplatesHandler } from '../../api/_modules/quotation-templates.js';
import {
  createQuotationTemplateLibraryRepository,
  QuotationTemplateLibraryConflictError,
  QuotationTemplateLibraryInputError,
} from '../../api/_infrastructure/db/repositories/quotation-template-library-repository.js';

const repository = {
  list: async (active?: boolean) => ({
    templates: active
      ? []
      : [
          {
            id: 'template-id',
            key: 'padrao',
            name: 'Padrão',
            archived: false,
            is_default: true,
            current_version_id: 'version-id',
            current_version: 1,
            current_hash: 'a'.repeat(64),
            updated_at: '2026-08-04T00:00:00.000Z',
            usage_count: 0,
          },
        ],
    default_key: 'padrao',
  }),
  get: async (id: string) =>
    id
      ? {
          id: 'template-id',
          key: 'padrao',
          name: 'Padrão',
          archived: false,
          is_default: true,
          current_version_id: 'version-id',
          current_version: 1,
          current_hash: 'a'.repeat(64),
          updated_at: '2026-08-04T00:00:00.000Z',
          usage_count: 0,
          current_source: '<!doctype html>',
          versions: [
            {
              id: 'version-id',
              version: 1,
              source_hash: 'a'.repeat(64),
              created_at: '2026-08-04T00:00:00.000Z',
            },
          ],
        }
      : null,
  create: async () => ({ id: 'template-id' }),
  saveVersion: async () => ({ id: 'version-id' }),
  archive: async () => ({ archived: true as const }),
  setDefault: async () => ({ default_key: 'padrao' }),
  validate: async () => ({ valid: true, warnings: [], preview: '<!doctype html>' }),
};

function event(method: string, path: string, query: Record<string, string> = {}, payload?: object) {
  return {
    httpMethod: method,
    headers: {},
    queryStringParameters: query,
    body: payload ? JSON.stringify(payload) : '',
    url: path,
  };
}

test('template library handler routes metadata, details, validation and mutations through repository seam', { concurrency: false }, async () => {
  const handler = createQuotationTemplatesHandler({ repository });
    let response = await handler(event('GET', '/api/quotation-templates'));
    let payload = JSON.parse(response.body!);
    assert.equal(response.statusCode, 200);
    assert.equal('current_source' in payload.data[0], false);

    response = await handler(event('GET', '/api/quotation-templates', { id: 'template-id' }));
    payload = JSON.parse(response.body!);
    assert.equal(payload.data.current_source, '<!doctype html>');
    assert.equal(payload.data.versions.length, 1);

    response = await handler(event('GET', '/api/quotation-templates', { active: 'true' }));
    assert.deepEqual(JSON.parse(response.body!).templates, []);

    response = await handler(
      event(
        'POST',
        '/api/quotation-templates',
        {},
        { key: 'novo', name: 'Novo', source: '<!doctype html>' }
      )
    );
    assert.equal(response.statusCode, 201);
    response = await handler(
      event(
        'POST',
        '/api/quotation-templates/validate',
        {},
        { key: 'novo', source: '<!doctype html>' }
      )
    );
    assert.equal(response.statusCode, 200);
    response = await handler(
      event(
        'PUT',
        '/api/quotation-templates',
        { id: 'template-id' },
        { action: 'save_version', source: '<!doctype html>' }
      )
    );
    assert.equal(response.statusCode, 200);
    response = await handler(
      event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'archive' })
    );
    assert.equal(response.statusCode, 200);
    response = await handler(
      event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'set_default' })
    );
    assert.equal(response.statusCode, 200);
});

test('template library handler maps missing details and repository validation failures', { concurrency: false }, async () => {
    const rejectingRepository = {
      ...repository,
      get: async () => null,
      create: async (input: { key: string; name: string; source: string }) => {
        if (input.key === 'padrao')
          throw new QuotationTemplateLibraryInputError('A chave do template já está em uso.');
        if (!input.name.trim())
          throw new QuotationTemplateLibraryInputError('Nome de template inválido.');
        if (input.source.includes('<script>'))
          throw new QuotationTemplateLibraryInputError('HTML inválido.');
        if (input.source.includes('{{#if'))
          throw new QuotationTemplateLibraryInputError('Handlebars inválido.');
        return { id: 'template-id' };
      },
      archive: async () =>
        Promise.reject(
          new QuotationTemplateLibraryConflictError('Não é possível arquivar o template padrão.')
        ),
    };
    const handler = createQuotationTemplatesHandler({ repository: rejectingRepository });
    assert.equal(
      (await handler(event('GET', '/api/quotation-templates', { id: 'missing' }))).statusCode,
      404
    );
    const invalidInputs = [
      { key: 'padrao', name: 'Duplicado', source: '<!doctype html>' },
      { key: 'novo', name: '   ', source: '<!doctype html>' },
      { key: 'novo', name: 'HTML', source: '<script>' },
      { key: 'novo', name: 'Handlebars', source: '{{#if' },
    ];
    for (const input of invalidInputs) {
      const response = await handler(event('POST', '/api/quotation-templates', {}, input));
      assert.equal(response.statusCode, 400);
    }
    const archive = await handler(
      event('PUT', '/api/quotation-templates', { id: 'template-id' }, { action: 'archive' })
    );
    assert.equal(archive.statusCode, 409);
});

test('persisted-template validation previews the production secoes shape', async () => {
  const source = `<!doctype html><html><body>
    {{quote_number}} {{client.name}}
    {{#each items}}{{name}}{{/each}}
    {{display.total}}
    {{#if secoes.prazo_producao.enabled}}<h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p>{{/if}}
    {{#if secoes.pagamento.enabled}}<h2>{{secoes.pagamento.title}}</h2><p>{{secoes.pagamento.body_html}}</p>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<h2>{{secoes.condicoes_gerais.title}}</h2><p>{{secoes.condicoes_gerais.body_html}}</p>{{/if}}
  </body></html>`;
  const library = createQuotationTemplateLibraryRepository(() => {
    throw new Error('database must not be used by validation preview');
  });
  const result = await library.validate({ key: 'v2-real-shape', source });

  assert.equal(result.valid, true);
  assert.equal(result.contract_version, 2);
  assert.deepEqual(result.warnings, []);
  assert.match(result.preview, /Prazo de produção/);
  assert.match(result.preview, /À vista<br>Pix ou transferência/);
  assert.match(result.preview, /Frete FOB<br>Arte aprovada pelo cliente/);
});

test('v2 persistence validation rejects fragments missing every required field', async () => {
  const library = createQuotationTemplateLibraryRepository(() => {
    throw new Error('database must not be used by validation');
  });
  const fields = [
    ['quote_number', '{{quote_number}}'],
    ['client.name', '{{client.name}}'],
    ['#each items', '{{#each items}}{{name}}{{/each}}'],
    ['display.total', '{{display.total}}'],
  ];

  for (const [missing, field] of fields) {
    const source = fields
      .filter(([, candidate]) => candidate !== field)
      .map(([, candidate]) => candidate)
      .join(' ');
    await assert.rejects(
      () => library.validate({ key: `fragment-${missing.replace(/[^a-z]+/g, '-')}`, source }),
      (error: unknown) =>
        error instanceof QuotationTemplateLibraryInputError && error.message.includes(missing)
    );
  }

  const validSource = fields.map(([, field]) => field).join(' ');
  await assert.doesNotReject(() => library.validate({ key: 'fragment-complete', source: validSource }));
});

test('template library handler rejects malformed JSON and unsupported methods', { concurrency: false }, async () => {
    const handler = createQuotationTemplatesHandler({ repository });
    assert.equal(
      (await handler({ ...event('POST', '/api/quotation-templates'), body: '{' })).statusCode,
      400
    );
    assert.equal((await handler(event('DELETE', '/api/quotation-templates'))).statusCode, 405);
});
