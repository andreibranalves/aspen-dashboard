# Bundle Optimization + Code-Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce initial JS chunk from 517 kB to ≤200 kB via React.lazy code-splitting per page + vendor chunk separation + stale asset cleanup.

**Architecture:** Transform synchronous page imports in `App.tsx` into `React.lazy(() => import(...))` with `Suspense` fallback. Configure Vite `manualChunks` to isolate React, UI utilities, and icons into cacheable vendor chunks. Add `prebuild` script to purge stale build artifacts from `public/assets/`.

**Tech Stack:** React 19 (built-in `lazy`/`Suspense`), Vite 6 `rollupOptions.output.manualChunks`, zero new dependencies.

## Global Constraints

- No new dependencies added.
- Routing stays manual hash-based (`useHashRoute`); no React Router.
- `emptyOutDir: false` preserved; `public/dashboard-old.html` and other static files must survive builds.
- `AutoQuotePage` and `LoginPage` remain eager; all other pages become lazy.
- All existing tests (`npm run test:unit`, `npm run test:e2e`, `npm run lint`, `npm run type-check`) must pass.
- Brazil Portuguese for user-facing text only; code/comments may be English.
- ESM only; `.js` imports require explicit extension in `api/`; `src/` uses `@/*` alias.
- Target: entry chunk ≤ 200 kB raw / ≤ 60 kB gzip; no Vite >500 kB chunk warning.

---

## File Structure

| File                            | Role                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `package.json`                  | Add `prebuild` script                                      |
| `vite.config.js`                | Add `rollupOptions.output.manualChunks`                    |
| `src/components/PageLoader.tsx` | New: Suspense fallback spinner                             |
| `src/App.tsx`                   | Convert page imports to `React.lazy`, wrap with `Suspense` |

---

### Task 1: Add prebuild script to clean stale assets

**Files:**

- Modify: `package.json`

**Interfaces:**

- Consumes: none
- Produces: `npm run prebuild` removes `public/assets/index-*.{js,css,map}` before each build

- [ ] **Step 1: Add prebuild script**

In `package.json`, add `"prebuild"` script before the existing `"build"` script:

```json
"prebuild": "rm -f public/assets/index-*.js public/assets/index-*.css public/assets/index-*.js.map public/assets/index-*.css.map",
```

The `scripts` block should look like:

```json
"scripts": {
    "dev": "node scripts/vite-dev.mjs",
    "dev:vercel": "vercel dev",
    "build:api": "tsc -p api/tsconfig.api.json",
    "prebuild": "rm -f public/assets/index-*.js public/assets/index-*.css public/assets/index-*.js.map public/assets/index-*.css.map",
    "build": "npm run build:api && vite build",
    ...
```

- [ ] **Step 2: Verify prebuild runs**

```bash
npm run prebuild
```

Expected: no errors, stale files removed. If `public/assets/` has no matching files, `rm -f` succeeds silently.

- [ ] **Step 3: Verify build still works**

```bash
npm run build
```

Expected: build succeeds, fresh `index-*.js` and `index-*.css` in `public/assets/`.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add prebuild script to clean stale public/assets artifacts"
```

---

### Task 2: Configure Vite manualChunks for vendor splitting

**Files:**

- Modify: `vite.config.js`

**Interfaces:**

- Consumes: none
- Produces: three vendor chunks (`react-vendor`, `ui-vendor`, `icons`) via `rollupOptions.output.manualChunks`

- [ ] **Step 1: Add rollupOptions to vite.config.js**

Replace the `build` block in `vite.config.js`:

Old:

```js
  build: {
    outDir: 'public',
    emptyOutDir: false, // preserva arquivos não-gerados (dashboard-old.html etc)
  },
```

New:

```js
  build: {
    outDir: 'public',
    emptyOutDir: false, // preserva arquivos não-gerados (dashboard-old.html etc)
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
```

Full file after change:

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
  publicDir: 'static', // assets estáticos separados do output de build
  build: {
    outDir: 'public',
    emptyOutDir: false, // preserva arquivos não-gerados (dashboard-old.html etc)
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

- [ ] **Step 2: Verify build splits vendors**

```bash
npm run build
ls public/assets/react-vendor-*.js public/assets/ui-vendor-*.js public/assets/icons-*.js
```

Expected: three vendor chunk files exist.

- [ ] **Step 3: Verify no Vite chunk warning**

Check build output. Expected: no "Some chunks are larger than 500 kB" warning.

- [ ] **Step 4: Commit**

```bash
git add vite.config.js
git commit -m "feat: configure Vite manualChunks for react-vendor, ui-vendor, icons"
```

---

### Task 3: Create PageLoader Suspense fallback component

**Files:**

- Create: `src/components/PageLoader.tsx`

**Interfaces:**

- Consumes: none
- Produces: `export default function PageLoader(): JSX.Element` — a centered spinning circle, height ~50vh, using Tailwind design tokens (`fg-muted`, `line`, `primary`)

- [ ] **Step 1: Create the component**

Create `src/components/PageLoader.tsx`:

```tsx
export default function PageLoader() {
  return (
    <div className="flex h-[50vh] items-center justify-center text-fg-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-primary" />
    </div>
  );
}
```

Zero dependencies. Uses only Tailwind CSS classes already available in the project.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/components/PageLoader.tsx 2>&1 || echo "TS check done (ignore project-level errors)"
```

Expected: no type errors in this file. (Project-level tsc may fail on other files; that's pre-existing.)

- [ ] **Step 3: Commit**

```bash
git add src/components/PageLoader.tsx
git commit -m "feat: add PageLoader Suspense fallback component"
```

---

### Task 4: Convert App.tsx to React.lazy code-splitting

**Files:**

- Modify: `src/App.tsx`

**Interfaces:**

- Consumes: `@/components/PageLoader` (Task 3), all `@/pages/*` (existing)
- Produces: `export default function App(): JSX.Element` — same behavior, lazy-loaded pages

- [ ] **Step 1: Replace imports and render logic**

Replace `src/App.tsx` entirely:

```tsx
import { Suspense, lazy } from 'react';
import { useHashRoute } from '@/hooks/useHashRoute';
import Layout from '@/components/layout/Layout';
import PageLoader from '@/components/PageLoader';

// Eager pages — rota padrão e tela de login (críticas, pequenas)
import AutoQuotePage from '@/pages/AutoQuotePage';
import LoginPage from '@/pages/LoginPage';

// Lazy pages — carregadas sob demanda ao navegar
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

function renderPage(route: string, navigate: (hash: string) => void) {
  // Login page — full screen, no layout
  if (route === '/login') return <LoginPage navigate={navigate} />;

  // Detail page: #/quotations/ORC-20261143
  if (route.startsWith('/quotations/')) {
    const id = route.split('/quotations/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <QuotationDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  // Detail page: #/sales-orders/VP-20261143
  if (route.startsWith('/sales-orders/')) {
    const id = route.split('/sales-orders/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <SalesOrderDetailPage id={id} navigate={navigate} />
      </Suspense>
    );
  }

  // Product detail page: #/products/LNC-SED-70
  if (route.startsWith('/products/')) {
    const sku = route.split('/products/')[1];
    return (
      <Suspense fallback={<PageLoader />}>
        <ProductDetailPage sku={sku} navigate={navigate} />
      </Suspense>
    );
  }

  // Lead/Customer detail page: #/leads/lead/CRM-LEAD-... or #/leads/cliente/CUST-...
  if (route.startsWith('/leads/')) {
    const parts = route.split('/');
    const tipo = parts[2];
    const id = parts.slice(3).join('/');
    if (tipo && id) {
      return (
        <Suspense fallback={<PageLoader />}>
          <LeadDetailPage tipo={tipo} id={id} navigate={navigate} />
        </Suspense>
      );
    }
  }

  let page: React.ReactNode;

  switch (route) {
    case '/dashboard':
      page = <DashboardPage navigate={navigate} />;
      break;
    case '/quotations':
      page = <QuotationsPage navigate={navigate} />;
      break;
    case '/auto':
      page = <AutoQuotePage />;
      break;
    case '/sales-orders':
      page = <SalesOrdersPage navigate={navigate} />;
      break;
    case '/crm':
      page = <CrmKanbanPage />;
      break;
    case '/products':
      page = <ProductsPage />;
      break;
    case '/leads':
      page = <LeadsPage navigate={navigate} />;
      break;
    case '/settings':
      page = <SettingsPage />;
      break;
    case '/manual':
      page = <ManualOrcamentoPage />;
      break;
    case '/comunicacao':
      page = <ComunicacaoPage />;
      break;
    default:
      page = <AutoQuotePage />;
  }

  // AutoQuotePage is eager; wrap lazy pages (all switch cases except auto/default)
  if (route === '/auto' || route === '' || route === '/') {
    return page;
  }

  return <Suspense fallback={<PageLoader />}>{page}</Suspense>;
}

export default function App() {
  const [route, navigate] = useHashRoute();

  // Login page — full screen, no sidebar
  if (route === '/login') {
    return <LoginPage navigate={navigate} />;
  }

  return (
    <Layout route={route} onNavigate={navigate}>
      {renderPage(route, navigate)}
    </Layout>
  );
}
```

Key changes from original:

1. Added `import { Suspense, lazy } from 'react'` and `import PageLoader from '@/components/PageLoader'`.
2. `AutoQuotePage` and `LoginPage` stay as direct imports (eager).
3. All other page imports become `const Name = lazy(() => import('@/pages/Name'))`.
4. Every lazy page render is wrapped in `<Suspense fallback={<PageLoader />}>`.
5. `AutoQuotePage` (the default route) is NOT wrapped in Suspense since it's eager.
6. Empty/root route falls through to default (`/auto` case), both eager.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit src/App.tsx 2>&1
```

Expected: no type errors. `React.lazy` infers types from the default export.

- [ ] **Step 3: Run lint**

```bash
npx eslint src/App.tsx src/components/PageLoader.tsx
```

Expected: no lint errors.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: build succeeds, multiple JS chunks in `public/assets/` including page-named chunks like `DashboardPage-*.js`.

- [ ] **Step 5: Verify chunk count and sizes**

```bash
ls -lh public/assets/*.js | wc -l
ls -lh public/assets/index-*.js
```

Expected: ≥ 8 JS chunks; `index-*.js` ≤ 200 kB raw.

- [ ] **Step 6: Run unit tests**

```bash
npm run test:unit
```

Expected: all pass.

- [ ] **Step 7: Run e2e tests**

```bash
npm run test:e2e
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat: convert pages to React.lazy with Suspense code-splitting"
```

---

## Execution Order

Tasks 1, 2, and 3 have NO dependencies on each other and can run in parallel. Task 4 depends on Task 3 (needs `PageLoader` component).

```
Task 1 (prebuild) ──┐
Task 2 (manualChunks) ──┼── parallel ──► Task 4 (App.tsx lazy)
Task 3 (PageLoader) ──┘
```

After all tasks complete, run full verification:

```bash
npm run build
ls -lh public/assets/
npm run lint
npm run type-check
npm run test:unit
npm run test:e2e
```
