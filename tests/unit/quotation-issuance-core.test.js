import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';
import { test } from 'node:test';

import {
  QuotationDocumentRepositoryError,
} from '../../api/_db/quotation-document-repository.js';
import {
  createQuotationDocumentHandler,
} from '../../api/_functions/quotation-document.js';
import {
  createQuotationIssueHandler,
  issueQuotation,
  QuotationPdfRenderError,
} from '../../api/_functions/quotation-issue.js';
import {
  createVercelQuotationDocumentStorage,
  isValidPdfBuffer,
  quotationPdfChecksum,
} from '../../api/_functions/lib/quotation-document-storage.js';
import { renderQuotationPdfHtml } from '../../api/_functions/lib/quotation-pdf.js';
import { DEFAULT_QUOTATION_TEMPLATE } from '../../api/_functions/lib/quotation-templates.js';
import { sendFunctionResult } from '../../api/_lib/function-adapter.js';

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF');

function snapshot() {
  return {
    quotation: {
      id: '11111111-1111-4111-8111-111111111111',
      businessNumber: 'ORC-20260001',
      clientId: '22222222-2222-4222-8222-222222222222',
      status: 'rascunho',
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
      updatedAt: new Date('2026-07-01T12:00:00.000Z'),
    },
    revision: {
      id: '33333333-3333-4333-8333-333333333333',
      quotationId: '11111111-1111-4111-8111-111111111111',
      version: 2,
      status: 'rascunho',
      validadeDias: 15,
      pagamento: 'À vista',
      entrega: '10 dias',
      fretePadrao: '0.00',
      frete: '12.50',
      observacoes: '<script>alert(1)</script>',
      prazoProducao: '5 dias',
      templatePadrao: DEFAULT_QUOTATION_TEMPLATE.key,
      templateHash: DEFAULT_QUOTATION_TEMPLATE.hash,
      clienteNome: '<b>Cliente snapshot</b>',
      clienteDocumento: '12345678000195',
      clienteEmail: 'cliente@example.com',
      clienteTelefone: '5511999999999',
      clienteEndereco: 'Rua A',
      clienteNumero: '10',
      clienteBairro: 'Centro',
      clienteComplemento: null,
      clienteMunicipio: 'São Paulo',
      clienteUf: 'SP',
      clienteCep: '01001000',
      clienteNotas: null,
      subtotal: '110.00',
      total: '122.50',
      createdAt: new Date('2026-07-01T12:00:00.000Z'),
    },
    items: [{
      id: '44444444-4444-4444-8444-444444444444',
      revisionId: '33333333-3333-4333-8333-333333333333',
      position: 0,
      productSku: 'SKU-A',
      quantidade: '1.000',
      produtoSku: 'SKU-A',
      produtoNome: 'Produto snapshot',
      produtoDescricao: '',
      produtoUnidade: 'Und',
      produtoCategoria: null,
      produtoMarca: null,
      precoFonte: 'base',
      precoMinimoFaixa: null,
      precoSugerido: '110.00',
      precoAplicado: '110.00',
      diferencaPreco: '0.00',
      totalLinha: '110.00',
      manualRate: false,
    }],
  };
}

function issuedDocument(overrides = {}) {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    quotationId: '11111111-1111-4111-8111-111111111111',
    revisionId: '33333333-3333-4333-8333-333333333333',
    kind: 'quotation_pdf',
    blobPathname: `quotations/ORC-20260001/revision-2-${DEFAULT_QUOTATION_TEMPLATE.hash}-${'b'.repeat(64)}.pdf`,
    fileName: 'ORC-20260001-R2.pdf',
    mimeType: 'application/pdf',
    sizeBytes: PDF.length,
    checksumSha256: quotationPdfChecksum(PDF),
    templateKey: DEFAULT_QUOTATION_TEMPLATE.key,
    templateHash: DEFAULT_QUOTATION_TEMPLATE.hash,
    createdAt: new Date('2026-07-01T12:05:00.000Z'),
    ...overrides,
  };
}

test('issuance renders semantic snapshot HTML, archives a deterministic private key and commits metadata last', async () => {
  const source = snapshot();
  let renderedHtml = '';
  let completedInput;
  const repository = {
    prepare: async () => ({ snapshot: source, document: null }),
    complete: async (input) => {
      assert.equal(source.quotation.status, 'rascunho');
      assert.equal(source.revision.status, 'rascunho');
      completedInput = input;
      return issuedDocument(input);
    },
    find: async () => null,
  };
  const storage = {
    archive: async (pathname, buffer) => {
      assert.equal(buffer, PDF);
      const sourceHash = createHash('sha256').update(renderedHtml, 'utf8').digest('hex');
      assert.equal(pathname, `quotations/ORC-20260001/revision-2-${DEFAULT_QUOTATION_TEMPLATE.hash}-${sourceHash}.pdf`);
      return { pathname, sizeBytes: buffer.length, checksumSha256: quotationPdfChecksum(buffer) };
    },
    read: async () => null,
  };

  const result = await issueQuotation('ORC-20260001', {
    repository,
    storage,
    renderPdf: async (html) => {
      renderedHtml = html;
      return PDF;
    },
  });

  assert.equal(result.alreadyIssued, false);
  assert.match(renderedHtml, /<!doctype html>/i);
  assert.match(renderedHtml, /ORC-20260001/);
  assert.match(renderedHtml, /Produto snapshot/);
  assert.match(renderedHtml, /&lt;b&gt;Cliente snapshot&lt;\/b&gt;/);
  assert.doesNotMatch(renderedHtml, /<script>alert/);
  assert.equal(completedInput.fileName, 'ORC-20260001-R2.pdf');
  assert.equal(completedInput.expectedUpdatedAt, '2026-07-01T12:00:00.000Z');
  assert.equal(completedInput.mimeType, 'application/pdf');
  assert.equal(completedInput.checksumSha256, quotationPdfChecksum(PDF));
});

test('render, Blob and database failures stop before later stages and keep the source draft retryable', async () => {
  for (const failedStage of ['render', 'blob', 'commit']) {
    const source = snapshot();
    const calls = [];
    const repository = {
      prepare: async () => ({ snapshot: source, document: null }),
      complete: async (input) => {
        calls.push('commit');
        if (failedStage === 'commit') throw new QuotationDocumentRepositoryError();
        return issuedDocument(input);
      },
      find: async () => null,
    };
    const storage = {
      archive: async (pathname, buffer) => {
        calls.push('blob');
        if (failedStage === 'blob') throw new Error('segredo do provedor');
        return { pathname, sizeBytes: buffer.length, checksumSha256: quotationPdfChecksum(buffer) };
      },
      read: async () => null,
    };
    await assert.rejects(
      () => issueQuotation('ORC-20260001', {
        repository,
        storage,
        renderPdf: async () => {
          calls.push('render');
          if (failedStage === 'render') throw new Error('falha interna do Chromium');
          return PDF;
        },
      }),
      failedStage === 'render'
        ? (error) => error instanceof QuotationPdfRenderError && !error.message.includes('Chromium')
        : undefined,
    );
    assert.equal(source.quotation.status, 'rascunho');
    assert.equal(source.revision.status, 'rascunho');
    if (failedStage === 'render') assert.deepEqual(calls, ['render']);
    if (failedStage === 'blob') assert.deepEqual(calls, ['render', 'blob']);
    if (failedStage === 'commit') assert.deepEqual(calls, ['render', 'blob', 'commit']);
  }
});

test('an already issued revision is returned without rendering, upload or duplicate commit', async () => {
  const document = issuedDocument();
  const result = await issueQuotation('ORC-20260001', {
    repository: {
      prepare: async () => ({ snapshot: snapshot(), document }),
      complete: async () => { throw new Error('não deve persistir novamente'); },
      find: async () => document,
    },
    storage: {
      archive: async () => { throw new Error('não deve enviar novamente'); },
      read: async () => null,
    },
    renderPdf: async () => { throw new Error('não deve renderizar novamente'); },
  });
  assert.equal(result.alreadyIssued, true);
  assert.equal(result.document.id, document.id);
});

test('issuance endpoint gates core mode and returns safe Portuguese errors without provider details', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  const event = { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: JSON.stringify({ id: 'ORC-20260001' }) };
  try {
    delete process.env.CRM_CORE_QUOTES_ENABLED;
    const disabled = await createQuotationIssueHandler()(event);
    assert.equal(disabled.statusCode, 404);

    process.env.CRM_CORE_QUOTES_ENABLED = 'true';
    const handler = createQuotationIssueHandler({
      repository: {
        prepare: async () => ({ snapshot: snapshot(), document: null }),
        complete: async () => { throw new Error('não deve chegar ao commit'); },
        find: async () => null,
      },
      storage: {
        archive: async () => { throw new Error('não deve chegar ao Blob'); },
        read: async () => null,
      },
      renderPdf: async () => { throw new Error('segredo interno do Chromium'); },
    });
    const failed = await handler(event);
    assert.equal(failed.statusCode, 502);
    const payload = JSON.parse(failed.body);
    assert.match(payload.error, /Não foi possível gerar o PDF/i);
    assert.doesNotMatch(payload.error, /Chromium|segredo/i);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});

test('Blob retry reuses a valid deterministic orphan instead of overwriting or duplicating it', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(PDF);
      controller.close();
    },
  });
  const storage = createVercelQuotationDocumentStorage({
    put: async () => { throw new Error('already exists'); },
    get: async (pathname) => ({
      statusCode: 200,
      stream,
      headers: {},
      blob: {
        url: 'private://blob',
        downloadUrl: 'private://download',
        pathname,
        contentDisposition: 'inline',
        cacheControl: 'private',
        uploadedAt: new Date(),
        etag: 'etag',
        contentType: 'application/pdf',
        size: PDF.length,
      },
    }),
  });
  const pathname = `quotations/ORC-20260001/revision-2-${DEFAULT_QUOTATION_TEMPLATE.hash}-${'b'.repeat(64)}.pdf`;
  const archived = await storage.archive(pathname, Buffer.from('outro PDF'));
  assert.equal(archived.pathname, pathname);
  assert.equal(archived.sizeBytes, PDF.length);
  assert.equal(archived.checksumSha256, quotationPdfChecksum(PDF));
});

test('authenticated document handler returns verified PDF bytes and rejects integrity mismatch', async () => {
  const previous = process.env.CRM_CORE_QUOTES_ENABLED;
  process.env.CRM_CORE_QUOTES_ENABLED = 'true';
  try {
    const document = issuedDocument();
    const event = { httpMethod: 'GET', headers: {}, queryStringParameters: { id: document.id }, body: '' };
    const handler = createQuotationDocumentHandler({
      repository: { prepare: async () => null, complete: async () => document, find: async () => document },
      storage: {
        archive: async () => { throw new Error('not used'); },
        read: async () => ({
          pathname: document.blobPathname,
          buffer: PDF,
          contentType: 'application/pdf',
          sizeBytes: PDF.length,
          checksumSha256: quotationPdfChecksum(PDF),
        }),
      },
    });
    const response = await handler(event);
    assert.equal(response.statusCode, 200);
    assert.equal(response.isBase64Encoded, true);
    assert.deepEqual(Buffer.from(response.body, 'base64'), PDF);

    const corruptHandler = createQuotationDocumentHandler({
      repository: { prepare: async () => null, complete: async () => document, find: async () => document },
      storage: {
        archive: async () => { throw new Error('not used'); },
        read: async () => ({
          pathname: document.blobPathname,
          buffer: PDF,
          contentType: 'application/pdf',
          sizeBytes: PDF.length,
          checksumSha256: '0'.repeat(64),
        }),
      },
    });
    const corrupt = await corruptHandler(event);
    assert.equal(corrupt.statusCode, 503);
    assert.match(JSON.parse(corrupt.body).error, /integridade/i);
  } finally {
    if (previous === undefined) delete process.env.CRM_CORE_QUOTES_ENABLED;
    else process.env.CRM_CORE_QUOTES_ENABLED = previous;
  }
});

test('function adapter decodes Lambda-style base64 before sending binary responses', () => {
  let sent;
  let status;
  const response = {
    setHeader() {},
    status(value) { status = value; return this; },
    send(value) { sent = value; },
  };
  sendFunctionResult(response, { statusCode: 200, body: PDF.toString('base64'), isBase64Encoded: true });
  assert.equal(status, 200);
  assert.equal(Buffer.isBuffer(sent), true);
  assert.deepEqual(sent, PDF);
});

test('real Chromium smoke produces a valid PDF from semantic HTML', { timeout: 120000 }, async () => {
  const pdf = await renderQuotationPdfHtml('<!doctype html><html lang="pt-BR"><body><h1>ORC-20260001</h1><table><tr><td>Produto</td></tr></table></body></html>', { timeout: 60000 });
  assert.equal(isValidPdfBuffer(pdf), true);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
});
