import { createHash } from 'node:crypto';

import Handlebars, { type TemplateDelegate } from 'handlebars';

/**
 * Repository-versioned quote templates.  Keep the source strings in this
 * module so a deployment always renders with the same source that produced a
 * persisted template hash.  Template interpolation deliberately uses normal
 * Handlebars escaping; templates must never use triple-stash expressions.
 */
const PADRAO_SOURCE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Orçamento {{quote_number}}</title>
  <style>
    :root { color-scheme: light; font-family: Arial, sans-serif; color: #172033; }
    body { margin: 0; padding: 32px; background: #fff; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #172033; padding-bottom: 18px; }
    h1 { margin: 0; font-size: 26px; }
    .muted { color: #5c667a; font-size: 13px; }
    .section { margin-top: 24px; }
    .client { border: 1px solid #d9deea; border-radius: 8px; padding: 14px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e5e8ef; text-align: left; }
    th { background: #f4f6fa; font-size: 12px; text-transform: uppercase; }
    .number { text-align: right; white-space: nowrap; }
    .totals { margin-left: auto; width: min(360px, 100%); margin-top: 16px; }
    .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
    .grand-total { border-top: 2px solid #172033; font-size: 18px; font-weight: 700; padding-top: 8px !important; }
    .terms { white-space: pre-line; }
  </style>
</head>
<body>
  <header class="header">
    <div><h1>Orçamento</h1><div class="muted">{{quote_number}} · Revisão {{revision}}</div></div>
    <div class="muted">Emitido em {{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="section client">
    <strong>Cliente</strong><br>
    {{client.name}}<br>
    {{#if client.document}}Documento: {{client.document}}<br>{{/if}}
    {{#if client.email}}E-mail: {{client.email}}<br>{{/if}}
    {{#if client.phone}}Telefone: {{client.phone}}<br>{{/if}}
    {{#if client.address}}{{client.address}}{{/if}}
  </section>
  <section class="section">
    <strong>Itens</strong>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Qtd.</th><th>Un.</th><th class="number">Unitário</th><th class="number">Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{unit}}</td><td class="number">{{display.unit_price}}</td><td class="number">{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <section class="section terms">
    {{#if terms.pagamento}}<strong>Pagamento:</strong> {{terms.pagamento}}<br>{{/if}}
    {{#if terms.entrega}}<strong>Entrega:</strong> {{terms.entrega}}<br>{{/if}}
    {{#if terms.production_deadline}}<strong>Prazo de produção:</strong> {{terms.production_deadline}}<br>{{/if}}
    {{#if terms.observations}}<strong>Observações:</strong> {{terms.observations}}{{/if}}
  </section>
</body>
</html>`;

const MINIMAL_SOURCE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>{{quote_number}} — {{client.name}}</title>
  <style>
    body { margin: 0; padding: 28px; font: 14px/1.5 Georgia, serif; color: #222; }
    header { display: flex; justify-content: space-between; border-bottom: 1px solid #222; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 23px; font-weight: 500; }
    .meta { text-align: right; font-size: 12px; }
    h2 { font-size: 15px; margin: 22px 0 5px; }
    table { width: 100%; border-collapse: collapse; }
    td, th { border-bottom: 1px solid #ddd; padding: 7px 3px; text-align: left; }
    th { font-size: 11px; text-transform: uppercase; }
    .right { text-align: right; }
    .summary { margin: 14px 0 0 auto; width: 260px; }
    .summary p { display: flex; justify-content: space-between; margin: 4px 0; }
    .summary .total { border-top: 1px solid #222; padding-top: 7px; font-size: 17px; }
    .terms { margin-top: 24px; white-space: pre-line; }
  </style>
</head>
<body>
  <header><h1>Proposta comercial</h1><div class="meta">{{quote_number}} · Rev. {{revision}}<br>{{display.quote_date}} — válida até {{display.validity_date}}</div></header>
  <h2>Cliente</h2><div>{{client.name}}{{#if client.document}} · {{client.document}}{{/if}}{{#if client.email}} · {{client.email}}{{/if}}</div>
  <h2>Itens</h2>
  <table><thead><tr><th>Descrição</th><th>Qtd.</th><th>Un.</th><th class="right">Preço</th><th class="right">Total</th></tr></thead><tbody>{{#each items}}<tr><td>{{name}}</td><td>{{quantity}}</td><td>{{unit}}</td><td class="right">{{display.unit_price}}</td><td class="right">{{display.line_total}}</td></tr>{{/each}}</tbody></table>
  <div class="summary"><p><span>Subtotal</span><span>{{display.subtotal}}</span></p><p><span>Frete</span><span>{{display.freight}}</span></p><p class="total"><strong>Total</strong><strong>{{display.total}}</strong></p></div>
  <div class="terms">{{#if terms.pagamento}}Pagamento: {{terms.pagamento}}\n{{/if}}{{#if terms.entrega}}Entrega: {{terms.entrega}}\n{{/if}}{{#if terms.production_deadline}}Prazo de produção: {{terms.production_deadline}}\n{{/if}}{{#if terms.observations}}Observações: {{terms.observations}}{{/if}}</div>
</body>
</html>`;

const BRANDED_SOURCE = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Or&ccedil;amento {{quote_number}}</title>
  <link
    href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap"
    rel="stylesheet">
  <style>
    :root {
      --navy: #33312f;
      --gold: #C8A04A;
      --gold-light: #E8C878;
      --text: #33312f;
      --muted: #33312f;
      --line: #d3cac2;
      --bg: #FFFFFF;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'DM Sans', sans-serif; color: var(--text); font-size: 13px; line-height: 1.6; }
    @page { margin: 0; }
    @media print {
      body { margin: 0; padding: 0; }
      .letterhead, .print-format-header, .print-heading { display: none !important; }
    }
    .page { width: 100%; min-height: 100vh; background: var(--bg); position: relative; display: flex; flex-direction: column; justify-content: space-between; }
    .header { position: relative; height: 130px; overflow: hidden; background: var(--bg); }
    .header-left { position: absolute; left: 48px; top: 50%; transform: translateY(calc(-50% + 4px)); z-index: 2; }
    .header-title { font-family: 'Cormorant Garamond', serif; font-size: 37px; font-weight: 600; color: #33312f; line-height: 1.15; letter-spacing: -0.3px; }
    .body { padding: 16px 48px; flex: 1; }
    .meta-row { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
    .section-label { font-family: 'Cormorant Garamond', serif; font-size: 18px; font-weight: 700; letter-spacing: 0.5px; color: #33312f; margin-bottom: 10px; }
    .client-data p { font-size: 13px; margin-bottom: 3px; color: var(--text); }
    .client-data strong { font-weight: 500; color: var(--navy); }
    .meta-right { text-align: right; flex-shrink: 0; }
    .meta-right .order-number { font-family: 'DM Sans', sans-serif; font-size: 16px; font-weight: 700; color: var(--navy); letter-spacing: -0.2px; line-height: 1; }
    .meta-right .order-label { font-size: 13px; color: var(--muted); letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 4px; }
    .meta-right .order-date { font-size: 12px; color: var(--muted); margin-top: 6px; }
    .meta-right .valid-badge { display: block; font-size: 12px; color: var(--muted); margin-top: 4px; font-weight: 400; }
    .table-wrap { margin-bottom: 32px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { border-bottom: 2px solid #827059; }
    thead th { font-family: 'Cormorant Garamond', serif !important; font-size: 18px !important; font-weight: 700 !important; letter-spacing: 0.5px !important; color: #33312f !important; padding: 0 0 10px !important; text-align: left !important; background: none !important; border: none !important; }
    thead th.right { text-align: right !important; }
    thead th.center { text-align: center !important; }
    tbody tr { border-bottom: 1px solid var(--line); }
    tbody tr:last-child { border-bottom: 2px solid #827059; }
    tbody td { padding: 14px 0; vertical-align: middle; font-size: 13px; color: var(--text); }
    tbody td.sl { color: var(--muted); font-size: 13px; font-weight: 600; width: 30px; padding-right: 20px; text-align: center; }
    tbody td.product { padding-right: 24px; padding-left: 16px; }
    .product-name { font-weight: 500; color: var(--navy); margin-bottom: 2px; }
    .product-desc { font-size: 13px; color: var(--muted); }
    td.right { text-align: right; }
    td.center { text-align: center; }
    td.price, td.qty, td.subtotal { white-space: nowrap; font-variant-numeric: tabular-nums; }
    td.subtotal { font-weight: 600; color: var(--navy); }
    .info-grid { display: flex; flex-direction: column; gap: 28px; margin-bottom: 28px; }
    .info-block { padding: 0; background: none; border-left: none; }
    .info-block p { font-size: 12px; color: var(--text); margin-bottom: 4px; }
    .info-block p strong { font-weight: 500; color: var(--navy); }
    .info-block p:last-child { margin-bottom: 0; }
    .conditions { padding: 0; background: none; margin-bottom: 32px; border-left: none; margin-top: 0; }
    .conditions p { font-size: 12px; color: var(--muted); margin-bottom: 6px; line-height: 1.65; }
    .conditions p:last-child { margin-bottom: 0; }
    .footer { margin-top: 0; padding: 14px 48px; background: #002b5f; }
    .footer-contacts { display: flex; flex-direction: row; align-items: center; justify-content: space-between; width: 100%; }
    .contact-item { display: flex; align-items: center; gap: 8px; font-size: 11px; color: #ffffff; }
    .contact-icon { width: 18px; height: 18px; background: #ffffff; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .contact-icon svg { width: 10px; height: 10px; fill: #002b5f; }
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-left">
      <div class="header-title">Proposta de<br>Or&ccedil;amento</div>
    </div>
    <svg style="position:absolute;right:0;top:0;width:62%;height:130px;" viewBox="0 0 349.14 87.82" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path style="fill:#d0cac2" d="M295.67,0v87.82h-129.21c-22.22,0-43.54-7-59.25-19.46L44.18,18.38C32.06,8.77,16.62,2.4,0,0h295.67Z" />
      <path style="fill:#002b5f" d="M349.14,0v87.82h-134.08c-22.22,0-43.54-7-59.25-19.46l-63.03-49.98C80.67,8.77,65.22,2.4,48.6,0h300.54Z" />
    </svg>
    <div style="position:absolute;right:48px;top:44px;z-index:4;">
      <svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" id="Camada_2" data-name="Camada 2" viewBox="0 0 181.61 45.75" width="191" height="53">
        <defs>
          <style>.cls-1{fill:#d2a246}.cls-2{fill:#ffffff}</style>
        </defs>
        <g id="Camada_1-2" data-name="Camada 1">
          <path class="cls-1" d="M22.07,19.21c.9,3.69,3.58,6.77,6.9,8.54.11-3.94.02-7.88.05-11.83.05-3.39-1.34-6.72-3.68-9.16-3.13,3.22-4.47,8.09-3.27,12.44M9.15,4.66c-3.25,1.94-5.6,5.35-6.18,9.09-.6,3.36.23,6.96,2.22,9.74,1.9,2.74,4.92,4.65,8.18,5.31,3.37.67,6.95-.07,9.82-1.94-2.32-2.56-3.92-5.82-4.24-9.28-.49-4.54,1.07-9.27,4.26-12.56-4.09-2.83-9.83-2.95-14.07-.35M9,1.59C14.15-.95,20.71-.39,25.29,3.09,28.43.88,32.32-.31,36.16.07c5.52.42,10.66,3.99,12.98,9.01,1.25,2.55,1.66,5.42,1.55,8.23-4.03,0-8.06,0-12.09,0,0-.94,0-1.87,0-2.81,3.09,0,6.18.03,9.27,0-.5-4.22-3.07-8.15-6.85-10.14-4.17-2.31-9.6-2.1-13.52.64,2.75,2.93,4.34,6.92,4.31,10.94,0,4.25,0,8.5,0,12.75,4.04.95,8.51-.13,11.61-2.91,1.32-1.09,2.28-2.53,3.15-3.98.8.44,1.62.84,2.44,1.25-2.05,4.04-5.86,7.16-10.27,8.25-4.26,1.11-8.99.36-12.65-2.1-.3-.14-.66-.61-1-.3-2.76,1.91-6.09,2.98-9.45,2.89-4.29-.03-8.52-1.94-11.41-5.1C.85,23.11-.65,17.88.26,13.04,1.12,8.12,4.49,3.73,9,1.59" fill="#ffffff"></path>
          <g><path class="cls-2" d="M69.56,2.64c3.3,0,5.9.88,7.81,2.64,1.91,1.76,2.86,4.18,2.86,7.25v14.64h-4.27v-3.3h-.19c-1.84,2.71-4.3,4.07-7.37,4.07-2.62,0-4.81-.78-6.57-2.33-1.76-1.55-2.64-3.49-2.64-5.82,0-2.46.93-4.41,2.79-5.87,1.86-1.45,4.34-2.18,7.44-2.18,2.65,0,4.83.48,6.55,1.45v-1.02c0-1.55-.61-2.87-1.84-3.95-1.23-1.08-2.67-1.62-4.32-1.62-2.49,0-4.46,1.05-5.92,3.15l-3.93-2.47c2.17-3.1,5.37-4.65,9.6-4.65ZM63.79,19.9c0,1.16.49,2.13,1.48,2.91.99.78,2.14,1.16,3.47,1.16,1.87,0,3.55-.69,5.02-2.08,1.47-1.39,2.21-3.02,2.21-4.9-1.39-1.1-3.33-1.65-5.82-1.65-1.81,0-3.32.44-4.53,1.31-1.21.87-1.82,1.96-1.82,3.25Z" fill="#ffffff"></path><path class="cls-2" d="M103.21,20.58c0,2.07-.91,3.81-2.71,5.24-1.81,1.42-4.09,2.13-6.84,2.13-2.39,0-4.49-.62-6.3-1.87-1.81-1.24-3.1-2.89-3.88-4.92l3.98-1.7c.58,1.42,1.43,2.53,2.55,3.32,1.12.79,2.33,1.19,3.66,1.19,1.42,0,2.61-.31,3.56-.92.95-.61,1.43-1.34,1.43-2.18,0-1.52-1.16-2.63-3.49-3.35l-4.07-1.02c-4.62-1.16-6.93-3.39-6.93-6.69,0-2.17.88-3.9,2.64-5.21,1.76-1.31,4.02-1.96,6.76-1.96,2.1,0,4,.5,5.7,1.5,1.7,1,2.89,2.34,3.56,4.02l-3.98,1.65c-.45-1-1.19-1.79-2.21-2.35-1.02-.56-2.16-.85-3.42-.85-1.16,0-2.21.29-3.13.87-.92.58-1.38,1.29-1.38,2.13,0,1.36,1.28,2.33,3.83,2.91l3.59.92c4.72,1.16,7.08,3.54,7.08,7.13Z" fill="#ffffff"></path><path class="cls-2" d="M119.21,27.95c-1.75,0-3.34-.37-4.78-1.12-1.44-.74-2.55-1.73-3.32-2.96h-.19l.19,3.3v10.47h-4.46V3.42h4.27v3.3h.19c.78-1.23,1.88-2.21,3.32-2.96,1.44-.74,3.03-1.12,4.78-1.12,3.14,0,5.79,1.23,7.95,3.69,2.23,2.49,3.35,5.48,3.35,8.97s-1.12,6.51-3.35,8.97c-2.17,2.46-4.82,3.69-7.95,3.69ZM118.48,23.88c2.13,0,3.93-.81,5.38-2.42,1.45-1.58,2.18-3.64,2.18-6.16s-.73-4.54-2.18-6.16c-1.45-1.62-3.25-2.42-5.38-2.42s-3.98.81-5.43,2.42c-1.42,1.62-2.13,3.67-2.13,6.16s.71,4.59,2.13,6.21c1.45,1.58,3.26,2.38,5.43,2.38Z" fill="#ffffff"></path><path class="cls-2" d="M145.25,27.95c-3.49,0-6.37-1.2-8.63-3.59-2.26-2.39-3.39-5.41-3.39-9.07s1.1-6.63,3.3-9.04c2.2-2.41,5.01-3.61,8.44-3.61s6.33,1.14,8.41,3.42,3.13,5.47,3.13,9.58l-.05.48h-18.67c.06,2.33.84,4.2,2.33,5.62,1.49,1.42,3.26,2.13,5.33,2.13,2.84,0,5.07-1.42,6.69-4.27l3.98,1.94c-1.07,2-2.55,3.57-4.44,4.7-1.89,1.13-4.03,1.7-6.42,1.7ZM138.12,12.43h13.62c-.13-1.65-.8-3.01-2.01-4.1-1.21-1.08-2.84-1.62-4.87-1.62-1.68,0-3.13.52-4.34,1.55-1.21,1.03-2.01,2.42-2.4,4.17Z" fill="#ffffff"></path><path class="cls-2" d="M160.57,3.42h4.27v3.3h.19c.68-1.16,1.72-2.13,3.13-2.91,1.41-.78,2.87-1.16,4.39-1.16,2.91,0,5.15.83,6.72,2.5,1.57,1.67,2.35,4.03,2.35,7.1v14.93h-4.46v-14.64c-.1-3.88-2.05-5.82-5.87-5.82-1.78,0-3.27.72-4.46,2.16-1.2,1.44-1.79,3.16-1.79,5.16v13.14h-4.46V3.42Z" fill="#ffffff"></path></g>
          <g><path class="cls-2" d="M119.87,43.06c-.97,0-1.77-.33-2.39-1-.63-.66-.94-1.5-.94-2.51s.3-1.84.91-2.51,1.39-1,2.34-1,1.75.32,2.33.95c.58.63.87,1.52.87,2.66v.13h-5.19c.02.65.23,1.17.65,1.56.41.39.91.59,1.48.59.79,0,1.41-.39,1.86-1.18l1.1.54c-.3.56-.71.99-1.23,1.3-.52.31-1.12.47-1.78.47ZM117.89,38.75h3.78c-.04-.46-.22-.84-.56-1.14-.34-.3-.79-.45-1.35-.45-.47,0-.87.14-1.2.43-.34.29-.56.67-.67,1.16Z" fill="#ffffff"></path><path class="cls-2" d="M129.23,41.01c0,.57-.25,1.06-.75,1.45-.5.39-1.13.59-1.9.59-.66,0-1.25-.17-1.75-.52-.5-.34-.86-.8-1.08-1.36l1.1-.47c.16.39.4.7.71.92.31.22.65.33,1.02.33.39,0,.72-.08.99-.26.26-.17.4-.37.4-.61,0-.42-.32-.73-.97-.93l-1.13-.28c-1.28-.32-1.92-.94-1.92-1.86,0-.6.24-1.08.73-1.45.49-.36,1.11-.54,1.88-.54.58,0,1.11.14,1.58.42s.8.65.99,1.12l-1.1.46c-.13-.28-.33-.5-.61-.65-.28-.16-.6-.24-.95-.24-.32,0-.61.08-.87.24-.26.16-.38.36-.38.59,0,.38.35.65,1.06.81l1,.26c1.31.32,1.96.98,1.96,1.98Z" fill="#ffffff"></path><path class="cls-2" d="M132.85,42.95c-.54,0-.98-.17-1.34-.5-.35-.33-.54-.79-.54-1.39v-3.69h-1.16v-1.13h1.16v-2.02h1.24v2.02h1.61v1.13h-1.61v3.28c0,.44.08.74.26.89s.36.24.58.24c.1,0,.2-.01.29-.03.09-.02.18-.05.26-.09l.39,1.1c-.32.12-.7.17-1.13.17Z" fill="#ffffff"></path><path class="cls-2" d="M137.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM135.76,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z" fill="#ffffff"></path><path class="cls-2" d="M142.96,42.84h-1.24v-6.59h1.18v.91h.05c.19-.32.48-.59.87-.81s.78-.32,1.16-.32c.48,0,.91.11,1.28.34s.64.53.81.93c.55-.84,1.3-1.26,2.27-1.26.76,0,1.35.23,1.76.7.41.47.62,1.13.62,1.99v4.12h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64Z" fill="#ffffff"></path><path class="cls-2" d="M156.61,43.06c-.48,0-.93-.1-1.32-.31s-.71-.48-.92-.82h-.05l.05.91v2.9h-1.24v-9.49h1.18v.91h.05c.22-.34.52-.61.92-.82.4-.21.84-.31,1.32-.31.87,0,1.6.34,2.21,1.02.62.69.93,1.52.93,2.49s-.31,1.81-.93,2.49c-.6.68-1.34,1.02-2.21,1.02ZM156.41,41.93c.59,0,1.09-.22,1.49-.67.4-.44.61-1.01.61-1.71s-.2-1.26-.61-1.71c-.4-.45-.9-.67-1.49-.67s-1.1.22-1.51.67c-.39.45-.59,1.02-.59,1.71s.2,1.27.59,1.72c.4.44.91.66,1.51.66Z" fill="#ffffff"></path><path class="cls-2" d="M163.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM161.77,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z" fill="#ffffff"></path><path class="cls-2" d="M168.97,42.84h-1.24v-6.59h1.18v1.08h.05c.13-.35.38-.65.77-.89s.77-.37,1.15-.37.66.05.91.16l-.38,1.2c-.15-.06-.39-.09-.73-.09-.47,0-.87.19-1.22.56s-.52.82-.52,1.32v3.63Z" fill="#ffffff"></path><path class="cls-2" d="M174.21,33.98c0,.24-.09.45-.26.62-.17.17-.38.26-.62.26s-.45-.08-.62-.26c-.17-.17-.26-.38-.26-.62s.09-.45.26-.62c.17-.17.38-.26.62-.26s.45.09.62.26c.17.17.26.38.26.62ZM173.96,36.25v6.59h-1.24v-6.59h1.24Z" fill="#ffffff"></path><path class="cls-2" d="M178.01,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM176.41,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z" fill="#ffffff"></path></g>
        </g>
      </svg>
    </div>
  </div>
  <div class="body">
    <div class="meta-row">
      <div class="client-section">
        <div class="section-label">Cliente:</div>
        <div class="client-data">
          <p><strong>Nome:</strong> {{client.name}}</p>
          {{#if client.email}}<p><strong>E-mail:</strong> {{client.email}}</p>{{/if}}
          {{#if client.phone}}<p><strong>Telefone:</strong> {{client.phone}}</p>{{/if}}
        </div>
      </div>
      <div class="meta-right">
        <div class="order-label">Or&ccedil;amento</div>
        <div class="order-number">{{quote_number}}</div>
        <div class="order-date">Data: {{display.quote_date}}</div>
        {{#if validity}}<div class="valid-badge">V&aacute;lido at&eacute; {{display.validity_date}}</div>{{/if}}
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:30px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">SL.</th>
            <th style="padding-left:16px;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">Produto</th>
            <th class="center" style="width:90px;padding-right:30px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">Pre&ccedil;o</th>
            <th class="center" style="width:80px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">Qtd</th>
            <th class="right" style="width:100px;text-align:right;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {{#each items}}
          <tr>
            <td class="sl">{{position}}.</td>
            <td class="product">
              <div class="product-name">{{name}}</div>
              {{#if description}}<div class="product-desc">{{description}}</div>{{/if}}
            </td>
            <td class="center price" style="padding-right:30px">{{display.unit_price}}</td>
            <td class="center qty">{{quantity}}</td>
            <td class="right subtotal">{{display.line_total}}</td>
          </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
    <div class="info-grid">
      <div class="info-block">
        <div class="section-label">Prazo de produ&ccedil;&atilde;o:</div>
        {{#if terms.production_deadline}}<p>{{terms.production_deadline}}</p>{{else}}<p>15 a 20 dias &uacute;teis ap&oacute;s confirma&ccedil;&atilde;o do pagamento e aprova&ccedil;&atilde;o da arte.</p>{{/if}}
      </div>
      <div class="info-block">
        <div class="section-label">Dados para pagamento:</div>
        <p><strong>ASPEN COM&Eacute;RCIO DE ARTIGOS PERSONALIZADOS LTDA</strong></p>
        <p><strong>CNPJ:</strong> 55.458.072/0001-79</p>
        <p><strong>Banco:</strong> Stone Pagamentos S.A. (197)</p>
        <p><strong>Ag&ecirc;ncia:</strong> 0001 &nbsp;|&nbsp; <strong>Conta:</strong> 35207618-6</p>
        <p><strong>Pix:</strong> 55.458.072/0001-79</p>
      </div>
    </div>
    <div class="conditions">
      <div class="section-label">Condi&ccedil;&otilde;es Gerais:</div>
      <p>Formas de pagamento: PIX, boleto banc&aacute;rio e transfer&ecirc;ncia.</p>
      <p>Frete: FOB.</p>
    </div>
  </div>
  <div class="footer">
    <div class="footer-contacts">
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff"><path d="M3.36,0h.11c.5,0,1,.12,1.45.35.69.34,1.26.92,1.59,1.61.2.43.31.9.33,1.37v.18c-.02.54-.16,1.07-.41,1.54-.41.76-1.11,1.35-1.93,1.62-.32.11-.65.16-.98.17h-.19c-.54-.02-1.08-.16-1.56-.43-.74-.41-1.32-1.1-1.59-1.91-.11-.33-.17-.68-.18-1.03v-.1c0-.57.16-1.13.44-1.62.36-.65.95-1.17,1.63-1.47.41-.18.85-.27,1.29-.28M2.64.86c-.2.23-.34.51-.45.79.32.15.66.23,1.01.26,0-.48,0-.96,0-1.45-.22.07-.41.22-.56.39M3.64.47c0,.48,0,.96,0,1.44.35-.02.69-.11,1.02-.26-.09-.23-.2-.44-.34-.64-.17-.24-.39-.46-.68-.55M1.45,1.18c.11.09.23.18.35.26.11-.27.25-.52.42-.76-.28.12-.54.29-.77.49M4.62.69c.17.23.31.49.42.76.12-.08.24-.17.35-.27-.23-.2-.49-.37-.77-.49M.44,3.2c.33,0,.67,0,1,0,.02-.45.08-.9.21-1.33-.18-.11-.35-.24-.51-.38-.41.48-.66,1.09-.7,1.71M5.18,1.87c.13.43.19.88.21,1.33.33,0,.67,0,1,0-.04-.63-.29-1.23-.7-1.71-.16.14-.33.27-.51.38M1.88,3.2c.44,0,.88,0,1.32,0v-.85c-.4-.03-.79-.12-1.15-.28-.1.37-.15.75-.17,1.13M3.64,2.35c0,.28,0,.57,0,.85.44,0,.88,0,1.32,0-.02-.38-.07-.76-.17-1.13-.36.16-.76.25-1.15.28M.44,3.64c.04.63.29,1.24.7,1.71.16-.14.33-.27.51-.38-.13-.43-.19-.88-.21-1.33-.33,0-.67,0-1,0M1.88,3.64c.01.38.07.76.17,1.13.36-.16.75-.25,1.15-.28,0-.28,0-.57,0-.85h-1.32M3.64,3.64c0,.28,0,.57,0,.85.4.03.79.12,1.15.28.1-.37.15-.75.17-1.13-.44,0-.88,0-1.32,0M5.39,3.64c-.02.45-.08.9-.21,1.33.18.11.35.24.51.38.41-.48.66-1.09.7-1.71-.33,0-.67,0-1,0M2.19,5.18c.1.25.23.5.39.72.16.21.37.39.62.47,0-.48,0-.96,0-1.44-.35.02-.7.11-1.02.26M3.64,4.93c0,.48,0,.96,0,1.44.26-.07.46-.26.62-.47.17-.22.29-.46.39-.72-.32-.14-.66-.23-1.02-.26M1.45,5.66c.23.2.49.37.77.49-.17-.23-.31-.49-.42-.76-.12.08-.24.17-.35.27M5.04,5.39c-.11.27-.25.52-.42.76.28-.12.54-.29.77-.49-.11-.1-.23-.19-.35-.27Z" /></svg>
        </div>
        <a href="https://www.aspenestamparia.com" style="color:#ffffff;text-decoration:none;">aspenestamparia.com</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff"><path d="M3.38,0h.18c.47.02.94.13,1.37.34.33.16.63.37.89.62.02.02.03.05.05.07.4.41.7.92.85,1.47.07.26.11.54.12.81v.2c-.02.31-.06.63-.16.93-.15.47-.4.9-.74,1.25-.62.67-1.51,1.07-2.42,1.09-.59.02-1.19-.13-1.71-.41-.6.16-1.2.31-1.8.47.16-.58.32-1.17.48-1.75-.19-.34-.33-.71-.4-1.09-.11-.63-.05-1.3.2-1.9.26-.65.75-1.2,1.34-1.57C2.15.2,2.76.02,3.38,0M1.91,1c-.5.32-.89.8-1.11,1.35-.21.53-.26,1.12-.13,1.67.08.34.23.67.43.96-.1.35-.19.69-.29,1.04.34-.09.68-.18,1.02-.27.02,0,.05-.02.07,0,.24.15.51.27.79.35.39.11.81.13,1.22.05.48-.08.94-.29,1.32-.6.36-.29.65-.67.82-1.1.24-.58.28-1.25.1-1.85-.2-.7-.69-1.31-1.32-1.67-.41-.23-.87-.36-1.34-.37-.56-.01-1.12.14-1.59.44Z" /><path d="M2.11,1.84c.11-.05.23-.02.34-.02.07,0,.1.07.13.12.1.22.18.45.28.67.02.04.02.08,0,.12-.06.12-.15.22-.24.33-.03.04-.05.09-.03.14.2.36.5.67.86.88.11.06.22.11.33.16.05.02.11.02.15-.02.1-.11.2-.23.29-.35.02-.03.06-.05.1-.05.09.01.18.06.26.1.13.06.26.13.39.19v-.02c.06.03.12.04.16.09.02.04.02.08.02.12,0,.11-.03.21-.07.31-.05.1-.14.18-.23.24-.1.07-.21.12-.33.15-.15.02-.3.02-.45,0-.08-.02-.15-.05-.23-.07-.19-.07-.38-.14-.56-.24-.26-.13-.48-.31-.68-.52-.2-.2-.38-.43-.56-.66-.17-.24-.32-.51-.34-.81-.02-.23.06-.47.2-.65.06-.07.11-.15.2-.19Z" /></svg>
        </div>
        <a href="https://wa.me/5521969241265" style="color:#ffffff;text-decoration:none;">(21) 96924-1265</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 4.81" fill="#ffffff"><path d="M.42.03C.51,0,.62,0,.72,0c1.83,0,3.66,0,5.49,0,.15,0,.3.05.41.14.13.11.2.27.21.44v3.64c0,.16-.08.32-.2.43-.09.08-.21.14-.34.15-.08,0-.17,0-.25,0H.79c-.1,0-.2,0-.29-.01-.19-.03-.35-.16-.43-.33-.04-.08-.05-.16-.06-.24V.58c0-.06.01-.13.04-.19C.1.23.24.09.42.03M.69.4c.76.76,1.53,1.52,2.29,2.28.1.1.24.18.38.19.18.02.36-.05.49-.18.77-.76,1.53-1.52,2.3-2.29-1.82,0-3.64,0-5.47,0M.4.68c0,1.15,0,2.29,0,3.44.58-.57,1.15-1.15,1.73-1.72C1.55,1.83.98,1.26.4.68M4.71,2.4c.58.57,1.15,1.15,1.73,1.72,0-1.15,0-2.29,0-3.44-.58.57-1.15,1.15-1.73,1.72M.69,4.41c1.82,0,3.64,0,5.47,0-.58-.57-1.15-1.15-1.73-1.72-.07.07-.14.14-.21.21-.07.07-.14.15-.23.2-.2.14-.44.2-.68.17-.22-.02-.43-.12-.59-.27-.1-.1-.2-.2-.31-.3-.58.57-1.15,1.15-1.73,1.72Z" /></svg>
        </div>
        <a href="mailto:contato@aspenestamparia.com" style="color:#ffffff;text-decoration:none;">contato@aspenestamparia.com</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.85" fill="#ffffff"><path d="M2.71,0h1.41c.29,0,.57,0,.86.03.39.03.79.14,1.1.38.21.16.39.36.51.59.14.28.21.59.23.9,0,.09,0,.17.01.26v2.48c-.01.3-.03.6-.12.89-.11.35-.32.67-.62.9-.21.16-.45.27-.7.33-.31.08-.63.08-.95.09-.11,0-.21,0-.32,0h-1.49c-.24,0-.48,0-.71-.03-.33-.02-.67-.1-.96-.26-.36-.2-.64-.53-.78-.92-.09-.25-.14-.51-.15-.78-.03-.53-.02-1.05-.02-1.58,0-.44,0-.88.02-1.31.01-.3.07-.59.18-.86.11-.26.28-.48.49-.66C1.01.2,1.4.08,1.8.04c.3-.03.61-.03.92-.04M2.08.64c-.24,0-.48.04-.69.13-.19.07-.35.21-.48.37-.1.13-.17.29-.21.46-.06.23-.06.47-.07.71-.01.49,0,.99,0,1.49,0,.37,0,.73.02,1.1.01.23.06.46.16.67.08.16.21.3.35.41.23.16.51.22.78.24.38.02.77.03,1.15.03.6,0,1.2,0,1.79-.02.27-.02.56-.07.79-.23.2-.14.36-.34.44-.58.1-.29.1-.59.11-.89.01-.39,0-.78,0-1.16,0-.43,0-.86-.02-1.29-.01-.27-.05-.54-.18-.78-.08-.15-.2-.29-.34-.39-.23-.16-.52-.22-.8-.24-.52-.03-1.03-.02-1.55-.03-.42,0-.84,0-1.26.02Z" /><path d="M5.17,1.19c.2-.05.42.08.48.28.07.19-.03.41-.21.5-.17.08-.38.03-.5-.11-.12-.15-.12-.38,0-.52.06-.07.14-.12.23-.13Z" /><path d="M3.25,1.67c.32-.03.66.03.95.17.37.18.68.5.84.89.16.36.18.78.08,1.16-.1.38-.34.72-.66.96-.28.21-.63.33-.98.34-.37.01-.75-.1-1.06-.31-.32-.22-.57-.56-.68-.94-.11-.38-.1-.79.05-1.15.14-.36.41-.67.74-.87.22-.13.47-.21.72-.24M3.31,2.29c-.38.04-.73.28-.9.61-.13.24-.16.53-.09.79.06.25.21.48.42.64.19.15.44.23.68.23.23,0,.46-.07.65-.2.2-.14.36-.34.44-.56.09-.25.09-.54-.01-.79-.09-.24-.26-.44-.48-.57-.21-.13-.46-.18-.71-.16Z" /></svg>
        </div>
        <a href="https://www.instagram.com/aspenestamparia" style="color:#ffffff;text-decoration:none;">@aspenestamparia</a>
      </div>
    </div>
  </div>
</div>
</body>
</html>`;

export interface QuotationTemplateDefinition {
  key: string;
  name: string;
  is_default: boolean;
  source: string;
}

export interface QuotationTemplateMetadata {
  key: string;
  name: string;
  is_default: boolean;
  hash: string;
}

export interface QuotationTemplate extends QuotationTemplateMetadata {
  source: string;
}

export class QuotationTemplateResolutionError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Template do orçamento não encontrado.');
    this.name = 'QuotationTemplateResolutionError';
  }
}

function sourceHash(source: string): string {
  return createHash('sha256').update(Buffer.from(source, 'utf8')).digest('hex');
}

const COMPARATIVE_SOURCE = String.raw`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Orçamento {{quote_number}}</title>
<link
  href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap"
  rel="stylesheet">
<style>
  :root {
    --navy: #33312f;
    --gold: #C8A04A;
    --gold-light: #E8C878;
    --text: #33312f;
    --muted: #33312f;
    --line: #d3cac2;
    --bg: #FFFFFF;
    --header-h: 274px;
    /* Header gráfico (130) + dados cliente (144) */
    --footer-h: 50px;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'DM Sans', sans-serif;
    color: var(--text);
    font-size: 13px;
    line-height: 1.6;
    background: var(--bg);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  @page {
    size: A4;
    margin: 0;
  }

  /* ═══════════════════════════════════════════
     HEADER FIXO (título + logo + cliente)
     ═══════════════════════════════════════════ */
  .fixed-header {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--header-h);
    background: var(--bg);
    z-index: 100;
  }

  /* Parte gráfica do header */
  .header-graphic {
    position: relative;
    height: 130px;
    overflow: hidden;
  }

  .header-left {
    position: absolute;
    left: 48px;
    top: 50%;
    transform: translateY(calc(-50% + 4px));
    z-index: 2;
  }

  .header-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 37px;
    font-weight: 600;
    color: #33312f;
    line-height: 1.15;
    letter-spacing: -0.3px;
  }

  /* Parte dos dados do cliente */
  .header-client {
    margin: 0 48px;
    padding: 12px 0 28px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 1px solid var(--line);
  }

  .section-label {
    font-family: 'Cormorant Garamond', serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #33312f;
    margin-bottom: 6px;
  }

  .client-data p {
    font-size: 13px;
    margin-bottom: 2px;
    color: var(--text);
  }

  .client-data strong {
    font-weight: 500;
    color: var(--navy);
  }

  .meta-right {
    text-align: right;
    flex-shrink: 0;
  }

  .meta-right .order-number {
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--navy);
    letter-spacing: -0.2px;
    line-height: 1;
  }

  .meta-right .order-date {
    font-size: 12px;
    color: var(--muted);
    margin-top: 6px;
  }

  .meta-right .valid-badge {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
    font-weight: 400;
  }

  /* ═══════════════════════════════════════════
     FOOTER FIXO
     ═══════════════════════════════════════════ */
  .fixed-footer {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--footer-h);
    padding: 0 48px;
    background: #002b5f;
    z-index: 100;
    display: flex;
    align-items: center;
  }

  .footer-contacts {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .contact-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #ffffff;
  }

  .contact-icon {
    width: 18px;
    height: 18px;
    background: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .contact-icon svg {
    width: 10px;
    height: 10px;
    fill: #002b5f;
  }

  /* ═══════════════════════════════════════════
     CONTEÚDO (padding empurra p/ baixo do header/footer fixos)
     ═══════════════════════════════════════════ */
  .content {
    padding-top: var(--header-h);
    padding-bottom: var(--footer-h);
  }

  .page-content {
    padding: 32px 48px 20px;
  }

  /* ── PRODUCTS TABLE ── */
  .table-wrap {
    margin-bottom: 0;
  }

  .products-table {
    width: 100%;
    border-collapse: collapse;
  }

  .products-table thead tr {
    border-bottom: 2px solid #827059;
  }

  .products-table thead th {
    font-family: 'Cormorant Garamond', serif !important;
    font-size: 18px !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px !important;
    color: #33312f !important;
    padding: 0 0 10px !important;
    text-align: left !important;
    background: none !important;
    border: none !important;
  }

  .products-table thead th.right {
    text-align: right !important;
  }

  .products-table thead th.center {
    text-align: center !important;
  }

  .products-table thead th.price-band {
    width: 92px;
    text-align: center !important;
    white-space: nowrap;
  }

  .products-table tbody tr {
    border-bottom: 1px solid var(--line);
  }

  .products-table tbody tr:last-child {
    border-bottom: 2px solid #827059;
  }

  .products-table tbody td {
    padding: 14px 0;
    vertical-align: middle;
    font-size: 13px;
    color: var(--text);
  }

  .products-table tbody td.sl {
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    width: 30px;
    padding-right: 20px;
    text-align: center;
  }

  .products-table tbody td.product {
    padding-right: 24px;
    padding-left: 16px;
  }

  .product-name {
    font-weight: 500;
    color: var(--navy);
    margin-bottom: 2px;
  }

  .product-desc {
    font-size: 13px;
    color: var(--muted);
  }

  td.right {
    text-align: right;
  }

  td.center {
    text-align: center;
  }

  td.price-band {
    text-align: center;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .matrix-price {
    font-weight: 600;
    color: var(--navy);
  }

  .matrix-unit {
    margin-top: 2px;
    font-size: 10px;
    line-height: 1.2;
    color: var(--muted);
  }

  .matrix-empty {
    color: var(--line);
  }

  td.price,
  td.qty,
  td.subtotal {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  td.subtotal {
    font-weight: 600;
    color: var(--navy);
  }

  /* ── QUEBRA DE PÁGINA ── */
  .page-break {
    break-after: always;
    page-break-after: always;
  }

  /* Conteúdo que inicia em nova página precisa de padding p/ não ficar atrás do header fixo */
  .page-2-content {
    padding: calc(var(--header-h) + 32px) 48px 20px;
  }

  /* ── INFO SECTIONS (Página 2) ── */
  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 28px;
    margin-bottom: 28px;
  }

  .info-block p {
    font-size: 12px;
    color: var(--text);
    margin-bottom: 4px;
  }

  .info-block p strong {
    font-weight: 500;
    color: var(--navy);
  }

  .conditions p {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    line-height: 1.65;
  }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════════
     HEADER FIXO (aparece em todas as páginas)
     ═══════════════════════════════════════════════ -->
<div class="fixed-header">
  <div class="header-graphic">
    <div class="header-left">
      <div class="header-title">Proposta de<br>Orçamento</div>
    </div>

    <svg style="position:absolute;right:0;top:0;width:62%;height:130px;" viewBox="0 0 349.14 87.82"
      preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path style="fill:#d0cac2"
        d="M295.67,0v87.82h-129.21c-22.22,0-43.54-7-59.25-19.46L44.18,18.38C32.06,8.77,16.62,2.4,0,0h295.67Z" />
      <path style="fill:#002b5f"
        d="M349.14,0v87.82h-134.08c-22.22,0-43.54-7-59.25-19.46l-63.03-49.98C80.67,8.77,65.22,2.4,48.6,0h300.54Z" />
    </svg>

    <div style="position:absolute;right:48px;top:44px;z-index:4;">
      <svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" id="Camada_2"
        data-name="Camada 2" viewBox="0 0 181.61 45.75" width="191" height="53">
        <defs>
          <style>
            .cls-1 {
              fill: #d2a246
            }

            .cls-2 {
              fill: #ffffff
            }
          </style>
        </defs>
        <g id="Camada_1-2" data-name="Camada 1">
          <path class="cls-1"
            d="M22.07,19.21c.9,3.69,3.58,6.77,6.9,8.54.11-3.94.02-7.88.05-11.83.05-3.39-1.34-6.72-3.68-9.16-3.13,3.22-4.47,8.09-3.27,12.44M9.15,4.66c-3.25,1.94-5.6,5.35-6.18,9.09-.6,3.36.23,6.96,2.22,9.74,1.9,2.74,4.92,4.65,8.18,5.31,3.37.67,6.95-.07,9.82-1.94-2.32-2.56-3.92-5.82-4.24-9.28-.49-4.54,1.07-9.27,4.26-12.56-4.09-2.83-9.83-2.95-14.07-.35M9,1.59C14.15-.95,20.71-.39,25.29,3.09,28.43.88,32.32-.31,36.16.07c5.52.42,10.66,3.99,12.98,9.01,1.25,2.55,1.66,5.42,1.55,8.23-4.03,0-8.06,0-12.09,0,0-.94,0-1.87,0-2.81,3.09,0,6.18.03,9.27,0-.5-4.22-3.07-8.15-6.85-10.14-4.17-2.31-9.6-2.1-13.52.64,2.75,2.93,4.34,6.92,4.31,10.94,0,4.25,0,8.5,0,12.75,4.04.95,8.51-.13,11.61-2.91,1.32-1.09,2.28-2.53,3.15-3.98.8.44,1.62.84,2.44,1.25-2.05,4.04-5.86,7.16-10.27,8.25-4.26,1.11-8.99.36-12.65-2.1-.3-.14-.66-.61-1-.3-2.76,1.91-6.09,2.98-9.45,2.89-4.29-.03-8.52-1.94-11.41-5.1C.85,23.11-.65,17.88.26,13.04,1.12,8.12,4.49,3.73,9,1.59"
            fill="#ffffff"></path>
          <g>
            <path class="cls-2"
              d="M69.56,2.64c3.3,0,5.9.88,7.81,2.64,1.91,1.76,2.86,4.18,2.86,7.25v14.64h-4.27v-3.3h-.19c-1.84,2.71-4.3,4.07-7.37,4.07-2.62,0-4.81-.78-6.57-2.33-1.76-1.55-2.64-3.49-2.64-5.82,0-2.46.93-4.41,2.79-5.87,1.86-1.45,4.34-2.18,7.44-2.18,2.65,0,4.83.48,6.55,1.45v-1.02c0-1.55-.61-2.87-1.84-3.95-1.23-1.08-2.67-1.62-4.32-1.62-2.49,0-4.46,1.05-5.92,3.15l-3.93-2.47c2.17-3.1,5.37-4.65,9.6-4.65ZM63.79,19.9c0,1.16.49,2.13,1.48,2.91.99.78,2.14,1.16,3.47,1.16,1.87,0,3.55-.69,5.02-2.08,1.47-1.39,2.21-3.02,2.21-4.9-1.39-1.1-3.33-1.65-5.82-1.65-1.81,0-3.32.44-4.53,1.31-1.21.87-1.82,1.96-1.82,3.25Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M103.21,20.58c0,2.07-.91,3.81-2.71,5.24-1.81,1.42-4.09,2.13-6.84,2.13-2.39,0-4.49-.62-6.3-1.87-1.81-1.24-3.1-2.89-3.88-4.92l3.98-1.7c.58,1.42,1.43,2.53,2.55,3.32,1.12.79,2.33,1.19,3.66,1.19,1.42,0,2.61-.31,3.56-.92.95-.61,1.43-1.34,1.43-2.18,0-1.52-1.16-2.63-3.49-3.35l-4.07-1.02c-4.62-1.16-6.93-3.39-6.93-6.69,0-2.17.88-3.9,2.64-5.21,1.76-1.31,4.02-1.96,6.76-1.96,2.1,0,4,.5,5.7,1.5,1.7,1,2.89,2.34,3.56,4.02l-3.98,1.65c-.45-1-1.19-1.79-2.21-2.35-1.02-.56-2.16-.85-3.42-.85-1.16,0-2.21.29-3.13.87-.92.58-1.38,1.29-1.38,2.13,0,1.36,1.28,2.33,3.83,2.91l3.59.92c4.72,1.16,7.08,3.54,7.08,7.13Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M119.21,27.95c-1.75,0-3.34-.37-4.78-1.12-1.44-.74-2.55-1.73-3.32-2.96h-.19l.19,3.3v10.47h-4.46V3.42h4.27v3.3h.19c.78-1.23,1.88-2.21,3.32-2.96,1.44-.74,3.03-1.12,4.78-1.12,3.14,0,5.79,1.23,7.95,3.69,2.23,2.49,3.35,5.48,3.35,8.97s-1.12,6.51-3.35,8.97c-2.17,2.46-4.82,3.69-7.95,3.69ZM118.48,23.88c2.13,0,3.93-.81,5.38-2.42,1.45-1.58,2.18-3.64,2.18-6.16s-.73-4.54-2.18-6.16c-1.45-1.62-3.25-2.42-5.38-2.42s-3.98.81-5.43,2.42c-1.42,1.62-2.13,3.67-2.13,6.16s.71,4.59,2.13,6.21c1.45,1.58,3.26,2.38,5.43,2.38Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M145.25,27.95c-3.49,0-6.37-1.2-8.63-3.59-2.26-2.39-3.39-5.41-3.39-9.07s1.1-6.63,3.3-9.04c2.2-2.41,5.01-3.61,8.44-3.61s6.33,1.14,8.41,3.42,3.13,5.47,3.13,9.58l-.05.48h-18.67c.06,2.33.84,4.2,2.33,5.62,1.49,1.42,3.26,2.13,5.33,2.13,2.84,0,5.07-1.42,6.69-4.27l3.98,1.94c-1.07,2-2.55,3.57-4.44,4.7-1.89,1.13-4.03,1.7-6.42,1.7ZM138.12,12.43h13.62c-.13-1.65-.8-3.01-2.01-4.1-1.21-1.08-2.84-1.62-4.87-1.62-1.68,0-3.13.52-4.34,1.55-1.21,1.03-2.01,2.42-2.4,4.17Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M160.57,3.42h4.27v3.3h.19c.68-1.16,1.72-2.13,3.13-2.91,1.41-.78,2.87-1.16,4.39-1.16,2.91,0,5.15.83,6.72,2.5,1.57,1.67,2.35,4.03,2.35,7.1v14.93h-4.46v-14.64c-.1-3.88-2.05-5.82-5.87-5.82-1.78,0-3.27.72-4.46,2.16-1.2,1.44-1.79,3.16-1.79,5.16v13.14h-4.46V3.42Z"
              fill="#ffffff"></path>
          </g>
          <g>
            <path class="cls-2"
              d="M119.87,43.06c-.97,0-1.77-.33-2.39-1-.63-.66-.94-1.5-.94-2.51s.3-1.84.91-2.51,1.39-1,2.34-1,1.75.32,2.33.95c.58.63.87,1.52.87,2.66v.13h-5.19c.02.65.23,1.17.65,1.56.41.39.91.59,1.48.59.79,0,1.41-.39,1.86-1.18l1.1.54c-.3.56-.71.99-1.23,1.3-.52.31-1.12.47-1.78.47ZM117.89,38.75h3.78c-.04-.46-.22-.84-.56-1.14-.34-.3-.79-.45-1.35-.45-.47,0-.87.14-1.2.43-.34.29-.56.67-.67,1.16Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M129.23,41.01c0,.57-.25,1.06-.75,1.45-.5.39-1.13.59-1.9.59-.66,0-1.25-.17-1.75-.52-.5-.34-.86-.8-1.08-1.36l1.1-.47c.16.39.4.7.71.92.31.22.65.33,1.02.33.39,0,.72-.08.99-.26.26-.17.4-.37.4-.61,0-.42-.32-.73-.97-.93l-1.13-.28c-1.28-.32-1.92-.94-1.92-1.86,0-.6.24-1.08.73-1.45.49-.36,1.11-.54,1.88-.54.58,0,1.11.14,1.58.42s.8.65.99,1.12l-1.1.46c-.13-.28-.33-.5-.61-.65-.28-.16-.6-.24-.95-.24-.32,0-.61.08-.87.24-.26.16-.38.36-.38.59,0,.38.35.65,1.06.81l1,.26c1.31.32,1.96.98,1.96,1.98Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M132.85,42.95c-.54,0-.98-.17-1.34-.5-.35-.33-.54-.79-.54-1.39v-3.69h-1.16v-1.13h1.16v-2.02h1.24v2.02h1.61v1.13h-1.61v3.28c0,.44.08.74.26.89s.36.24.58.24c.1,0,.2-.01.29-.03.09-.02.18-.05.26-.09l.39,1.1c-.32.12-.7.17-1.13.17Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M137.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM135.76,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M142.96,42.84h-1.24v-6.59h1.18v.91h.05c.19-.32.48-.59.87-.81s.78-.32,1.16-.32c.48,0,.91.11,1.28.34s.64.53.81.93c.55-.84,1.3-1.26,2.27-1.26.76,0,1.35.23,1.76.7.41.47.62,1.13.62,1.99v4.12h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M156.61,43.06c-.48,0-.93-.1-1.32-.31s-.71-.48-.92-.82h-.05l.05.91v2.9h-1.24v-9.49h1.18v.91h.05c.22-.34.52-.61.92-.82.4-.21.84-.31,1.32-.31.87,0,1.6.34,2.21,1.02.62.69.93,1.52.93,2.49s-.31,1.81-.93,2.49c-.6.68-1.34,1.02-2.21,1.02ZM156.41,41.93c.59,0,1.09-.22,1.49-.67.4-.44.61-1.01.61-1.71s-.2-1.26-.61-1.71c-.4-.45-.9-.67-1.49-.67s-1.1.22-1.51.67c-.39.45-.59,1.02-.59,1.71s.2,1.27.59,1.72c.4.44.91.66,1.51.66Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M163.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM161.77,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M168.97,42.84h-1.24v-6.59h1.18v1.08h.05c.13-.35.38-.65.77-.89s.77-.37,1.15-.37.66.05.91.16l-.38,1.2c-.15-.06-.39-.09-.73-.09-.47,0-.87.19-1.22.56s-.52.82-.52,1.32v3.63Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M174.21,33.98c0,.24-.09.45-.26.62-.17.17-.38.26-.62.26s-.45-.08-.62-.26c-.17-.17-.26-.38-.26-.62s.09-.45.26-.62c.17-.17.38-.26.62-.26s.45.09.62.26c.17.17.26.38.26.62ZM173.96,36.25v6.59h-1.24v-6.59h1.24Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M178.01,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM176.41,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
          </g>
        </g>
      </svg>
    </div>
  </div>

  <!-- Dados do cliente (parte do header fixo) -->
  <div class="header-client">
    <div class="client-section">
      <div class="section-label">Cliente:</div>
      <div class="client-data">
        <p><strong>Nome:</strong> {{client.name}}</p>
        {{#if client.email}}<p><strong>E-mail:</strong> {{client.email}}</p>{{/if}}
        {{#if client.phone}}<p><strong>Telefone:</strong> {{client.phone}}</p>{{/if}}
      </div>
    </div>
    <div class="meta-right">
      <div class="order-number">{{quote_number}}</div>
      <div class="order-date">Data: {{display.quote_date}}</div>
      {{#if validity}}
      <div class="valid-badge">Válido até {{display.validity_date}}</div>
      {{/if}}
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════
     FOOTER FIXO (aparece em todas as páginas)
     ═══════════════════════════════════════════════ -->
<div class="fixed-footer">
  <div class="footer-contacts">
    <div class="contact-item">
      <div class="contact-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff">
          <path
            d="M3.36,0h.11c.5,0,1,.12,1.45.35.69.34,1.26.92,1.59,1.61.2.43.31.9.33,1.37v.18c-.02.54-.16,1.07-.41,1.54-.41.76-1.11,1.35-1.93,1.62-.32.11-.65.16-.98.17h-.19c-.54-.02-1.08-.16-1.56-.43-.74-.41-1.32-1.1-1.59-1.91-.11-.33-.17-.68-.18-1.03v-.1c0-.57.16-1.13.44-1.62.36-.65.95-1.17,1.63-1.47.41-.18.85-.27,1.29-.28M2.64.86c-.2.23-.34.51-.45.79.32.15.66.23,1.01.26,0-.48,0-.96,0-1.45-.22.07-.41.22-.56.39M3.64.47c0,.48,0,.96,0,1.44.35-.02.69-.11,1.02-.26-.09-.23-.2-.44-.34-.64-.17-.24-.39-.46-.68-.55M1.45,1.18c.11.09.23.18.35.26.11-.27.25-.52.42-.76-.28.12-.54.29-.77.49M4.62.69c.17.23.31.49.42.76.12-.08.24-.17.35-.27-.23-.2-.49-.37-.77-.49M.44,3.2c.33,0,.67,0,1,0,.02-.45.08-.9.21-1.33-.18-.11-.35-.24-.51-.38-.41.48-.66,1.09-.7,1.71M5.18,1.87c.13.43.19.88.21,1.33.33,0,.67,0,1,0-.04-.63-.29-1.23-.7-1.71-.16.14-.33.27-.51.38M1.88,3.2c.44,0,.88,0,1.32,0v-.85c-.4-.03-.79-.12-1.15-.28-.1.37-.15.75-.17,1.13M3.64,2.35c0,.28,0,.57,0,.85.44,0,.88,0,1.32,0-.02-.38-.07-.76-.17-1.13-.36.16-.76.25-1.15.28M.44,3.64c.04.63.29,1.24.7,1.71.16-.14.33-.27.51-.38-.13-.43-.19-.88-.21-1.33-.33,0-.67,0-1,0M1.88,3.64c.01.38.07.76.17,1.13.36-.16.75-.25,1.15-.28,0-.28,0-.57,0-.85h-1.32M3.64,3.64c0,.28,0,.57,0,.85.4.03.79.12,1.15.28.1-.37.15-.75.17-1.13-.44,0-.88,0-1.32,0M5.39,3.64c-.02.45-.08.9-.21,1.33.18.11.35.24.51.38.41-.48.66-1.09.7-1.71-.33,0-.67,0-1,0M2.19,5.18c.1.25.23.5.39.72.16.21.37.39.62.47,0-.48,0-.96,0-1.44-.35.02-.7.11-1.02.26M3.64,4.93c0,.48,0,.96,0,1.44.26-.07.46-.26.62-.47.17-.22.29-.46.39-.72-.32-.14-.66-.23-1.02-.26M1.45,5.66c.23.2.49.37.77.49-.17-.23-.31-.49-.42-.76-.12.08-.24.17-.35.27M5.04,5.39c-.11.27-.25.52-.42.76.28-.12.54-.29.77-.49-.11-.1-.23-.19-.35-.27Z" />
        </svg>
      </div>
      <a href="https://www.aspenestamparia.com" style="color:#ffffff;text-decoration:none;">aspenestamparia.com</a>
    </div>
    <div class="contact-item">
      <div class="contact-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff">
          <path
            d="M3.38,0h.18c.47.02.94.13,1.37.34.33.16.63.37.89.62.02.02.03.05.05.07.4.41.7.92.85,1.47.07.26.11.54.12.81v.2c-.02.31-.06.63-.16.93-.15.47-.4.9-.74,1.25-.62.67-1.51,1.07-2.42,1.09-.59.02-1.19-.13-1.71-.41-.6.16-1.2.31-1.8.47.16-.58.32-1.17.48-1.75-.19-.34-.33-.71-.4-1.09-.11-.63-.05-1.3.2-1.9.26-.65.75-1.2,1.34-1.57C2.15.2,2.76.02,3.38,0M1.91,1c-.5.32-.89.8-1.11,1.35-.21.53-.26,1.12-.13,1.67.08.34.23.67.43.96-.1.35-.19.69-.29,1.04.34-.09.68-.18,1.02-.27.02,0,.05-.02.07,0,.24.15.51.27.79.35.39.11.81.13,1.22.05.48-.08.94-.29,1.32-.6.36-.29.65-.67.82-1.1.24-.58.28-1.25.1-1.85-.2-.7-.69-1.31-1.32-1.67-.41-.23-.87-.36-1.34-.37-.56-.01-1.12.14-1.59.44Z" />
          <path
            d="M2.11,1.84c.11-.05.23-.02.34-.02.07,0,.1.07.13.12.1.22.18.45.28.67.02.04.02.08,0,.12-.06.12-.15.22-.24.33-.03.04-.05.09-.03.14.2.36.5.67.86.88.11.06.22.11.33.16.05.02.11.02.15-.02.1-.11.2-.23.29-.35.02-.03.06-.05.1-.05.09.01.18.06.26.1.13.06.26.13.39.19v-.02c.06.03.12.04.16.09.02.04.02.08.02.12,0,.11-.03.21-.07.31-.05.1-.14.18-.23.24-.1.07-.21.12-.33.15-.15.02-.3.02-.45,0-.08-.02-.15-.05-.23-.07-.19-.07-.38-.14-.56-.24-.26-.13-.48-.31-.68-.52-.2-.2-.38-.43-.56-.66-.17-.24-.32-.51-.34-.81-.02-.23.06-.47.2-.65.06-.07.11-.15.2-.19Z" />
        </svg>
      </div>
      <a href="https://wa.me/5521969241265" style="color:#ffffff;text-decoration:none;">(21) 96924-1265</a>
    </div>
    <div class="contact-item">
      <div class="contact-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 4.81" fill="#ffffff">
          <path
            d="M.42.03C.51,0,.62,0,.72,0c1.83,0,3.66,0,5.49,0,.15,0,.3.05.41.14.13.11.2.27.21.44v3.64c0,.16-.08.32-.2.43-.09.08-.21.14-.34.15-.08,0-.17,0-.25,0H.79c-.1,0-.2,0-.29-.01-.19-.03-.35-.16-.43-.33-.04-.08-.05-.16-.06-.24V.58c0-.06.01-.13.04-.19C.1.23.24.09.42.03M.69.4c.76.76,1.53,1.52,2.29,2.28.1.1.24.18.38.19.18.02.36-.05.49-.18.77-.76,1.53-1.52,2.3-2.29-1.82,0-3.64,0-5.47,0M.4.68c0,1.15,0,2.29,0,3.44.58-.57,1.15-1.15,1.73-1.72C1.55,1.83.98,1.26.4.68M4.71,2.4c.58.57,1.15,1.15,1.73,1.72,0-1.15,0-2.29,0-3.44-.58.57-1.15,1.15-1.73,1.72M.69,4.41c1.82,0,3.64,0,5.47,0-.58-.57-1.15-1.15-1.73-1.72-.07.07-.14.14-.21.21-.07.07-.14.15-.23.2-.2.14-.44.2-.68.17-.22-.02-.43-.12-.59-.27-.1-.1-.2-.2-.31-.3-.58.57-1.15,1.15-1.73,1.72Z" />
        </svg>
      </div>
      <a href="mailto:contato@aspenestamparia.com"
        style="color:#ffffff;text-decoration:none;">contato@aspenestamparia.com</a>
    </div>
    <div class="contact-item">
      <div class="contact-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.85" fill="#ffffff">
          <path
            d="M2.71,0h1.41c.29,0,.57,0,.86.03.39.03.79.14,1.1.38.21.16.39.36.51.59.14.28.21.59.23.9,0,.09,0,.17.01.26v2.48c-.01.3-.03.6-.12.89-.11.35-.32.67-.62.9-.21.16-.45.27-.7.33-.31.08-.63.08-.95.09-.11,0-.21,0-.32,0h-1.49c-.24,0-.48,0-.71-.03-.33-.02-.67-.1-.96-.26-.36-.2-.64-.53-.78-.92-.09-.25-.14-.51-.15-.78-.03-.53-.02-1.05-.02-1.58,0-.44,0-.88.02-1.31.01-.3.07-.59.18-.86.11-.26.28-.48.49-.66C1.01.2,1.4.08,1.8.04c.3-.03.61-.03.92-.04M2.08.64c-.24,0-.48.04-.69.13-.19.07-.35.21-.48.37-.1.13-.17.29-.21.46-.06.23-.06.47-.07.71-.01.49,0,.99,0,1.49,0,.37,0,.73.02,1.1.01.23.06.46.16.67.08.16.21.3.35.41.23.16.51.22.78.24.38.02.77.03,1.15.03.6,0,1.2,0,1.79-.02.27-.02.56-.07.79-.23.2-.14.36-.34.44-.58.1-.29.1-.59.11-.89.01-.39,0-.78,0-1.16,0-.43,0-.86-.02-1.29-.01-.27-.05-.54-.18-.78-.08-.15-.2-.29-.34-.39-.23-.16-.52-.22-.8-.24-.52-.03-1.03-.02-1.55-.03-.42,0-.84,0-1.26.02Z" />
          <path
            d="M5.17,1.19c.2-.05.42.08.48.28.07.19-.03.41-.21.5-.17.08-.38.03-.5-.11-.12-.15-.12-.38,0-.52.06-.07.14-.12.23-.13Z" />
          <path
            d="M3.25,1.67c.32-.03.66.03.95.17.37.18.68.5.84.89.16.36.18.78.08,1.16-.1.38-.34.72-.66.96-.28.21-.63.33-.98.34-.37.01-.75-.1-1.06-.31-.32-.22-.57-.56-.68-.94-.11-.38-.1-.79.05-1.15.14-.36.41-.67.74-.87.22-.13.47-.21.72-.24M3.31,2.29c-.38.04-.73.28-.9.61-.13.24-.16.53-.09.79.06.25.21.48.42.64.19.15.44.23.68.23.23,0,.46-.07.65-.2.2-.14.36-.34.44-.56.09-.25.09-.54-.01-.79-.09-.24-.26-.44-.48-.57-.21-.13-.46-.18-.71-.16Z" />
        </svg>
      </div>
      <a href="https://www.instagram.com/aspenestamparia"
        style="color:#ffffff;text-decoration:none;">@aspenestamparia</a>
    </div>
  </div>
</div>

<!-- ═══════════════════════════════════════════════
     CONTEÚDO
     ═══════════════════════════════════════════════ -->
<div class="content">

  <!-- ══ PÁGINA 1: TABELA DE PRODUTOS ══ -->
  <div class="page-content">
    <div class="table-wrap">
      <table class="products-table">
        <thead>
          <tr>
            <th style="width:30px;text-align:center;">SL.</th>
            <th style="padding-left:16px;">Produto</th>
            {{#each comparison.brackets}}
            <th class="price-band">{{label}}</th>
            {{/each}}
          </tr>
        </thead>
        <tbody>
          {{#each comparison.products}}
          <tr>
            <td class="sl">{{position}}.</td>
            <td class="product">
              <div class="product-name">{{name}}</div>
              {{#if description}}
              <div class="product-desc">{{description}}</div>
              {{/if}}
            </td>
            {{#each prices}}
            <td class="price-band">
              {{#if available}}
              <div class="matrix-price">{{display}}</div>
              <div class="matrix-unit">/un.</div>
              {{else}}
              <span class="matrix-empty">-</span>
              {{/if}}
            </td>
            {{/each}}
          </tr>
          {{/each}}
        </tbody>
      </table>
    </div>
  </div>

  <!-- QUEBRA DE PÁGINA FORÇADA -->
  <div class="page-break"></div>

  <!-- ══ PÁGINA 2: INFORMAÇÕES ADICIONAIS ══ -->
  <div class="page-2-content">
    <div class="info-grid">
      <div class="info-block">
        <div class="section-label">Prazo de produção:</div>
        <p>15 a 20 dias úteis após confirmação do pagamento e aprovação da arte.</p>
      </div>
      <div class="info-block">
        <div class="section-label">Dados para pagamento:</div>
        <p><strong>ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA</strong></p>
        <p><strong>CNPJ:</strong> 55.458.072/0001-79</p>
        <p><strong>Banco:</strong> Stone Pagamentos S.A. (197)</p>
        <p><strong>Agência:</strong> 0001 &nbsp;|&nbsp; <strong>Conta:</strong> 35207618-6</p>
        <p><strong>Pix:</strong> 55.458.072/0001-79</p>
      </div>
    </div>

    <div class="conditions">
      <div class="section-label">Condições Gerais:</div>
      <p>Frete: FOB.</p>
      <p>Formas de pagamento: PIX, boleto bancário e cartão de crédito com acréscimo das taxas da operação.</p>
      <p>É possível solicitar alterações no pedido antes do início da produção, após o início não será possível.</p>
      <p>Pedidos que ainda não tenham iniciado a confecção podem ser cancelados em até 7 dias após o pagamento, após o
        início da confecção não será possível.</p>
    </div>
  </div>

</div>

  <div class="template-contract" style="display:none">
    {{#each items}}<span>{{name}} {{quantity}}</span>{{/each}}
    <span>{{display.total}}</span>
  </div>
</body>
</html>`;

const SIMPLE_SOURCE = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Orçamento {{quote_number}}</title>
<link
  href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap"
  rel="stylesheet">
<style>
  :root {
    --navy: #33312f;
    --gold: #C8A04A;
    --gold-light: #E8C878;
    --text: #33312f;
    --muted: #33312f;
    --line: #d3cac2;
    --bg: #FFFFFF;
  }

  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: 'DM Sans', sans-serif;
    color: var(--text);
    font-size: 13px;
    line-height: 1.6;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  @page {
    margin: 0;
  }

  @media print {
    body {
      margin: 0;
      padding: 0;
    }

    /* Suprime cabeçalho padrão do documento impresso */
    .letterhead,
    .print-format-header,
    .print-heading {
      display: none !important;
    }
  }

  .page {
    width: 100%;
    min-height: 100vh;
    background: var(--bg);
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  /* ── HEADER ── */
  .header {
    position: relative;
    height: 130px;
    overflow: hidden;
    background: var(--bg);
  }

  .header-left {
    position: absolute;
    left: 48px;
    top: 50%;
    transform: translateY(calc(-50% + 4px));
    z-index: 2;
  }

  .header-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 37px;
    font-weight: 600;
    color: #33312f;
    line-height: 1.15;
    letter-spacing: -0.3px;
  }

  /* ── BODY ── */
  .body {
    padding: 16px 48px;
    flex: 1;
  }

  /* Client + Meta row */
  .meta-row {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    margin-bottom: 16px;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--line);
  }

  .section-label {
    font-family: 'Cormorant Garamond', serif;
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: #33312f;
    margin-bottom: 10px;
  }

  .client-data p {
    font-size: 13px;
    margin-bottom: 3px;
    color: var(--text);
  }

  .client-data strong {
    font-weight: 500;
    color: var(--navy);
  }

  .meta-right {
    text-align: right;
    flex-shrink: 0;
  }

  .meta-right .order-number {
    font-family: 'DM Sans', sans-serif;
    font-size: 16px;
    font-weight: 700;
    color: var(--navy);
    letter-spacing: -0.2px;
    line-height: 1;
  }

  .meta-right .order-label {
    font-size: 13px;
    color: var(--muted);
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .meta-right .order-date {
    font-size: 12px;
    color: var(--muted);
    margin-top: 6px;
  }

  .meta-right .valid-badge {
    display: block;
    font-size: 12px;
    color: var(--muted);
    margin-top: 4px;
    font-weight: 400;
  }

  /* ── PRODUCTS TABLE ── */
  .table-wrap {
    margin-bottom: 32px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  thead tr {
    border-bottom: 2px solid #827059;
  }

  thead th {
    font-family: 'Cormorant Garamond', serif !important;
    font-size: 18px !important;
    font-weight: 700 !important;
    letter-spacing: 0.5px !important;
    color: #33312f !important;
    padding: 0 0 10px !important;
    text-align: left !important;
    background: none !important;
    border: none !important;
  }

  thead th.right {
    text-align: right !important;
  }

  thead th.center {
    text-align: center !important;
  }

  tbody {
    counter-reset: simple-item;
  }

  tbody tr {
    border-bottom: 1px solid var(--line);
    counter-increment: simple-item;
  }

  tbody tr:last-child {
    border-bottom: 2px solid #827059;
  }

  tbody td {
    padding: 14px 0;
    vertical-align: middle;
    font-size: 13px;
    color: var(--text);
  }

  tbody td.sl {
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    width: 30px;
    padding-right: 20px;
    text-align: center;
  }

  tbody td.sl::before {
    content: counter(simple-item) ".";
  }

  tbody td.product {
    padding-right: 24px;
    padding-left: 16px;
  }

  .product-name {
    font-weight: 500;
    color: var(--navy);
    margin-bottom: 2px;
  }

  .product-desc {
    font-size: 13px;
    color: var(--muted);
  }

  td.right {
    text-align: right;
  }

  td.center {
    text-align: center;
  }

  td.price,
  td.qty,
  td.subtotal {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  td.subtotal {
    font-weight: 600;
    color: var(--navy);
  }

  /* ── INFO SECTIONS ── */
  .info-grid {
    display: flex;
    flex-direction: column;
    gap: 28px;
    margin-bottom: 28px;
  }

  .info-block {
    padding: 0;
    background: none;
    border-left: none;
  }

  .info-block p {
    font-size: 12px;
    color: var(--text);
    margin-bottom: 4px;
  }

  .info-block p strong {
    font-weight: 500;
    color: var(--navy);
  }

  .info-block p:last-child {
    margin-bottom: 0;
  }

  /* ── CONDITIONS ── */
  .conditions {
    padding: 0;
    background: none;
    margin-bottom: 32px;
    border-left: none;
    margin-top: 0;
  }

  .conditions p {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 6px;
    line-height: 1.65;
  }

  .conditions p:last-child {
    margin-bottom: 0;
  }

  .footer {
    margin-top: 0;
    padding: 14px 48px;
    background: #002b5f;
  }

  .footer-contacts {
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .contact-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #ffffff;
  }

  .contact-icon {
    width: 18px;
    height: 18px;
    background: #ffffff;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .contact-icon svg {
    width: 10px;
    height: 10px;
    fill: #002b5f;
  }
</style>

</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-left">
      <div class="header-title">Proposta de<br>Orçamento</div>
    </div>

    <svg style="position:absolute;right:0;top:0;width:62%;height:130px;" viewBox="0 0 349.14 87.82"
      preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path style="fill:#d0cac2"
        d="M295.67,0v87.82h-129.21c-22.22,0-43.54-7-59.25-19.46L44.18,18.38C32.06,8.77,16.62,2.4,0,0h295.67Z" />
      <path style="fill:#002b5f"
        d="M349.14,0v87.82h-134.08c-22.22,0-43.54-7-59.25-19.46l-63.03-49.98C80.67,8.77,65.22,2.4,48.6,0h300.54Z" />
    </svg>

    <div style="position:absolute;right:48px;top:44px;z-index:4;">
      <svg xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" id="Camada_2"
        data-name="Camada 2" viewBox="0 0 181.61 45.75" width="191" height="53">
        <defs>
          <style>
            .cls-1 {
              fill: #d2a246
            }

            .cls-2 {
              fill: #ffffff
            }
          </style>
        </defs>
        <g id="Camada_1-2" data-name="Camada 1">
          <path class="cls-1"
            d="M22.07,19.21c.9,3.69,3.58,6.77,6.9,8.54.11-3.94.02-7.88.05-11.83.05-3.39-1.34-6.72-3.68-9.16-3.13,3.22-4.47,8.09-3.27,12.44M9.15,4.66c-3.25,1.94-5.6,5.35-6.18,9.09-.6,3.36.23,6.96,2.22,9.74,1.9,2.74,4.92,4.65,8.18,5.31,3.37.67,6.95-.07,9.82-1.94-2.32-2.56-3.92-5.82-4.24-9.28-.49-4.54,1.07-9.27,4.26-12.56-4.09-2.83-9.83-2.95-14.07-.35M9,1.59C14.15-.95,20.71-.39,25.29,3.09,28.43.88,32.32-.31,36.16.07c5.52.42,10.66,3.99,12.98,9.01,1.25,2.55,1.66,5.42,1.55,8.23-4.03,0-8.06,0-12.09,0,0-.94,0-1.87,0-2.81,3.09,0,6.18.03,9.27,0-.5-4.22-3.07-8.15-6.85-10.14-4.17-2.31-9.6-2.1-13.52.64,2.75,2.93,4.34,6.92,4.31,10.94,0,4.25,0,8.5,0,12.75,4.04.95,8.51-.13,11.61-2.91,1.32-1.09,2.28-2.53,3.15-3.98.8.44,1.62.84,2.44,1.25-2.05,4.04-5.86,7.16-10.27,8.25-4.26,1.11-8.99.36-12.65-2.1-.3-.14-.66-.61-1-.3-2.76,1.91-6.09,2.98-9.45,2.89-4.29-.03-8.52-1.94-11.41-5.1C.85,23.11-.65,17.88.26,13.04,1.12,8.12,4.49,3.73,9,1.59"
            fill="#ffffff"></path>
          <g>
            <path class="cls-2"
              d="M69.56,2.64c3.3,0,5.9.88,7.81,2.64,1.91,1.76,2.86,4.18,2.86,7.25v14.64h-4.27v-3.3h-.19c-1.84,2.71-4.3,4.07-7.37,4.07-2.62,0-4.81-.78-6.57-2.33-1.76-1.55-2.64-3.49-2.64-5.82,0-2.46.93-4.41,2.79-5.87,1.86-1.45,4.34-2.18,7.44-2.18,2.65,0,4.83.48,6.55,1.45v-1.02c0-1.55-.61-2.87-1.84-3.95-1.23-1.08-2.67-1.62-4.32-1.62-2.49,0-4.46,1.05-5.92,3.15l-3.93-2.47c2.17-3.1,5.37-4.65,9.6-4.65ZM63.79,19.9c0,1.16.49,2.13,1.48,2.91.99.78,2.14,1.16,3.47,1.16,1.87,0,3.55-.69,5.02-2.08,1.47-1.39,2.21-3.02,2.21-4.9-1.39-1.1-3.33-1.65-5.82-1.65-1.81,0-3.32.44-4.53,1.31-1.21.87-1.82,1.96-1.82,3.25Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M103.21,20.58c0,2.07-.91,3.81-2.71,5.24-1.81,1.42-4.09,2.13-6.84,2.13-2.39,0-4.49-.62-6.3-1.87-1.81-1.24-3.1-2.89-3.88-4.92l3.98-1.7c.58,1.42,1.43,2.53,2.55,3.32,1.12.79,2.33,1.19,3.66,1.19,1.42,0,2.61-.31,3.56-.92.95-.61,1.43-1.34,1.43-2.18,0-1.52-1.16-2.63-3.49-3.35l-4.07-1.02c-4.62-1.16-6.93-3.39-6.93-6.69,0-2.17.88-3.9,2.64-5.21,1.76-1.31,4.02-1.96,6.76-1.96,2.1,0,4,.5,5.7,1.5,1.7,1,2.89,2.34,3.56,4.02l-3.98,1.65c-.45-1-1.19-1.79-2.21-2.35-1.02-.56-2.16-.85-3.42-.85-1.16,0-2.21.29-3.13.87-.92.58-1.38,1.29-1.38,2.13,0,1.36,1.28,2.33,3.83,2.91l3.59.92c4.72,1.16,7.08,3.54,7.08,7.13Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M119.21,27.95c-1.75,0-3.34-.37-4.78-1.12-1.44-.74-2.55-1.73-3.32-2.96h-.19l.19,3.3v10.47h-4.46V3.42h4.27v3.3h.19c.78-1.23,1.88-2.21,3.32-2.96,1.44-.74,3.03-1.12,4.78-1.12,3.14,0,5.79,1.23,7.95,3.69,2.23,2.49,3.35,5.48,3.35,8.97s-1.12,6.51-3.35,8.97c-2.17,2.46-4.82,3.69-7.95,3.69ZM118.48,23.88c2.13,0,3.93-.81,5.38-2.42,1.45-1.58,2.18-3.64,2.18-6.16s-.73-4.54-2.18-6.16c-1.45-1.62-3.25-2.42-5.38-2.42s-3.98.81-5.43,2.42c-1.42,1.62-2.13,3.67-2.13,6.16s.71,4.59,2.13,6.21Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M145.25,27.95c-3.49,0-6.37-1.2-8.63-3.59-2.26-2.39-3.39-5.41-3.39-9.07s1.1-6.63,3.3-9.04c2.2-2.41,5.01-3.61,8.44-3.61s6.33,1.14,8.41,3.42,3.13,5.47,3.13,9.58l-.05.48h-18.67c.06,2.33.84,4.2,2.33,5.62,1.49,1.42,3.26,2.13,5.33,2.13,2.84,0,5.07-1.42,6.69-4.27l3.98,1.94c-1.07,2-2.55,3.57-4.44,4.7-1.89,1.13-4.03,1.7-6.42,1.7ZM138.12,12.43h13.62c-.13-1.65-.8-3.01-2.01-4.1-1.21-1.08-2.84-1.62-4.87-1.62-1.68,0-3.13.52-4.34,1.55-1.21,1.03-2.01,2.42-2.4,4.17Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M160.57,3.42h4.27v3.3h.19c.68-1.16,1.72-2.13,3.13-2.91,1.41-.78,2.87-1.16,4.39-1.16,2.91,0,5.15.83,6.72,2.5,1.57,1.67,2.35,4.03,2.35,7.1v14.93h-4.46v-14.64c-.1-3.88-2.05-5.82-5.87-5.82-1.78,0-3.27.72-4.46,2.16-1.2,1.44-1.79,3.16-1.79,5.16v13.14h-4.46V3.42Z"
              fill="#ffffff"></path>
          </g>
          <g>
            <path class="cls-2"
              d="M119.87,43.06c-.97,0-1.77-.33-2.39-1-.63-.66-.94-1.5-.94-2.51s.3-1.84.91-2.51,1.39-1,2.34-1,1.75.32,2.33.95c.58.63.87,1.52.87,2.66v.13h-5.19c.02.65.23,1.17.65,1.56.41.39.91.59,1.48.59.79,0,1.41-.39,1.86-1.18l1.1.54c-.3.56-.71.99-1.23,1.3-.52.31-1.12.47-1.78.47ZM117.89,38.75h3.78c-.04-.46-.22-.84-.56-1.14-.34-.3-.79-.45-1.35-.45-.47,0-.87.14-1.2.43-.34.29-.56.67-.67,1.16Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M129.23,41.01c0,.57-.25,1.06-.75,1.45-.5.39-1.13.59-1.9.59-.66,0-1.25-.17-1.75-.52-.5-.34-.86-.8-1.08-1.36l1.1-.47c.16.39.4.7.71.92.31.22.65.33,1.02.33.39,0,.72-.08.99-.26.26-.17.4-.37.4-.61,0-.42-.32-.73-.97-.93l-1.13-.28c-1.28-.32-1.92-.94-1.92-1.86,0-.6.24-1.08.73-1.45.49-.36,1.11-.54,1.88-.54.58,0,1.11.14,1.58.42s.8.65.99,1.12l-1.1.46c-.13-.28-.33-.5-.61-.65-.28-.16-.6-.24-.95-.24-.32,0-.61.08-.87.24-.26.16-.38.36-.38.59,0,.38.35.65,1.06.81l1,.26c1.31.32,1.96.98,1.96,1.98Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M132.85,42.95c-.54,0-.98-.17-1.34-.5-.35-.33-.54-.79-.54-1.39v-3.69h-1.16v-1.13h1.16v-2.02h1.24v2.02h1.61v1.13h-1.61v3.28c0,.44.08.74.26.89s.36.24.58.24c.1,0,.2-.01.29-.03.09-.02.18-.05.26-.09l.39,1.1c-.32.12-.7.17-1.13.17Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M137.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM135.76,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M142.96,42.84h-1.24v-6.59h1.18v.91h.05c.19-.32.48-.59.87-.81s.78-.32,1.16-.32c.48,0,.91.11,1.28.34s.64.53.81.93c.55-.84,1.3-1.26,2.27-1.26.76,0,1.35.23,1.76.7.41.47.62,1.13.62,1.99v4.12h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64h-1.24v-3.93c0-.62-.11-1.06-.34-1.34s-.6-.41-1.13-.41c-.48,0-.87.2-1.2.6s-.48.88-.48,1.43v3.64Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M156.61,43.06c-.48,0-.93-.1-1.32-.31s-.71-.48-.92-.82h-.05l.05.91v2.9h-1.24v-9.49h1.18v.91h.05c.22-.34.52-.61.92-.82.4-.21.84-.31,1.32-.31.87,0,1.6.34,2.21,1.02.62.69.93,1.52.93,2.49s-.31,1.81-.93,2.49c-.6.68-1.34,1.02-2.21,1.02ZM156.41,41.93c.59,0,1.09-.22,1.49-.67.4-.44.61-1.01.61-1.71s-.2-1.26-.61-1.71c-.4-.45-.9-.67-1.49-.67s-1.1.22-1.51.67c-.39.45-.59,1.02-.59,1.71s.2,1.27.59,1.72c.4.44.91.66,1.51.66Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M163.37,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM161.77,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M168.97,42.84h-1.24v-6.59h1.18v1.08h.05c.13-.35.38-.65.77-.89s.77-.37,1.15-.37.66.05.91.16l-.38,1.2c-.15-.06-.39-.09-.73-.09-.47,0-.87.19-1.22.56s-.52.82-.52,1.32v3.63Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M174.21,33.98c0,.24-.09.45-.26.62-.17.17-.38.26-.62.26s-.45-.08-.62-.26c-.17-.17-.26-.38-.26-.62s.09-.45.26-.62c.17-.17.38-.26.62-.26s.45.09.62.26c.17.17.26.38.26.62ZM173.96,36.25v6.59h-1.24v-6.59h1.24Z"
              fill="#ffffff"></path>
            <path class="cls-2"
              d="M178.01,36.04c.91,0,1.64.24,2.17.73.53.49.79,1.16.79,2.01v4.06h-1.18v-.91h-.05c-.51.75-1.19,1.13-2.04,1.13-.73,0-1.33-.22-1.82-.65-.49-.43-.73-.97-.73-1.61,0-.68.26-1.22.77-1.63.52-.4,1.2-.61,2.06-.61.73,0,1.34.13,1.82.4v-.28c0-.43-.17-.8-.51-1.1-.34-.3-.74-.45-1.2-.45-.69,0-1.24.29-1.64.87l-1.09-.69c.6-.86,1.49-1.29,2.66-1.29ZM176.41,40.82c0,.32.14.59.41.81s.59.32.96.32c.52,0,.98-.19,1.39-.58.41-.39.61-.84.61-1.36-.39-.3-.92-.46-1.61-.46-.5,0-.92.12-1.26.36-.34.24-.5.54-.5.9Z"
              fill="#ffffff"></path>
          </g>
        </g>
      </svg>
    </div>
  </div>

  <!-- BODY -->
  <div class="body">

    <!-- Client + Meta -->
    <div class="meta-row">
      <div class="client-section">
        <div class="section-label">Cliente:</div>
        <div class="client-data">
          <p><strong>Nome:</strong> {{client.name}}</p>
          {{#if client.email}}<p><strong>E-mail:</strong> {{client.email}}</p>{{/if}}
          {{#if client.phone}}<p><strong>Telefone:</strong> {{client.phone}}</p>{{/if}}
        </div>
      </div>
      <div class="meta-right">
        <div class="order-number">{{quote_number}}</div>
        <div class="order-date">Data: {{display.quote_date}}</div>
        {{#if validity}}
        <div class="valid-badge">Válido até {{display.validity_date}}</div>
        {{/if}}
      </div>
    </div>

    <!-- Products Table -->
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th
              style="width:30px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">
              SL.</th>
            <th
              style="padding-left:16px;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">
              Produto</th>
            <th class="center"
              style="width:90px;padding-right:30px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">
              Preço</th>
            <th class="center"
              style="width:80px;text-align:center;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">
              Qtd</th>
            <th class="right"
              style="width:100px;text-align:right;font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:#33312f;">
              Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {{#each items}}
          <tr>
            <td class="sl"></td>
            <td class="product">
              <div class="product-name">{{name}}</div>
              {{#if description}}
              <div class="product-desc">{{description}}</div>
              {{/if}}
            </td>
            <td class="center price" style="padding-right:30px">{{display.unit_price}}</td>
            <td class="center qty">{{quantity}}</td>
            <td class="right subtotal">{{display.line_total}}</td>
          </tr>
          {{/each}}
        </tbody>
      </table>
    </div>

    <!-- Info Grid: Prazo + Pagamento -->
    <div class="info-grid">
      <div class="info-block">
        <div class="section-label">Prazo de produção:</div>
        <p>15 a 20 dias úteis após confirmação do pagamento e aprovação da arte.</p>
      </div>
      <div class="info-block">
        <div class="section-label">Dados para pagamento:</div>
        <p><strong>ASPEN COMÉRCIO DE ARTIGOS PERSONALIZADOS LTDA</strong></p>
        <p><strong>CNPJ:</strong> 55.458.072/0001-79</p>
        <p><strong>Banco:</strong> Stone Pagamentos S.A. (197)</p>
        <p><strong>Agência:</strong> 0001 &nbsp;|&nbsp; <strong>Conta:</strong> 35207618-6</p>
        <p><strong>Pix:</strong> 55.458.072/0001-79</p>
      </div>
    </div>

    <!-- Conditions -->
    <div class="conditions">
      <div class="section-label">Condições Gerais:</div>
      <p>Formas de pagamento: PIX, boleto bancário e transferência.</p>
      <p>Frete: FOB.</p>
    </div>

  </div><!-- /body -->

  <!-- FOOTER -->
  <div class="footer">
    <div class="footer-contacts">
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff">
            <path
              d="M3.36,0h.11c.5,0,1,.12,1.45.35.69.34,1.26.92,1.59,1.61.2.43.31.9.33,1.37v.18c-.02.54-.16,1.07-.41,1.54-.41.76-1.11,1.35-1.93,1.62-.32.11-.65.16-.98.17h-.19c-.54-.02-1.08-.16-1.56-.43-.74-.41-1.32-1.1-1.59-1.91-.11-.33-.17-.68-.18-1.03v-.1c0-.57.16-1.13.44-1.62.36-.65.95-1.17,1.63-1.47.41-.18.85-.27,1.29-.28M2.64.86c-.2.23-.34.51-.45.79.32.15.66.23,1.01.26,0-.48,0-.96,0-1.45-.22.07-.41.22-.56.39M3.64.47c0,.48,0,.96,0,1.44.35-.02.69-.11,1.02-.26-.09-.23-.2-.44-.34-.64-.17-.24-.39-.46-.68-.55M1.45,1.18c.11.09.23.18.35.26.11-.27.25-.52.42-.76-.28.12-.54.29-.77.49M4.62.69c.17.23.31.49.42.76.12-.08.24-.17.35-.27-.23-.2-.49-.37-.77-.49M.44,3.2c.33,0,.67,0,1,0,.02-.45.08-.9.21-1.33-.18-.11-.35-.24-.51-.38-.41.48-.66,1.09-.7,1.71M5.18,1.87c.13.43.19.88.21,1.33.33,0,.67,0,1,0-.04-.63-.29-1.23-.7-1.71-.16.14-.33.27-.51.38M1.88,3.2c.44,0,.88,0,1.32,0v-.85c-.4-.03-.79-.12-1.15-.28-.1.37-.15.75-.17,1.13M3.64,2.35c0,.28,0,.57,0,.85.44,0,.88,0,1.32,0-.02-.38,0-.57-.17-1.13-.36.16-.76.25-1.15.28M.44,3.64c.04.63.29,1.24.7,1.71.16-.14.33-.27.51-.38-.13-.43-.19-.88-.21-1.33-.33,0-.67,0-1,0M1.88,3.64c.01.38.07.76.17,1.13.36-.16.75-.25,1.15-.28,0-.28,0-.57,0-.85h-1.32M3.64,3.64c0,.28,0,.57,0,.85.4.03.79.12,1.15.28.1-.37.15-.76.17-1.13-.44,0-.88,0-1.32,0M5.39,3.64c-.02.45-.08.9-.21,1.33.18.11.35.24.51.38.41-.48.66-1.09.7-1.71-.33,0-.67,0-1,0M2.19,5.18c.1.25.23.5.39.72.16.21.37.39.62.47,0-.48,0-.96,0-1.44-.35.02-.7.11-1.02.26M3.64,4.93c0,.48,0,.96,0,1.44.26-.07.46-.26.62-.47.17-.22.29-.46.39-.72-.32-.14-.66-.23-1.02-.26M1.45,5.66c.23.2.49.37.77.49-.17-.23-.31-.49-.42-.76-.12.08-.24.17-.35.27M5.04,5.39c-.11.27-.25.52-.42.76.28-.12.54-.29.77-.49-.11-.1-.23-.19-.35-.27Z" />
          </svg>
        </div>
        <a href="https://www.aspenestamparia.com" style="color:#ffffff;text-decoration:none;">aspenestamparia.com</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.84" fill="#ffffff">
            <path
              d="M3.38,0h.18c.47.02.94.13,1.37.34.33.16.63.37.89.62.02.02.03.05.05.07.4.41.7.92.85,1.47.07.26.11.54.12.81v.2c-.02.31-.06.63-.16.93-.15.47-.4.9-.74,1.25-.62.67-1.51,1.07-2.42,1.09-.59.02-1.19-.13-1.71-.41-.6.16-1.2.31-1.8.47.16-.58.32-1.17.48-1.75-.19-.34-.33-.71-.4-1.09-.11-.63-.05-1.3.2-1.9.26-.65.75-1.2,1.34-1.57C2.15.2,2.76.02,3.38,0M1.91,1c-.5.32-.89.8-1.11,1.35-.21.53-.26,1.12-.13,1.67.08.34.23.67.43.96-.1.35-.19.69-.29,1.04.34-.09.68-.18,1.02-.27.02,0,.05-.02.07,0,.24.15.51.27.79.35.39.11.81.13,1.22.05.48-.08.94-.29,1.32-.6.36-.29.65-.67.82-1.1.24-.58.28-1.25.1-1.85-.2-.7-.69-1.31-1.32-1.67-.41-.23-.87-.36-1.34-.37-.56-.01-1.12.14-1.59.44Z" />
            <path
              d="M2.11,1.84c.11-.05.23-.02.34-.02.07,0,.1.07.13.12.1.22.18.45.28.67.02.04.02.08,0,.12-.06.12-.15.22-.24.33-.03.04-.05.09-.03.14.2.36.5.67.86.88.11.06.22.11.33.16.05.02.11.02.15-.02.1-.11.2-.23.29-.35.02-.03.06-.05.1-.05.09.01.18.06.26.1.13.06.26.13.39.19v-.02c.06.03.12.04.16.09.02.04.02.08.02.12,0,.11-.03.21-.07.31-.05.1-.14.18-.23.24-.1.07-.21.12-.33.15-.15.02-.3.02-.45,0-.08-.02-.15-.05-.23-.07-.19-.07-.38-.14-.56-.24-.26-.13-.48-.31-.68-.52-.2-.2-.38-.43-.56-.66-.17-.24-.32-.51-.34-.81-.02-.23.06-.47.2-.65.06-.07.11-.15.2-.19Z" />
          </svg>
        </div>
        <a href="https://wa.me/5521969241265" style="color:#ffffff;text-decoration:none;">(21) 96924-1265</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 4.81" fill="#ffffff">
            <path
              d="M.42.03C.51,0,.62,0,.72,0c1.83,0,3.66,0,5.49,0,.15,0,.3.05.41.14.13.11.2.27.21.44v3.64c0,.16-.08.32-.2.43-.09.08-.21.14-.34.15-.08,0-.17,0-.25,0H.79c-.1,0-.2,0-.29-.01-.19-.03-.35-.16-.43-.33-.04-.08-.05-.16-.06-.24V.58c0-.06.01-.13.04-.19C.1.23.24.09.42.03M.69.4c.76.76,1.53,1.52,2.29,2.28.1.1.24.18.38.19.18.02.36-.05.49-.18.77-.76,1.53-1.52,2.3-2.29-1.82,0-3.64,0-5.47,0M.4.68c0,1.15,0,2.29,0,3.44.58-.57,1.15-1.15,1.73-1.72C1.55,1.83.98,1.26.4.68M4.71,2.4c.58.57,1.15,1.15,1.73,1.72,0-1.15,0-2.29,0-3.44-.58.57-1.15,1.15-1.73,1.72M.69,4.41c1.82,0,3.64,0,5.47,0-.58-.57-1.15-1.15-1.73-1.72-.07.07-.14.14-.21.21-.07.07-.14.15-.23.2-.2.14-.44.2-.68.17-.22-.02-.43-.12-.59-.27-.1-.1-.2-.2-.31-.3-.58.57-1.15,1.15-1.73,1.72Z" />
          </svg>
        </div>
        <a href="mailto:contato@aspenestamparia.com"
          style="color:#ffffff;text-decoration:none;">contato@aspenestamparia.com</a>
      </div>
      <div class="contact-item">
        <div class="contact-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 6.84 6.85" fill="#ffffff">
            <path
              d="M2.71,0h1.41c.29,0,.57,0,.86.03.39.03.79.14,1.1.38.21.16.39.36.51.59.14.28.21.59.23.9,0,.09,0,.17.01.26v2.48c-.01.3-.03.6-.12.89-.11.35-.32.67-.62.9-.21.16-.45.27-.7.33-.31.08-.63.08-.95.09-.11,0-.21,0-.32,0h-1.49c-.24,0-.48,0-.71-.03-.33-.02-.67-.1-.96-.26-.36-.2-.64-.53-.78-.92-.09-.25-.14-.51-.15-.78-.03-.53-.02-1.05-.02-1.58,0-.44,0-.88.02-1.31.01-.3.07-.59.18-.86.11-.26.28-.48.49-.66C1.01.2,1.4.08,1.8.04c.3-.03.61-.03.92-.04M2.08.64c-.24,0-.48.04-.69.13-.19.07-.35.21-.48.37-.1.13-.17.29-.21.46-.06.23-.06.47-.07.71-.01.49,0,.99,0,1.49,0,.37,0,.73.02,1.1.01.23.06.46.16.67.08.16.21.3.35.41.23.16.51.22.78.24.38.02.77.03,1.15.03.6,0,1.2,0,1.79-.02.27-.02.56-.07.79-.23.2-.14.36-.34.44-.58.1-.29.1-.59.11-.89.01-.39,0-.78,0-1.16,0-.43,0-.86-.02-1.29-.01-.27-.05-.54-.18-.78-.08-.15-.2-.29-.34-.39-.23-.16-.52-.22-.8-.24-.52-.03-1.03-.02-1.55-.03-.42,0-.84,0-1.26.02Z" />
            <path
              d="M5.17,1.19c.2-.05.42.08.48.28.07.19-.03.41-.21.5-.17.08-.38.03-.5-.11-.12-.15-.12-.38,0-.52.06-.07.14-.12.23-.13Z" />
            <path
              d="M3.25,1.67c.32-.03.66.03.95.17.37.18.68.5.84.89.16.36.18.78.08,1.16-.1.38-.34.72-.66.96-.28.21-.63.33-.98.34-.37.01-.75-.1-1.06-.31-.32-.22-.57-.56-.68-.94-.11-.38-.1-.79.05-1.15.14-.36.41-.67.74-.87.22-.13.47-.21.72-.24M3.31,2.29c-.38.04-.73.28-.9.61-.13.24-.16.53-.09.79.06.25.21.48.42.64.19.15.44.23.68.23.23,0,.46-.07.65-.2.2-.14.36-.34.44-.56.09-.25.09-.54-.01-.79-.09-.24-.26-.44-.48-.57-.21-.13-.46-.18-.71-.16Z" />
          </svg>
        </div>
        <a href="https://www.instagram.com/aspenestamparia"
          style="color:#ffffff;text-decoration:none;">@aspenestamparia</a>
      </div>
    </div>
  </div>

</div>

<div class="template-contract" style="display:none">
  {{#each items}}<span>{{name}} {{quantity}}</span>{{/each}}
  <span>{{display.total}}</span>
</div>
</body>
</html>`;

const DEFINITIONS: readonly QuotationTemplateDefinition[] = [
  { key: 'padrao', name: 'Padrão Aspen', is_default: true, source: PADRAO_SOURCE },
  { key: 'minimalista', name: 'Minimalista', is_default: false, source: MINIMAL_SOURCE },
  { key: 'branded', name: 'Aspen Original', is_default: false, source: BRANDED_SOURCE },
  { key: 'comparativo', name: 'Comparativo por faixa', is_default: false, source: COMPARATIVE_SOURCE },
  { key: 'simples', name: 'Simples', is_default: false, source: SIMPLE_SOURCE },
];

const ALLOWED_HELPERS = new Set(['if', 'each']);
const DISALLOWED_BUILTIN_HELPERS = new Set([
  'log',
  'lookup',
  'with',
  'unless',
  'helperMissing',
  'blockHelperMissing',
]);

type AstRecord = Record<string, unknown> & { type?: string };

function isAstRecord(value: unknown): value is AstRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function astPathName(value: unknown): string | null {
  if (!isAstRecord(value) || value.type !== 'PathExpression') return null;
  return typeof value.original === 'string' ? value.original : null;
}

function astArray(value: unknown): AstRecord[] {
  return Array.isArray(value) ? value.filter(isAstRecord) : [];
}

function validateAstExpression(expression: unknown, templateKey: string): void {
  if (!isAstRecord(expression)) throw new Error(`Expressão inválida no template: ${templateKey}`);
  if (expression.type === 'SubExpression') {
    throw new Error(`Subexpressões não são permitidas no template: ${templateKey}`);
  }
  if (
    expression.type === 'PathExpression' ||
    expression.type === 'StringLiteral' ||
    expression.type === 'NumberLiteral' ||
    expression.type === 'BooleanLiteral' ||
    expression.type === 'UndefinedLiteral' ||
    expression.type === 'NullLiteral'
  )
    return;
  throw new Error(`Expressão não permitida no template: ${templateKey}`);
}

function validateAstHash(hash: unknown, templateKey: string): void {
  if (!isAstRecord(hash)) return;
  for (const pair of astArray(hash.pairs)) validateAstExpression(pair.value, templateKey);
}

function validateAstProgram(program: unknown, templateKey: string): void {
  if (!isAstRecord(program)) throw new Error(`Bloco inválido no template: ${templateKey}`);
  for (const node of astArray(program.body)) validateAstNode(node, templateKey);
}

function validateAstNode(node: AstRecord, templateKey: string): void {
  switch (node.type) {
    case 'Program':
      validateAstProgram(node, templateKey);
      return;
    case 'MustacheStatement': {
      if (node.escaped === false)
        throw new Error(`Saída sem escape não é permitida no template: ${templateKey}`);
      const params = astArray(node.params);
      const hash = node.hash;
      const hasHash = isAstRecord(hash) && astArray(hash.pairs).length > 0;
      const pathName = astPathName(node.path);
      if ((params.length > 0 || hasHash) && (!pathName || !ALLOWED_HELPERS.has(pathName))) {
        throw new Error(`Helper não permitido no template: ${templateKey}`);
      }
      if (params.length === 0 && !hasHash && pathName && DISALLOWED_BUILTIN_HELPERS.has(pathName)) {
        throw new Error(`Helper não permitido no template: ${templateKey}`);
      }
      for (const parameter of params) validateAstExpression(parameter, templateKey);
      validateAstHash(hash, templateKey);
      validateAstExpression(node.path, templateKey);
      return;
    }
    case 'BlockStatement': {
      const pathName = astPathName(node.path);
      if (!pathName || !ALLOWED_HELPERS.has(pathName)) {
        throw new Error(`Bloco helper não permitido no template: ${templateKey}`);
      }
      for (const parameter of astArray(node.params)) validateAstExpression(parameter, templateKey);
      validateAstHash(node.hash, templateKey);
      validateAstProgram(node.program, templateKey);
      if (node.inverse) validateAstProgram(node.inverse, templateKey);
      return;
    }
    case 'PartialStatement':
    case 'PartialBlockStatement':
    case 'Decorator':
    case 'DecoratorBlock':
      throw new Error(`Parciais e decorators não são permitidos no template: ${templateKey}`);
    case 'ContentStatement':
    case 'CommentStatement':
      return;
    default:
      throw new Error(`Nó não permitido no template: ${templateKey}`);
  }
}

export function validateQuotationTemplateSource(
  source: string,
  templateKey = 'desconhecido'
): void {
  const ast = Handlebars.parse(source) as unknown as AstRecord;
  validateAstProgram(ast, templateKey);
}

const TEMPLATES: readonly QuotationTemplate[] = Object.freeze(
  DEFINITIONS.map((definition) =>
    Object.freeze({
      ...definition,
      hash: sourceHash(definition.source),
    })
  )
);
const BY_KEY = new Map(TEMPLATES.map((template) => [template.key, template]));
const DEFAULT_TEMPLATE = TEMPLATES.find((template) => template.is_default)!;
const BRANDED_DEFINITION = DEFINITIONS.find((definition) => definition.key === 'branded')!;
const BRANDED_TEMPLATE = TEMPLATES.find((template) => template.key === 'branded')!;

export const QUOTATION_TEMPLATES = TEMPLATES;
export const DEFAULT_QUOTATION_TEMPLATE = DEFAULT_TEMPLATE;

export function getQuotationTemplateManifest(): QuotationTemplateMetadata[] {
  return TEMPLATES.map(({ key, name, is_default, hash }) => ({ key, name, is_default, hash }));
}

export function getQuotationTemplate(key: unknown): QuotationTemplate | null {
  if (typeof key !== 'string') return null;
  return BY_KEY.get(key.trim()) || null;
}

export function resolveQuotationTemplate(key: unknown, hash?: unknown): QuotationTemplate {
  const template = getQuotationTemplate(key);
  if (template && typeof hash === 'string' && template.hash === hash.trim()) return template;
  throw new QuotationTemplateResolutionError();
}

export function quotationTemplateFromVersion(version: {
  source: string;
  sourceHash: string;
  template?: { key: string; name: string };
}): QuotationTemplate {
  // Persisted copies of the immutable branded source retain its trusted compatibility path.
  if (
    version.template?.key === BRANDED_TEMPLATE.key &&
    version.source === BRANDED_TEMPLATE.source &&
    version.sourceHash === BRANDED_TEMPLATE.hash
  ) {
    return BRANDED_TEMPLATE;
  }
  return {
    key: version.template?.key || 'persisted',
    name: version.template?.name || 'Template persistido',
    is_default: false,
    source: version.source,
    hash: version.sourceHash,
  };
}

const HELPER_NAMES = Object.freeze({
  if: true,
  each: true,
});

function parseCents(value: unknown): bigint {
  const raw = String(value ?? '0').trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0') || '0');
  return match[1] ? -cents : cents;
}

function formatCurrency(value: unknown): string {
  const cents = parseCents(value);
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  const integer = absolute / 100n;
  const decimal = (absolute % 100n).toString().padStart(2, '0');
  return `${sign}R$ ${integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ,${decimal}`.replace(
    ' ,',
    ','
  );
}

function formatDate(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function createEnvironment(): typeof Handlebars {
  const environment = Handlebars.create();
  for (const helperName of Object.keys(environment.helpers)) {
    if (!ALLOWED_HELPERS.has(helperName)) environment.unregisterHelper(helperName);
  }
  for (const decoratorName of Object.keys(environment.decorators)) {
    environment.unregisterDecorator(decoratorName);
  }
  return environment;
}

export interface QuotationTemplateViewModel {
  [key: string]: unknown;
}

/** Deterministic data used to validate and preview templates before persistence. */
export const QUOTATION_TEMPLATE_PREVIEW_VIEW_MODEL: QuotationTemplateViewModel = {
  quote_number: 'ORC-PREVIEW',
  revision: 1,
  validity: true,
  client: {
    name: 'Cliente de demonstração',
    document: '00.000.000/0000-00',
    email: 'cliente@example.com',
    phone: '(11) 99999-9999',
    address: 'Rua de demonstração, 100 - Centro',
  },
  items: [
    {
      position: 1,
      sku: 'SKU-DEMO',
      name: 'Produto de demonstração',
      description: 'Descrição do produto de demonstração',
      quantity: '1',
      unit: 'Und',
      display: { unit_price: 'R$ 10,00', line_total: 'R$ 10,00' },
    },
  ],
  comparison: {
    brackets: [
      { minimum: 30, label: '30 - 99' },
      { minimum: 100, label: '100 - 299' },
    ],
    products: [
      {
        position: 1,
        name: 'Produto de demonstração',
        description: 'Descrição do produto de demonstração',
        prices: [
          { display: 'R$ 10,00', available: true },
          { display: '', available: false },
        ],
      },
    ],
  },
  display: {
    quote_date: '01/01/2026',
    validity_date: '16/01/2026',
    subtotal: 'R$ 10,00',
    freight: 'R$ 0,00',
    total: 'R$ 10,00',
  },
  terms: {
    pagamento: 'À vista',
    entrega: '15 dias',
    production_deadline: '15 dias',
    observations: 'Observação de demonstração',
  },
  secoes: {
    prazo_producao: true,
    pagamento: true,
    condicoes_gerais: true,
  },
};

// ── HTML policy tokenizer ──────────────────────────────────────────────

// All allowlists stored lowercase for case-insensitive matching
const ALLOWED_TAGS = new Set([
  'a',
  'article',
  'b',
  'blockquote',
  'body',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'defs',
  'div',
  'dl',
  'dt',
  'em',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'head',
  'header',
  'hr',
  'html',
  'img',
  'li',
  'link',
  'main',
  'meta',
  'nav',
  'ol',
  'p',
  'path',
  'pre',
  'section',
  'small',
  'span',
  'strong',
  'style',
  'svg',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'title',
  'tr',
  'ul',
]);

// SVG-restricted tag subset (only these allowed inside <svg>)
const SVG_ALLOWED_TAGS = new Set(['svg', 'g', 'path', 'defs', 'style']);

// Tags that are ONLY valid inside SVG context
const SVG_ONLY_TAGS = new Set(['g', 'path', 'defs']);

// Only this built-in source may omit display.total; every new template/version must require it.
// External/persisted templates with the same key or hash do NOT get this exception.
const BRANDED_PROVENANCE_TOKEN = Symbol('branded-template');

// Global attribute allowlist (applied to all tags that lack per-tag restrictions)
// NOTE: href and src are NOT here — they are only allowed on specific tags via TAG_ATTRIBUTE_RESTRICTIONS
const ALLOWED_ATTRIBUTES = new Set([
  'class',
  'id',
  'style',
  'rel',
  'charset',
  'width',
  'height',
  'viewbox',
  'preserveaspectratio',
  'xmlns',
  'xmlns:xlink',
  'fill',
  'stroke',
  'd',
  'data-name',
  'lang',
]);

// Per-tag attribute restrictions: ONLY these attributes allowed (replaces global check)
const TAG_ATTRIBUTE_RESTRICTIONS: Record<string, Set<string>> = {
  a: new Set(['href', 'class', 'id', 'style']),
  meta: new Set(['charset']),
  link: new Set(['href', 'rel']),
  img: new Set(['src', 'width', 'height']),
};

// SVG-specific attribute allowlist (replaces global check inside SVG context)
const SVG_ATTRIBUTES = new Set([
  'class',
  'id',
  'style',
  'fill',
  'stroke',
  'd',
  'viewbox',
  'preserveaspectratio',
  'xmlns',
  'xmlns:xlink',
  'width',
  'height',
  'data-name',
  'transform',
  'opacity',
  'clip-path',
  'mask',
]);

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const DANGEROUS_CSS_PATTERNS = ['@import', 'expression(', 'url(', 'behavior', '-moz-binding'];

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lpar;/g, '(')
    .replace(/&rpar;/g, ')')
    .replace(/&lbrace;/g, '{')
    .replace(/&rbrace;/g, '}')
    .replace(/&num;/g, '#')
    .replace(/&percnt;/g, '%')
    .replace(/&star;/g, '*')
    .replace(/&plus;/g, '+')
    .replace(/&comma;/g, ',')
    .replace(/&period;/g, '.')
    .replace(/&sol;/g, '/')
    .replace(/&colon;/g, ':')
    .replace(/&semi;/g, ';')
    .replace(/&lt sign;/g, '<')
    .replace(/&equals;/g, '=')
    .replace(/&quest;/g, '?')
    .replace(/&commat;/g, '@')
    .replace(/&lsqb;/g, '[')
    .replace(/&rsqb;/g, ']')
    .replace(/&Hat;/g, '^')
    .replace(/&lowbar;/g, '_')
    .replace(/&grave;/g, '`')
    .replace(/&lcub;/g, '{')
    .replace(/&rcub;/g, '}')
    .replace(/&vert;/g, '|')
    .replace(/&tilde;/g, '~')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ')
    .replace(/&thinsp;/g, ' ')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&laquo;/g, '\u00AB')
    .replace(/&raquo;/g, '\u00BB')
    .replace(/&copy;/g, '\u00A9')
    .replace(/&reg;/g, '\u00AE')
    .replace(/&trade;/g, '\u2122')
    .replace(/&euro;/g, '\u20AC')
    .replace(/&pound;/g, '\u00A3')
    .replace(/&yen;/g, '\u00A5')
    .replace(/&cent;/g, '\u00A2')
    .replace(/&curren;/g, '\u00A4')
    .replace(/&sect;/g, '\u00A7')
    .replace(/&para;/g, '\u00B6')
    .replace(/&larr;/g, '\u2190')
    .replace(/&uarr;/g, '\u2191')
    .replace(/&rarr;/g, '\u2192')
    .replace(/&darr;/g, '\u2193')
    .replace(/&times;/g, '\u00D7')
    .replace(/&divide;/g, '\u00F7')
    .replace(/&plusmn;/g, '\u00B1')
    .replace(/&micro;/g, '\u00B5')
    .replace(/&para;/g, '\u00B6')
    .replace(/&middot;/g, '\u00B7')
    .replace(/&ordf;/g, '\u00AA')
    .replace(/&ordm;/g, '\u00BA')
    .replace(/&iquest;/g, '\u00BF')
    .replace(/&Agrave;/g, '\u00C0')
    .replace(/&Aacute;/g, '\u00C1')
    .replace(/&Acirc;/g, '\u00C2')
    .replace(/&Atilde;/g, '\u00C3')
    .replace(/&Auml;/g, '\u00C4')
    .replace(/&Aring;/g, '\u00C5')
    .replace(/&AElig;/g, '\u00C6')
    .replace(/&Ccedil;/g, '\u00C7')
    .replace(/&Egrave;/g, '\u00C8')
    .replace(/&Eacute;/g, '\u00C9')
    .replace(/&Ecirc;/g, '\u00CA')
    .replace(/&Euml;/g, '\u00CB')
    .replace(/&Igrave;/g, '\u00CC')
    .replace(/&Iacute;/g, '\u00CD')
    .replace(/&Icirc;/g, '\u00CE')
    .replace(/&Iuml;/g, '\u00CF')
    .replace(/&ETH;/g, '\u00D0')
    .replace(/&Ntilde;/g, '\u00D1')
    .replace(/&Ograve;/g, '\u00D2')
    .replace(/&Oacute;/g, '\u00D3')
    .replace(/&Ocirc;/g, '\u00D4')
    .replace(/&Otilde;/g, '\u00D5')
    .replace(/&Ouml;/g, '\u00D6')
    .replace(/&Oslash;/g, '\u00D8')
    .replace(/&Ugrave;/g, '\u00D9')
    .replace(/&Uacute;/g, '\u00DA')
    .replace(/&Ucirc;/g, '\u00DB')
    .replace(/&Uuml;/g, '\u00DC')
    .replace(/&Yacute;/g, '\u00DD')
    .replace(/&THORN;/g, '\u00DE')
    .replace(/&szlig;/g, '\u00DF')
    .replace(/&agrave;/g, '\u00E0')
    .replace(/&aacute;/g, '\u00E1')
    .replace(/&acirc;/g, '\u00E2')
    .replace(/&atilde;/g, '\u00E3')
    .replace(/&auml;/g, '\u00E4')
    .replace(/&aring;/g, '\u00E5')
    .replace(/&aelig;/g, '\u00E6')
    .replace(/&ccedil;/g, '\u00E7')
    .replace(/&egrave;/g, '\u00E8')
    .replace(/&eacute;/g, '\u00E9')
    .replace(/&ecirc;/g, '\u00EA')
    .replace(/&euml;/g, '\u00EB')
    .replace(/&igrave;/g, '\u00EC')
    .replace(/&iacute;/g, '\u00ED')
    .replace(/&icirc;/g, '\u00EE')
    .replace(/&iuml;/g, '\u00EF')
    .replace(/&eth;/g, '\u00F0')
    .replace(/&ntilde;/g, '\u00F1')
    .replace(/&ograve;/g, '\u00F2')
    .replace(/&oacute;/g, '\u00F3')
    .replace(/&ocirc;/g, '\u00F4')
    .replace(/&otilde;/g, '\u00F5')
    .replace(/&ouml;/g, '\u00F6')
    .replace(/&oslash;/g, '\u00F8')
    .replace(/&ugrave;/g, '\u00F9')
    .replace(/&uacute;/g, '\u00FA')
    .replace(/&ucirc;/g, '\u00FB')
    .replace(/&uuml;/g, '\u00FC')
    .replace(/&yacute;/g, '\u00FD')
    .replace(/&thorn;/g, '\u00FE')
    .replace(/&yuml;/g, '\u00FF')
    .replace(/&fnof;/g, '\u0192')
    .replace(/&circ;/g, '\u02C6')
    .replace(/&tilde;/g, '\u02DC')
    .replace(/&Alpha;/g, '\u0391')
    .replace(/&Beta;/g, '\u0392')
    .replace(/&Gamma;/g, '\u0393')
    .replace(/&Delta;/g, '\u0394')
    .replace(/&Epsilon;/g, '\u0395')
    .replace(/&Zeta;/g, '\u0396')
    .replace(/&Eta;/g, '\u0397')
    .replace(/&Theta;/g, '\u0398')
    .replace(/&Iota;/g, '\u0399')
    .replace(/&Kappa;/g, '\u039A')
    .replace(/&Lambda;/g, '\u039B')
    .replace(/&Mu;/g, '\u039C')
    .replace(/&Nu;/g, '\u039D')
    .replace(/&Xi;/g, '\u039E')
    .replace(/&Omicron;/g, '\u039F')
    .replace(/&Pi;/g, '\u03A0')
    .replace(/&Rho;/g, '\u03A1')
    .replace(/&Sigma;/g, '\u03A3')
    .replace(/&Tau;/g, '\u03A4')
    .replace(/&Upsilon;/g, '\u03A5')
    .replace(/&Phi;/g, '\u03A6')
    .replace(/&Chi;/g, '\u03A7')
    .replace(/&Psi;/g, '\u03A8')
    .replace(/&Omega;/g, '\u03A9')
    .replace(/&alpha;/g, '\u03B1')
    .replace(/&beta;/g, '\u03B2')
    .replace(/&gamma;/g, '\u03B3')
    .replace(/&delta;/g, '\u03B4')
    .replace(/&epsilon;/g, '\u03B5')
    .replace(/&zeta;/g, '\u03B6')
    .replace(/&eta;/g, '\u03B7')
    .replace(/&theta;/g, '\u03B8')
    .replace(/&iota;/g, '\u03B9')
    .replace(/&kappa;/g, '\u03BA')
    .replace(/&lambda;/g, '\u03BB')
    .replace(/&mu;/g, '\u03BC')
    .replace(/&nu;/g, '\u03BD')
    .replace(/&xi;/g, '\u03BE')
    .replace(/&omicron;/g, '\u03BF')
    .replace(/&pi;/g, '\u03C0')
    .replace(/&rho;/g, '\u03C1')
    .replace(/&sigmaf;/g, '\u03C2')
    .replace(/&sigma;/g, '\u03C3')
    .replace(/&tau;/g, '\u03C4')
    .replace(/&upsilon;/g, '\u03C5')
    .replace(/&phi;/g, '\u03C6')
    .replace(/&chi;/g, '\u03C7')
    .replace(/&psi;/g, '\u03C8')
    .replace(/&omega;/g, '\u03C9')
    .replace(/&thetasym;/g, '\u03D1')
    .replace(/&upsih;/g, '\u03D2')
    .replace(/&piv;/g, '\u03D6')
    .replace(/&OElig;/g, '\u0152')
    .replace(/&oelig;/g, '\u0153')
    .replace(/&Scaron;/g, '\u0160')
    .replace(/&scaron;/g, '\u0161')
    .replace(/&Yuml;/g, '\u0178')
    .replace(/&ligature;/g, '\uFB01')
    .replace(/&frasl;/g, '\u2044')
    .replace(/&weierp;/g, '\u2118')
    .replace(/&image;/g, '\u2111')
    .replace(/&real;/g, '\u211C')
    .replace(/&trade;/g, '\u2122')
    .replace(/&alefsym;/g, '\u2135')
    .replace(/&larr;/g, '\u2190')
    .replace(/&uarr;/g, '\u2191')
    .replace(/&rarr;/g, '\u2192')
    .replace(/&darr;/g, '\u2193')
    .replace(/&harr;/g, '\u2194')
    .replace(/&crarr;/g, '\u21B5')
    .replace(/&lArr;/g, '\u21D0')
    .replace(/&uArr;/g, '\u21D1')
    .replace(/&rArr;/g, '\u21D2')
    .replace(/&dArr;/g, '\u21D3')
    .replace(/&hArr;/g, '\u21D4')
    .replace(/&forall;/g, '\u2200')
    .replace(/&part;/g, '\u2202')
    .replace(/&exist;/g, '\u2203')
    .replace(/&empty;/g, '\u2205')
    .replace(/&nabla;/g, '\u2207')
    .replace(/&isin;/g, '\u2208')
    .replace(/&notin;/g, '\u2209')
    .replace(/&ni;/g, '\u220B')
    .replace(/&prod;/g, '\u220F')
    .replace(/&sum;/g, '\u2211')
    .replace(/&minus;/g, '\u2212')
    .replace(/&lowast;/g, '\u2217')
    .replace(/&radic;/g, '\u221A')
    .replace(/&prop;/g, '\u221D')
    .replace(/&infin;/g, '\u221E')
    .replace(/&ang;/g, '\u2220')
    .replace(/&and;/g, '\u2227')
    .replace(/&or;/g, '\u2228')
    .replace(/&cap;/g, '\u2229')
    .replace(/&cup;/g, '\u222A')
    .replace(/&int;/g, '\u222B')
    .replace(/&there4;/g, '\u2234')
    .replace(/&sim;/g, '\u223C')
    .replace(/&cong;/g, '\u2245')
    .replace(/&asymp;/g, '\u2248')
    .replace(/&ne;/g, '\u2260')
    .replace(/&equiv;/g, '\u2261')
    .replace(/&le;/g, '\u2264')
    .replace(/&ge;/g, '\u2265')
    .replace(/&sub;/g, '\u2282')
    .replace(/&sup;/g, '\u2283')
    .replace(/&nsub;/g, '\u2284')
    .replace(/&sube;/g, '\u2286')
    .replace(/&supe;/g, '\u2287')
    .replace(/&oplus;/g, '\u2295')
    .replace(/&otimes;/g, '\u2297')
    .replace(/&perp;/g, '\u22A5')
    .replace(/&sdot;/g, '\u22C5')
    .replace(/&lceil;/g, '\u2308')
    .replace(/&rceil;/g, '\u2309')
    .replace(/&lfloor;/g, '\u230A')
    .replace(/&rfloor;/g, '\u230B')
    .replace(/&lang;/g, '\u2329')
    .replace(/&rang;/g, '\u232A')
    .replace(/&loz;/g, '\u25CA')
    .replace(/&spades;/g, '\u2660')
    .replace(/&clubs;/g, '\u2663')
    .replace(/&hearts;/g, '\u2665')
    .replace(/&diams;/g, '\u2666');
}

function normalizeCssForCheck(css: string): string {
  // Decode HTML entities (comprehensive set)
  let s = decodeHtmlEntities(css);
  // Normalize control whitespace (tab/newline/carriage-return → space, collapse runs)
  s = s.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ');
  // Decode CSS escapes: \\HHHHHH → char
  s = s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  // Remove CSS comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  return s;
}

function checkCssSafety(css: string, context: string, templateKey: string): void {
  const lower = normalizeCssForCheck(css).toLowerCase();
  for (const pattern of DANGEROUS_CSS_PATTERNS) {
    if (lower.includes(pattern)) {
      throw new Error(`CSS perigoso "${pattern}" em ${context}: ${templateKey}`);
    }
  }
  if (/(?:^|[;{ ])on\w+\s*:/.test(lower)) {
    throw new Error(`Propriedade de evento em CSS não permitida em ${context}: ${templateKey}`);
  }
}

type HtmlTokenType = 'doctype' | 'start-tag' | 'end-tag' | 'comment' | 'text' | 'raw-text';

interface HtmlToken {
  type: HtmlTokenType;
  name?: string;
  attributes?: Array<{ name: string; value: string }>;
  selfClosing?: boolean;
  content?: string;
}

function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  let i = 0;

  while (i < source.length) {
    if (source[i] !== '<') {
      const end = source.indexOf('<', i);
      const text = end === -1 ? source.slice(i) : source.slice(i, end);
      if (text) tokens.push({ type: 'text', content: text });
      i = end === -1 ? source.length : end;
      continue;
    }

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end === -1) throw new Error('Comentário HTML não terminado');
      tokens.push({ type: 'comment', content: source.slice(i, end + 3) });
      i = end + 3;
      continue;
    }

    if (source.startsWith('<!', i)) {
      const end = source.indexOf('>', i);
      if (end === -1) throw new Error('Declaração HTML não terminada');
      tokens.push({ type: 'doctype', content: source.slice(i, end + 1) });
      i = end + 1;
      continue;
    }

    if (source[i + 1] === '/') {
      i += 2;
      let name = '';
      while (i < source.length && /[a-zA-Z0-9]/.test(source[i])) name += source[i++];
      if (!name) throw new Error('Nome de tag de fechamento inválido');
      // Reject trailing junk between tag name and >
      while (i < source.length && /\s/.test(source[i])) i++;
      if (i >= source.length || source[i] !== '>') {
        throw new Error(`Lixo após nome de tag de fechamento </${name}>`);
      }
      tokens.push({ type: 'end-tag', name: name.toLowerCase() });
      i++;
      continue;
    }

    i++;
    let name = '';
    while (i < source.length && /[a-zA-Z0-9]/.test(source[i])) name += source[i++];
    if (!name) throw new Error('Nome de tag inválido');

    const attributes: Array<{ name: string; value: string }> = [];
    let selfClosing = false;

    while (i < source.length && source[i] !== '>') {
      while (i < source.length && /\s/.test(source[i])) i++;
      if (source[i] === '/') {
        selfClosing = true;
        i++;
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] === '>') break;
      }
      if (source[i] === '>') break;
      if (i >= source.length) throw new Error(`Tag <${name}> não terminada`);

      let attrName = '';
      while (i < source.length && /[a-zA-Z0-9_:.-]/.test(source[i])) attrName += source[i++];
      if (!attrName) throw new Error(`Atributo inválido na tag <${name}>`);

      while (i < source.length && /\s/.test(source[i])) i++;

      let attrValue = '';
      if (source[i] === '=') {
        i++;
        while (i < source.length && /\s/.test(source[i])) i++;
        if (source[i] === '"') {
          i++;
          const end = source.indexOf('"', i);
          if (end === -1) throw new Error(`Valor de atributo não terminado na tag <${name}>`);
          attrValue = source.slice(i, end);
          i = end + 1;
        } else if (source[i] === "'") {
          i++;
          const end = source.indexOf("'", i);
          if (end === -1) throw new Error(`Valor de atributo não terminado na tag <${name}>`);
          attrValue = source.slice(i, end);
          i = end + 1;
        } else {
          // Reject unquoted attribute values
          throw new Error(`Valor de atributo não aspas na tag <${name}>`);
        }
      }
      attributes.push({ name: attrName.toLowerCase(), value: attrValue });
    }

    const tagName = name.toLowerCase();
    // After attribute parsing, the loop ended because i >= source.length or source[i] === '>'.
    // If EOF was reached before >, reject the unterminated tag.
    if (i >= source.length || source[i] !== '>') {
      throw new Error(`Tag <${name}> não terminada`);
    }
    tokens.push({ type: 'start-tag', name: tagName, attributes, selfClosing });
    i++; // skip the >

    if ((tagName === 'style' || tagName === 'script') && !selfClosing) {
      const closeTag = `</${tagName}>`;
      const closeIdx = source.toLowerCase().indexOf(closeTag, i);
      if (closeIdx === -1) throw new Error(`Tag <${tagName}> não terminada`);
      tokens.push({ type: 'raw-text', content: source.slice(i, closeIdx) });
      i = closeIdx + closeTag.length;
    }
  }
  return tokens;
}

function hasHandlebarsExpression(value: string): boolean {
  return /\{\{/.test(value);
}

function checkHtmlPolicy(tokens: HtmlToken[], templateKey: string): void {
  const stack: string[] = [];
  let inSvg = false;
  for (const token of tokens) {
    if (token.type === 'start-tag') {
      const tagLower = token.name!;

      // SVG context tracking
      if (tagLower === 'svg') inSvg = true;

      // Tag allowlist (SVG context uses restricted set, reject SVG-only tags outside SVG)
      if (!inSvg && SVG_ONLY_TAGS.has(tagLower)) {
        throw new Error(`Tag "<${token.name}>" não permitida fora de contexto SVG: ${templateKey}`);
      }
      const tagSet = inSvg ? SVG_ALLOWED_TAGS : ALLOWED_TAGS;
      if (!tagSet.has(tagLower)) {
        throw new Error(`Tag "<${token.name}>" não permitida no template: ${templateKey}`);
      }

      // Reject self-closing on non-void tags (except SVG void elements)
      if (token.selfClosing && !VOID_ELEMENTS.has(tagLower) && tagLower !== 'path') {
        throw new Error(`Tag "<${token.name}>" não-void não pode ser auto-fechada: ${templateKey}`);
      }

      // Push non-void, non-self-closing, non-style/script tags
      if (
        !token.selfClosing &&
        !VOID_ELEMENTS.has(tagLower) &&
        tagLower !== 'style' &&
        tagLower !== 'script'
      ) {
        stack.push(tagLower);
      }

      for (const attr of token.attributes || []) {
        const attrLower = attr.name;

        // Reject Handlebars expressions in URL/style contexts
        if (
          (attrLower === 'href' || attrLower === 'src' || attrLower === 'style') &&
          hasHandlebarsExpression(attr.value)
        ) {
          throw new Error(
            `Expressão dinâmica não permitida no atributo "${attrLower}" da tag <${token.name}>: ${templateKey}`
          );
        }

        // Attribute policy: SVG context uses SVG allowlist,
        // restricted tags use their specific set, all others use global
        if (inSvg) {
          if (!SVG_ATTRIBUTES.has(attrLower)) {
            throw new Error(
              `Atributo "${attr.name}" não permitido na tag <${token.name}>: ${templateKey}`
            );
          }
        } else {
          const tagRestricted = TAG_ATTRIBUTE_RESTRICTIONS[tagLower];
          if (tagRestricted) {
            if (!tagRestricted.has(attrLower)) {
              throw new Error(
                `Atributo "${attr.name}" não permitido na tag <${token.name}>: ${templateKey}`
              );
            }
          } else if (!ALLOWED_ATTRIBUTES.has(attrLower)) {
            throw new Error(
              `Atributo "${attr.name}" não permitido na tag <${token.name}>: ${templateKey}`
            );
          }
        }

        // URL protocol checks
        if (attrLower === 'href' || attrLower === 'src') {
          const decoded = decodeHtmlEntities(attr.value).toLowerCase().trim();
          if (
            attrLower === 'src' &&
            !decoded.startsWith('https:') &&
            !decoded.startsWith('data:image/')
          ) {
            throw new Error(`Protocolo não permitido em src: ${decoded}: ${templateKey}`);
          }
          if (
            attrLower === 'href' &&
            !decoded.startsWith('https:') &&
            !decoded.startsWith('mailto:')
          ) {
            throw new Error(`Protocolo não permitido em href: ${decoded}: ${templateKey}`);
          }
        }

        // CSS safety in style attributes
        if (attrLower === 'style') {
          checkCssSafety(attr.value, `atributo style na tag <${token.name}>`, templateKey);
        }
      }

      // Exit SVG context on self-closing or closing svg
      if (tagLower === 'svg' && token.selfClosing) inSvg = false;
    } else if (token.type === 'end-tag') {
      if (token.name === 'svg') inSvg = false;
      if (stack.length === 0 || stack[stack.length - 1] !== token.name) {
        throw new Error(`Tag de fechamento </${token.name}> inesperada: ${templateKey}`);
      }
      stack.pop();
    } else if (token.type === 'raw-text') {
      checkCssSafety(token.content || '', 'bloco <style>', templateKey);
    }
  }
  if (stack.length > 0) {
    throw new Error(`Tag <${stack[stack.length - 1]}> não fechada: ${templateKey}`);
  }
}

function stripHandlebars(source: string): string {
  return source.replace(/\{\{\{[\s\S]*?\}\}\}/g, '').replace(/\{\{[\s\S]*?\}\}/g, '');
}

type AstWalk = Record<string, unknown> & { type?: string };

function findRequiredFields(
  source: string,
  templateKey: string,
  provenance?: symbol
): { missing: string[]; secoesPresent: boolean; missingSections: string[] } {
  const ast = Handlebars.parse(source) as unknown as AstWalk;
  const found = {
    quote_number: false,
    client_name: false,
    each_items: false,
    display_total: false,
  };
  const secoesFound = new Set<string>();

  function walk(node: AstWalk): void {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'PathExpression' && typeof node.original === 'string') {
      const n = node.original;
      if (n === 'quote_number') found.quote_number = true;
      if (n === 'client.name') found.client_name = true;
      if (n === 'display.total') found.display_total = true;
      if (n.startsWith('secoes.')) {
        // Track each exact secoes path: secoes.prazo_producao, secoes.pagamento, secoes.condicoes_gerais
        const parts = n.split('.');
        if (parts.length >= 2) secoesFound.add(parts[1]);
      }
    }
    if (node.type === 'BlockStatement') {
      const p = node.path as AstWalk | undefined;
      if (p?.original === 'each' && Array.isArray(node.params)) {
        const first = node.params[0] as AstWalk | undefined;
        if (first?.original === 'items') found.each_items = true;
      }
    }
    if (Array.isArray(node.body)) for (const c of node.body) walk(c as AstWalk);
    if (node.program) walk(node.program as AstWalk);
    if (node.inverse) walk(node.inverse as AstWalk);
    if (Array.isArray(node.params)) for (const p of node.params) walk(p as AstWalk);
    if (node.path && node.type !== 'PathExpression') walk(node.path as AstWalk);
    if (node.hash && typeof node.hash === 'object') {
      const h = node.hash as AstWalk;
      if (Array.isArray(h.pairs)) for (const pr of h.pairs) walk(pr as AstWalk);
    }
  }
  walk(ast);

  const missing: string[] = [];
  if (!found.quote_number) missing.push('quote_number');
  if (!found.client_name) missing.push('client.name');
  if (!found.each_items) missing.push('#each items');

  // Only the exact historical source, reached through the private internal path,
  // may omit display.total. Public/persisted validation always requires it.
  const isTrustedBuiltin = source === BRANDED_SOURCE && provenance === BRANDED_PROVENANCE_TOKEN;
  if (!found.display_total && isTrustedBuiltin) {
    // Emit the plan-required compatibility warning
    console.warn(
      `[quotation-templates] Aviso: template ${templateKey} é um legado histórico que não usa display.total. Novos templates devem incluir display.total.`
    );
  }
  if (!found.display_total && !isTrustedBuiltin) {
    missing.push('display.total');
  }

  // Track each missing section placeholder individually
  const allSections = ['prazo_producao', 'pagamento', 'condicoes_gerais'];
  const missingSections = allSections.filter((s) => !secoesFound.has(s));
  for (const s of missingSections) {
    console.warn(
      `[quotation-templates] Aviso: seção editável "${s}" não usada no template ${templateKey}`
    );
  }

  return { missing, secoesPresent: secoesFound.size > 0, missingSections };
}

function checkDynamicUrlStyleBypass(source: string, templateKey: string): void {
  // Check the ORIGINAL source (not stripped) for Handlebars expressions in
  // href, src, or style attribute values. These would bypass static URL/CSS
  // policy checks because the expressions are stripped before tokenization.
  const attrRegex = /<(\w+)[^>]*\b(href|src|style)\s*=\s*["']([^"']*\{\{[^"']*)["']/gi;
  let match;
  while ((match = attrRegex.exec(source)) !== null) {
    const attrValue = match[3];
    if (/\{\{/.test(attrValue)) {
      throw new Error(
        `Expressão dinâmica não permitida no atributo "${match[2]}" da tag <${match[1]}>: ${templateKey}`
      );
    }
  }
}

/**
 * Combined validation entry point for persistence callers.
 * Performs HTML policy validation (tokenizer + attribute/tag allowlists + required fields)
 * then AST validation (Handlebars helper/expression restrictions).
 */
export function validateQuotationSource(source: string, templateKey: string): void {
  validateQuotationSourceInternal(source, templateKey);
}

export function validateQuotationHtmlSource(source: string, templateKey = 'desconhecido'): void {
  validateQuotationHtmlSourceInternal(source, templateKey);
}

function validateQuotationSourceInternal(
  source: string,
  templateKey: string,
  provenance?: symbol
): void {
  validateQuotationHtmlSourceInternal(source, templateKey, provenance);
  validateQuotationTemplateSource(source, templateKey);
}

function validateQuotationHtmlSourceInternal(
  source: string,
  templateKey = 'desconhecido',
  provenance?: symbol
): void {
  // Reject Handlebars expressions in URL/style contexts on the ORIGINAL source
  // (before stripping, since stripping removes them and bypasses the check)
  checkDynamicUrlStyleBypass(source, templateKey);

  const stripped = stripHandlebars(source);

  // HTML policy check first (catches dangerous markup before field validation)
  const tokens = tokenizeHtml(stripped);
  checkHtmlPolicy(tokens, templateKey);

  // Required fields check (only for full HTML documents)
  const isHtmlDocument = /<html[\s>]/i.test(stripped) || /<!doctype/i.test(stripped);
  if (isHtmlDocument) {
    const { missing } = findRequiredFields(source, templateKey, provenance);
    if (missing.length > 0) {
      throw new Error(
        `Campo obrigatório ausente no template ${templateKey}: ${missing.join(', ')}`
      );
    }
  }
}

function validateDefinitions(definitions: readonly QuotationTemplateDefinition[]): void {
  const keys = new Set<string>();
  let defaults = 0;
  for (const definition of definitions) {
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(definition.key)) {
      throw new Error(`Chave de template inválida: ${definition.key}`);
    }
    if (keys.has(definition.key)) throw new Error(`Chave de template duplicada: ${definition.key}`);
    keys.add(definition.key);
    if (!definition.name.trim() || !definition.source.trim())
      throw new Error(`Template incompleto: ${definition.key}`);
    const provenance =
      definition === BRANDED_DEFINITION ? BRANDED_PROVENANCE_TOKEN : undefined;
    validateQuotationSourceInternal(definition.source, definition.key, provenance);
    if (definition.is_default) defaults += 1;
  }
  if (defaults !== 1)
    throw new Error(
      `Manifesto de templates deve ter exatamente um padrão (encontrados ${defaults}).`
    );
}

validateDefinitions(DEFINITIONS);

export function renderQuotationTemplate(
  template: QuotationTemplate,
  viewModel: QuotationTemplateViewModel
): string {
  const environment = createEnvironment();
  let compiled: TemplateDelegate;
  try {
    // Only the exact frozen built-in objects qualify for trusted exceptions.
    // Forged objects with matching key/hash metadata are rejected.
    const provenance =
      template === BRANDED_TEMPLATE ? BRANDED_PROVENANCE_TOKEN : undefined;
    validateQuotationSourceInternal(template.source, template.key, provenance);
    compiled = environment.compile(template.source, {
      knownHelpers: HELPER_NAMES,
      knownHelpersOnly: true,
      noEscape: false,
      strict: true,
    });
  } catch (error) {
    console.error(
      `[quotation-templates] compile failed (${template.key})`,
      error instanceof Error ? error.message : error
    );
    throw new Error('Não foi possível preparar o template do orçamento.', { cause: error });
  }
  try {
    return compiled(viewModel, {
      allowProtoMethodsByDefault: false,
      allowProtoPropertiesByDefault: false,
      allowCallsToHelperMissing: false,
    });
  } catch (error) {
    console.error(
      `[quotation-templates] render failed (${template.key})`,
      error instanceof Error ? error.message : error
    );
    throw new Error('Não foi possível renderizar o orçamento.', { cause: error });
  }
}

export { formatCurrency as formatQuotationCurrency, formatDate as formatQuotationDate };
