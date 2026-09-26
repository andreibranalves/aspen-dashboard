// Smoke do chromium da imagem do aspen-worker: PDF e WebP de um HTML mínimo,
// com as mesmas restrições do compose e sem rede. Roda dentro da imagem:
//   docker run --rm --read-only --tmpfs /tmp:size=512m --network none \
//     -v "$PWD/deploy/worker/render-smoke.mjs:/smoke.mjs:ro" aspen-worker:<tag> node /smoke.mjs
import {
  renderQuotationPdf,
  renderQuotationWebpHtml,
} from '/app/api/_modules/quotation-pdf-renderer.js';

const html =
  '<!doctype html><html><body style="font-family: sans-serif">' +
  '<h1>Orçamento</h1><p>Renderização da imagem do worker.</p></body></html>';

const pdf = await renderQuotationPdf(html);
if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('PDF inválido.');
if (!pdf.includes('/FontFile')) throw new Error('PDF sem fonte embutida.');

const pages = await renderQuotationWebpHtml(html);
if (pages.length !== 1 || pages[0].subarray(8, 12).toString('latin1') !== 'WEBP') {
  throw new Error('WebP inválido.');
}

console.log(`render ok: pdf=${pdf.length}B webp=${pages[0].length}B`);
