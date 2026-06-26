# Design: Otimização do bundle frontend + code-splitting

## 1. Objetivo e escopo

Reduzir o chunk JavaScript inicial do Aspen Dashboard, adiar o carregamento de páginas e bibliotecas não críticas, e estabilizar o cache de dependências de terceiros — sem adicionar novas dependências e sem mudar a arquitetura de rotas manual/hash-based.

**Dentro do escopo:**

- Introduzir `React.lazy` + `Suspense` para code-splitting por página.
- Configurar `rollupOptions.output.manualChunks` no Vite para agrupar vendors (React, utilitários UI).
- Mover bibliotecas pesadas/usadas em poucas telas para chunks separados (ex.: `@vercel/blob` na Comunicação).
- Limpar assets antigos gerados em `public/assets/` sem quebrar arquivos estáticos manuais (`dashboard-old.html`, etc.).
- Medir o impacto antes/depois com `npm run build` e `npx vite-bundle-visualizer`.

**Fora do escopo (não-objetivos):**

- Não trocar React Router ou reescrever o roteamento manual/hash-based.
- Não adicionar bibliotecas de carregamento progressivo, service workers ou SSR.
- Não otimizar imagens/ícones individuais (fora do escopo deste design).
- Não remover ou substituir dependências sem aprovação explícita.
- Não alterar contratos de API.

---

## 2. Contexto e bundle atual

### 2.1 Build de referência (baseline)

Comando: `npm run build` (Vite 6.4.2, modo production).

| Chunk | Tamanho bruto | Gzip |
|---|---|---|
| `public/assets/index-*.js` | **517 kB** | **141 kB** |
| `public/assets/index-*.css` | **42 kB** | **8,5 kB** |
| `public/index.html` | 0,49 kB | 0,32 kB |

> Vite emite warning: *"Some chunks are larger than 500 kB after minification"*.

Todo o JavaScript da aplicação está em **um único chunk**. Qualquer navegação inicial carrega páginas e bibliotecas que o usuário pode nunca abrir (CRM Kanban, Comunicação, Configurações, detalhes, etc.).

### 2.2 Maiores módulos por tamanho renderizado (vite-bundle-visualizer)

| Módulo | Tamanho renderizado | Gzip | Observação |
|---|---|---|---|
| `react-dom/cjs/react-dom-client.production.js` | 553 kB | 95 kB | Essencial; deve ir para vendor cacheável |
| `tailwind-merge/dist/bundle-mjs.mjs` | 72 kB | 12 kB | Grande para o que faz; agrupar em vendor UI |
| `src/pages/LeadsPage.tsx` | 58 kB | 9,2 kB | Candidato a lazy |
| `src/pages/ManualOrcamentoPage.tsx` | 56 kB | 8,8 kB | Candidato a lazy |
| `@vercel/blob/dist/chunk-*.js` | 41 kB | 10 kB | Só usado em `ComunicacaoPage` |
| `src/pages/LeadDetailPage.tsx` | 35 kB | 6,6 kB | Candidato a lazy |
| `src/pages/AutoQuotePage.tsx` | 31 kB | 6,6 kB | Página padrão; pode ficar eager |
| `src/pages/QuotationsPage.tsx` | 27 kB | 5,2 kB | Candidato a lazy |
| `src/pages/QuotationDetailPage.tsx` | 25 kB | 5,1 kB | Candidato a lazy |
| `src/components/SplitResultCard.tsx` | 24 kB | 4,4 kB | Só usado em `AutoQuotePage` |
| `src/pages/ProductDetailPage.tsx` | 24 kB | 5,0 kB | Candidato a lazy |
| `src/components/communication/FlowEditorTab.tsx` | 24 kB | 4,4 kB | Só usado em `ComunicacaoPage` |

Outros destaques:

- `react` + `scheduler` somam ~30 kB renderizados.
- `lucide-react` aparece como centenas de arquivos pequenos (tree-shaking por ícone funciona bem), mas o total de ícones usados é significativo.
- `clsx` e `class-variance-authority` são pequenos, mas compartilhados com `tailwind-merge` no caminho crítico de UI.

### 2.3 Roteamento atual

`src/App.tsx` importa todas as páginas de forma síncrona e faz dispatch manual pelo hash (`useHashRoute`). Não usa React Router, o que simplifica a adoção de `React.lazy`: basta transformar os imports de página em `lazy(() => import(...))` e envolver `renderPage` com `Suspense`.

### 2.4 Problema de assets acumulados

`vite.config.js` define `build.emptyOutDir: false` para preservar arquivos não-gerados (ex.: `public/dashboard-old.html`). O efeito colateral é que `public/assets/` acumula dezenas de arquivos `index-*.js` e `index-*.css` de builds antigos. Isso polui deploys e dificulta leitura do output.

---

## 3. Abordagens consideradas

### Abordagem A — Code-splitting por rota + vendors cacheáveis (recomendada)

Usar `React.lazy` para páginas e `manualChunks` para separar React e utilitários UI em chunks cacheáveis.

**Mudanças:**
- Transformar imports de páginas em `React.lazy` em `src/App.tsx`.
- Adicionar `Suspense` com fallback leve no `App`.
- Configurar `rollupOptions.output.manualChunks` em `vite.config.js`.
- Limpar assets antigos antes do build via script npm `prebuild`.

**Prós:**
- Reduz chunk inicial em ~150–200 kB bruto (estimativa conservadora), acelerando first paint e TTI.
- Vendors raramente mudados ficam cacheáveis entre deploys.
- Bibliotecas de nicho (`@vercel/blob`) só carregam quando a tela é acessada.
- Zero dependências novas.
- Mínima mudança arquitetural: mantém roteamento manual/hash-based.

**Contras:**
- Navegação para uma página lazy gera uma requisição extra de JS (aceitável em HTTP/2).
- Risco de flash de fallback se o loader de página for pesado.
- Requer cuidado com TypeScript e tipos de componentes lazy.

### Abordagem B — Apenas `manualChunks`, sem lazy loading de páginas

Manter todas as páginas eager, mas separar React e utilitários em vendors.

**Prós:**
- Menor risco de regressão.
- Nenhuma requisição extra na navegação entre páginas.

**Contras:**
- Não resolve o problema principal: usuário baixa todas as páginas no primeiro acesso.
- Ganho limitado (~150 kB no máximo).

### Abordagem C — Code-splitting granular por abas/widgets

Dividir além das páginas: lazy-load abas de `ComunicacaoPage`, drawer de `LeadsPage`, etc.

**Prós:**
- Potencial de redução ainda maior no primeiro carregamento.

**Contras:**
- Complexidade desnecessária para a primeira rodada.
- Risco de muitos chunks pequenos e múltiplas requisições.
- Requer refatoração de componentes internos.

**Decisão:** adotar **Abordagem A — code-splitting por rota + vendors cacheáveis**. É o melhor custo-benefício para o estado atual da aplicação.

---

## 4. Componentes e arquivos

### 4.1 `src/App.tsx`

Transformar imports de página em `React.lazy`. Exemplo:

```tsx
import { Suspense, lazy } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';

// Páginas que devem ser carregadas eager (padrão + login)
import AutoQuotePage from '@/pages/AutoQuotePage';
import LoginPage from '@/pages/LoginPage';

// Páginas lazy
const DashboardPage = lazy(() => import('@/pages/DashboardPage'));
const QuotationsPage = lazy(() => import('@/pages/QuotationsPage'));
const QuotationDetailPage = lazy(() => import('@/pages/QuotationDetailPage'));
const SalesOrdersPage = lazy(() => import('@/pages/SalesOrdersPage'));
const SalesOrderDetailPage = lazy(() => import('@/pages/SalesOrderDetailPage'));
const CrmKanbanPage = lazy(() => import('@/pages/CrmKanbanPage'));
const ProductsPage = lazy(() => import('@/pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('@/pages/ProductDetailPage'));
const LeadsPage = lazy(() => import('@/pages/LeadsPage'));
const LeadDetailPage = lazy(() => import('@/pages/LeadDetailPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ManualOrcamentoPage = lazy(() => import('@/pages/ManualOrcamentoPage'));
const ComunicacaoPage = lazy(() => import('@/pages/ComunicacaoPage'));
```

Manter `AutoQuotePage` eager porque é a rota padrão (`default` do switch). `LoginPage` também fica eager por ser tela de autenticação pequena e crítica.

### 4.2 `src/components/PageLoader.tsx` (novo)

Fallback leve para `Suspense`, sem adicionar dependências. Pode ser um spinner CSS simples ou reutilizar `Skeleton` existente. Sugestão mínima:

```tsx
export default function PageLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center text-fg-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-primary" />
    </div>
  );
}
```

> Pode-se evitar criar novo arquivo e usar um loader inline em `App.tsx` se preferir menor superfície.

### 4.3 `vite.config.js`

Adicionar `build.rollupOptions.output.manualChunks`:

```js
export default defineConfig({
  plugins: [react()],
  resolve: { /* ... */ },
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor';
          }
          if (/node_modules\/(tailwind-merge|clsx|class-variance-authority)\//.test(id)) {
            return 'ui-vendor';
          }
          if (/node_modules\/lucide-react\//.test(id)) {
            return 'icons';
          }
        },
      },
    },
  },
  // ...
});
```

**Notas sobre a escolha de chunks:**
- `react-vendor` separa a maior dependência do bundle e a torna cacheável entre deploys.
- `ui-vendor` isola `tailwind-merge` (72 kB renderizados), reduzindo o chunk de entrada.
- `icons` separa os ícones do Lucide. Como são usados em praticamente todas as páginas, manter em um chunk próprio melhora cache e evita duplicação entre páginas lazy. Se o time preferir menos requisições iniciais, pode-se remover o grupo `icons` e deixar os ícones no chunk de entrada.

### 4.4 `package.json`

Adicionar script `prebuild` para limpar assets antigos antes de gerar novos:

```json
{
  "scripts": {
    "prebuild": "rm -f public/assets/index-*.js public/assets/index-*.css public/assets/index-*.js.map public/assets/index-*.css.map",
    "build": "vite build"
  }
}
```

Isso preserva arquivos estáticos manuais em `public/` (incluindo `dashboard-old.html`) e evita acúmulo de builds anteriores. Arquivos como imagens/favicons em `public/` não são afetados.

---

## 5. Estratégia de code-splitting

### 5.1 Princípios

1. **Uma página = um chunk.** Cada rota do hash vira `React.lazy`, gerando um chunk dinâmico automaticamente.
2. **Shell fica no chunk inicial.** `Layout`, `Sidebar`, `TopBar`, `useHashRoute`, `api`, `formatters` e a página padrão (`AutoQuotePage`) permanecem eager.
3. **Vendors separados e cacheáveis.** React/DOM/scheduler e utilitários UI vão para chunks próprios.
4. **Bibliotecas de nicho seguem a página.** `@vercel/blob` será puxado para o chunk de `ComunicacaoPage` porque só ela o importa.
5. **Evitar micro-chunks.** Não lazy-loadar componentes internos de páginas na primeira rodada.

### 5.2 Divisão esperada após implementação

| Chunk | Conteúdo | Estratégia |
|---|---|---|
| `index-*.js` | Entry, `App`, `Layout`, `AutoQuotePage`, `LoginPage`, utilitários compartilhados | Eager |
| `react-vendor-*.js` | react, react-dom, scheduler | `manualChunks` |
| `ui-vendor-*.js` | tailwind-merge, clsx, class-variance-authority | `manualChunks` |
| `icons-*.js` | lucide-react (ícones + factory) | `manualChunks` (opcional) |
| `DashboardPage-*.js` | DashboardPage | Lazy |
| `QuotationsPage-*.js` | QuotationsPage | Lazy |
| `QuotationDetailPage-*.js` | QuotationDetailPage | Lazy |
| `SalesOrdersPage-*.js` | SalesOrdersPage | Lazy |
| `SalesOrderDetailPage-*.js` | SalesOrderDetailPage | Lazy |
| `CrmKanbanPage-*.js` | CrmKanbanPage | Lazy |
| `ProductsPage-*.js` | ProductsPage | Lazy |
| `ProductDetailPage-*.js` | ProductDetailPage | Lazy |
| `LeadsPage-*.js` | LeadsPage + DetailDrawer, QualityBadges, ContextActions | Lazy |
| `LeadDetailPage-*.js` | LeadDetailPage | Lazy |
| `ManualOrcamentoPage-*.js` | ManualOrcamentoPage | Lazy |
| `ComunicacaoPage-*.js` | ComunicacaoPage + abas de comunicação + `@vercel/blob` | Lazy |
| `SettingsPage-*.js` | SettingsPage | Lazy |

### 5.3 Chunk inicial estimado

Sem lazy loading:
- Entry: ~517 kB bruto.

Com lazy loading + vendors separados:
- Entry: ~120–150 kB bruto (estimativa: `App` + `Layout` + `AutoQuotePage` + `LoginPage` + helpers).
- `react-vendor`: ~280 kB bruto.
- `ui-vendor`: ~75 kB bruto.
- `icons`: ~30–50 kB bruto (estimativa).

O usuário baixa ~430–480 kB no primeiro acesso (sem contar CSS), mas o cache do browser passa a reter `react-vendor`, `ui-vendor` e `icons` entre deploys que não alterem essas dependências. A carga inicial crítica (entry) é bem menor.

---

## 6. Plano de lazy-loading

### 6.1 Páginas que continuam eager

| Página | Motivo |
|---|---|
| `AutoQuotePage` | Rota padrão (`default` do switch); é o primeiro conteúdo que usuário vê. |
| `LoginPage` | Tela pequena, crítica e acessível diretamente via `#/login`. |

### 6.2 Páginas a tornar lazy

Todas as demais:

- `/dashboard` → `DashboardPage`
- `/quotations` e `/quotations/:id` → `QuotationsPage`, `QuotationDetailPage`
- `/sales-orders` e `/sales-orders/:id` → `SalesOrdersPage`, `SalesOrderDetailPage`
- `/crm` → `CrmKanbanPage`
- `/products` e `/products/:sku` → `ProductsPage`, `ProductDetailPage`
- `/leads` e `/leads/:tipo/:id` → `LeadsPage`, `LeadDetailPage`
- `/manual` → `ManualOrcamentoPage`
- `/comunicacao` → `ComunicacaoPage`
- `/settings` → `SettingsPage`

### 6.3 Suspense e fallback

Envolver a renderização de página com `Suspense`:

```tsx
function renderPage(route: string, navigate: (hash: string) => void) {
  // Login e default continuam como estão
  if (route === '/login') return <LoginPage navigate={navigate} />;
  // ...detalhes podem ser lazy ou eager, mas devem estar dentro de Suspense...

  let page: React.ReactNode;

  switch (route) {
    case '/dashboard':
      page = <DashboardPage navigate={navigate} />;
      break;
    // ...
    default:
      page = <AutoQuotePage />;
  }

  return <Suspense fallback={<PageLoader />}>{page}</Suspense>;
}
```

> Detalhes com lazy: como `route.startsWith('/quotations/')` é um branch separado, retornar `<Suspense fallback={<PageLoader />}><QuotationDetailPage ... /></Suspense>` diretamente nesse branch.

---

## 7. Configuração de chunks

### 7.1 `vite.config.js` atual

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
```

### 7.2 `vite.config.js` proposto

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  publicDir: 'static',
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-vendor';
          }
          if (/node_modules\/(tailwind-merge|clsx|class-variance-authority)\//.test(id)) {
            return 'ui-vendor';
          }
          if (/node_modules\/lucide-react\//.test(id)) {
            return 'icons';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
```

### 7.3 Script de limpeza de assets

Em `package.json`:

```json
{
  "scripts": {
    "prebuild": "rm -f public/assets/index-*.js public/assets/index-*.css public/assets/index-*.js.map public/assets/index-*.css.map",
    "build": "vite build"
  }
}
```

> Se em algum ambiente Windows for necessário executar o build, o script `prebuild` com `rm` pode falhar. Como o projeto roda em WSL/Linux e deploy na Vercel (Linux), isso é aceitável. Alternativa: criar `scripts/clean-assets.mjs` e chamá-lo no `prebuild`.

---

## 8. Testes e critérios de sucesso

### 8.1 Métricas de sucesso

| Métrica | Baseline | Meta |
|---|---|---|
| Tamanho do chunk JS inicial (`index-*.js`) | 517 kB / 141 kB gzip | ≤ 200 kB / ≤ 60 kB gzip |
| Número de chunks JS após build | 1 | ≥ 8 (entry + vendors + páginas lazy) |
| Vite chunk warning (>500 kB) | Sim | Não |
| Arquivos antigos em `public/assets/` | Dezenas | Apenas os do build atual |

### 8.2 Verificações funcionais

- `npm run build` executa sem erros.
- `npm run type-check` passa.
- `npm run lint` passa.
- `npm run test:unit` passa.
- Navegação por todas as rotas continua funcionando:
  - `/dashboard`
  - `/quotations` e `/quotations/:id`
  - `/sales-orders` e `/sales-orders/:id`
  - `/crm`
  - `/products` e `/products/:sku`
  - `/leads` e `/leads/:tipo/:id`
  - `/manual`
  - `/comunicacao`
  - `/settings`
  - `/login`
- Nenhum erro de `Suspense` cair no fallback eterno.
- Upload de mídia em Comunicação continua funcionando (verifica chunk de `@vercel/blob`).

### 8.3 Validação do bundle

Após implementação, rodar:

```bash
npm run build
npx vite-bundle-visualizer -t sunburst --open false -o /tmp/aspen-bundle-after.html
ls -lh public/assets/index-*.js public/assets/index-*.css
```

Comparar tamanhos e confirmar que `react-vendor`, `ui-vendor`, `icons` e chunks de página aparecem.

---

## 9. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Flash de conteúdo ao navegar para página lazy | Baixo/Médio | Fallback `PageLoader` leve; páginas lazy são pequenas (20–60 kB), então o delay é curto. |
| TypeScript reclamar de tipos em `React.lazy` | Baixo | Usar `lazy(() => import('@/pages/X'))` com componentes default export; tipos são inferidos. |
| Quebra de `emptyOutDir: false` ao limpar assets | Baixo | `prebuild` remove apenas `public/assets/index-*.{js,css,map}`, preservando arquivos manuais. |
| Dependência compartilhada acabar em vários chunks | Médio | `manualChunks` agrupa React e utilitários UI; ícones também agrupados para evitar duplicação. |
| Navegação offline/cache em Vercel | Baixo | Vercel serve assets com hash e cache longo; chunks lazy são carregados sob demanda. |
| `React.lazy` não funcionar bem com roteamento manual/hash | Baixo | `Suspense` funciona independentemente do roteador; basta envolver o JSX retornado. |

---

## 10. Não-objetivos (reafirmação)

- Não trocar o roteamento manual/hash-based por React Router.
- Não adicionar novas dependências (incluindo bibliotecas de loading ou bundle analyzer em `devDependencies` sem aprovação).
- Não otimizar imagens, fontes ou CSS além do que o Vite já faz.
- Não lazy-loadar componentes internos de páginas na primeira rodada.
- Não alterar backend (`api/`) ou contratos de API.
