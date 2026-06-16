import { renderQuotationHtml } from './lib/quotation-html.js';
import { resolvePrintFormat } from './lib/print-format.js';

export async function handler(event) {
  const quotationId = event.queryStringParameters?.q;
  if (!quotationId) {
    return { statusCode: 400, headers: { 'Content-Type': 'text/plain' }, body: 'Parâmetro ?q= obrigatório' };
  }

  try {
    const printFormat = await resolvePrintFormat(quotationId, event.queryStringParameters?.format);
    const { html } = await renderQuotationHtml(quotationId, { printFormat });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: html,
    };
  } catch (err) {
    if (err?.statusCode === 404) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/plain' }, body: 'Orçamento não encontrado' };
    }
    console.error('[view]', err?.message || err);
    return { statusCode: 502, headers: { 'Content-Type': 'text/plain' }, body: 'Erro ao buscar orçamento' };
  }
}
