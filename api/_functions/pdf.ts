// GET /api/pdf?q=ORC-XXXX — returns quotation PDF (binary).
import type { FunctionEvent, FunctionResult } from '../_lib/types.js';
import { generateQuotationPdf } from './lib/quotation-pdf.js';

export async function handler(event: FunctionEvent): Promise<FunctionResult> {
  const quotationId = event.queryStringParameters?.q;
  if (!quotationId) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Parâmetro ?q= obrigatório' };
  }

  try {
    const { buffer, customerName } = await generateQuotationPdf(quotationId);

    // Sanitize filename: quotation ID + customer name, ASCII-safe
    const safeName = (customerName || 'cliente')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'cliente';
    const filename = `${quotationId} - ${safeName}.pdf`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err: unknown) {
    const details = err && typeof err === 'object' ? err as Record<string, unknown> : {};
    if (details.statusCode === 404 || details.code === 'NOT_FOUND') {
      return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Orçamento não encontrado' };
    }
    console.error('[pdf]', details.message || err);
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Erro ao gerar PDF' };
  }
}
