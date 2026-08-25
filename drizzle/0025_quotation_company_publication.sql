-- migration-risk: additive
-- Company snapshot enforcement and official v2 template publication are forward-only.
ALTER TABLE "quote_revisions" ALTER COLUMN "company_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "settings_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_settings_version_positive_check" CHECK ("app_settings"."settings_version" > 0);--> statement-breakpoint
-- Official v2 template publication is idempotent and never changes existing rows.
INSERT INTO "quotation_templates" ("id", "key", "name", "archived") VALUES ('f1000000-0000-4000-8000-000000000001'::uuid, 'padrao', 'Padrão Aspen', false) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_template_versions" ("id", "template_id", "version", "source", "source_hash", "contract_version")
SELECT 'f2000000-0000-4000-8000-000000000001'::uuid, template."id", COALESCE(MAX(existing."version"), 0) + 1, $quotation_padrao_v2$
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <title>Orçamento {{quote_number}}</title>
  <style>:root{font-family:Arial,sans-serif;color:#172033}body{margin:0;padding:32px}.header{display:flex;justify-content:space-between;border-bottom:2px solid #172033;padding-bottom:18px}.muted{color:#5c667a;font-size:13px}.meta{text-align:right}.client,.items,.commercial{margin-top:24px}.client{border:1px solid #d9deea;border-radius:8px;padding:14px}.client p{margin:4px 0}h1,h2,p{margin-top:0}h2{font-size:16px}table{width:100%;border-collapse:collapse}th,td{padding:9px 8px;border-bottom:1px solid #e5e8ef;text-align:left}.totals{display:flex;justify-content:flex-end;gap:18px;margin-top:16px}.totals strong{border-top:2px solid #172033;padding-top:8px}.commercial section{margin-top:18px}.commercial section div,.commercial section p{white-space:pre-line}.banking{margin-top:10px}.footer{display:flex;flex-wrap:wrap;gap:16px;border-top:1px solid #d9deea;margin-top:28px;padding-top:14px;font-size:12px}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Orçamento</h1>
      <p class="muted">{{company.identity.legal_name}} · CNPJ {{company.identity.document}}</p>
      <p class="muted">{{quote_number}} · Revisão {{revision}}</p>
    </div>
    <div class="meta">{{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="client">
    <h2>Cliente</h2>
    <p>{{client.name}}</p>
    {{#if client.document}}<p>{{client.document}}</p>{{/if}}
    {{#if client.email}}<p>{{client.email}}</p>{{/if}}
    {{#if client.phone}}<p>{{client.phone}}</p>{{/if}}
    {{#if client.address}}<p>{{client.address}}</p>{{/if}}
  </section>
  <section class="items">
    <h2>Itens</h2>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{display.unit_price}}</td><td>{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <div class="commercial">
    {{#if terms.entrega}}<p>Entrega: {{terms.entrega}}</p>{{/if}}
    {{#if secoes.prazo_producao.enabled}}<section><h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p></section>{{/if}}
    {{#if secoes.pagamento.enabled}}<section><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><div class="banking">{{#if company.banking.bank_name}}<p>{{company.banking.bank_name}}{{#if company.banking.bank_code}} ({{company.banking.bank_code}}){{/if}}</p>{{/if}}{{#if company.banking.branch}}<p>Agência: {{company.banking.branch}}</p>{{/if}}{{#if company.banking.account}}<p>Conta: {{company.banking.account}}</p>{{/if}}{{#if company.banking.pix_key}}<p>Pix: {{company.banking.pix_key}}</p>{{/if}}</div></section>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<section><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></section>{{/if}}
  </div>
  <footer class="footer">
    {{#if company.contacts.website}}<span>{{company.contacts.website}}</span>{{/if}}
    {{#if company.contacts.phone}}<span>{{company.contacts.phone}}</span>{{/if}}
    {{#if company.contacts.email}}<span>{{company.contacts.email}}</span>{{/if}}
    {{#if company.contacts.instagram}}<span>{{company.contacts.instagram}}</span>{{/if}}
  </footer>
</body>
</html>
$quotation_padrao_v2$, 'ac72b75b66ac7e190d80ce9fda24bd77188d39394ffac18a3d756f2ef0b4c38a', 2
FROM "quotation_templates" AS template LEFT JOIN "quotation_template_versions" AS existing ON existing."template_id" = template."id" WHERE template."key" = 'padrao' AND NOT EXISTS (SELECT 1 FROM "quotation_template_versions" AS duplicate WHERE duplicate."template_id" = template."id" AND duplicate."source_hash" = 'ac72b75b66ac7e190d80ce9fda24bd77188d39394ffac18a3d756f2ef0b4c38a') GROUP BY template."id" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_templates" ("id", "key", "name", "archived") VALUES ('f1000000-0000-4000-8000-000000000002'::uuid, 'minimalista', 'Minimalista', false) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_template_versions" ("id", "template_id", "version", "source", "source_hash", "contract_version")
SELECT 'f2000000-0000-4000-8000-000000000002'::uuid, template."id", COALESCE(MAX(existing."version"), 0) + 1, $quotation_minimalista_v2$
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <title>Proposta comercial {{quote_number}}</title>
  <style>body{margin:0;padding:28px;font:14px/1.5 Georgia,serif;color:#222}h1{font-weight:500}.header{display:flex;justify-content:space-between;border-bottom:1px solid #222;padding-bottom:12px}.meta{text-align:right;font-size:12px}.muted{font-size:12px;color:#555}.client,.items,.commercial{margin-top:22px}.client p{margin:3px 0}h2{font-size:15px;margin:0 0 7px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:7px 3px;text-align:left}.totals{display:flex;justify-content:flex-end;gap:14px;margin-top:14px}.totals strong{border-top:1px solid #222;padding-top:7px}.commercial section{margin-top:18px}.commercial section div,.commercial section p{white-space:pre-line}.footer{display:flex;flex-wrap:wrap;gap:14px;border-top:1px solid #ddd;margin-top:24px;padding-top:12px;font-size:12px}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Proposta comercial</h1>
      <p class="muted">{{company.identity.legal_name}} · CNPJ {{company.identity.document}}</p>
      <p class="muted">{{quote_number}} · Revisão {{revision}}</p>
    </div>
    <div class="meta">{{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="client">
    <h2>Cliente</h2>
    <p>{{client.name}}</p>
    {{#if client.document}}<p>{{client.document}}</p>{{/if}}
    {{#if client.email}}<p>{{client.email}}</p>{{/if}}
    {{#if client.phone}}<p>{{client.phone}}</p>{{/if}}
    {{#if client.address}}<p>{{client.address}}</p>{{/if}}
  </section>
  <section class="items">
    <h2>Itens</h2>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{display.unit_price}}</td><td>{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <div class="commercial">
    {{#if terms.entrega}}<p>Entrega: {{terms.entrega}}</p>{{/if}}
    {{#if secoes.prazo_producao.enabled}}<section><h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p></section>{{/if}}
    {{#if secoes.pagamento.enabled}}<section><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><div class="banking">{{#if company.banking.bank_name}}<p>{{company.banking.bank_name}}{{#if company.banking.bank_code}} ({{company.banking.bank_code}}){{/if}}</p>{{/if}}{{#if company.banking.branch}}<p>Agência: {{company.banking.branch}}</p>{{/if}}{{#if company.banking.account}}<p>Conta: {{company.banking.account}}</p>{{/if}}{{#if company.banking.pix_key}}<p>Pix: {{company.banking.pix_key}}</p>{{/if}}</div></section>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<section><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></section>{{/if}}
  </div>
  <footer class="footer">
    {{#if company.contacts.website}}<span>{{company.contacts.website}}</span>{{/if}}
    {{#if company.contacts.phone}}<span>{{company.contacts.phone}}</span>{{/if}}
    {{#if company.contacts.email}}<span>{{company.contacts.email}}</span>{{/if}}
    {{#if company.contacts.instagram}}<span>{{company.contacts.instagram}}</span>{{/if}}
  </footer>
</body>
</html>
$quotation_minimalista_v2$, 'bc2dbc33ff7792ff90c96bea293e6855560bdd330c0b46a41f0d61b7cc7aab47', 2
FROM "quotation_templates" AS template LEFT JOIN "quotation_template_versions" AS existing ON existing."template_id" = template."id" WHERE template."key" = 'minimalista' AND NOT EXISTS (SELECT 1 FROM "quotation_template_versions" AS duplicate WHERE duplicate."template_id" = template."id" AND duplicate."source_hash" = 'bc2dbc33ff7792ff90c96bea293e6855560bdd330c0b46a41f0d61b7cc7aab47') GROUP BY template."id" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_templates" ("id", "key", "name", "archived") VALUES ('f1000000-0000-4000-8000-000000000003'::uuid, 'branded', 'Aspen Original', false) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_template_versions" ("id", "template_id", "version", "source", "source_hash", "contract_version")
SELECT 'f2000000-0000-4000-8000-000000000003'::uuid, template."id", COALESCE(MAX(existing."version"), 0) + 1, $quotation_branded_v2$
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <title>Proposta de orçamento {{quote_number}}</title>
  <style>:root{font-family:Arial,sans-serif;color:#33312f}body{margin:0;color:#33312f;font-size:13px;line-height:1.6}body:before{content:"";display:block;height:12px;background:#1e3159}.header{display:flex;justify-content:space-between;padding:34px 48px 22px;border-bottom:1px solid #d3cac2}.header h1{color:#1e3159;font-size:30px;margin:0}.muted{color:#6b6259;font-size:12px}.meta{text-align:right}.client,.items,.commercial{margin:0 48px;padding-top:22px}.client p{margin:3px 0}.items h2,.commercial h2{color:#1e3159;font-size:18px}table{width:100%;border-collapse:collapse}th{border-bottom:2px solid #827059;padding:0 0 10px;text-align:left}td{border-bottom:1px solid #d3cac2;padding:12px 0}.totals{display:flex;justify-content:flex-end;gap:18px;margin-top:16px}.totals strong{color:#1e3159;border-top:2px solid #827059;padding-top:8px}.commercial section{margin-top:22px}.commercial section div,.commercial section p{white-space:pre-line}.banking{border-left:3px solid #c8a04a;padding-left:12px}.footer{display:flex;flex-wrap:wrap;gap:18px;background:#1e3159;color:#fff;margin-top:28px;padding:14px 48px;font-size:11px}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Proposta de orçamento</h1>
      <p class="muted">{{company.identity.legal_name}} · CNPJ {{company.identity.document}}</p>
      <p class="muted">{{quote_number}} · Revisão {{revision}}</p>
    </div>
    <div class="meta">{{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="client">
    <h2>Cliente</h2>
    <p>{{client.name}}</p>
    {{#if client.document}}<p>{{client.document}}</p>{{/if}}
    {{#if client.email}}<p>{{client.email}}</p>{{/if}}
    {{#if client.phone}}<p>{{client.phone}}</p>{{/if}}
    {{#if client.address}}<p>{{client.address}}</p>{{/if}}
  </section>
  <section class="items">
    <h2>Itens</h2>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{display.unit_price}}</td><td>{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <div class="commercial">
    {{#if terms.entrega}}<p>Entrega: {{terms.entrega}}</p>{{/if}}
    {{#if secoes.prazo_producao.enabled}}<section><h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p></section>{{/if}}
    {{#if secoes.pagamento.enabled}}<section><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><div class="banking">{{#if company.banking.bank_name}}<p>{{company.banking.bank_name}}{{#if company.banking.bank_code}} ({{company.banking.bank_code}}){{/if}}</p>{{/if}}{{#if company.banking.branch}}<p>Agência: {{company.banking.branch}}</p>{{/if}}{{#if company.banking.account}}<p>Conta: {{company.banking.account}}</p>{{/if}}{{#if company.banking.pix_key}}<p>Pix: {{company.banking.pix_key}}</p>{{/if}}</div></section>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<section><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></section>{{/if}}
  </div>
  <footer class="footer">
    {{#if company.contacts.website}}<span>{{company.contacts.website}}</span>{{/if}}
    {{#if company.contacts.phone}}<span>{{company.contacts.phone}}</span>{{/if}}
    {{#if company.contacts.email}}<span>{{company.contacts.email}}</span>{{/if}}
    {{#if company.contacts.instagram}}<span>{{company.contacts.instagram}}</span>{{/if}}
  </footer>
</body>
</html>
$quotation_branded_v2$, '9cdd38836f5fb0ef8d56bee43abbb4da4506d84b2ac364ff4f7d7fb7f09cd66c', 2
FROM "quotation_templates" AS template LEFT JOIN "quotation_template_versions" AS existing ON existing."template_id" = template."id" WHERE template."key" = 'branded' AND NOT EXISTS (SELECT 1 FROM "quotation_template_versions" AS duplicate WHERE duplicate."template_id" = template."id" AND duplicate."source_hash" = '9cdd38836f5fb0ef8d56bee43abbb4da4506d84b2ac364ff4f7d7fb7f09cd66c') GROUP BY template."id" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_templates" ("id", "key", "name", "archived") VALUES ('f1000000-0000-4000-8000-000000000004'::uuid, 'comparativo', 'Comparativo por faixa', false) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_template_versions" ("id", "template_id", "version", "source", "source_hash", "contract_version")
SELECT 'f2000000-0000-4000-8000-000000000004'::uuid, template."id", COALESCE(MAX(existing."version"), 0) + 1, $quotation_comparativo_v2$
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <title>Comparativo por faixa {{quote_number}}</title>
  <style>body{margin:0;padding:28px;font:13px/1.5 Arial,sans-serif;color:#26344c}h1{margin:0;color:#1e3159}.header{display:flex;justify-content:space-between;border-bottom:2px solid #1e3159;padding-bottom:18px}.meta{text-align:right;color:#5c667a}.muted{color:#5c667a;font-size:12px}.client,.items,.commercial{margin-top:22px}.client{background:#f4f6fa;border-radius:8px;padding:14px}.client p{margin:3px 0}h2{font-size:16px;color:#1e3159}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #d9deea;text-align:left}.comparison{margin-top:22px}.totals{display:flex;justify-content:flex-end;gap:18px;margin-top:14px}.totals strong{border-top:2px solid #1e3159;padding-top:8px}.commercial section{margin-top:18px}.commercial section div,.commercial section p{white-space:pre-line}.footer{display:flex;flex-wrap:wrap;gap:16px;border-top:1px solid #d9deea;margin-top:28px;padding-top:14px;font-size:12px}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Comparativo por faixa</h1>
      <p class="muted">{{company.identity.legal_name}} · CNPJ {{company.identity.document}}</p>
      <p class="muted">{{quote_number}} · Revisão {{revision}}</p>
    </div>
    <div class="meta">{{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="client">
    <h2>Cliente</h2>
    <p>{{client.name}}</p>
    {{#if client.document}}<p>{{client.document}}</p>{{/if}}
    {{#if client.email}}<p>{{client.email}}</p>{{/if}}
    {{#if client.phone}}<p>{{client.phone}}</p>{{/if}}
    {{#if client.address}}<p>{{client.address}}</p>{{/if}}
  </section>
  <section class="items">
    <h2>Itens</h2>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{display.unit_price}}</td><td>{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
    {{#if comparison.brackets}}
    <h2>Comparação por faixa</h2>
    <table class="comparison"><thead><tr><th>Produto</th>{{#each comparison.brackets}}<th>{{label}}</th>{{/each}}</tr></thead><tbody>{{#each comparison.products}}<tr><td>{{name}}</td>{{#each prices}}<td>{{display}}</td>{{/each}}</tr>{{/each}}</tbody></table>
    {{/if}}
  <div class="commercial">
    {{#if terms.entrega}}<p>Entrega: {{terms.entrega}}</p>{{/if}}
    {{#if secoes.prazo_producao.enabled}}<section><h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p></section>{{/if}}
    {{#if secoes.pagamento.enabled}}<section><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><div class="banking">{{#if company.banking.bank_name}}<p>{{company.banking.bank_name}}{{#if company.banking.bank_code}} ({{company.banking.bank_code}}){{/if}}</p>{{/if}}{{#if company.banking.branch}}<p>Agência: {{company.banking.branch}}</p>{{/if}}{{#if company.banking.account}}<p>Conta: {{company.banking.account}}</p>{{/if}}{{#if company.banking.pix_key}}<p>Pix: {{company.banking.pix_key}}</p>{{/if}}</div></section>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<section><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></section>{{/if}}
  </div>
  <footer class="footer">
    {{#if company.contacts.website}}<span>{{company.contacts.website}}</span>{{/if}}
    {{#if company.contacts.phone}}<span>{{company.contacts.phone}}</span>{{/if}}
    {{#if company.contacts.email}}<span>{{company.contacts.email}}</span>{{/if}}
    {{#if company.contacts.instagram}}<span>{{company.contacts.instagram}}</span>{{/if}}
  </footer>
</body>
</html>
$quotation_comparativo_v2$, 'abac432292ccc6a6818c12a0995a8367e0d7a1f72f49523ea6e0793f210e5b24', 2
FROM "quotation_templates" AS template LEFT JOIN "quotation_template_versions" AS existing ON existing."template_id" = template."id" WHERE template."key" = 'comparativo' AND NOT EXISTS (SELECT 1 FROM "quotation_template_versions" AS duplicate WHERE duplicate."template_id" = template."id" AND duplicate."source_hash" = 'abac432292ccc6a6818c12a0995a8367e0d7a1f72f49523ea6e0793f210e5b24') GROUP BY template."id" ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_templates" ("id", "key", "name", "archived") VALUES ('f1000000-0000-4000-8000-000000000005'::uuid, 'simples', 'Simples', false) ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "quotation_template_versions" ("id", "template_id", "version", "source", "source_hash", "contract_version")
SELECT 'f2000000-0000-4000-8000-000000000005'::uuid, template."id", COALESCE(MAX(existing."version"), 0) + 1, $quotation_simples_v2$
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
  <title>Orçamento {{quote_number}}</title>
  <style>body{margin:0;padding:24px;font:13px/1.45 Arial,sans-serif;color:#222}.header{border-bottom:1px solid #222;padding-bottom:12px}.header h1{display:inline-block;margin:0 18px 0 0}.meta{display:inline-block;font-size:12px;color:#555}.muted{font-size:12px;color:#555}.client,.items,.commercial{margin-top:18px}.client p{margin:2px 0}h2{font-size:14px;margin:0 0 6px}table{width:100%;border-collapse:collapse}th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:left}.totals{display:flex;justify-content:flex-end;gap:12px;margin-top:12px}.totals strong{font-size:16px}.commercial section{margin-top:14px}.commercial section div,.commercial section p{white-space:pre-line}.footer{display:flex;flex-wrap:wrap;gap:12px;border-top:1px solid #ddd;margin-top:22px;padding-top:10px;font-size:11px}</style>
</head>
<body>
  <header class="header">
    <div>
      <h1>Orçamento</h1>
      <p class="muted">{{company.identity.legal_name}} · CNPJ {{company.identity.document}}</p>
      <p class="muted">{{quote_number}} · Revisão {{revision}}</p>
    </div>
    <div class="meta">{{display.quote_date}}<br>Válido até {{display.validity_date}}</div>
  </header>
  <section class="client">
    <h2>Cliente</h2>
    <p>{{client.name}}</p>
    {{#if client.document}}<p>{{client.document}}</p>{{/if}}
    {{#if client.email}}<p>{{client.email}}</p>{{/if}}
    {{#if client.phone}}<p>{{client.phone}}</p>{{/if}}
    {{#if client.address}}<p>{{client.address}}</p>{{/if}}
  </section>
  <section class="items">
    <h2>Itens</h2>
    <table><thead><tr><th>SKU</th><th>Produto</th><th>Quantidade</th><th>Unitário</th><th>Total</th></tr></thead><tbody>
      {{#each items}}<tr><td>{{sku}}</td><td>{{name}}{{#if description}}<div class="muted">{{description}}</div>{{/if}}</td><td>{{quantity}}</td><td>{{display.unit_price}}</td><td>{{display.line_total}}</td></tr>{{/each}}
    </tbody></table>
    <div class="totals"><div><span>Subtotal</span><span>{{display.subtotal}}</span></div><div><span>Frete</span><span>{{display.freight}}</span></div><div class="grand-total"><span>Total</span><span>{{display.total}}</span></div></div>
  </section>
  <div class="commercial">
    {{#if terms.entrega}}<p>Entrega: {{terms.entrega}}</p>{{/if}}
    {{#if secoes.prazo_producao.enabled}}<section><h2>{{secoes.prazo_producao.title}}</h2><p>{{secoes.prazo_producao.value}}</p></section>{{/if}}
    {{#if secoes.pagamento.enabled}}<section><h2>{{secoes.pagamento.title}}</h2><div>{{secoes.pagamento.body_html}}</div><div class="banking">{{#if company.banking.bank_name}}<p>{{company.banking.bank_name}}{{#if company.banking.bank_code}} ({{company.banking.bank_code}}){{/if}}</p>{{/if}}{{#if company.banking.branch}}<p>Agência: {{company.banking.branch}}</p>{{/if}}{{#if company.banking.account}}<p>Conta: {{company.banking.account}}</p>{{/if}}{{#if company.banking.pix_key}}<p>Pix: {{company.banking.pix_key}}</p>{{/if}}</div></section>{{/if}}
    {{#if secoes.condicoes_gerais.enabled}}<section><h2>{{secoes.condicoes_gerais.title}}</h2><div>{{secoes.condicoes_gerais.body_html}}</div></section>{{/if}}
  </div>
  <footer class="footer">
    {{#if company.contacts.website}}<span>{{company.contacts.website}}</span>{{/if}}
    {{#if company.contacts.phone}}<span>{{company.contacts.phone}}</span>{{/if}}
    {{#if company.contacts.email}}<span>{{company.contacts.email}}</span>{{/if}}
    {{#if company.contacts.instagram}}<span>{{company.contacts.instagram}}</span>{{/if}}
  </footer>
</body>
</html>
$quotation_simples_v2$, 'df30255bfb82aa561b1cf690ca2462c4fbd981f69661846fb2477560ff91bc42', 2
FROM "quotation_templates" AS template LEFT JOIN "quotation_template_versions" AS existing ON existing."template_id" = template."id" WHERE template."key" = 'simples' AND NOT EXISTS (SELECT 1 FROM "quotation_template_versions" AS duplicate WHERE duplicate."template_id" = template."id" AND duplicate."source_hash" = 'df30255bfb82aa561b1cf690ca2462c4fbd981f69661846fb2477560ff91bc42') GROUP BY template."id" ON CONFLICT DO NOTHING;
--> statement-breakpoint
