# Gerenciamento de templates HTML e conteúdo de orçamentos - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir administrar templates HTML versionados, configurar três seções comerciais globais e personalizar essas seções em revisões de orçamento ainda em rascunho.

**Architecture:** O banco terá identidades de modelos, versões imutáveis de HTML e snapshots de conteúdo por revisão.

A configuração singleton manterá os padrões das três seções, enquanto cada revisão capturará sua própria cópia editável.

O motor Handlebars existente continuará renderizando HTML sob demanda, agora usando a versão exata do template e o snapshot exato da revisão.

**Tech Stack:** React 19, Vite 6, TypeScript, Node.js ESM, PostgreSQL via Neon + Drizzle, Handlebars, Playwright e `node:test`.

## Pre-implementation gate

Before Task 1, run `npm run build` and `npm run test:unit` on the current checkout.

Record the baseline result in the task report; do not fix unrelated pre-existing failures as part of this feature.

Run `git diff -- docs/superpowers/plans/2026-08-04-no-pdf-html-only.md scripts/cleanup-orc.mjs` and leave those pre-existing files unchanged.

## Global Constraints

- Editar fontes `*.ts`, `*.tsx` e `*.mjs`; arquivos `api/**/*.js` são compilados e ignorados. Arquivos gerados de migração Drizzle, `package.json` e testes podem ser alterados quando a tarefa exigir.
- Não adicionar dependência sem aprovação explícita.
- HTML de template pode usar CSS, mas não pode executar JavaScript.
- `script`, `iframe`, `object`, `embed`, URLs `javascript:`, handlers inline e saídas Handlebars sem escape são rejeitados.
- Corpos de seções são texto simples e devem ser escapados antes de receber `<br>`.
- O template controla completamente o layout e pode omitir qualquer seção.
- Existem exatamente três seções no primeiro lançamento: `prazo_producao`, `pagamento` e `condicoes_gerais`.
- `prazo_producao` continua sendo campo semântico da revisão e não ganha corpo global.
- Configuração global afeta somente novos orçamentos.
- Cada revisão guarda template, versão e conteúdo usados na renderização.
- Template e conteúdo só podem ser alterados enquanto a revisão estiver em `rascunho`.
- Modelos usados são arquivados, nunca excluídos fisicamente.
- Manual e automático devem oferecer o seletor de modelo na criação.
- Rascunho já criado também pode trocar o modelo sem criar nova revisão.
- Preview usa HTML sob demanda e não grava PDF ou HTML em Blob.
- Manter `quotation-preview?format=pdf` para geração sob demanda.
- Manter WhatsApp PDF sem acoplar a emissão de orçamento.
- Erros de API devem permanecer em português brasileiro e não expor stack trace.
- O validador HTML deve usar tokenizer/state machine estrito e allowlists explícitas, não apenas regex de rejeição.
- Templates novos e novas versões exigem os campos essenciais `quote_number`, `client.name`, um bloco `{{#each items}}...{{/each}}` e `display.total`.
- O source Frappe legado migrado pode omitir `display.total` somente quando o hash corresponder exatamente ao source histórico conhecido; essa exceção não vale para novas versões.
- A migração, criação de orçamento, atualização de rascunho e criação de revisão compartilham o mesmo lock advisory transacional.
- Preview histórico nunca aceita `template`/`template_key` como override; somente rascunho aceita `template_version_id` para seleção ainda não salva.
- O endpoint de templates é o único owner de `template_padrao` na UI; salvamento de seções não envia esse campo e o backend preserva o valor atual quando omitido.
- Cada tarefa termina com teste direcionado, verificação e commit isolado.

---

## Mapa de arquivos

### Domínio e renderização

- Criar `api/_db/quotation-content.ts` para tipos, defaults, validação e snapshots das seções.
- Modificar `api/_functions/lib/quotation-templates.ts` para política HTML, `body_html`, modelos de preview e renderização de templates persistidos.
- Modificar `api/_db/quotation-template-repository.ts` para carregar a versão imutável e o snapshot da revisão.
- Criar `api/_db/quotation-template-library-repository.ts` para CRUD de modelos e versões.
- Criar `api/_db/quotation-template-migration.ts` para funções puras de migração e montagem de snapshots legados.
- Criar `api/_db/quotation-write-lock.ts` para o lock advisory compartilhado por migração e escritores de revisões.

### Banco e migração

- Modificar `api/_db/schema.ts` com `quotation_templates`, `quotation_template_versions`, `app_settings.quotation_sections`, `quote_revisions.template_version_id` e `quote_revisions.sections_snapshot`.
- Criar a migração Drizzle gerada `drizzle/0011_quotation_template_library.sql` e o snapshot correspondente em `drizzle/meta/`.
- Criar `scripts/migrate-quotation-templates.mjs` para semear templates embutidos e preencher dados existentes.
- Modificar `package.json` com `migrate:quotation-templates`.

### API

- Modificar `api/_functions/quotation-templates.ts` para GET, criação, versionamento, arquivamento, definição de padrão e preview de validação.
- Modificar `api/_db/settings-repository.ts` e `api/_functions/settings.ts` para persistir as seções e manter compatibilidade com o payload legado.
- Modificar `api/_db/quote-repository.ts` para selecionar versão e snapshot durante criação.
- Modificar `api/_db/quote-draft-management-repository.ts` para atualizar template e seções em rascunhos.
- Modificar `api/_db/quotation-lifecycle-repository.ts` para copiar template e snapshot ao criar revisão.
- Manter `api/[...path].ts`, `scripts/dev-api-server.mjs` e `scripts/app-server.mjs` com a rota existente `quotation-templates`; não criar rota duplicada.

### Frontend

- Criar `src/lib/quotationTemplatesApi.ts` com tipos e chamadas da biblioteca.
- Criar `src/components/quotation/QuotationSectionsEditor.tsx` para edição das três seções.
- Criar `src/components/quotation/QuotationTemplateManager.tsx` para a tela lista + editor.
- Modificar `src/pages/SettingsPage.tsx` para integrar biblioteca e seções globais.
- Modificar `src/types/domain.ts` e `src/hooks/useExtractionDrafts.ts` para carregar a escolha do modelo no fluxo automático.
- Modificar `src/pages/ManualOrcamentoPage.tsx` e `src/pages/AutoQuotePage.tsx` para exibir o seletor na criação.
- Modificar `src/components/SplitResultCard.tsx` para exibir o seletor no rascunho extraído.
- Modificar `src/pages/QuotationDetailPage.tsx` para editar seções e trocar modelo no rascunho.
- Modificar `src/App.tsx` somente se a rota de Configurações precisar de uma subrota nova; preferir manter a rota existente `#/settings`.

### Testes

- Criar `tests/unit/quotation-content.test.ts`.
- Criar `tests/unit/quotation-template-library.test.ts`.
- Criar `tests/unit/quotation-template-migration.test.ts`.
- Criar `tests/unit/quotation-schema.test.ts`.
- Modificar `tests/unit/quotation-templates-core.test.js`.
- Modificar `tests/unit/settings.test.ts` e `tests/unit/settings-postgres.test.ts`.
- Modificar `tests/unit/quotations-core.test.ts`, `tests/unit/quotations-postgres.test.ts` e `tests/unit/quotation-lifecycle-postgres.test.ts`.
- Modificar `tests/quotation-templates-core.spec.js`, `tests/settings.spec.js` e `tests/quotation-lifecycle.spec.js`.
- Criar ou modificar teste E2E do fluxo manual e automático conforme a cobertura existente no checkout.

---

## Task 1: Modelar seções e endurecer o motor de templates

**Files:**

- Create: `api/_db/quotation-content.ts`
- Modify: `api/_functions/lib/quotation-templates.ts`
- Create: `tests/unit/quotation-content.test.ts`
- Modify: `tests/unit/quotation-templates-core.test.js`

**Interfaces:**

- Produces `QuotationSectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais'`.
- Produces `QuotationSectionsSettings` com `schema_version`, `enabled`, `title` e `body` apenas onde aplicável.
- Produces `QuotationSectionsSnapshot` com `base` e `current` para cada seção.
- Produces `DEFAULT_QUOTATION_SECTIONS`.
- Produces `normalizeQuotationSections(input, legacy)`.
- Produces `createQuotationSectionsSnapshot(settings)`.
- Produces `validateQuotationSections(input)`.
- Produces `combineLegacyConditions(entrega, observacoes)`.
- Produces `toSafeMultilineHtml(value)`.
- Keeps `renderQuotationTemplate(template, viewModel)` compatible with built-in and persisted templates.

- [ ] **Step 1: Write failing unit tests for section normalization and safe text**

Add assertions with these exact behaviors:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_QUOTATION_SECTIONS,
  combineLegacyConditions,
  createQuotationSectionsSnapshot,
  normalizeQuotationSections,
} from '../../api/_db/quotation-content.js';

const legacy = {
  pagamento: '50% na aprovação',
  entrega: '3 dias úteis',
  observacoes: 'A arte precisa ser aprovada antes da produção.',
};

test('normaliza três seções e combina campos legados em condições gerais', () => {
  const sections = normalizeQuotationSections(undefined, legacy);
  assert.equal(sections.schema_version, 1);
  assert.equal(sections.pagamento.body, '50% na aprovação');
  assert.equal(
    sections.condicoes_gerais.body,
    'Prazo de entrega:\n3 dias úteis\n\nObservações:\nA arte precisa ser aprovada antes da produção.'
  );
});

test('cria base e current independentes', () => {
  const snapshot = createQuotationSectionsSnapshot(DEFAULT_QUOTATION_SECTIONS);
  snapshot.current.pagamento.title = 'Alterado';
  assert.equal(snapshot.base.pagamento.title, DEFAULT_QUOTATION_SECTIONS.pagamento.title);
});

test('combina somente os valores legados existentes', () => {
  assert.equal(combineLegacyConditions('', 'Observação'), 'Observações:\nObservação');
  assert.equal(combineLegacyConditions('Entrega', ''), 'Prazo de entrega:\nEntrega');
  assert.equal(combineLegacyConditions('', ''), '');
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test tests/unit/quotation-content.test.ts
```

Expected: FAIL because `api/_db/quotation-content.ts` does not exist.

- [ ] **Step 3: Implement the section domain module**

Use these bounds and semantics:

```ts
export const QUOTATION_SECTION_SCHEMA_VERSION = 1 as const;
export const MAX_SECTION_TITLE_LENGTH = 120;
export const MAX_SECTION_BODY_LENGTH = 4000;

export type QuotationSectionKey = 'prazo_producao' | 'pagamento' | 'condicoes_gerais';

export interface QuotationSectionSettings {
  enabled: boolean;
  title: string;
  body?: string;
}

export interface QuotationSectionsSettings {
  schema_version: typeof QUOTATION_SECTION_SCHEMA_VERSION;
  prazo_producao: QuotationSectionSettings;
  pagamento: QuotationSectionSettings & { body: string };
  condicoes_gerais: QuotationSectionSettings & { body: string };
}

export interface QuotationSectionsSnapshot {
  schema_version: typeof QUOTATION_SECTION_SCHEMA_VERSION;
  prazo_producao: { base: QuotationSectionSettings; current: QuotationSectionSettings };
  pagamento: {
    base: QuotationSectionSettings & { body: string };
    current: QuotationSectionSettings & { body: string };
  };
  condicoes_gerais: {
    base: QuotationSectionSettings & { body: string };
    current: QuotationSectionSettings & { body: string };
  };
}
```

`normalizeQuotationSections` must reject non-object sections, non-boolean `enabled`, blank titles and strings over the bounds.

It must fill missing values from `DEFAULT_QUOTATION_SECTIONS`.

It must derive the legacy conditions body only when `input` does not contain `condicoes_gerais`.

`createQuotationSectionsSnapshot` must deep-copy all nested values so `base` and `current` cannot share object references.

`combineLegacyConditions` must preserve the exact labels `Prazo de entrega:` and `Observações:`.

- [ ] **Step 4: Add the Handlebars safe body helper and HTML policy tests**

Extend `tests/unit/quotation-templates-core.test.js` with these assertions:

```js
test('body_html escapes user text and preserves line breaks', () => {
  const model = quotationSnapshotViewModel({
    ...snapshot,
    revision: {
      ...snapshot.revision,
      sectionsSnapshot: {
        schema_version: 1,
        prazo_producao: {
          base: { enabled: true, title: 'Prazo de produção' },
          current: { enabled: true, title: 'Prazo de produção' },
        },
        pagamento: {
          base: { enabled: true, title: 'Pagamento', body: 'A' },
          current: { enabled: true, title: 'Pagamento', body: '<script>alert(1)</script>\nSaldo' },
        },
        condicoes_gerais: {
          base: { enabled: true, title: 'Condições', body: 'C' },
          current: { enabled: true, title: 'Condições', body: 'C' },
        },
      },
    },
  });
  const html = renderQuotationTemplate(
    { ...DEFAULT_QUOTATION_TEMPLATE, source: '{{secoes.pagamento.body_html}}' },
    model
  );
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;<br>Saldo/);
  assert.doesNotMatch(html, /<script>/);
});
```

Add rejected HTML cases for `<script>`, `onclick`, `javascript:` and `<iframe>`.
Also test that an HTML document missing each required budget field (number, client, item loop and total) is rejected, while omission of any `secoes.*` placeholder returns a warning only.

- [ ] **Step 5: Implement the policy and view-model support**

Add `validateQuotationHtmlSource(source: string, templateKey?: string): void` in `quotation-templates.ts`.

It must reject the forbidden tags, event attributes, dangerous URL protocols, CSS `@import`, CSS `expression(` and CSS `url(javascript:...)`.

It must allow the tags and attributes already used by the three built-in templates plus common safe document tags: `article`, `b`, `blockquote`, `caption`, `code`, `col`, `colgroup`, `dd`, `dl`, `dt`, `em`, `footer`, `h3`, `h4`, `h5`, `h6`, `hr`, `img`, `li`, `main`, `nav`, `ol`, `pre`, `small`, `tfoot`, `ul`.
The allowlist is exhaustive: reject unknown tags and attributes, including `meta` attributes other than `charset`, URL-bearing attributes other than `href`/`src`/`link`, all `data-*` attributes except the existing `data-name`, and all SVG active-content features such as `foreignObject`, `use` and `xlink:href`.
Normalize tag/attribute names, HTML character references, control whitespace and protocol casing before checking URLs; allow only `https:` and `mailto:` where applicable, and only `https:` or `data:image/*` for images.
Apply the same declaration policy to `<style>` blocks and `style` attributes: reject `@import`, `expression(`, every `url(`, `behavior`, `-moz-binding`, and any event-like property.
Add mixed-case, encoded-protocol, malformed-markup, unknown-tag/attribute and unsafe-SVG tests.
The validator must remain dependency-free.

Implement it as a strict tokenizer/state machine that recognizes doctype, start/end tags, quoted attributes, comments and style content, and rejects malformed or unterminated markup before applying policy checks. Do not use a regex-only allowlist.

The exhaustive tag allowlist must include only the document/common tags used by the built-ins plus the safe tags listed above, and SVG must be limited to `svg`, `g` and `path`. The exhaustive attribute allowlist must cover the built-ins' `class`, `id`, `style`, `href`, `src`, `rel`, `charset`, `width`, `height`, `viewBox`, `preserveAspectRatio`, `xmlns`, `xmlns:xlink`, `fill`, `stroke`, `d` and `data-name`; reject all other attributes, including `xlink:href`, `foreignObject`, `use`, form actions and unknown `data-*` attributes. Normalize tag/attribute names, character references, control whitespace and protocol casing before URL checks.

For the required fields, parse the Handlebars AST and require these exact paths: `quote_number`, `client.name`, an `each` block whose path is `items`, and `display.total`. Return Portuguese field-specific errors for each missing path. Missing `secoes.prazo_producao`, `secoes.pagamento` or `secoes.condicoes_gerais` remains a preview warning only.

The only exception is the exact historical Frappe source/hash already present in `QUOTATION_TEMPLATES`; identify it by source hash in the static definition, allow its missing `display.total` with a compatibility warning, and do not apply that exception to user-created or subsequently saved Frappe versions.

Call it before `validateQuotationTemplateSource` in `renderQuotationTemplate` and in every persistence validation path.

Add a view-model helper that returns `secoes.prazo_producao.value`, `secoes.pagamento.body_html` and `secoes.condicoes_gerais.body_html`.

Generate each `body_html` by escaping each line with `Handlebars.escapeExpression` and joining lines with `<br>` inside `new Handlebars.SafeString(...)`.

Keep normal `{{...}}` interpolation escaped and continue rejecting triple-stash syntax.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --test tests/unit/quotation-content.test.ts tests/unit/quotation-templates-core.test.js
```

Expected: PASS with zero failures.

Commit:

```bash
git add api/_db/quotation-content.ts api/_functions/lib/quotation-templates.ts tests/unit/quotation-content.test.ts tests/unit/quotation-templates-core.test.js
git commit -m "feat: add quotation section content model"
```

---

## Task 2: Add the database schema for templates and snapshots

**Files:**

- Modify: `api/_db/schema.ts`
- Create: `drizzle/0011_quotation_template_library.sql`
- Create: `drizzle/meta/0011_snapshot.json`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/unit/quotation-schema.test.ts`

**Interfaces:**

- Produces `quotationTemplates` with `id`, `key`, `name`, `archived`, `createdAt` and `updatedAt`.
- Produces `quotationTemplateVersions` with `id`, `templateId`, `version`, `source`, `sourceHash` and `createdAt`.
- Adds `appSettings.quotationSections` JSONB.
- Adds nullable `quoteRevisions.templateVersionId` and `quoteRevisions.sectionsSnapshot` for zero-downtime backfill.
- Existing `templatePadrao` and `templateHash` remain compatibility mirrors.

- [ ] **Step 1: Add schema assertions before implementation**

Add a unit test that imports the schema and asserts the new table exports exist and the column names map to `quotation_templates`, `quotation_template_versions`, `quotation_sections`, `template_version_id` and `sections_snapshot`.

Use the existing Drizzle migration sequence (`drizzle/0010_add_item_notas.sql` is the current last migration) and keep the new migration forward-only.

Add this assertion to the test:

```ts
import {
  appSettings,
  quoteRevisions,
  quotationTemplates,
  quotationTemplateVersions,
} from '../../api/_db/schema.js';

assert.equal(appSettings.quotationSections.name, 'quotation_sections');
assert.equal(quoteRevisions.templateVersionId.name, 'template_version_id');
assert.equal(quoteRevisions.sectionsSnapshot.name, 'sections_snapshot');
assert.equal(quotationTemplates.key.name, 'key');
assert.equal(quotationTemplateVersions.sourceHash.name, 'source_hash');
```

Run:

```bash
node --test tests/unit/quotation-schema.test.ts
```

Expected: FAIL because the schema exports and columns do not exist.

- [ ] **Step 2: Add Drizzle table definitions**

Import `text` from `drizzle-orm/pg-core`.

Add this shape to `api/_db/schema.ts`:

```ts
export const quotationTemplates = pgTable(
  'quotation_templates',
  {
    id: uuid('id').primaryKey(),
    key: varchar('key', { length: 120 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('quotation_templates_key_unique').on(table.key)]
);

export const quotationTemplateVersions = pgTable(
  'quotation_template_versions',
  {
    id: uuid('id').primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => quotationTemplates.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    source: text('source').notNull(),
    sourceHash: varchar('source_hash', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('quotation_template_versions_template_version_unique').on(
      table.templateId,
      table.version
    ),
    uniqueIndex('quotation_template_versions_template_hash_unique').on(
      table.templateId,
      table.sourceHash
    ),
  ]
);
```

Add `quotationSections` to `appSettings` as JSONB typed with `QuotationSectionsSettings` and a valid default based on `DEFAULT_QUOTATION_SECTIONS`.

Because both editable section bodies allow up to 4000 characters, widen the legacy `pagamento` columns in `app_settings` and `quote_revisions` from `varchar(500)` to at least `varchar(4000)` in this forward migration, or lower the payment-body limit to 500 everywhere before implementation. Do not truncate a section body when writing compatibility mirrors.

Add these nullable columns to `quoteRevisions`:

```ts
templateVersionId: uuid('template_version_id').references(() => quotationTemplateVersions.id),
sectionsSnapshot: jsonb('sections_snapshot').$type<QuotationSectionsSnapshot>(),
```

Keep them nullable in the schema because existing databases need a data backfill between the DDL migration and the application invariant.

New writes must still reject missing values at the repository boundary after this task.

- [ ] **Step 3: Generate and inspect the Drizzle migration**

Run:

```bash
npm run db:generate -- --name quotation-template-library
```

If Drizzle generates a different timestamped/tagged filename, keep its generated name and update later task references to the actual file; do not rename generated artifacts manually.

Inspect the SQL and verify it creates both tables, adds the JSONB column and adds both revision columns without dropping existing data.

Do not hand-edit the generated snapshot JSON.

- [ ] **Step 4: Run schema checks**

Run:

```bash
npm run build:api
node --test tests/unit/quotation-schema.test.ts
```

Expected: PASS with zero TypeScript errors and zero test failures.

- [ ] **Step 5: Commit the schema migration**

```bash
git add api/_db/schema.ts drizzle/0011_quotation_template_library.sql drizzle/meta tests/unit/quotation-schema.test.ts
git commit -m "feat: add versioned quotation template schema"
```

---

## Task 3: Implement the dynamic template library repository and API

**Files:**

- Create: `api/_db/quotation-template-library-repository.ts`
- Modify: `api/_functions/quotation-templates.ts`
- Modify: `api/_functions/lib/quotation-templates.ts`
- Modify: `scripts/dev-api-server.mjs` to include `url` in the `FunctionEvent`.
- Modify: `scripts/app-server.mjs` to include `url` in the `FunctionEvent`.
- Create: `tests/unit/quotation-template-library.test.ts`
- Modify: `tests/unit/quotation-templates-core.test.js`

**Interfaces:**

- Produces `QuotationTemplateListItem` with `id`, `key`, `name`, `archived`, `is_default`, `current_version_id`, `current_version`, `current_hash`, `updated_at` and `usage_count`.
- Produces `QuotationTemplateDetail` with the list item, current source and immutable version metadata.
- Produces `QuotationTemplateLibraryRepository` with `list`, `get`, `create`, `saveVersion`, `archive`, `setDefault` and `validate`.
- Produces `readCurrentQuotationTemplateVersion(db, selection)` for quote creation and draft updates.
- Keeps route name `quotation-templates` unchanged.

- [ ] **Step 1: Define the repository seam and handler tests**

Add fake-repository tests for these requests:

```ts
const repository = {
  list: async () => ({ templates: [], default_key: 'padrao' }),
  get: async () => null,
  create: async () => ({ id: 'template-id' }),
  saveVersion: async () => ({ id: 'version-id' }),
  archive: async () => ({ archived: true }),
  setDefault: async () => ({ default_key: 'padrao' }),
  validate: async () => ({ valid: true, warnings: [], preview: '<!doctype html>' }),
};
```

Cover:

- GET without `id` returns metadata only and omits source.
- GET with `id` returns source and versions.
- GET with `active=true` excludes archived models.
- POST creates a model and its first version.
- POST to `/api/quotation-templates/validate` validates without persistence.
- PUT with `action: 'save_version'` creates a new immutable version.
- PUT with `action: 'archive'` rejects the current default.
- PUT with `action: 'set_default'` updates `app_settings.template_padrao`.
- Duplicate keys, blank names, invalid HTML and invalid Handlebars return status 400.

- [ ] **Step 2: Run the tests and verify the seam fails**

Run:

```bash
node --test tests/unit/quotation-template-library.test.ts
```

Expected: FAIL because the repository and new handler behavior do not exist.

- [ ] **Step 3: Implement the repository**

Use lazy database access through `getDatabase`, matching existing repository seams.

The handler dependency seam must be injectable as `QuotationTemplateLibraryRepository` so unit tests do not require PostgreSQL.

`readCurrentQuotationTemplateVersion(db, selection)` must accept a transaction-compatible `QuoteDatabase` and return `{ model, version }` with the model's `id`, `key`, `name`, `archived` and the version's `id`, `version`, `source`, `sourceHash`.

Normalize keys with `/^[a-z0-9][a-z0-9_-]{0,119}$/`.

Normalize names with a 255-character maximum.

Reject source strings longer than 200000 UTF-8 characters.

Validate source with both `validateQuotationHtmlSource` and `validateQuotationTemplateSource` before insert or update.

`saveVersion` must also render the source with the same deterministic preview fixture used by `validate`, and must persist only after validation and rendering both succeed; a client-supplied validation result is never trusted.

Compute `source_hash` with the existing SHA-256 helper.

Use a transaction for create, save-version, archive and set-default operations.

When saving a version, return the existing version if the same template already has the same hash.

When saving a changed source, compute `max(version) + 1` under the template row lock.

When archiving, query `app_settings.template_padrao` and reject archiving the configured default with `QuoteManagementConflictError` semantics translated to the template repository error type.

When setting the default, reject archived templates and update the singleton row atomically.

Count revision references through `quote_revisions.template_version_id` for `usage_count`.

- [ ] **Step 4: Implement handler routing without changing the catch-all router**

`quotation-templates.ts` must inspect the request path to distinguish `/api/quotation-templates` from `/api/quotation-templates/validate` because the project router resolves only the first path segment.

Use `event.url` when available and add `url: req.url` to the event objects built by `scripts/dev-api-server.mjs` and `scripts/app-server.mjs`.

The Vercel catch-all already supplies `url` through `toFunctionEvent`.

Use these request shapes:

```json
POST /api/quotation-templates
{
  "key": "corporativo",
  "name": "Corporativo",
  "source": "<!doctype html>..."
}
```

```json
POST /api/quotation-templates/validate
{
  "key": "corporativo",
  "source": "<!doctype html>..."
}
```

```json
PUT /api/quotation-templates?id=<template-id>
{
  "action": "save_version",
  "name": "Corporativo",
  "source": "<!doctype html>..."
}
```

```json
PUT /api/quotation-templates?id=<template-id>
{ "action": "archive" }
```

```json
PUT /api/quotation-templates?id=<template-id>
{ "action": "set_default" }
```

Return JSON with `responseMetadata('core')`, safe Portuguese errors and no source in list responses.

Use deterministic preview data from the existing snapshot fixture shape.

Return preview warnings when a template omits one of `secoes.prazo_producao`, `secoes.pagamento` or `secoes.condicoes_gerais`.

Omission is a warning, not a validation failure.

- [ ] **Step 5: Run tests, build and commit**

Run:

```bash
node --test tests/unit/quotation-template-library.test.ts tests/unit/quotation-templates-core.test.js
npm run build:api
```

Expected: PASS with zero failures and zero TypeScript errors.

Commit:

```bash
git add api/_db/quotation-template-library-repository.ts api/_functions/quotation-templates.ts api/_functions/lib/quotation-templates.ts tests/unit/quotation-template-library.test.ts tests/unit/quotation-templates-core.test.js
git commit -m "feat: add quotation template library API"
```

---

## Task 4: Add the idempotent template and legacy-data migration

**Files:**

- Create: `api/_db/quotation-template-migration.ts`
- Create: `api/_db/quotation-write-lock.ts`
- Create: `scripts/migrate-quotation-templates.mjs`
- Modify: `package.json`
- Create: `tests/unit/quotation-template-migration.test.ts`
- Modify: `tests/unit/quotations-postgres.test.ts`
- Modify: `api/_functions/frappe-migration.ts` only if the existing one-time migration import path needs the new template seed helpers; do not alter its historical PDF behavior otherwise.
- Modify: `tests/unit/migrate-frappe-cli.test.ts` only if the CLI test asserts the list of migration commands; keep the historical migration CLI behavior unchanged.

**Interfaces:**

- Produces `combineLegacyConditions(entrega, observacoes)` reuse from `quotation-content.ts`.
- Produces `snapshotFromLegacyRevision(revision)`.
- Produces `templateSeedPlan()`.
- Produces executable command `npm run migrate:quotation-templates`.

- [ ] **Step 1: Write pure migration tests**

Add tests for:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  snapshotFromLegacyRevision,
  templateSeedPlan,
} from '../../api/_db/quotation-template-migration.js';

test('legacy revision receives a frozen sections snapshot', () => {
  const snapshot = snapshotFromLegacyRevision({
    pagamento: 'À vista',
    entrega: '3 dias',
    observacoes: 'Aprovar arte',
    prazoProducao: '10 dias úteis',
  });
  assert.equal(snapshot.pagamento.current.body, 'À vista');
  assert.match(snapshot.condicoes_gerais.current.body, /Prazo de entrega:/);
  assert.match(snapshot.condicoes_gerais.current.body, /Observações:/);
  assert.equal(snapshot.prazo_producao.current.title, 'Prazo de produção');
});

test('built-in seed plan is stable and idempotent by key and hash', () => {
  const plan = templateSeedPlan();
  assert.ok(plan.length >= 3);
  assert.equal(new Set(plan.map((item) => item.key)).size, plan.length);
  for (const item of plan) assert.match(item.source_hash, /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Implement the pure migration helpers**

`templateSeedPlan()` must read `QUOTATION_TEMPLATES` from the existing static engine and produce one version-1 seed for `padrao`, `minimalista` and `frappe`.

The plan must accept the built-in source definitions as they exist today; it must not rewrite their HTML in this migration, because existing revision hashes must remain resolvable.

The helper must also expose `legacySnapshotForRevision(revision)` and `legacySettingsSections(settings)` so the CLI and repository tests use one normalization path.

Do not change built-in source strings in this task.

Existing revision hashes must continue resolving to the exact source that produced them.

`snapshotFromLegacyRevision` must set `base` and `current` to independent copies of the legacy values.

For new legacy conditions, use the exact `combineLegacyConditions` labels.

- [ ] **Step 3: Implement the migration CLI**

The script must require `DATABASE_URL` and run in a single PostgreSQL transaction.

Do not use an import of the generated `api/**/*.js` files before `npm run build:api`; the package script already compiles TypeScript first.

The script must not import or invoke Vercel Blob.

It must be safe to run repeatedly. Use `api/_db/quotation-write-lock.ts` as the single implementation of a transaction-scoped PostgreSQL advisory lock. The migration must acquire it before reading or writing revisions and hold it through the final in-transaction verification; quote creation, draft updates and lifecycle revision creation must acquire the same lock before their transactions write revisions. After commit, acquire the lock in a new read transaction and repeat the missing-row verification before declaring success.

Use `postgres` and the compiled schema or parameterized SQL, matching `scripts/migrate-frappe-crm.mjs` ESM conventions.

The transaction must:

1. Upsert the three built-in model identities by `key`.
2. Insert each built-in source as version 1 when its hash is absent.
3. Set `app_settings.quotation_sections` from current legacy `pagamento`, `entrega` and `observacoes` when the newly added JSON field is empty, invalid or still equal to the empty schema default.
4. Preserve a non-empty pre-existing JSON value if one is already present.
5. Find every `quote_revisions` row by `template_padrao` and `template_hash`.
6. Resolve the matching `quotation_template_versions.id`.
7. Abort with a Portuguese error listing the key and hash if no matching version exists.
8. Write `template_version_id` and `sections_snapshot` for every revision.
9. Verify no revision has a missing version or snapshot before commit.
10. Validate `app_settings.template_padrao` against the seeded active models; preserve a valid configured key, otherwise set `padrao` and report `default_repaired`.
11. Leave legacy columns untouched for compatibility.

The script must print a JSON report with counts for models, versions, revisions backfilled, already-complete rows, and `default_repaired`.

- [ ] **Step 4: Add the package command and migration instructions**

Add this script entry:

```json
"migrate:quotation-templates": "npm run build:api && node scripts/migrate-quotation-templates.mjs"
```

The release order is:

```bash
npm run db:migrate
npm run migrate:quotation-templates
```

Do not run the application rollout until the second command reports zero missing versions and zero missing snapshots.

- [ ] **Step 5: Run pure tests and, when configured, PostgreSQL verification**

Run:

```bash
node --test tests/unit/quotation-template-migration.test.ts
```

When `TEST_DATABASE_URL` or `DATABASE_URL` is available, run:

```bash
npm run migrate:quotation-templates
node --test tests/unit/quotations-postgres.test.ts
```

Expected: PASS and idempotent second execution with unchanged counts.

- [ ] **Step 6: Commit**

```bash
git add api/_db/quotation-template-migration.ts scripts/migrate-quotation-templates.mjs package.json tests/unit/quotation-template-migration.test.ts tests/unit/quotations-postgres.test.ts
git commit -m "feat: migrate quotation templates and snapshots"
```

---

## Task 5: Extend settings with global sections and compatibility normalization

**Files:**

- Modify: `api/_db/settings-repository.ts`
- Modify: `api/_functions/settings.ts`
- Modify: `src/lib/settingsApi.ts`
- Modify: `tests/unit/settings.test.ts`
- Modify: `tests/unit/settings-postgres.test.ts`
- Modify: `tests/settings.spec.js`

**Interfaces:**

- `Settings` gains `secoes: QuotationSectionsSettings`.
- `DashboardSettings` gains `secoes: QuotationSectionsSettings`.
- GET and PUT continue returning legacy `pagamento`, `entrega`, `observacoes` fields for compatibility.
- New PUT payload accepts `secoes` and derives legacy mirrors.
- `template_padrao` remains accepted for legacy callers, but the Settings UI does not send it; the template-library `set_default` action is the sole UI writer of the default key.

- [ ] **Step 1: Add failing settings tests**

Extend unit tests to assert:

```ts
const payload = {
  validade_dias: 30,
  frete_padrao: '12.50',
  template_padrao: 'padrao',
  secoes: {
    schema_version: 1,
    prazo_producao: { enabled: true, title: 'Produção' },
    pagamento: { enabled: true, title: 'Pagamento', body: '50% na aprovação' },
    condicoes_gerais: { enabled: false, title: 'Condições', body: '' },
  },
};
```

Assert that the response contains the same sections, `pagamento` mirrors the payment body, and `observacoes` mirrors the conditions body.

Assert that legacy payloads with `pagamento`, `entrega` and `observacoes` still normalize into the three-section shape.

Assert invalid `enabled`, blank titles and oversized bodies return field errors.

- [ ] **Step 2: Update settings types and repository persistence**

Add `quotationSections` to `appSettings` reads and writes.

`toSettings` must call `normalizeQuotationSections(row.quotationSections, row)`.

`DEFAULT_SETTINGS` must include `DEFAULT_QUOTATION_SECTIONS`.

When saving, write the validated JSON into `quotationSections`.

Keep legacy columns populated as follows:

- `pagamento` receives `secoes.pagamento.body`.
- `entrega` receives incoming legacy `entrega` when supplied, otherwise preserves the stored mirror; section-first writes must never clear it implicitly.
- `observacoes` receives `secoes.condicoes_gerais.body`.

When `template_padrao` is omitted, preserve the current database value. This prevents a stale Settings form from overwriting a default changed through the template manager.

This preserves old readers without creating a second source of truth for the new UI.

- [ ] **Step 3: Update API validation**

`validateSettingsPayload` must accept `payload.secoes` first.

When `payload.secoes` is absent, derive it from `payload.pagamento`, `payload.entrega` and `payload.observacoes`.

Use `validateQuotationSections` for all nested fields.

Keep existing validity, freight and template-key validation.

Return field-specific Portuguese errors such as `secoes.pagamento.body`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test tests/unit/settings.test.ts tests/unit/settings-postgres.test.ts
npx playwright test tests/settings.spec.js
```

Expected: PASS with zero failures.

- [ ] **Step 5: Commit**

```bash
git add api/_db/settings-repository.ts api/_functions/settings.ts src/lib/settingsApi.ts tests/unit/settings.test.ts tests/unit/settings-postgres.test.ts tests/settings.spec.js
git commit -m "feat: persist quotation section defaults"
```

---

## Task 6: Build the Settings UI for models and sections

**Files:**

- Create: `src/lib/quotationTemplatesApi.ts`
- Create: `src/components/quotation/QuotationSectionsEditor.tsx`
- Create: `src/components/quotation/QuotationTemplateManager.tsx`
- Modify: `src/pages/SettingsPage.tsx`
- Modify: `tests/settings.spec.js`

**Interfaces:**

- `listQuotationTemplates(activeOnly?: boolean)` calls `GET /quotation-templates`.
- `getQuotationTemplate(id)` calls `GET /quotation-templates?id=...`.
- `validateQuotationTemplate(source, key)` calls `POST /quotation-templates/validate`.
- `createQuotationTemplate(input)` calls `POST /quotation-templates`.
- `saveQuotationTemplateVersion(id, input)` calls `PUT /quotation-templates?id=...` with `action: 'save_version'`.
- `archiveQuotationTemplate(id)` calls `PUT /quotation-templates?id=...` with `action: 'archive'`.
- `setDefaultQuotationTemplate(id)` calls `PUT /quotation-templates?id=...` with `action: 'set_default'`.
- `QuotationSectionsEditor` has one stable prop contract shared by Settings and draft detail: use an explicit `mode: 'settings' | 'revision'`, `sections`, `editable`, `onChange`, optional `productionDeadline`/`onProductionDeadlineChange`, and optional `onRestore`; do not define incompatible prop shapes in later tasks.
- `QuotationTemplateManager` owns list/detail/validation/save state and exposes `onTemplatesChanged`.

`QuotationTemplateManager` must not nest a `<form>` inside the existing settings form; use a local `div` with explicit button handlers or split the surrounding settings form before integration.

- [ ] **Step 1: Add API wrapper types and tests**

Create `src/lib/quotationTemplatesApi.ts` with metadata matching the backend:

```ts
export interface QuotationTemplateMetadata {
  id: string;
  key: string;
  name: string;
  archived: boolean;
  is_default: boolean;
  current_version_id: string;
  current_version: number;
  current_hash: string;
  usage_count: number;
  updated_at: string;
}
```

Keep a compatibility type alias for current `QuotationDetailPage` consumers until Task 10 changes them.

- [ ] **Step 2: Implement the section editor**

Render three cards in fixed order.

Each card must contain:

- checkbox labeled `Exibir seção`.
- title input.
- body textarea for payment and conditions.
- explanatory text that production deadline uses the quote field.
- reset action only when editing a revision, not global settings.

Use the existing `Input`, `Button` and textarea class conventions.

Do not create a rich text toolbar.

- [ ] **Step 3: Implement the list + editor template manager**

Use a two-column responsive layout.

The left column lists active and archived templates.

The right column contains name, immutable key display, current version, source textarea and actions.

Creating a model requires key, name and complete HTML source.

Editing an existing model never mutates its source in place.

`Validar e visualizar preview` calls the validation endpoint and renders the returned preview inside `<iframe sandbox="" srcDoc={preview}>`.

Display validation warnings for missing section placeholders without blocking save.

Show `Padrão`, `Ativo`, `Arquivado` and `Usado por N revisões` labels.

Archive and set-default actions must use confirmation for destructive or global changes.

- [ ] **Step 4: Integrate into SettingsPage**

Replace the free-text `Chave do template padrão` field with the template manager and a model selector managed by the library.

Keep validity and freight fields in the existing settings form.

Replace separate payment, delivery and observations controls with the fixed three-section settings editor.

Keep `OperationalModeSection` unchanged.

Keep the template manager's create/version/preview actions in its own non-nested form or button flow.

Keep global numeric fields and section defaults in the existing settings save request so there are no nested forms or competing writes.

The template manager owns `set_default`; the parent settings save state must not send `template_padrao`. Update the displayed default from the manager response instead of copying a stale settings value back into the save payload.

Load settings and templates independently so a template failure does not erase operational status or numeric settings.

Preserve retry and Portuguese error states.

- [ ] **Step 5: Run UI tests and build**

Extend `tests/settings.spec.js` to cover:

- model list and source editor.
- validation preview.
- creating a new model.
- saving a new version.
- changing the default model.
- archiving a non-default model.
- toggling and editing all three global sections.
- archived/default badges, usage count, destructive-action confirmation and retryable template-load failure.
- saving a 4000-character payment body without truncating the compatibility mirror.
- changing the default in the manager, then saving sections/numeric settings, keeps the new default key.

Run:

```bash
npx playwright test tests/settings.spec.js
npm run build
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/quotationTemplatesApi.ts src/components/quotation/QuotationSectionsEditor.tsx src/components/quotation/QuotationTemplateManager.tsx src/pages/SettingsPage.tsx tests/settings.spec.js
git commit -m "feat: add quotation template settings UI"
```

---

## Task 7: Persist template selection and section snapshots when creating quotes

**Files:**

- Modify: `api/_db/quote-repository.ts`
- Modify: `api/_db/quotation-write-lock.ts`
- Modify: `api/_functions/lib/quotation-templates.ts`
- Modify: `tests/unit/quotations-core.test.ts`
- Modify: `tests/unit/quotations-postgres.test.ts`

**Interfaces:**

- `QuoteDraftCreateInput` accepts `template_key`, optional `template_version_id` and optional `secoes`.
- `QuoteDraftResult` returns `template_version_id` and `secoes` in addition to legacy key/hash fields.
- New revision rows always receive `templateVersionId` and `sectionsSnapshot` after the migration gate.

- [ ] **Step 1: Add failing creation tests**

Extend PostgreSQL coverage to create two drafts with different template keys and assert:

If `TEST_DATABASE_URL` is unavailable, add a memory/fake repository test for selection and keep the PostgreSQL test skipped using the existing `skip: !TEST_DATABASE_URL` convention.

```ts
assert.equal(draft.template_key, 'minimalista');
assert.match(draft.template_version_id, /^[0-9a-f-]{36}$/);
assert.equal(draft.secoes.pagamento.current.body, settingsSections.pagamento.body);
assert.notEqual(draft.secoes, settingsSections);
```

Add a test that an archived or nonexistent template returns `400` through `orcamento-core`.

Add a test that explicit section overrides are copied into `base` and `current` independently.

- [ ] **Step 2: Add transaction helpers for dynamic selection**

Replace synchronous static `getQuotationTemplate` selection in `quote-repository.ts` with a database lookup through `readCurrentQuotationTemplateVersion`.

Keep static templates as a compatibility fallback only until Task 4 has backfilled all rows; do not remove `getQuotationTemplate` while migration and historical preview still depend on it.

Selection rules:

1. If `template_version_id` is supplied, load that version and verify its model is not archived.
2. Else if `template_key` is supplied, load the current version for that key and verify it is not archived.
3. Else load the model identified by `settings.template_padrao`.
4. Reject missing, archived or inconsistent selections with `QuoteDraftInputError('Template do orçamento inválido.')`.

Read the current global sections from `settings.secoes`.

Normalize a supplied `secoes` payload and create the revision snapshot.

- [ ] **Step 3: Insert the new revision fields and compatibility mirrors**

Acquire the shared quotation write lock before the transaction writes the revision.

Set these fields in the quote revision insert:

```ts
templateVersionId: template.version.id,
sectionsSnapshot: sectionsSnapshot,
templatePadrao: template.model.key,
templateHash: template.version.sourceHash,
pagamento: sectionsSnapshot.pagamento.current.body,
entrega: settings.entrega,
observacoes: sectionsSnapshot.condicoes_gerais.current.body,
prazoProducao: deadline,
```

If a legacy delivery value is explicitly supplied, use it instead of `settings.entrega`. Never clear the compatibility `entrega` mirror merely because the new section payload was used.

Keep `fretePadrao`, `frete`, validity, client snapshot and item snapshots unchanged.

Return `template_version_id` and `secoes` from `createDraft`.

- [ ] **Step 4: Run tests and build**

Run:

```bash
node --test tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts
npm run build:api
```

Expected: PASS with zero failures and zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add api/_db/quote-repository.ts api/_functions/lib/quotation-templates.ts tests/unit/quotations-core.test.ts tests/unit/quotations-postgres.test.ts
git commit -m "feat: snapshot template content on quote creation"
```

---

## Task 8: Add draft overrides and lifecycle snapshot copying

**Files:**

- Modify: `api/_db/quote-draft-management-repository.ts`
- Modify: `api/_db/quotation-lifecycle-repository.ts`
- Modify: `api/_db/quotation-write-lock.ts`
- Modify: `api/_functions/quotations-core.ts`
- Modify: `tests/unit/quotation-lifecycle-postgres.test.ts`
- Modify: `tests/quotation-lifecycle.spec.js`

**Interfaces:**

- `QuoteDraftManagementDetail` returns `template_version_id`, `template_version`, `secoes`, `sections_snapshot` and template metadata in revision history.
- `QuoteDraftManagementUpdateInput` accepts `template_key`, optional `template_version_id` and optional `secoes`.
- `CreateQuotationRevisionInput` continues to copy the complete source revision.
- `QuoteRevisionHistoryEntry` returns `template_key`, `template_version` and `template_hash`.

- [ ] **Step 1: Add failing repository tests**

Extend the PostgreSQL management test to:

- update payment title/body and condition enabled/title/body in a draft.
- update the template key in the same request.
- assert `base` remains unchanged and `current` contains the override.
- assert `Restaurar padrão` behavior by sending `current = base`.
- assert updates after `enviado`, `aprovado` or `perdido` reject with `QuoteManagementConflictError`.

Extend lifecycle tests to create a revision and assert `templateVersionId` and `sectionsSnapshot` equal the source revision values.

- [ ] **Step 2: Extend detail and update input types**

Add these fields:

```ts
template_version_id: string | null;
template_version: number | null;
secoes: QuotationSectionsSnapshot | null;
sections_snapshot: QuotationSectionsSnapshot | null;
```

Add to update input:

```ts
template_version_id?: unknown;
secoes?: unknown;
sections_snapshot?: unknown;
```

`sections_snapshot` and `secoes` may be accepted as aliases, but responses must use `secoes` and `sections_snapshot` consistently.

- [ ] **Step 3: Make template selection asynchronous and database-backed**

Acquire the shared quotation write lock before the draft/lifecycle transaction writes a revision.

Replace `readTemplateSelection` with an async helper that receives the transaction.

It must preserve legacy `template_padrao` input support.

It must resolve the current version when only a key is sent.

It must reject a version that belongs to another model.

It must reject archived models.

If no template field is sent, retain the current revision version.

- [ ] **Step 4: Update the draft transaction**

Normalize the incoming section snapshot against the current revision snapshot.

The persisted `base` is authoritative and must never be client-editable. If a full snapshot is sent, validate that its `base` exactly matches the stored base and reject a mismatch; alternatively accept only `current` values and reconstruct the snapshot server-side. A restore request copies the stored base into current.

When sections are supplied, use `current` values as the new revision values:

- `pagamento` receives payment body.
- `observacoes` receives conditions body.
- `entrega` is cleared for section-first writes.
- `prazoProducao` remains the dedicated input field.

When sections are absent, preserve the current legacy update behavior and derive a snapshot from the resulting legacy fields.

Update `templateVersionId`, `templatePadrao`, `templateHash` and `sectionsSnapshot` atomically with the revision.

Keep optimistic concurrency and the existing non-draft conflict checks unchanged.

- [ ] **Step 5: Copy snapshot fields in `createRevision`**

Add `templateVersionId: source.templateVersionId` and `sectionsSnapshot: source.sectionsSnapshot` to the new revision insert.

If the source is a legacy row without a snapshot, construct one from the source fields before insert and fail with a migration error if its template version cannot be resolved.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
node --test tests/unit/quotation-lifecycle-postgres.test.ts tests/unit/quotations-core.test.ts
npx playwright test tests/quotation-lifecycle.spec.js
npm run build:api
```

Expected: PASS with zero failures.

Commit:

```bash
git add api/_db/quote-draft-management-repository.ts api/_db/quotation-lifecycle-repository.ts api/_functions/quotations-core.ts tests/unit/quotation-lifecycle-postgres.test.ts tests/quotation-lifecycle.spec.js
git commit -m "feat: support quotation draft content overrides"
```

---

## Task 9: Render the exact persisted template version and section snapshot

**Files:**

- Modify: `api/_db/quotation-template-repository.ts`
- Modify: `api/_functions/quotation-preview.ts`
- Modify: `api/_functions/lib/quotation-templates.ts`
- Modify: `tests/unit/quotation-templates-core.test.js`
- Modify: `tests/unit/quotation-html.test.js`

**Interfaces:**

- `QuotationTemplateSnapshot` gains `templateVersion` and `sectionsSnapshot`.
- `readQuotationTemplateSnapshot(db, id)` accepts quotation business number, quotation UUID or revision UUID.
- Preview defaults to the exact `templateVersionId` stored by the revision.
- Draft preview may receive `template_version_id` for an unsaved model selection.
- Persisted previews reject legacy `template` and `template_key` overrides entirely; draft previews accept only `template_version_id` and reject a non-draft override with 409.

- [ ] **Step 1: Add failing preview tests**

Add tests that:

- a snapshot loaded by revision UUID renders that exact revision.
- a snapshot loaded by business number renders the latest revision.
- dynamic source from `quotation_template_versions` is used instead of static definitions.
- section enabled flags control the view model.
- changing global sections after snapshot creation does not change preview output.
- draft `template_version_id` override works.

- sent `template_version_id` override returns 409.
- `format=pdf` still calls the existing on-the-fly PDF renderer.

- [ ] **Step 2: Extend snapshot loading**

Load the target quotation by business number or UUID.

If the input is a revision UUID and no quotation matches directly, find the quotation through `quote_revisions.id` and use that exact revision.

For a business number or quotation UUID, load the latest revision as current behavior does.

Join `quotation_template_versions` by `revision.templateVersionId`.

Reject query parameters `template` and `template_key` before selecting a source. For a draft, resolve only `template_version_id`, verify that it belongs to the selected quotation and that its model is active; for any non-draft revision return 409 when an override is supplied.

If a migrated legacy row lacks `templateVersionId`, resolve the static built-in by `templatePadrao` and `templateHash`, log a compatibility warning and return the static source.

Do not read current settings for historical rendering.

- [ ] **Step 3: Build the section-aware view model**

Use `sectionsSnapshot.current` for `secoes`.

Use `revision.prazoProducao` for `secoes.prazo_producao.value`.

Expose legacy `terms` for built-in compatibility, with `terms.observations` mapped from the revision legacy field.

Preserve item ordering, client snapshots, totals and date formatting.

- [ ] **Step 4: Update preview route and headers**

Use the exact persisted version by default.

Accept `template_version_id` only for a rascunho revision.

Return `X-Quotation-Template-Key`, `X-Quotation-Template-Version` and `X-Quotation-Template-Hash`.

Add safe headers to HTML responses:

```text
Cache-Control: no-store
Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

Keep PDF responses private and on-the-fly.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
node --test tests/unit/quotation-templates-core.test.js tests/unit/quotation-html.test.js
npm run build:api
```

Expected: PASS with zero failures.

Commit:

```bash
git add api/_db/quotation-template-repository.ts api/_functions/quotation-preview.ts api/_functions/lib/quotation-templates.ts tests/unit/quotation-templates-core.test.js tests/unit/quotation-html.test.js
git commit -m "feat: render persisted quotation template versions"
```

---

## Task 10: Add template and section controls to manual and automatic creation

**Files:**

- Modify: `src/types/domain.ts`
- Modify: `src/hooks/useExtractionDrafts.ts`
- Modify: `src/pages/ManualOrcamentoPage.tsx`
- Modify: `src/pages/AutoQuotePage.tsx`
- Modify: `src/components/SplitResultCard.tsx`
- Modify: `tests/quotation-templates-core.spec.js`
- Modify: `tests/orcamento-core.spec.js` for the automatic/core creation contract.
- Modify: `tests/orcamento.spec.js` for the legacy/manual boundary if it covers the manual form.
- Create: `tests/manual-quotation-core.spec.js` only if no existing E2E file covers `ManualOrcamentoPage` creation; do not duplicate an existing manual flow test.

**Interfaces:**

- `DraftEdited` gains `template_key?: string`.
- `buildDraftsFromOrders(orders, prazoVal, templateKey)` initializes the selected key.
- Manual creation sends `extracted.template_key`.
- Automatic creation sends `extracted.template_key`.
- Both flows use `listQuotationTemplates(true)`.

- [ ] **Step 1: Add failing frontend tests**

Add E2E assertions that:

Use the existing route-mocking style from `tests/quotation-templates-core.spec.js`; do not require a live database for these UI tests.

- manual creation displays `Modelo HTML` and sends the selected key.
- automatic extracted cards display `Modelo HTML` and send the selected key.
- the default model is selected when the API marks one as default.
- an API failure displays a retryable Portuguese error without blocking the rest of the form.

- [ ] **Step 2: Add the shared template loading state**

Use `listQuotationTemplates(true)` in each creation page.

Store the active metadata list, selected default key and load error.

Do not fetch source HTML for creation selectors.

- [ ] **Step 3: Add the manual selector**

Add a select labeled `Modelo HTML` in the existing `Condições e fechamento` section.

Initialize it to the API default.

Include `template_key` in the existing `extracted` payload.

Keep the backend as the final authority when the selector has not loaded.

- [ ] **Step 4: Add the automatic selector**

Add `template_key` to `DraftEdited`.

Pass the default key to `buildDraftsFromOrders`.

Render the selector in `SplitResultCard` while the card is editable and before creation.

Send the selected key from `createSingleQuote`.

Persist it in local state alongside other draft edits.

- [ ] **Step 5: Run E2E tests and build**

Run:

```bash
npx playwright test tests/quotation-templates-core.spec.js
npm run build
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/types/domain.ts src/hooks/useExtractionDrafts.ts src/pages/ManualOrcamentoPage.tsx src/pages/AutoQuotePage.tsx src/components/SplitResultCard.tsx tests/quotation-templates-core.spec.js tests/orcamento-core.spec.js tests/orcamento.spec.js tests/manual-quotation-core.spec.js
git commit -m "feat: select quotation template during creation"
```

---

## Task 11: Add draft template switching and always-visible section overrides

**Files:**

- Create: `src/components/quotation/QuotationSectionsEditor.tsx` if not completed in Task 6, otherwise modify it.
- Modify: `src/pages/QuotationDetailPage.tsx`
- Modify: `src/lib/quotationTemplatesApi.ts`
- Modify: `tests/quotation-templates-core.spec.js`
- Modify: `tests/quotation-lifecycle.spec.js`
- Modify: `tests/orcamento-core.spec.js` only if the detail/create fixture shares the template selector mock.

**Interfaces:**

- Detail payload contains `secoes`, `template_version_id`, `template_version`, `template_hash` and `concurrency_token`.
- Save payload contains `template_key`, `secoes`, `prazo_producao` and the existing fields.
- `QuotationSectionsEditor` uses the single contract defined in Task 6 (`mode`, `sections`, `editable`, `onChange`, optional production-deadline callbacks and `onRestore`).

- [ ] **Step 1: Add failing detail-page tests**

Extend the core detail E2E fixture with a complete `secoes` snapshot.

Assert:

- all three cards are visible while editing.
- production deadline is a separate input.
- payment and conditions title/body fields are editable.
- enabled toggles are editable.
- changing a field displays `Personalizado`.
- `Restaurar padrão` returns the current section to its base value.
- saving sends `secoes` and `template_key`.
- changing the model in a rascunho does not call `create_revision`.
- sent detail shows read-only content and no edit controls.

- [ ] **Step 2: Extend the detail data model**

Add the section snapshot and version metadata to `QuotationData`.

Use a local frontend type that mirrors `QuotationSectionsSnapshot` without importing backend files into Vite.

Normalize missing snapshots for legacy mock responses into three sections with `Padrão` indicators.

- [ ] **Step 3: Integrate the editor into the detail page**

Place the editor in the existing editable conditions area.

Keep the current product, client, freight and validity controls.

Keep `prazo_producao` as the dedicated field.

Use `data.status_canonical` to determine editability.

Show the model selector only as editable for rascunho.

Keep the current `Visualizar` action and point it to `template_version_id` for drafts.

For persisted non-draft previews, omit override query parameters so the backend uses the frozen version. Remove all `template=` query construction, including PDF preview links.

- [ ] **Step 4: Update save and reset behavior**

Include the full sections snapshot in `apiPut('/quotations?id=...')`.

After save, replace local state with the authoritative server response.

`Restaurar padrão` must copy `base` into `current`, not fetch `/settings`.

When a new model is selected, update the selected version ID from the active metadata list.

For an existing draft whose current model is archived, load the full template metadata list for the detail selector and include that archived current model as the selected option; do not offer other archived models as new choices. Saving without changing it must preserve the archived reference and historical rendering.

Keep concurrency conflict handling unchanged.

- [ ] **Step 5: Update revision history display**

Show revision number, status, date, template key and template version.

History preview links must use `entry.revision_id` so the exact historical revision renders.

Do not show links to stored documents.

- [ ] **Step 6: Run E2E tests and build**

Run:

```bash
npx playwright test tests/quotation-templates-core.spec.js tests/quotation-lifecycle.spec.js
npm run build
```

Expected: PASS with zero failures.

- [ ] **Step 7: Commit**

```bash
git add src/components/quotation/QuotationSectionsEditor.tsx src/pages/QuotationDetailPage.tsx src/lib/quotationTemplatesApi.ts tests/quotation-templates-core.spec.js tests/quotation-lifecycle.spec.js
git commit -m "feat: edit quotation sections in drafts"
```

---

## Task 12: Complete regression coverage and migration verification

**Files:**

- Modify: `tests/unit/quotation-content.test.ts`
- Modify: `tests/unit/quotation-template-library.test.ts`
- Modify: `tests/unit/quotation-template-migration.test.ts`
- Modify: `tests/unit/quotation-templates-core.test.js`
- Modify: `tests/unit/settings.test.ts`
- Modify: `tests/unit/quotations-core.test.ts`
- Modify: `tests/unit/quotations-postgres.test.ts`
- Modify: `tests/unit/quotation-lifecycle-postgres.test.ts`
- Modify: `tests/settings.spec.js`
- Modify: `tests/quotation-templates-core.spec.js`
- Modify: `tests/quotation-lifecycle.spec.js`
- Modify: `docs/superpowers/specs/2026-08-04-quotation-template-management-design.md` only if implementation exposes an approved behavior correction.

**Interfaces:**

- No new public interface.
- Produces complete regression evidence for the approved design.

- [ ] **Step 1: Run all targeted unit tests**

```bash
TZ=UTC node --test \
  tests/unit/quotation-content.test.ts \
  tests/unit/quotation-template-library.test.ts \
  tests/unit/quotation-template-migration.test.ts \
  tests/unit/quotation-templates-core.test.js \
  tests/unit/settings.test.ts \
  tests/unit/quotations-core.test.ts \
  tests/unit/quotations-postgres.test.ts \
  tests/unit/quotation-lifecycle-postgres.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run all affected E2E tests**

```bash
npx playwright test \
  tests/settings.spec.js \
  tests/quotation-templates-core.spec.js \
  tests/quotation-lifecycle.spec.js
```

Expected: PASS with zero failures.

- [ ] **Step 3: Run project verification**

```bash
npm run lint
npm run type-check
npm run check:tailwind
npm run build
npm run test:unit
```

Expected: zero lint errors, zero TypeScript errors, zero Tailwind check errors and zero unit-test failures.

- [ ] **Step 4: Verify forbidden references and generated output**

```bash
grep -RniE '<script|javascript:|onclick=|onload=|<iframe|<object|<embed' api/_functions src --include='*.ts' --include='*.tsx'
grep -RniE 'issued_document|createVercelQuotationDocumentStorage|@vercel/blob.*quotation' api/_functions api/_db src --include='*.ts' --include='*.tsx'
git status --short
```

The first command may match validator rejection strings, but it must not find an accepted template source or emitted user HTML path.

Run it against TypeScript/TSX sources only, excluding generated `api/**/*.js` output.

Run the security browser test that loads a validated preview in a sandbox and asserts no script execution, no network request and no unsafe SVG active content.

The second command must show no new PDF-issuance dependency; `@vercel/blob` remains required by communication media and is not removed by this feature.

Generated `api/**/*.js` files must not be staged.

- [ ] **Step 5: Verify migration idempotency against PostgreSQL**

```bash
npm run migrate:quotation-templates
npm run migrate:quotation-templates
```

The second report must show no duplicate versions and no additional revisions changed.

Add an explicit lifecycle regression test that status transition/emission performs no PDF generation, Blob upload, document-storage call or document URL return; preview `format=pdf` remains the only on-demand PDF path.

Add a concurrency regression test that runs migration/backfill and a revision writer through the shared lock and verifies no committed revision is missing `template_version_id` or `sections_snapshot`.

- [ ] **Step 6: Commit final test updates**

```bash
git add tests

git commit -m "test: cover quotation template versioning and overrides"
```

---

## Plan review adjudications

- The Oracle report's missing `src/pages/ManualOrcamentoPage.tsx` finding was verified false: the path exists in the current checkout and remains the correct manual creation surface.
- Historical preview override, shared write locking, strict HTML parsing, default ownership, archived draft selection, invalid-default repair, delivery-mirror preservation and migration-test ownership were incorporated above before implementation.
- User decision: preserve the exact migrated Frappe source/hash as a historical compatibility exception for missing `display.total`; every new template/version still requires `display.total`.

## Final verification checklist

- [ ] Three built-in templates are present in the database after migration.
- [ ] Existing revisions resolve their original template source by key and hash.
- [ ] New template versions never mutate old versions.
- [ ] Archived models remain renderable for historical revisions.
- [ ] Exactly one active default model is configured.
- [ ] Global section changes affect only new revisions.
- [ ] Section overrides survive reload and remain frozen after send.
- [ ] Production deadline remains a dedicated revision field.
- [ ] Payment and conditions bodies preserve safe line breaks.
- [ ] HTML layout remains controlled by the pasted template.
- [ ] JavaScript and dangerous HTML are rejected and blocked by response CSP.
- [ ] Manual and automatic creation allow model selection.
- [ ] Draft detail allows model switching without creating a revision.
- [ ] Historical preview uses the exact revision UUID and version.
- [ ] PDF preview remains on-the-fly and no issuance path returns.
- [ ] Vercel Blob remains available only for unrelated communication media and legacy migration code.
- [ ] `npm run check` passes.
- [ ] `npm run test:unit` passes.
- [ ] Affected Playwright tests pass.

## Execution handoff

Implementation must start only after an independent plan review approves this file.

Before implementation, resolve the exact Drizzle-generated migration filename from Task 2 and update the task ledger if it differs from `0011_quotation_template_library.sql`.

Before deployment, run the database migration and backfill in this exact order:

```bash
npm run db:migrate
npm run migrate:quotation-templates
```

Do not remove static built-in sources until the migration report proves every existing revision has a matching dynamic version and snapshot.

Use one fresh asynchronous worker per task, with a review gate after each task.

Do not modify the pre-existing `docs/superpowers/plans/2026-08-04-no-pdf-html-only.md` or the untracked `scripts/cleanup-orc.mjs` while executing this plan.
