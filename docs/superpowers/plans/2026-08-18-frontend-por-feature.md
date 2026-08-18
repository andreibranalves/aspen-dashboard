# Fases 6-7: Frontend por feature + rotas centralizadas - Plano de Implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para implementar este plano tarefa por tarefa.
> Passos usam sintaxe de checkbox (`- [ ]`) para rastreamento.

**Goal:** Reorganizar `src/` em `app/` (rotas centralizadas) + `features/<dominio>/`, com `lib/` dividido em `api/`/`formatting/`/`storage/` e `components/shared/`, sem nenhuma mudança de comportamento e sem React Router.

**Architecture:** Movimento físico de 57 arquivos TS/TSX (19 na Task 2, 38 na Task 3) com o script determinístico `scripts/rewrite-imports.mjs` (estendido para alias `@/...` e candidates `.tsx`/`.jsx`), seguido de reescrita do dispatch de rotas: uma tabela única em `src/app/routes.tsx` (match + render + nav) e `navigation.ts` derivando o sidebar.
Execução em 4 tasks: extensão do script, shared+lib, features, rotas centralizadas.

**Tech Stack:** React 19, Vite 6, TypeScript 5.9, hash routing via `useHashRoute`, `node:test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-18-frontend-por-feature-design.md` - este plano implementa as Fases 6-7 (seções 11-12) da `aspen-dashboard-plano-refatoracao.md`.
A spec contém o layout alvo completo e as violações de fronteira registradas para a Fase 19.

## Global Constraints

- Zero mudança de comportamento: paridade de rotas auditada na seção 5 da spec (prefixos de detalhe, leads com id multi-segmento, fallback auto sem Suspense, login fora do Layout).
- Nenhuma página muda de assinatura de props (`id`, `sku`, `tipo`, `navigate` continuam iguais).
- Alias `@/` aponta para `src/` (tsconfig paths + vite.config.js); imports de frontend usam alias, imports de teste usam caminhos relativos `../../src/...` COM extensão `.ts` - ambos são reescritos pelo script.
- Sem React Router, sem dependências novas.
- Não editar `public/` (build Vite) nem `drizzle/` (migrations).
- Documentação histórica (`docs/superpowers/**` anteriores, `docs/baseline-refatoracao.md`, spec raiz) NÃO é tocada.
- Outputs tsc (`api/**/*.js`) são gitignored; limpar antes de cada build (`find api -name '*.js' -delete && find api -name '*.js.map' -delete`).
- Commits sem co-autor.
- Modelos de subagent: `worker` = `opencode-go/deepseek-v4-flash`, `reviewer` = `opencode-go/deepseek-v4-pro`; sem overrides de model/thinking; máximo 3 rodadas review/fix por task.
- Erros de usuário em PT-BR; nunca expor stack/db/secrets.
- Playwright local usa `webServer` próprio (`scripts/vite-dev.mjs`, porta 5173, `reuseExistingServer: false`) - não precisa subir servidor manualmente.

## Mecânica de verificação por task (aplicar em TODAS as tasks)

Antes de cada build: `find api -name '*.js' -delete && find api -name '*.js.map' -delete`.
Depois: `npm run check` (lint + type-check + tailwind + build) + testes direcionados da task.
Testes unitários: `TZ=UTC node --test tests/unit/<arquivo>.test.ts` (vários arquivos: listar no mesmo comando).
Os 29 testes PostgreSQL (nomes `*-postgres*.test.ts` e `postgres-first-party-schema.test.ts`) continuam skip sem banco descartável - skip NÃO é falha.

---

## Task 1: Estender `rewrite-imports.mjs` para alias `@/` e `.tsx`/`.jsx`

Prepara a ferramenta para mover frontend.
Sem esta extensão, imports de alias (`@/pages/X`) não seriam reescritos e moves de `.tsx` não resolveriam.

**Files:**

- Modify: `scripts/rewrite-imports.mjs`

**Interfaces:**

- Consumes: nada (script já commitado na sessão anterior).
- Produces: mesmo CLI `node scripts/rewrite-imports.mjs <mapping.json>`, agora com:
  - `resolveOld` aceitando specifiers `@/...` (resolve contra `src/`);
  - candidates `.tsx`, `.jsx`, `/index.tsx`, `/index.jsx` no `resolveOld`;
  - rewrite de alias movido para novo alias `@/...` (preserva sufixo e query string).

- [ ] **Step 1: Substituir o conteúdo do script**

Substituir TODO o conteúdo de `scripts/rewrite-imports.mjs` por (versão final verificada na Task 1: preserva a semântica no-op-safe do script original - especificador reescrito SEM extensão com sufixo/query do spec reaplicados, backreference de aspa, guard `replaced !== m` - e adiciona alias + tsx/jsx):

```js
// Rewrites relative and alias import specifiers and path strings after moving source files.
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

// Resolve a specifier (relative or '@/...' alias) from the OLD importer dir to an existing source file.
function resolveOld(baseDirOld, spec) {
  const { pathname } = splitQuery(spec);
  const isAlias = pathname.startsWith('@/');
  const base = isAlias ? resolve(ROOT, 'src') : baseDirOld;
  const p = isAlias ? resolve(base, pathname.slice(2)) : resolve(baseDirOld, pathname);
  const candidates = [
    p,
    p.replace(/\.js$/, '.ts'),
    p.replace(/\.ts$/, '.js'),
    p + '.ts',
    p + '.tsx',
    p + '.js',
    p + '.jsx',
    p + '/index.ts',
    p + '/index.tsx',
    p + '/index.js',
    p + '/index.jsx',
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

  // 1) relative (./ ../) and alias (@/) import/export specifiers (static, side-effect and dynamic)
  text = text.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+(?:type\s+)?)(['"])((?:\.|@\/)[^'"]*?)\2/g,
    (m, pre, q, spec) => {
      const targetOld = resolveOld(baseDirOld, spec);
      if (!targetOld) return m;
      const targetNew = MAP[targetOld] ?? targetOld;
      // Specifier WITHOUT extension; the specifier's own suffix is re-appended.
      // (targetNew always resolves to a file WITH an extension such as .ts/.tsx.)
      const extless = targetNew.replace(/\.(?:ts|tsx|js|jsx|mjs)$/, '');
      let rel;
      if (spec.startsWith('@/')) {
        rel = '@/';
        const fromSrc = relative(resolve(ROOT, 'src'), resolve(ROOT, extless)).replace(/\\/g, '/');
        rel += fromSrc;
      } else {
        rel = relative(baseDirNew, resolve(ROOT, extless)).replace(/\\/g, '/');
        rel = rel.startsWith('.') ? rel : './' + rel;
      }
      // Suffix and query come from the pathname, not the full specifier (query may trail).
      const { pathname, query } = splitQuery(spec);
      const suffix = pathname.endsWith('.mjs')
        ? '.mjs'
        : pathname.endsWith('.tsx')
          ? '.tsx'
          : pathname.endsWith('.jsx')
            ? '.jsx'
            : pathname.endsWith('.ts')
              ? '.ts'
              : pathname.endsWith('.js')
                ? '.js'
                : '';
      const replaced = pre + q + rel + suffix + query + q;
      if (replaced !== m) {
        rewrites++;
        return replaced;
      }
      return m;
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

- [ ] **Step 2: Verificar no-op com mapa vazio**

```bash
echo '{}' > /tmp/empty-map.json
node scripts/rewrite-imports.mjs /tmp/empty-map.json
git status --porcelain
```

Expected: `renames: 0, rewrites: 0` e `git status --porcelain` vazio.

- [ ] **Step 3: Probe de alias + .tsx com arquivos scratch temporariamente rastreados**

O script lê a lista de arquivos de `git ls-files`; arquivos scratch precisam ser staged para serem vistos (intent-to-add não é suficiente).

```bash
cat > src/__probe_importer.tsx <<'EOF'
import { PROBE } from '@/__probe_target';
export const probe = PROBE;
EOF
cat > src/__probe_target.ts <<'EOF'
export const PROBE = 1;
EOF
git add src/__probe_importer.tsx src/__probe_target.ts
cat > /tmp/probe-map.json <<'EOF'
{
  "src/__probe_importer.tsx": "src/components/__probe_importer.tsx",
  "src/__probe_target.ts": "src/lib/__probe_target.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/probe-map.json
grep -n "from '@/" src/components/__probe_importer.tsx
ls src/lib/__probe_target.ts
```

Expected: `renames: 2, rewrites: 1`; grep mostra `from '@/lib/__probe_target'`; arquivo existe em `src/lib/`.

- [ ] **Step 4: Limpar scratch e conferir árvore limpa**

```bash
rm src/components/__probe_importer.tsx src/lib/__probe_target.ts
git reset src/__probe_importer.tsx src/__probe_target.ts
git status --porcelain
```

Expected: vazio (scratch removido e retirado do index).

- [ ] **Step 5: Commit**

```bash
git add scripts/rewrite-imports.mjs
git commit -m "refactor(scripts): suporte a alias @/ e tsx/jsx no rewrite de imports"
```

---

## Task 2: Mover componentes compartilhados e dividir `lib/` (api/formatting/storage)

**Files:**

- Move (6): `src/components/ConfirmDialog.tsx`, `PageHeader.tsx`, `PageLoader.tsx`, `Skeleton.tsx`, `SkeletonDetail.tsx`, `SkeletonTable.tsx` → `src/components/shared/`
- Move (10): `src/lib/api.ts`, `communicationApi.ts`, `communicationSend.ts`, `orderTemplatesApi.ts`, `productCache.ts`, `quotationIssueApi.ts`, `quotationTemplatesApi.ts`, `settingsApi.ts`, `whatsappFlows.ts`, `whatsappInboxApi.ts` → `src/lib/api/`
- Move (2): `src/lib/formatters.ts`, `printFormats.ts` → `src/lib/formatting/`
- Move (1): `src/lib/autoQuoteDraftStorage.ts` → `src/lib/storage/`
- Delete: `src/components/EmptyState.tsx`, `src/components/ErrorState.tsx` (zero usos, grep confirmado)

**Interfaces:**

- Consumes: script estendido da Task 1.
- Produces: `src/components/shared/` (6), `src/lib/api/` (10), `src/lib/formatting/` (2), `src/lib/storage/` (1).
  `src/lib/` raiz mantém `utils.ts`, `constants.ts`, `clientMetadata.ts`, `localProjections.ts`.

- [ ] **Step 1: Limpar outputs tsc**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Deletar componentes mortos**

```bash
git rm src/components/EmptyState.tsx src/components/ErrorState.tsx
```

- [ ] **Step 3: Criar mapa e rodar o rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "src/components/ConfirmDialog.tsx": "src/components/shared/ConfirmDialog.tsx",
  "src/components/PageHeader.tsx": "src/components/shared/PageHeader.tsx",
  "src/components/PageLoader.tsx": "src/components/shared/PageLoader.tsx",
  "src/components/Skeleton.tsx": "src/components/shared/Skeleton.tsx",
  "src/components/SkeletonDetail.tsx": "src/components/shared/SkeletonDetail.tsx",
  "src/components/SkeletonTable.tsx": "src/components/shared/SkeletonTable.tsx",
  "src/lib/api.ts": "src/lib/api/api.ts",
  "src/lib/communicationApi.ts": "src/lib/api/communicationApi.ts",
  "src/lib/communicationSend.ts": "src/lib/api/communicationSend.ts",
  "src/lib/orderTemplatesApi.ts": "src/lib/api/orderTemplatesApi.ts",
  "src/lib/productCache.ts": "src/lib/api/productCache.ts",
  "src/lib/quotationIssueApi.ts": "src/lib/api/quotationIssueApi.ts",
  "src/lib/quotationTemplatesApi.ts": "src/lib/api/quotationTemplatesApi.ts",
  "src/lib/settingsApi.ts": "src/lib/api/settingsApi.ts",
  "src/lib/whatsappFlows.ts": "src/lib/api/whatsappFlows.ts",
  "src/lib/whatsappInboxApi.ts": "src/lib/api/whatsappInboxApi.ts",
  "src/lib/formatters.ts": "src/lib/formatting/formatters.ts",
  "src/lib/printFormats.ts": "src/lib/formatting/printFormats.ts",
  "src/lib/autoQuoteDraftStorage.ts": "src/lib/storage/autoQuoteDraftStorage.ts"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
```

Expected: `renames: 19` e contagem de rewrites > 0.

- [ ] **Step 4: Conferir reescrita nos testes e scripts**

```bash
grep -rn "src/lib/formatters\|src/lib/printFormats\|src/lib/communicationSend\|src/lib/communicationApi\|src/lib/whatsappFlows\|src/lib/quotationIssueApi\|src/lib/autoQuoteDraftStorage" tests/unit --include="*.ts" | grep -v "formatting\|/api/\|/storage/" || echo "LIMPO-TESTES"
grep -n "src/lib" scripts/test-whatsapp-flows.mjs scripts/test-whatsapp-sequence.mjs
```

Expected: `LIMPO-TESTES` (imports de testes apontam para `src/lib/formatting/...`, `src/lib/api/...` e `src/lib/storage/...`); scripts apontam para `../src/lib/api/whatsappFlows.ts` (com query string preservada no import dinâmico do `test-whatsapp-flows.mjs`).

- [ ] **Step 5: Conferir restos de caminhos antigos no frontend**

```bash
grep -rn "from '@/components/ConfirmDialog'\|from '@/components/PageHeader'\|from '@/components/PageLoader'\|from '@/components/Skeleton'\|from '@/components/SkeletonDetail'\|from '@/components/SkeletonTable'" src || echo "LIMPO-COMPONENTS"
grep -rn "from '@/lib/api'\|from '@/lib/communicationApi'\|from '@/lib/communicationSend'\|from '@/lib/orderTemplatesApi'\|from '@/lib/productCache'\|from '@/lib/quotationIssueApi'\|from '@/lib/quotationTemplatesApi'\|from '@/lib/settingsApi'\|from '@/lib/whatsappFlows'\|from '@/lib/whatsappInboxApi'\|from '@/lib/formatters'\|from '@/lib/printFormats'\|from '@/lib/autoQuoteDraftStorage'" src || echo "LIMPO-LIB"
```

Expected: ambos `LIMPO` (nenhum import aponta para os caminhos antigos).
ATENÇÃO: `from '@/lib/api'` pode ainda aparecer se algum arquivo importar o diretório `lib/api` como diretório - não é o caso aqui; o grep deve dar zero em `src/`.

- [ ] **Step 6: Build e testes direcionados**

```bash
npm run check
TZ=UTC node --test tests/unit/formatters.test.ts tests/unit/local-projections.test.ts tests/unit/communication-send.test.ts tests/unit/communication-api.test.ts tests/unit/whatsapp-flows.test.ts tests/unit/auto-quote-draft-storage.test.ts tests/unit/quotation-content.test.ts
```

Expected: `npm run check` verde (lint + type-check + tailwind + build Vite) e todos os testes unitários verdes (skips PG são ok; aqui não há).

- [ ] **Step 7: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A src tests scripts
git commit -m "refactor(frontend): shared components e lib api/formatting/storage (Fases 6-7)"
```

---

## Task 3: Mover páginas e componentes para `features/<dominio>/`

Maior task de movimento: 38 arquivos no total (incluindo `App.tsx` e `LoginPage.tsx` para `app/`).
Sem mudança de lógica - só física; `App.tsx` continua com o dispatch antigo (reescrito na Task 4).

**Files:**

- Move (2): `src/App.tsx` → `src/app/App.tsx`; `src/pages/LoginPage.tsx` → `src/app/LoginPage.tsx`
- Move dashboard (1): `src/pages/DashboardPage.tsx` → `src/features/dashboard/pages/DashboardPage.tsx`
- Move quotations pages (4): `AutoQuotePage.tsx`, `ManualOrcamentoPage.tsx`, `QuotationDetailPage.tsx`, `QuotationsPage.tsx` → `src/features/quotations/pages/`
- Move quotations components (9): `src/components/CustomerMetadataForm.tsx`, `DraftItemTable.tsx`, `DraftReviewCard.tsx`, `OrderTemplateManager.tsx`, `SplitResultCard.tsx`, `StatusBadge.tsx`, `WhatsAppSendPanel.tsx`, `quotation/QuotationSectionsEditor.tsx`, `quotation/QuotationTemplateManager.tsx` → `src/features/quotations/components/`
- Move products (2): `ProductsPage.tsx`, `ProductDetailPage.tsx` → `src/features/products/pages/`
- Move customers (5): `LeadsPage.tsx`, `LeadDetailPage.tsx` → `src/features/customers/pages/`; `src/components/ContextActions.tsx`, `DetailDrawer.tsx`, `QualityBadges.tsx` → `src/features/customers/components/`
- Move crm (2): `CrmKanbanPage.tsx` → `src/features/crm/pages/`; `src/components/SkeletonKanban.tsx` → `src/features/crm/components/`
- Move sales-orders (2): `SalesOrdersPage.tsx`, `SalesOrderDetailPage.tsx` → `src/features/sales-orders/pages/`
- Move whatsapp (2): `WhatsAppInboxPage.tsx` → `src/features/whatsapp/pages/`; `src/components/ui/whatsapp-attachment-card.tsx` → `src/features/whatsapp/components/whatsapp-attachment-card.tsx`
- Move communication (8): `ComunicacaoPage.tsx` → `src/features/communication/pages/`; `src/components/communication/ChannelsTab.tsx`, `FlowEditorTab.tsx`, `MediaGridItem.tsx`, `MediaLibrary.tsx`, `MediaUploader.tsx`, `SendHistoryTab.tsx`, `SkeletonComunicacao.tsx` → `src/features/communication/components/`
- Move settings (1): `SettingsPage.tsx` → `src/features/settings/pages/SettingsPage.tsx`

**Interfaces:**

- Consumes: layout da Task 2 (`components/shared/`, `lib/api|formatting|storage`).
- Produces: `src/app/` (2), `src/features/` (8 domínios + settings, 38 arquivos).
  Diretórios `src/pages/`, `src/components/communication/`, `src/components/quotation/` ficam vazios (remover).

- [ ] **Step 1: Limpar outputs tsc**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
```

- [ ] **Step 2: Criar mapa e rodar o rewrite**

```bash
cat > /tmp/move-map.json <<'EOF'
{
  "src/App.tsx": "src/app/App.tsx",
  "src/pages/LoginPage.tsx": "src/app/LoginPage.tsx",
  "src/pages/DashboardPage.tsx": "src/features/dashboard/pages/DashboardPage.tsx",
  "src/pages/AutoQuotePage.tsx": "src/features/quotations/pages/AutoQuotePage.tsx",
  "src/pages/ManualOrcamentoPage.tsx": "src/features/quotations/pages/ManualOrcamentoPage.tsx",
  "src/pages/QuotationDetailPage.tsx": "src/features/quotations/pages/QuotationDetailPage.tsx",
  "src/pages/QuotationsPage.tsx": "src/features/quotations/pages/QuotationsPage.tsx",
  "src/components/CustomerMetadataForm.tsx": "src/features/quotations/components/CustomerMetadataForm.tsx",
  "src/components/DraftItemTable.tsx": "src/features/quotations/components/DraftItemTable.tsx",
  "src/components/DraftReviewCard.tsx": "src/features/quotations/components/DraftReviewCard.tsx",
  "src/components/OrderTemplateManager.tsx": "src/features/quotations/components/OrderTemplateManager.tsx",
  "src/components/SplitResultCard.tsx": "src/features/quotations/components/SplitResultCard.tsx",
  "src/components/StatusBadge.tsx": "src/features/quotations/components/StatusBadge.tsx",
  "src/components/WhatsAppSendPanel.tsx": "src/features/quotations/components/WhatsAppSendPanel.tsx",
  "src/components/quotation/QuotationSectionsEditor.tsx": "src/features/quotations/components/QuotationSectionsEditor.tsx",
  "src/components/quotation/QuotationTemplateManager.tsx": "src/features/quotations/components/QuotationTemplateManager.tsx",
  "src/pages/ProductsPage.tsx": "src/features/products/pages/ProductsPage.tsx",
  "src/pages/ProductDetailPage.tsx": "src/features/products/pages/ProductDetailPage.tsx",
  "src/pages/LeadsPage.tsx": "src/features/customers/pages/LeadsPage.tsx",
  "src/pages/LeadDetailPage.tsx": "src/features/customers/pages/LeadDetailPage.tsx",
  "src/components/ContextActions.tsx": "src/features/customers/components/ContextActions.tsx",
  "src/components/DetailDrawer.tsx": "src/features/customers/components/DetailDrawer.tsx",
  "src/components/QualityBadges.tsx": "src/features/customers/components/QualityBadges.tsx",
  "src/pages/CrmKanbanPage.tsx": "src/features/crm/pages/CrmKanbanPage.tsx",
  "src/components/SkeletonKanban.tsx": "src/features/crm/components/SkeletonKanban.tsx",
  "src/pages/SalesOrdersPage.tsx": "src/features/sales-orders/pages/SalesOrdersPage.tsx",
  "src/pages/SalesOrderDetailPage.tsx": "src/features/sales-orders/pages/SalesOrderDetailPage.tsx",
  "src/pages/WhatsAppInboxPage.tsx": "src/features/whatsapp/pages/WhatsAppInboxPage.tsx",
  "src/components/ui/whatsapp-attachment-card.tsx": "src/features/whatsapp/components/whatsapp-attachment-card.tsx",
  "src/pages/ComunicacaoPage.tsx": "src/features/communication/pages/ComunicacaoPage.tsx",
  "src/components/communication/ChannelsTab.tsx": "src/features/communication/components/ChannelsTab.tsx",
  "src/components/communication/FlowEditorTab.tsx": "src/features/communication/components/FlowEditorTab.tsx",
  "src/components/communication/MediaGridItem.tsx": "src/features/communication/components/MediaGridItem.tsx",
  "src/components/communication/MediaLibrary.tsx": "src/features/communication/components/MediaLibrary.tsx",
  "src/components/communication/MediaUploader.tsx": "src/features/communication/components/MediaUploader.tsx",
  "src/components/communication/SendHistoryTab.tsx": "src/features/communication/components/SendHistoryTab.tsx",
  "src/components/SkeletonComunicacao.tsx": "src/features/communication/components/SkeletonComunicacao.tsx",
  "src/pages/SettingsPage.tsx": "src/features/settings/pages/SettingsPage.tsx"
}
EOF
node scripts/rewrite-imports.mjs /tmp/move-map.json
rmdir src/pages src/components/communication src/components/quotation 2>/dev/null || true
```

Expected: `renames: 38` e contagem de rewrites > 0.

- [ ] **Step 3: Conferir reescrita de `main.tsx` e restos**

```bash
grep -n "import App" src/main.tsx
grep -rn "@/pages/\|@/components/quotation/\|@/components/communication/\|@/components/CustomerMetadataForm\|@/components/DraftItemTable\|@/components/DraftReviewCard\|@/components/OrderTemplateManager\|@/components/SplitResultCard\|@/components/StatusBadge\|@/components/WhatsAppSendPanel\|@/components/ContextActions\|@/components/DetailDrawer\|@/components/QualityBadges\|@/components/SkeletonKanban\|@/components/SkeletonComunicacao\|@/components/ui/whatsapp-attachment-card" src || echo "LIMPO"
ls src/pages 2>/dev/null && echo "AINDA EXISTE" || echo "REMOVIDO-PAGES"
```

Expected: `main.tsx` importa `./app/App`; grep residual `LIMPO`; `REMOVIDO-PAGES`.

- [ ] **Step 4: Build e checagem completa**

```bash
npm run check
```

Expected: verde (lint + type-check + tailwind + build Vite completo).

- [ ] **Step 5: Playwright completo (navegação real por hash)**

```bash
npx playwright test
```

Expected: 89/89 verde (o webServer do config sobe `scripts/vite-dev.mjs` sozinho).

- [ ] **Step 6: Limpar outputs e commit**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
git add -A src
git commit -m "refactor(frontend): mover paginas e componentes para features/ por dominio"
```

---

## Task 4: Centralizar rotas em `src/app/routes.tsx` + `navigation.ts`

Fase 7: uma única fonte para definição de rotas e navegação.
Nenhuma página muda de assinatura; o dispatch usa `render` lambdas com as props exatas de hoje.

**Files:**

- Create: `src/app/match-route.ts` (matchers puros, sem JSX)
- Create: `src/app/routes.tsx` (tabela única)
- Create: `src/app/navigation.ts` (NAV_SECTIONS derivada)
- Create: `tests/unit/match-route.test.ts`
- Rewrite: `src/app/App.tsx` (dispatch via tabela)
- Modify: `src/components/layout/Sidebar.tsx` (NAV_SECTIONS importada)
- Modify: `AGENTS.md` (STRUCTURE, WHERE TO LOOK, CONVENTIONS)

**Interfaces:**

- Consumes: layout final das Tasks 2-3.
- Produces: `AppRoute` (path, match, render, suspense, layout, nav), `matchSegments`, `prefix`, `NAV_SECTIONS`, `routes`.
  Contrato completo na seção 5 da spec.

- [ ] **Step 1: Criar `src/app/match-route.ts`**

Conteúdo completo:

```ts
// Matchers de rota puros (sem JSX) - testáveis em node:test sem transform de TSX.

export function matchSegments(pattern: string, route: string): Record<string, string> | null {
  const parts = pattern.split('/');
  const actual = route.split('/');
  const params: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (seg.startsWith(':')) {
      if (seg.endsWith('*')) {
        params[seg.slice(1, -1)] = actual.slice(i).join('/');
        return params;
      }
      if (i >= actual.length) return null;
      params[seg.slice(1)] = actual[i];
    } else if (i >= actual.length || seg !== actual[i]) {
      return null;
    }
  }
  return actual.length === parts.length ? params : null;
}

export function prefix(prefixPath: string): (route: string) => Record<string, string> | null {
  return (route: string) => (route.startsWith(prefixPath) ? { id: route.slice(prefixPath.length) } : null);
}
```

- [ ] **Step 2: Criar o teste unitário `tests/unit/match-route.test.ts`**

Conteúdo completo:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSegments, prefix } from '../../src/app/match-route.ts';

test('matchSegments captura parametro de segmento', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id', '/leads/cliente/ORC-1'), { tipo: 'cliente', id: 'ORC-1' });
});

test('matchSegments captura id com barras via catch-all', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id*', '/leads/cliente/a/b/c'), { tipo: 'cliente', id: 'a/b/c' });
});

test('matchSegments devolve id vazio quando falta o resto', () => {
  assert.deepEqual(matchSegments('/leads/:tipo/:id*', '/leads/cliente'), { tipo: 'cliente', id: '' });
});

test('matchSegments rejeita rota com menos segmentos que o padrao', () => {
  assert.equal(matchSegments('/a/b', '/a'), null);
});

test('matchSegments rejeita rota com mais segmentos que o padrao sem catch-all', () => {
  assert.equal(matchSegments('/a/b', '/a/b/c'), null);
});

test('matchSegments rejeita segmento estatico diferente', () => {
  assert.equal(matchSegments('/a/b', '/a/x'), null);
});

test('prefix captura o resto apos o prefixo', () => {
  assert.deepEqual(prefix('/quotations/')('/quotations/ORC-1'), { id: 'ORC-1' });
});

test('prefix rejeita rota sem o prefixo (sem barra final)', () => {
  assert.equal(prefix('/quotations/')('/quotations'), null);
});
```

- [ ] **Step 3: Rodar o teste (deve passar de primeira - matcher já escrito)**

```bash
TZ=UTC node --test tests/unit/match-route.test.ts
```

Expected: 8/8 verde.

- [ ] **Step 4: Criar `src/app/routes.tsx`**

Conteúdo completo:

```tsx
import { lazy, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Columns3,
  FileText,
  MessageCircle,
  Package,
  Settings,
  ShoppingCart,
  Sparkles,
  Users,
} from 'lucide-react';
import { matchSegments, prefix } from '@/app/match-route';
import LoginPage from '@/app/LoginPage';
import AutoQuotePage from '@/features/quotations/pages/AutoQuotePage';

const DashboardPage = lazy(() => import('@/features/dashboard/pages/DashboardPage'));
const QuotationsPage = lazy(() => import('@/features/quotations/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/features/quotations/pages/QuotationDetailPage'));
const SalesOrdersPage = lazy(() => import('@/features/sales-orders/pages/SalesOrdersPage'));
const SalesOrderDetailPage = lazy(() => import('@/features/sales-orders/pages/SalesOrderDetailPage'));
const CrmKanbanPage = lazy(() => import('@/features/crm/pages/CrmKanbanPage'));
const ProductsPage = lazy(() => import('@/features/products/pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/features/products/pages/ProductDetailPage'));
const LeadsPage = lazy(() => import('@/features/customers/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/features/customers/pages/LeadDetailPage'));
const SettingsPage = lazy(() => import('@/features/settings/pages/SettingsPage'));
const ManualOrcamentoPage = lazy(() => import('@/features/quotations/pages/ManualOrcamentoPage'));
const ComunicacaoPage = lazy(() => import('@/features/communication/pages/ComunicacaoPage'));
const WhatsAppInboxPage = lazy(() => import('@/features/whatsapp/pages/WhatsAppInboxPage'));

export interface RouteContext {
  navigate: (hash: string) => void;
  params: Record<string, string>;
}

export interface AppRoute {
  path: string;
  match?: (route: string) => Record<string, string> | null;
  render: (ctx: RouteContext) => ReactNode;
  /** Envolve o conteúdo em Suspense/PageLoader (default: false). */
  suspense?: boolean;
  /** Renderiza dentro do Layout shell (default: true). */
  layout?: boolean;
  nav?: { label: string; icon: LucideIcon; section: string };
}

export const routes: AppRoute[] = [
  {
    path: '/login',
    layout: false,
    render: ({ navigate }) => <LoginPage navigate={navigate} />,
  },
  {
    path: '/quotations/:id',
    match: prefix('/quotations/'),
    suspense: true,
    render: ({ navigate, params }) => <QuotationDetailPage id={params.id} navigate={navigate} />,
  },
  {
    path: '/sales-orders/:id',
    match: prefix('/sales-orders/'),
    suspense: true,
    render: ({ navigate, params }) => <SalesOrderDetailPage id={params.id} navigate={navigate} />,
  },
  {
    path: '/products/:sku',
    match: prefix('/products/'),
    suspense: true,
    render: ({ navigate, params }) => <ProductDetailPage key={params.sku} sku={params.sku} navigate={navigate} />,
  },
  {
    path: '/leads/:tipo/:id',
    match: (route) => {
      const params = matchSegments('/leads/:tipo/:id*', route);
      return params && params.tipo && params.id ? params : null;
    },
    suspense: true,
    render: ({ navigate, params }) => <LeadDetailPage tipo={params.tipo} id={params.id} navigate={navigate} />,
  },
  {
    path: '/auto',
    render: () => <AutoQuotePage />,
    nav: { label: 'Auto', icon: Sparkles, section: 'Operacional' },
  },
  {
    path: '/whatsapp-inbox',
    suspense: true,
    render: ({ navigate }) => <WhatsAppInboxPage navigate={navigate} />,
    nav: { label: 'WhatsApp', icon: MessageCircle, section: 'Operacional' },
  },
  {
    path: '/dashboard',
    suspense: true,
    render: ({ navigate }) => <DashboardPage navigate={navigate} />,
    nav: { label: 'Dashboard', icon: BarChart3, section: 'Operacional' },
  },
  {
    path: '/sales-orders',
    suspense: true,
    render: ({ navigate }) => <SalesOrdersPage navigate={navigate} />,
    nav: { label: 'Pedidos', icon: ShoppingCart, section: 'Operacional' },
  },
  {
    path: '/crm',
    suspense: true,
    render: () => <CrmKanbanPage />,
    nav: { label: 'CRM', icon: Columns3, section: 'Operacional' },
  },
  {
    path: '/quotations',
    suspense: true,
    render: ({ navigate }) => <QuotationsPage navigate={navigate} />,
    nav: { label: 'Orçamentos', icon: FileText, section: 'Cadastros' },
  },
  {
    path: '/products',
    suspense: true,
    render: () => <ProductsPage />,
    nav: { label: 'Produtos', icon: Package, section: 'Cadastros' },
  },
  {
    path: '/leads',
    suspense: true,
    render: ({ navigate }) => <LeadsPage navigate={navigate} />,
    nav: { label: 'Clientes', icon: Users, section: 'Cadastros' },
  },
  {
    path: '/comunicacao',
    suspense: true,
    render: () => <ComunicacaoPage />,
    nav: { label: 'Comunicação', icon: MessageCircle, section: 'Outros' },
  },
  {
    path: '/settings',
    suspense: true,
    render: () => <SettingsPage />,
    nav: { label: 'Configurações', icon: Settings, section: 'Outros' },
  },
  {
    path: '/manual',
    suspense: true,
    render: () => <ManualOrcamentoPage />,
  },
];
```

- [ ] **Step 5: Criar `src/app/navigation.ts`**

Conteúdo completo:

```ts
import type { LucideIcon } from 'lucide-react';
import { routes } from '@/app/routes';

export interface NavItem {
  hash: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = routes.reduce<NavSection[]>((sections, route) => {
  if (!route.nav) return sections;
  const section = sections.find((s) => s.title === route.nav!.section);
  if (section) {
    section.items.push({ hash: route.path, label: route.nav!.label, icon: route.nav!.icon });
  } else {
    sections.push({
      title: route.nav!.section,
      items: [{ hash: route.path, label: route.nav!.label, icon: route.nav!.icon }],
    });
  }
  return sections;
}, []);
```

- [ ] **Step 6: Reescrever `src/app/App.tsx`**

Substituir TODO o conteúdo por:

```tsx
import { Suspense, type ReactNode } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/shared/PageLoader';
import { routes, type AppRoute } from '@/app/routes';
import AutoQuotePage from '@/features/quotations/pages/AutoQuotePage';

function findRoute(route: string): { entry: AppRoute; params: Record<string, string> } | null {
  for (const entry of routes) {
    const params = entry.match ? entry.match(route) : route === entry.path ? {} : null;
    if (params) return { entry, params };
  }
  return null;
}

export default function App() {
  const [route, navigate] = useHashRoute();
  const matched = findRoute(route);

  let content: ReactNode;
  if (matched) {
    content = matched.entry.render({ navigate, params: matched.params });
    if (matched.entry.suspense) {
      content = <Suspense fallback={<PageLoader />}>{content}</Suspense>;
    }
  } else {
    content = <AutoQuotePage />;
  }

  if (matched && matched.entry.layout === false) return content;
  return (
    <Layout route={route} onNavigate={navigate}>
      {content}
    </Layout>
  );
}
```

- [ ] **Step 7: Atualizar `src/components/layout/Sidebar.tsx`**

Substituir o bloco de imports + interfaces + `NAV_SECTIONS` local.
O trecho atual (do topo do arquivo até o fechamento de `NAV_SECTIONS`):

```tsx
import { cn } from '@/lib/utils';
import {
  BarChart3,
  ShoppingCart,
  FileText,
  Sparkles,
  Columns3,
  Package,
  Users,
  Settings,
  MessageCircle,
  Menu,
  X,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';

interface NavItem {
  hash: string;
  label: string;
  icon: LucideIcon;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operacional',
    items: [
      { hash: '/auto', label: 'Auto', icon: Sparkles },
      { hash: '/whatsapp-inbox', label: 'WhatsApp', icon: MessageCircle },
      { hash: '/dashboard', label: 'Dashboard', icon: BarChart3 },
      { hash: '/sales-orders', label: 'Pedidos', icon: ShoppingCart },
      { hash: '/crm', label: 'CRM', icon: Columns3 },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { hash: '/quotations', label: 'Orçamentos', icon: FileText },
      { hash: '/products', label: 'Produtos', icon: Package },
      { hash: '/leads', label: 'Clientes', icon: Users },
    ],
  },
  {
    title: 'Outros',
    items: [
      { hash: '/comunicacao', label: 'Comunicação', icon: MessageCircle },
      { hash: '/settings', label: 'Configurações', icon: Settings },
    ],
  },
];
```

vira:

```tsx
import { cn } from '@/lib/utils';
import { Menu, X, Moon, Sun } from 'lucide-react';
import { NAV_SECTIONS } from '@/app/navigation';
```

O restante do arquivo (interface `SidebarProps` e o componente) permanece intacto.

- [ ] **Step 8: Atualizar `AGENTS.md` raiz**

Três edições:

1. No bloco STRUCTURE, a linha:

```text
├── src/              # React SPA (built into public/)
```

vira:

```text
├── src/              # React SPA: app/ (rotas+navegacao), features/<dominio>/, components/ (ui, shared, layout), lib/ (api, formatting, storage), hooks/
```

1. Na tabela WHERE TO LOOK, as linhas:

```markdown
| Add frontend page | `src/pages/*.tsx` + `src/App.tsx` |
| Shared UI component | `src/components/ui/*.tsx` |
```

viram:

```markdown
| Add frontend page | `src/features/<dominio>/pages/*.tsx` + registro em `src/app/routes.tsx` |
| Shared UI component | `src/components/ui/*.tsx` (primitivos) + `src/components/shared/*.tsx` (compartilhados entre features) |
```

1. Na seção CONVENTIONS, a linha:

```markdown
- **Hash-based routing** uses `useHashRoute` and manual dispatch in `App.tsx`.
```

vira:

```markdown
- **Hash-based routing**: única fonte em `src/app/routes.tsx` (match + render + nav), dispatch em `src/app/App.tsx` via `useHashRoute`; sem React Router.
```

- [ ] **Step 9: Grep residual de caminhos antigos em código ativo**

```bash
grep -rn "@/pages/\|src/pages/" src tests scripts --include="*.ts" --include="*.tsx" --include="*.mjs" || echo "LIMPO"
grep -rn "@/components/quotation/\|@/components/communication/" src --include="*.tsx" --include="*.ts" || echo "LIMPO2"
```

Expected: `LIMPO` e `LIMPO2`.
Ocorrências em `docs/superpowers/**` históricos são esperadas e NÃO devem ser tocadas.

- [ ] **Step 10: Verificação final completa**

```bash
find api -name '*.js' -delete
find api -name '*.js.map' -delete
npm run check
npm run test:unit
npx playwright test
node scripts/check-no-legacy-provider.mjs
```

Expected:

- `npm run check` verde.
- `npm run test:unit` verde: 689 + 8 novos (match-route) = 697 pass, 29 skips PG.
- Playwright: 89/89 verde.
- `check-no-legacy-provider.mjs` verde.

- [ ] **Step 11: Commit final**

```bash
git add -A src tests AGENTS.md
git commit -m "refactor(frontend): rotas centralizadas em app/routes.tsx (Fases 6-7)"
```

---

## Critérios de aceitação finais (auditar antes de declarar concluído)

- [ ] `src/pages/`, `src/components/communication/`, `src/components/quotation/` não existem.
- [ ] `src/app/` tem `App.tsx`, `LoginPage.tsx`, `match-route.ts`, `routes.tsx`, `navigation.ts`.
- [ ] `src/features/` tem 9 diretórios: dashboard, quotations, products, customers, crm, sales-orders, whatsapp, communication, settings.
- [ ] `src/components/shared/` tem 6 arquivos; `src/components/ui/` e `src/components/layout/` intactos.
- [ ] `src/lib/` tem `api/` (10), `formatting/` (2), `storage/` (1) e raiz com `utils.ts`, `constants.ts`, `clientMetadata.ts`, `localProjections.ts`.
- [ ] `EmptyState.tsx` e `ErrorState.tsx` removidos.
- [ ] Sidebar renderiza as mesmas 10 entradas, nas mesmas 3 seções, com os mesmos hashes (paridade visual + Playwright).
- [ ] Paridade de rotas conforme tabela da seção 5 da spec (auditar cada caso no review final).
- [ ] `npm run check`, `npm run test:unit` (697), `npx playwright test` (89), `check-no-legacy-provider.mjs` todos verdes.
- [ ] `git status --porcelain` vazio ao final (fora outputs gitignored).
