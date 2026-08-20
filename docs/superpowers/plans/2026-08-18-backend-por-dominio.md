# Fases 4-5: Backend por domínio (monólito modular) - Plano de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa.
> Passos usam sintaxe de checkbox (`- [ ]`) para rastreamento.

**Goal:** Reorganizar o backend em `modules/` (por domínio), `infrastructure/` (db e integrações) e `_shared/`, sem nenhuma mudança de comportamento, mantendo `api/_app/routes.ts` como única definição de rotas.

**Architecture:** Movimento físico de 111 arquivos TypeScript com rewrite determinístico de imports.
Um script de rewrite (`scripts/rewrite-imports.mjs`) recebe um mapa origem→destino JSON, move os arquivos e reescreve todo import relativo que aponta para arquivo movido, incluindo imports dinâmicos e strings de caminho em testes.
Execução em 9 tasks: infraestrutura compartilhada primeiro, depois domínios (products, customers, quotations, communication+whatsapp, crm+sales-orders+system), depois infrastructure/db atômico, e verificação final completa.

**Tech Stack:** Node.js 22, TypeScript 5.9 (tsc `outDir: "."` emite `.js` ao lado de `.ts`, gitignored), `node:test`, Playwright, Drizzle.

**Spec:** `docs/superpowers/specs/2026-08-18-backend-por-dominio-design.md` - este plano implementa as Fases 4, 5 e seção 9 da `aspen-dashboard-plano-refatoracao.md`.
A spec contém o mapa origem→destino completo e a lista de violações de fronteira registradas para a Fase 19.

## Global Constraints

- Zero mudança de comportamento: nenhuma assinatura de handler/repositório muda.
- ESM: imports de backend exigem extensão `.js` explícita no código-fonte.
- `api/_app/routes.ts` continua sendo a única definição de rotas; o script de rewrite o atualiza automaticamente.
- Output tsc (`.js`/`.js.map` em `api/**`) é gitignored e DEVE ser removido antes de cada build (falso verde: teste resolvendo `.js` órfão em caminho antigo).
- Não editar `public/` (build Vite) nem `drizzle/` (histórico de migrations).
- Erros de usuário em PT-BR; nunca expor stack/db/secrets.
- Sem dependências novas.
- Documentação histórica (`docs/superpowers/**`, `docs/baseline-refatoracao.md`, spec raiz) NÃO é tocada pelo rewrite.
- Commits sem co-autor.
- Modelos de subagent: `worker` = `opencode-go/deepseek-v4-flash`, `reviewer` = `opencode-go/deepseek-v4-pro`; sem overrides de model/thinking; máximo 3 rodadas review/fix por task.
- Mapa de rotas deve permanecer idêntico ao de antes do refactor (`tests/unit/route-map.test.ts`).

## Mecânica de verificação por task (aplicar em TODAS as tasks)

Antes de cada build: `find api -name '*.js' -delete && find api -name '*.js.map' -delete`.
Depois: `npm run build:api` (emite e valida tipos) + `npm run type-check` + testes unitários direcionados da task.
Testes unitários executam com: `TZ=UTC node --test tests/unit/<arquivo>.test.ts` (vários arquivos de uma vez: listar todos no mesmo comando).
Os 29 testes PostgreSQL (nomes `*-postgres*.test.ts` e `postgres-first-party-schema.test.ts`) continuam skip sem banco descartável - skip NÃO é falha.

---

## Task 1: Script de rewrite de imports

Cria a ferramenta que todas as tasks seguintes usam.
Aproveitada também nas Fases 6-7 (frontend), por isso é commitada.

**Files:**

- Create: `scripts/rewrite-imports.mjs`

**Interfaces:**

- Consumes: nada.
- Produces: CLI `node scripts/rewrite-imports.mjs <mapping.json>`.
  `mapping.json` é um objeto `{ "api/_functions/x.ts": "api/modules/x.ts", ... }` (caminhos relativos à raiz do repo).
  O script move cada arquivo mapeado (`renameSync`) e reescreve, em todos os arquivos rastreados pelo git (`git ls-files '*.ts' '*.tsx' '*.mjs' '*.js' ':!public/**' ':!drizzle/**'`):
  - especificadores relativos (`.`) em `import ... from`, `export ... from`, `import()` dinâmico e imports de efeito colateral;
  - strings de caminho que correspondem exatamente a uma chave do mapa (com ou sem prefixo `api/`) - cobre `readFileSync` de testes;
  - preserva sufixo `.js`/`.ts` do especificador original e query strings (`?test=...`);
  - resolve o especificador a partir da posição NOVA do importador contra a posição NOVA do alvo (funciona com mudança de profundidade, ex.: `lib/` flatten).
  Saída: contagem de renames e rewrites por arquivo.

- [ ] **Step 1: Escrever o script**

Conteúdo completo de `scripts/rewrite-imports.mjs`:

```js
// Rewrites relative import specifiers and path strings after moving source files.
// Usage: node scripts/rewrite-imports.mjs <mapping.json>
// mapping.json: { "api/_functions/x.ts": "api/modules/x.ts", ... } (repo-root relative)
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const mapPath = process.argv[2];
if (!mapPath) {
  console.error('uso: node scripts/rewrite-imports.mjs <mapping.json>');
  process.exit(1);
}
const MAP = JSON.parse(readFileSync(mapPath, 'utf8'));
const ROOT = process.cwd();
const keys = new Set(Object.keys(MAP));

const files = execSync(
  "git ls-files '*.ts' '*.tsx' '*.mjs' '*.js' ':!public/**' ':!drizzle/**'",
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean);
const fileSet = new Set(files);

function splitQuery(spec) {
  const m = spec.match(/^([^?#]*)([?#].*)?$/);
  return { pathname: m[1], query: m[2] ?? '' };
}

// Resolve a relative specifier from the OLD importer dir to an existing source file.
function resolveOld(baseDirOld, spec) {
  const { pathname } = splitQuery(spec);
  const p = resolve(baseDirOld, pathname);
  const candidates = [
    p,
    p.replace(/\.js$/, '.ts'),
    p.replace(/\.ts$/, '.js'),
    p + '.ts',
    p + '.js',
    p + '/index.ts',
    p + '/index.js',
  ];
  for (const cand of candidates) {
    const rel = relative(ROOT, cand);
    if (fileSet.has(rel) || fileSet.has(rel.replace(/\\/g, '/'))) return rel;
  }
  return null;
}

let renames = 0;
let rewrites = 0;
for (const f of files) {
  const moved = MAP[f] ? resolve(ROOT, MAP[f]) : null;
  const baseDirOld = dirname(resolve(ROOT, f));
  const baseDirNew = moved ? dirname(moved) : baseDirOld;
  let text = readFileSync(f, 'utf8');
  const original = text;

  // 1) relative import/export specifiers (static, side-effect and dynamic)
  text = text.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+(?:type\s+)?)['"](\.[^'"]*?)['"]/g,
    (m, pre, spec) => {
      const targetOld = resolveOld(baseDirOld, spec);
      if (!targetOld) return m;
      const targetNew = MAP[targetOld] ?? targetOld;
      const rel = relative(baseDirNew, resolve(ROOT, targetNew)).replace(/\\/g, '/');
      const norm = rel.startsWith('.') ? rel : './' + rel;
      const suffix = spec.endsWith('.js') ? '.js' : spec.endsWith('.ts') ? '.ts' : '';
      rewrites++;
      return pre + "'" + norm + suffix + splitQuery(spec).query + "'";
    },
  );

  // 2) string literals pointing exactly at a moved file (readFileSync in tests)
  text = text.replace(
    /(['"])((?:api\/)?[a-z0-9_\-/]+\.(?:ts|mjs|js))(['"])/g,
    (m, q1, pth, q2) => {
      const key = pth.startsWith('api/') ? pth : 'api/' + pth;
      if (MAP[key]) {
        rewrites++;
        return q1 + MAP[key] + q2;
      }
      return m;
    },
  );

  if (text !== original) writeFileSync(f, text);
  if (moved) {
    mkdirSync(dirname(moved), { recursive: true });
    renameSync(f, moved);
    renames++;
  }
}
console.log(`renames: ${renames}, rewrites: ${rewrites}`);
```

- [ ] **Step 2: Verificar que o script é no-op com mapa vazio**

Run:

```bash
echo '{}' > /tmp/empty-map.json
node scripts/rewrite-imports.mjs /tmp/empty-map.json
git status --porcelain
```

Expected: `renames: 0, rewrites: 0` e `git status --porcelain` vazio.

- [ ] **Step 3: Commit**

```bash
git add scripts/rewrite-imports.mjs
git commit -m "refactor: script de rewrite de imports para movimentos de backend"
```

---

## Task 2: Mover `_lib` para `_shared` e `_http`

Move os 9 arquivos de `api/_lib/` e verifica que o pipeline e a suíte de auth/erros continuam verdes.

**Files:**

- Move: `api/_lib/auth.ts`, `api/_lib/session.ts`, `api/_lib/password.ts`, `api/_lib/http-error.ts`, `api/_lib/rate-limit.ts` → `api/_shared/`
- Move: `api/_lib/types.ts`, `api/_lib/function-adapter.ts` → `api/_http/`
- Move: `api/_lib/quotation-status.ts`, `api/_lib/media-schema.ts` → `api/modules/`
- Auto-rewrite: `api/_app/routes.ts` (import de `../_lib/types.js`), `api/_app/handle-request.ts`, `api/_http/*`, `api/[...path].ts`, todos os arquivos de `api/_functions/` e `api/_db/` que importam `_lib`.

**Interfaces:**

- Consumes: script da Task 1.
- Produces: `api/_shared/` (5 arquivos), `api/_http/` (4 arquivos no total), `api/modules/` (2 arquivos iniciais).
  `api/_lib/` fica vazio (remover o diretório).

- [ ] **Step 1: Limpar outputs tsc**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Criar mapa e rodar o rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_lib/auth.ts": "api/_shared/auth.ts",
  "api/_lib/session.ts": "api/_shared/session.ts",
  "api/_lib/password.ts": "api/_shared/password.ts",
  "api/_lib/http-error.ts": "api/_shared/http-error.ts",
  "api/_lib/rate-limit.ts": "api/_shared/rate-limit.ts",
  "api/_lib/types.ts": "api/_http/types.ts",
  "api/_lib/function-adapter.ts": "api/_http/function-adapter.ts",
  "api/_lib/quotation-status.ts": "api/modules/quotation-status.ts",
  "api/_lib/media-schema.ts": "api/modules/media-schema.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
rmdir api/_lib 2>/dev/null || true
```

Expected: `renames: 9` e contagem de rewrites > 0.

- [ ] **Step 3: Conferir não-restos de `_lib`**

```bash
grep -rn "_lib/" api tests scripts src --include="*.ts" --include="*.tsx" --include="*.mjs" || echo "LIMPO"
```

Se sobrar, os casos são: import antigo não resolvido (corrigir manualmente com o caminho novo) ou ocorrência em doc/comentário (atualizar o texto).

- [ ] **Step 4: Build e testes do domínio movido**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/auth.test.ts tests/unit/auth-password.test.ts tests/unit/session.test.ts tests/unit/rate-limit.test.ts tests/unit/handle-request.test.ts tests/unit/login.test.ts tests/unit/quotation-status.test.ts tests/unit/settings-app-server.test.ts tests/unit/route-map.test.ts
```

Expected: tudo verde (skips PG são ok).

- [ ] **Step 5: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api
git commit -m "refactor(api): mover _lib para _shared e _http (Fases 4-5, task shared)"
```

---

## Task 3: Mover domínio products

**Files:**

- Move (11): `api/_functions/products.ts`, `products-core.ts`, `product-detail.ts`, `product-detail-core.ts`, `product-update.ts`, `product-update-core.ts`, `product-pricing.ts`, `product-pricing-update.ts`, `product-activity.ts`, `pricing-lookup.ts`, `pricing-core.ts` → `api/modules/`
- Auto-rewrite: `routes.ts`, imports cruzados (ex.: `extract.ts` importa `pricing-*`), testes.

**Interfaces:**

- Consumes: `api/_shared/`, `api/_http/` da Task 2.
- Produces: 11 arquivos em `api/modules/`.

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_functions/products.ts": "api/modules/products.ts",
  "api/_functions/products-core.ts": "api/modules/products-core.ts",
  "api/_functions/product-detail.ts": "api/modules/product-detail.ts",
  "api/_functions/product-detail-core.ts": "api/modules/product-detail-core.ts",
  "api/_functions/product-update.ts": "api/modules/product-update.ts",
  "api/_functions/product-update-core.ts": "api/modules/product-update-core.ts",
  "api/_functions/product-pricing.ts": "api/modules/product-pricing.ts",
  "api/_functions/product-pricing-update.ts": "api/modules/product-pricing-update.ts",
  "api/_functions/product-activity.ts": "api/modules/product-activity.ts",
  "api/_functions/pricing-lookup.ts": "api/modules/pricing-lookup.ts",
  "api/_functions/pricing-core.ts": "api/modules/pricing-core.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
```

- [ ] **Step 3: Conferir restos**

```bash
grep -rn "_functions/\(products\|product-\|pricing\)" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
```

- [ ] **Step 4: Build e testes direcionados**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/pricing-core.test.ts tests/unit/pricing-postgres.test.ts tests/unit/pricing-rollout.test.ts tests/unit/product-activity-postgres.test.ts tests/unit/products.test.ts tests/unit/route-map.test.ts
```

- [ ] **Step 5: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests
git commit -m "refactor(api): mover dominio products para modules/"
```

---

## Task 4: Mover domínio customers

**Files:**

- Move (11): `api/_functions/client-detail.ts`, `client-detail-core.ts`, `client-core.ts`, `leads-clients.ts`, `leads-clients-core.ts`, `quote-leads.ts`, `client-schema.ts`, `client-repository.ts`, `lib/quote-leads-pure.ts`, `lib/quote-leads-store.ts`, `typebot-lead-capture.ts` → `api/modules/`
- Auto-rewrite: `routes.ts`, `api/_db/client-repository.ts` e `api/_db/client-schema.ts` (importam `../_functions/client-*` - vira `../../modules/client-*`), `api/_db/quote-repository.ts`, testes.

**Interfaces:**

- Consumes: `api/_shared/`, `api/_http/`.
- Produces: 11 arquivos em `api/modules/`.
  ATENÇÃO: `api/modules/client-repository.ts` é a INTERFACE canônica de repositório de clientes; `api/_db/client-repository.ts` (que se move na Task 8) é a implementação PostgreSQL.

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_functions/client-detail.ts": "api/modules/client-detail.ts",
  "api/_functions/client-detail-core.ts": "api/modules/client-detail-core.ts",
  "api/_functions/client-core.ts": "api/modules/client-core.ts",
  "api/_functions/leads-clients.ts": "api/modules/leads-clients.ts",
  "api/_functions/leads-clients-core.ts": "api/modules/leads-clients-core.ts",
  "api/_functions/quote-leads.ts": "api/modules/quote-leads.ts",
  "api/_functions/client-schema.ts": "api/modules/client-schema.ts",
  "api/_functions/client-repository.ts": "api/modules/client-repository.ts",
  "api/_functions/lib/quote-leads-pure.ts": "api/modules/quote-leads-pure.ts",
  "api/_functions/lib/quote-leads-store.ts": "api/modules/quote-leads-store.ts",
  "api/_functions/typebot-lead-capture.ts": "api/modules/typebot-lead-capture.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
```

- [ ] **Step 3: Conferir restos**

```bash
grep -rn "_functions/\(client\|leads-clients\|quote-leads\|typebot\)" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
```

- [ ] **Step 4: Build e testes direcionados**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/quote-leads.test.ts tests/unit/quote-leads-postgres.test.ts tests/unit/quote-leads-store.test.ts tests/unit/typebot-lead-capture.test.ts tests/unit/route-map.test.ts
```

- [ ] **Step 5: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests
git commit -m "refactor(api): mover dominio customers para modules/"
```

---

## Task 5: Mover domínio quotations

Maior domínio.
Inclui a única renomeação do plano (catálogo de templates) e a correção do import de tipo no frontend.

**Files:**

- Move (25): de `api/_functions/`: `orcamento.ts`, `orcamento-core.ts`, `quotations.ts`, `quotations-core.ts`, `quotation-preview.ts`, `quotation-issues.ts`, `quotation-templates.ts`, `duplicate-quotation.ts`, `edit-draft.ts`, `public-quotation.ts`, `pdf.ts`, `view.ts`, `order-templates.ts`, `extract.ts`, `lib/quotation-html.ts`, `lib/quotation-pdf.ts`, `lib/quotation-pdf-renderer.ts`, `lib/quotation-delivery.ts`, `lib/quotation-document-storage.ts`, `lib/quotation-draft-snapshot.ts`, `lib/quotation-issue-core.ts`, `lib/print-format.ts`; de `api/_db/`: `quotation-content.ts`, `quotation-template-snapshot.ts` → `api/modules/`
- Rename: `api/_functions/lib/quotation-templates.ts` → `api/modules/quotation-template-catalog.ts`
- Auto-rewrite: `routes.ts`, 6 repositórios em `api/_db/` que importam o catálogo, `src/lib/quotationIssueApi.ts`, testes.
- Verify manual: `src/lib/quotationIssueApi.ts` não é coberto pelo type-check da API - conferir `git diff src/` após o rewrite.

**Interfaces:**

- Consumes: `api/_shared/`, `api/_http/`, `api/modules/` (products, customers).
- Produces: 25 arquivos em `api/modules/` nesta task; `quotation-status.ts` (movido na Task 2) completa os 26 do domínio.

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_functions/orcamento.ts": "api/modules/orcamento.ts",
  "api/_functions/orcamento-core.ts": "api/modules/orcamento-core.ts",
  "api/_functions/quotations.ts": "api/modules/quotations.ts",
  "api/_functions/quotations-core.ts": "api/modules/quotations-core.ts",
  "api/_functions/quotation-preview.ts": "api/modules/quotation-preview.ts",
  "api/_functions/quotation-issues.ts": "api/modules/quotation-issues.ts",
  "api/_functions/quotation-templates.ts": "api/modules/quotation-templates.ts",
  "api/_functions/duplicate-quotation.ts": "api/modules/duplicate-quotation.ts",
  "api/_functions/edit-draft.ts": "api/modules/edit-draft.ts",
  "api/_functions/public-quotation.ts": "api/modules/public-quotation.ts",
  "api/_functions/pdf.ts": "api/modules/pdf.ts",
  "api/_functions/view.ts": "api/modules/view.ts",
  "api/_functions/order-templates.ts": "api/modules/order-templates.ts",
  "api/_functions/extract.ts": "api/modules/extract.ts",
  "api/_functions/lib/quotation-html.ts": "api/modules/quotation-html.ts",
  "api/_functions/lib/quotation-pdf.ts": "api/modules/quotation-pdf.ts",
  "api/_functions/lib/quotation-pdf-renderer.ts": "api/modules/quotation-pdf-renderer.ts",
  "api/_functions/lib/quotation-templates.ts": "api/modules/quotation-template-catalog.ts",
  "api/_functions/lib/quotation-delivery.ts": "api/modules/quotation-delivery.ts",
  "api/_functions/lib/quotation-document-storage.ts": "api/modules/quotation-document-storage.ts",
  "api/_functions/lib/quotation-draft-snapshot.ts": "api/modules/quotation-draft-snapshot.ts",
  "api/_functions/lib/quotation-issue-core.ts": "api/modules/quotation-issue-core.ts",
  "api/_functions/lib/print-format.ts": "api/modules/print-format.ts",
  "api/_db/quotation-content.ts": "api/modules/quotation-content.ts",
  "api/_db/quotation-template-snapshot.ts": "api/modules/quotation-template-snapshot.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
```

- [ ] **Step 3: Conferir restos**

```bash
grep -rn "_functions/\(orcamento\|quotations\|quotation\|duplicate\|edit-draft\|public-quotation\|pdf\|view\|order-templates\|extract\|print-format\)" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
grep -rn "_db/quotation-content\|_db/quotation-template-snapshot" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
```

- [ ] **Step 4: Conferir o import de tipo no frontend**

```bash
git diff src/lib/quotationIssueApi.ts
```

Expected: linha 2 passa a apontar para `../../api/modules/quotation-content`.

- [ ] **Step 5: Build e testes direcionados**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/quotations-core.test.ts tests/unit/quotation-preview.test.ts tests/unit/quotation-issue-postgres.test.ts tests/unit/quotation-issues.test.ts tests/unit/quotation-lifecycle-core.test.ts tests/unit/quotation-lifecycle-postgres.test.ts tests/unit/quotation-template-library.test.ts tests/unit/quotations-postgres.test.ts tests/unit/public-quotation.test.ts tests/unit/public-link-boundary.test.ts tests/unit/duplicate-quotation-postgres.test.ts tests/unit/extract-handler.test.ts tests/unit/extract-rules.test.ts tests/unit/orcamento-core.test.ts tests/unit/orcamento-postgres.test.ts tests/unit/order-templates.test.ts tests/unit/quotation-content.test.ts tests/unit/quotation-delivery-postgres.test.ts tests/unit/route-map.test.ts
```

- [ ] **Step 6: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests src
git commit -m "refactor(api): mover dominio quotations para modules/"
```

---

## Task 6: Mover domínios communication e whatsapp

Tasks de domínios com dependência cíclica entre flows, media, transporte e public-quotation - movem juntos, commit único.

**Files:**

- Move communication (8): de `api/_functions/`: `communication-flow-preview.ts`, `communication-flows.ts`, `communication-send-events.ts`, `communication-media.ts`, `communication-media-upload.ts`, `send-whatsapp-flow.ts`, `lib/postgres-media.ts`, `lib/time-greeting.ts` → `api/modules/`
- Move whatsapp (12): de `api/_functions/`: `send-whatsapp.ts`, `whatsapp-conversations.ts`, `whatsapp-flows.ts`, `whatsapp-leads.ts`, `whatsapp-send-status.ts`, `lib/whatsapp-conversations-store.ts`, `lib/whatsapp-conversations-sync.ts`, `lib/whatsapp-crm-match.ts`, `lib/whatsapp-identity-audit.ts`, `lib/whatsapp-identity-backfill.ts`, `lib/whatsapp-identity-resolver.ts`, `lib/whatsapp-send-reservation-store.ts` → `api/modules/`
- Auto-rewrite: `routes.ts`, `scripts/whatsapp-identity-audit.mjs` (imports diretos), `scripts/test-whatsapp-sequence.mjs` (import dinâmico com query string), testes.

**Interfaces:**

- Consumes: `api/_shared/`, `api/_http/`, products, customers, quotations.
- Produces: 20 arquivos em `api/modules/` nesta task; `media-schema.ts` (movido na Task 2) completa os 9 do domínio communication.

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_functions/communication-flow-preview.ts": "api/modules/communication-flow-preview.ts",
  "api/_functions/communication-flows.ts": "api/modules/communication-flows.ts",
  "api/_functions/communication-send-events.ts": "api/modules/communication-send-events.ts",
  "api/_functions/communication-media.ts": "api/modules/communication-media.ts",
  "api/_functions/communication-media-upload.ts": "api/modules/communication-media-upload.ts",
  "api/_functions/send-whatsapp-flow.ts": "api/modules/send-whatsapp-flow.ts",
  "api/_functions/lib/postgres-media.ts": "api/modules/postgres-media.ts",
  "api/_functions/lib/time-greeting.ts": "api/modules/time-greeting.ts",
  "api/_functions/send-whatsapp.ts": "api/modules/send-whatsapp.ts",
  "api/_functions/whatsapp-conversations.ts": "api/modules/whatsapp-conversations.ts",
  "api/_functions/whatsapp-flows.ts": "api/modules/whatsapp-flows.ts",
  "api/_functions/whatsapp-leads.ts": "api/modules/whatsapp-leads.ts",
  "api/_functions/whatsapp-send-status.ts": "api/modules/whatsapp-send-status.ts",
  "api/_functions/lib/whatsapp-conversations-store.ts": "api/modules/whatsapp-conversations-store.ts",
  "api/_functions/lib/whatsapp-conversations-sync.ts": "api/modules/whatsapp-conversations-sync.ts",
  "api/_functions/lib/whatsapp-crm-match.ts": "api/modules/whatsapp-crm-match.ts",
  "api/_functions/lib/whatsapp-identity-audit.ts": "api/modules/whatsapp-identity-audit.ts",
  "api/_functions/lib/whatsapp-identity-backfill.ts": "api/modules/whatsapp-identity-backfill.ts",
  "api/_functions/lib/whatsapp-identity-resolver.ts": "api/modules/whatsapp-identity-resolver.ts",
  "api/_functions/lib/whatsapp-send-reservation-store.ts": "api/modules/whatsapp-send-reservation-store.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
```

- [ ] **Step 3: Conferir restos e o import dinâmico com query string**

```bash
grep -rn "_functions/\(communication\|send-whatsapp\|whatsapp\|postgres-media\|time-greeting\)" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
grep -n "import(" scripts/test-whatsapp-sequence.mjs tests/unit/quotation-issues.test.ts
```

Expected: o import dinâmico de `scripts/test-whatsapp-sequence.mjs` aponta para `../api/modules/send-whatsapp.js?test=...` preservando a query string.

- [ ] **Step 4: Build e testes direcionados**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/communication-flow-preview.test.ts tests/unit/postgres-media.test.ts tests/unit/send-whatsapp.test.ts tests/unit/send-whatsapp-idempotency.test.ts tests/unit/send-whatsapp-review-r1.test.ts tests/unit/whatsapp-conversations.test.ts tests/unit/whatsapp-conversations-postgres-only.test.ts tests/unit/whatsapp-conversations-store.test.ts tests/unit/whatsapp-conversations-sync.test.ts tests/unit/whatsapp-crm-match.test.ts tests/unit/whatsapp-crm-postgres.test.ts tests/unit/whatsapp-identity-audit.test.ts tests/unit/whatsapp-identity-backfill.test.ts tests/unit/whatsapp-identity-resolver.test.ts tests/unit/whatsapp-leads.test.ts tests/unit/whatsapp-send-reservation-store.test.ts tests/unit/whatsapp-send-status.test.ts tests/unit/route-map.test.ts
```

- [ ] **Step 5: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests scripts
git commit -m "refactor(api): mover dominios communication e whatsapp para modules/"
```

---

## Task 7: Mover domínios crm, sales-orders e system

**Files:**

- Move crm (4): `crm-deals.ts`, `crm-update-deal.ts`, `crm-prune-candidates.ts`, `lib/crm-prune.ts` → `api/modules/`
- Move sales-orders (3): `sales-orders.ts`, `sales-dashboard.ts`, `sales-order-from-quotation.ts` → `api/modules/`
- Move system (4): `login.ts`, `logout.ts`, `settings.ts`, `operational-status.ts` → `api/modules/`
- Auto-rewrite: `routes.ts`, testes.

**Interfaces:**

- Consumes: `api/_shared/`, `api/_http/`, demais módulos.
- Produces: 11 arquivos em `api/modules/`.
  Após esta task, `api/_functions/` fica vazio (conferir com `ls`).

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_functions/crm-deals.ts": "api/modules/crm-deals.ts",
  "api/_functions/crm-update-deal.ts": "api/modules/crm-update-deal.ts",
  "api/_functions/crm-prune-candidates.ts": "api/modules/crm-prune-candidates.ts",
  "api/_functions/lib/crm-prune.ts": "api/modules/crm-prune.ts",
  "api/_functions/sales-orders.ts": "api/modules/sales-orders.ts",
  "api/_functions/sales-dashboard.ts": "api/modules/sales-dashboard.ts",
  "api/_functions/sales-order-from-quotation.ts": "api/modules/sales-order-from-quotation.ts",
  "api/_functions/login.ts": "api/modules/login.ts",
  "api/_functions/logout.ts": "api/modules/logout.ts",
  "api/_functions/settings.ts": "api/modules/settings.ts",
  "api/_functions/operational-status.ts": "api/modules/operational-status.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
rmdir api/_functions/lib api/_functions 2>/dev/null || true
```

- [ ] **Step 3: Conferir que `_functions` sumiu**

```bash
ls api/_functions 2>/dev/null && echo "AINDA EXISTE" || echo "REMOVIDO"
grep -rn "_functions/" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
```

- [ ] **Step 4: Build e testes direcionados**

```bash
npm run build:api
npm run type-check
TZ=UTC node --test tests/unit/crm-deals-postgres.test.ts tests/unit/crm-prune.test.ts tests/unit/sales-dashboard-postgres.test.ts tests/unit/sales-orders-postgres.test.ts tests/unit/settings.test.ts tests/unit/settings-postgres.test.ts tests/unit/login.test.ts tests/unit/operational-status.test.ts tests/unit/meta-capi.test.ts tests/unit/route-map.test.ts
```

- [ ] **Step 5: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests
git commit -m "refactor(api): mover dominios crm, sales-orders e system para modules/"
```

---

## Task 8: Mover infrastructure/db e integrations (atômico)

Move os 24 arquivos de `api/_db/` e os 2 de integrações.
Atômico porque os 17 repositórios têm grafo denso de imports entre si.

**Files:**

- Move (17): `api/_db/*-repository.ts` → `api/infrastructure/db/repositories/`
- Move (5): `api/_db/schema.ts`, `client.ts`, `client-schema.ts`, `quotation-write-lock.ts`, `quotation-revision-invariants.ts` → `api/infrastructure/db/`
- Move (2): `api/_functions/lib/evolution-delivery.ts` → `api/infrastructure/integrations/evolution/evolution-delivery.ts`; `api/_functions/lib/meta-capi.ts` → `api/infrastructure/integrations/meta-capi/meta-capi.ts`
- Modify: `drizzle.config.ts` (schema path)
- Auto-rewrite: tudo que importa repositórios (módulos, testes, scripts).

**Interfaces:**

- Consumes: todos os módulos da Task 7.
- Produces: `api/infrastructure/db/` (5 + 17), `api/infrastructure/integrations/evolution/`, `api/infrastructure/integrations/meta-capi/`.
  Após esta task, `api/_db/` fica vazio (remover o diretório).

- [ ] **Step 1: Limpar outputs**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Mapa e rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "api/_db/client-repository.ts": "api/infrastructure/db/repositories/client-repository.ts",
  "api/_db/crm-deals-repository.ts": "api/infrastructure/db/repositories/crm-deals-repository.ts",
  "api/_db/order-template-repository.ts": "api/infrastructure/db/repositories/order-template-repository.ts",
  "api/_db/pricing-repository.ts": "api/infrastructure/db/repositories/pricing-repository.ts",
  "api/_db/product-activity-repository.ts": "api/infrastructure/db/repositories/product-activity-repository.ts",
  "api/_db/product-catalog-repository.ts": "api/infrastructure/db/repositories/product-catalog-repository.ts",
  "api/_db/products-repository.ts": "api/infrastructure/db/repositories/products-repository.ts",
  "api/_db/quotation-delivery-repository.ts": "api/infrastructure/db/repositories/quotation-delivery-repository.ts",
  "api/_db/quotation-issue-repository.ts": "api/infrastructure/db/repositories/quotation-issue-repository.ts",
  "api/_db/quotation-lifecycle-repository.ts": "api/infrastructure/db/repositories/quotation-lifecycle-repository.ts",
  "api/_db/quotation-template-library-repository.ts": "api/infrastructure/db/repositories/quotation-template-library-repository.ts",
  "api/_db/quotation-template-repository.ts": "api/infrastructure/db/repositories/quotation-template-repository.ts",
  "api/_db/quote-draft-management-repository.ts": "api/infrastructure/db/repositories/quote-draft-management-repository.ts",
  "api/_db/quote-leads-repository.ts": "api/infrastructure/db/repositories/quote-leads-repository.ts",
  "api/_db/quote-repository.ts": "api/infrastructure/db/repositories/quote-repository.ts",
  "api/_db/sales-orders-repository.ts": "api/infrastructure/db/repositories/sales-orders-repository.ts",
  "api/_db/settings-repository.ts": "api/infrastructure/db/repositories/settings-repository.ts",
  "api/_db/schema.ts": "api/infrastructure/db/schema.ts",
  "api/_db/client.ts": "api/infrastructure/db/client.ts",
  "api/_db/client-schema.ts": "api/infrastructure/db/client-schema.ts",
  "api/_db/quotation-write-lock.ts": "api/infrastructure/db/quotation-write-lock.ts",
  "api/_db/quotation-revision-invariants.ts": "api/infrastructure/db/quotation-revision-invariants.ts",
  "api/_functions/lib/evolution-delivery.ts": "api/infrastructure/integrations/evolution/evolution-delivery.ts",
  "api/_functions/lib/meta-capi.ts": "api/infrastructure/integrations/meta-capi/meta-capi.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
rmdir api/_db api/_functions/lib api/_functions 2>/dev/null || true
```

- [ ] **Step 3: Atualizar `drizzle.config.ts`**

Editar `drizzle.config.ts`:

```ts
  schema: './api/_db/schema.ts',
```

vira:

```ts
  schema: './api/infrastructure/db/schema.ts',
```

- [ ] **Step 4: Conferir restos**

```bash
grep -rn "_db/" api tests scripts src drizzle.config.ts --include="*.ts" --include="*.mjs" || echo "LIMPO"
grep -rn "_functions/" api tests scripts src --include="*.ts" --include="*.mjs" || echo "LIMPO"
ls api/_db 2>/dev/null && echo "AINDA EXISTE" || echo "REMOVIDO"
```

- [ ] **Step 5: Build e suíte unitária COMPLETA**

```bash
npm run build:api
npm run type-check
npm run test:unit
```

Expected: 689 testes (689 pass + 29 skips PG).

- [ ] **Step 6: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A api tests drizzle.config.ts
git commit -m "refactor(api): mover infrastructure/db e integrations para layout alvo"
```

---

## Task 9: Docs ativas, grep residual e verificação final completa

**Files:**

- Modify: `AGENTS.md` (tabela WHERE TO LOOK), `tests/AGENTS.md`
- Move/Rewrite: `api/_functions/AGENTS.md` → `api/modules/AGENTS.md`; `api/_lib/AGENTS.md` → `api/_shared/AGENTS.md`
- Create: nota curta em `api/infrastructure/README.md`? NÃO - fora de escopo (Fase 20 cria ARCHITECTURE.md). Apenas docs ativas listadas.

**Interfaces:**

- Consumes: layout final das Tasks 2-8.
- Produces: docs ativas coerentes com o layout.

- [ ] **Step 1: Atualizar tabela WHERE TO LOOK do AGENTS.md raiz**

Na seção WHERE TO LOOK, substituir as linhas de localização por:

```markdown
| Task | Location |
| --- | --- |
| Add API endpoint | `api/modules/*` + `api/_app/routes.ts` |
| Add frontend page | `src/pages/*.tsx` + `src/App.tsx` |
| Shared UI component | `src/components/ui/*.tsx` |
| Business logic / handlers | `api/modules/<dominio>/` |
| Shared auth/errors/rate-limit | `api/_shared/` |
| HTTP pipeline e adapters | `api/_app/`, `api/_http/` |
| Database schema | `api/infrastructure/db/schema.ts` |
| PostgreSQL repository | `api/infrastructure/db/repositories/*.ts` |
| External integrations | `api/infrastructure/integrations/*/` |
| PDF generation | `api/modules/pdf.ts` + `api/modules/quotation-pdf.ts` |
| Tests | `tests/unit/*.test.*`, `tests/*.spec.js` |
```

- [ ] **Step 2: Atualizar referências em `tests/AGENTS.md`**

`grep -n "_functions\|_db\|_lib" tests/AGENTS.md` e substituir pelos novos caminhos.
A linha 16 atual é `- Import backend source from \`api/_functions\` or \`api/_db\` directly.`; ela vira `- Import backend source from \`api/modules\` or \`api/infrastructure/db\` directly.`.
Manter o texto restante intacto.

- [ ] **Step 3: Mover e reescrever AGENTS.md de diretórios movidos**

```bash
git mv api/_functions/AGENTS.md api/modules/AGENTS.md
git mv api/_lib/AGENTS.md api/_shared/AGENTS.md
```

Substituir o conteúdo de `api/modules/AGENTS.md` por:

````markdown
# `api/modules` - domain business logic and HTTP handlers

Handlers are dispatched by `api/[...path].ts`; shared libraries have no default export.

## Structure

```text
api/modules/
└── *.ts                         # handlers, services and domain helpers (flat,
                                 # one file per domain: quotations, products,
                                 # crm, customers, sales-orders, whatsapp,
                                 # communication, system)
```

## Where to look

| Task | File |
| --- | --- |
| AI extraction | `extract.ts` |
| Quotation creation | `orcamento.ts` / `orcamento-core.ts` |
| Quotation preview and PDF | `quotation-preview.ts` / `pdf.ts` |
| WhatsApp send | `send-whatsapp.ts` / `send-whatsapp-flow.ts` |
| Communication flows | `communication-flows.ts` / `communication-media.ts` |
| Lead ingestion | `quote-leads.ts` / `typebot-lead-capture.ts` |
| Client CRUD | `leads-clients.ts` / `client-detail.ts` |
| CRM operations | `crm-deals.ts` / `crm-update-deal.ts` |
| Product catalog and pricing | `products.ts` / `product-detail.ts` / `product-pricing.ts` |
| Quotation CRUD | `quotations.ts` / `duplicate-quotation.ts` |
| Sales orders | `sales-orders.ts` / `sales-dashboard.ts` |
| Settings | `settings.ts` |
| Auth | `login.ts` / `logout.ts` |

## Conventions

- Handlers receive a Lambda-shaped event and return `{ statusCode, headers?, body }`.
- Register every endpoint once in `api/_app/routes.ts`.
- PostgreSQL repositories live in `api/infrastructure/db/repositories/` and own durable business state and transaction boundaries.
- Evolution is the only WhatsApp delivery transport; its delivery helper lives in `api/infrastructure/integrations/evolution/`.
- Communication media uses Vercel KV and Vercel Blob.
- Shared error helpers return neutral Portuguese messages and log only safe error classes.

## Anti-patterns

- Do not add rollout switches or alternate persistence paths.
- Do not return raw upstream errors, stack traces, credentials or customer data in logs.
- Do not use CommonJS imports.
- Do not register shared libraries as routes.
````

Substituir o conteúdo de `api/_shared/AGENTS.md` por:

````markdown
# `api/_shared` - middleware and shared request helpers

This directory contains authentication, rate limiting, errors and small domain-neutral helpers.

## Structure

```text
api/_shared/
├── auth.ts
├── password.ts
├── session.ts
├── http-error.ts
└── rate-limit.ts
```

## Conventions

- Keep endpoint handlers and database writes outside this directory.
- Export small named helpers.
- HTTP contract types (`FunctionEvent`, `FunctionResult`) and the function adapter live in `api/_http/`.
- Authentication configuration fails closed when required settings are missing.
- Session cookies contain signed identifiers, never passwords or secret values.

## Security

- Do not add header-based authentication fallbacks.
- Do not log cookies, authorization headers, connection strings or personal data.
- Keep rate limiting as a best-effort guard and enforce business limits at repositories.
````

Conferir `scripts/AGENTS.md` com `grep -n "_functions\|_db\|_lib" scripts/AGENTS.md` e atualizar se houver.

- [ ] **Step 4: Grep residual global**

```bash
grep -rn "_functions/\|_db/\|_lib/" api tests scripts src --include="*.ts" --include="*.tsx" --include="*.mjs" || echo "LIMPO"
```

Expected: zero ocorrências em código ativo.
Ocorrências permitidas: NENHUMA em `api/`, `scripts/`, `src/`.
Em `tests/`, se restar alguma, corrigir manualmente.

- [ ] **Step 5: Verificação final completa**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
npm run check
npm run test:unit
npx playwright test
node scripts/check-no-legacy-provider.mjs
```

Expected:

- `npm run check` verde (lint + type-check + tailwind + build).
- `npm run test:unit` verde: 689 pass, 29 skips PG.
- Playwright: 89/89 verde.
- `check-no-legacy-provider.mjs` verde.

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "docs: atualizar AGENTS ativos para layout modules/infrastructure"
```

---

## Critérios de aceitação finais (auditar antes de declarar concluído)

- [ ] `api/_functions/`, `api/_db/`, `api/_lib/` não existem.
- [ ] `api/modules/` tem 80 arquivos; `api/_shared/` 5; `api/_http/` 4; `api/infrastructure/db/` 5 + `repositories/` 17; `integrations/evolution/` 1; `integrations/meta-capi/` 1.
- [ ] `api/_app/routes.ts` compila e o mapa de rotas é idêntico ao anterior (`tests/unit/route-map.test.ts` verde).
- [ ] `npm run check`, `npm run test:unit` (689), `npx playwright test` (89), `check-no-legacy-provider.mjs` todos verdes.
- [ ] Violações de fronteira da spec (seção 5) permanecem exatamente as mesmas - nenhuma foi corrigida nem piorada.
- [ ] `git status --porcelain` vazio ao final (fora outputs gitignored).
