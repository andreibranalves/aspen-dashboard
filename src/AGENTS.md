# AGENTS.md — Frontend React (Aspen Orçamento)

## Stack

- **React 19** + **Vite 6**
- **Tailwind CSS 3** + design system Framer (dark/light via `dark` class on `<html>`)
- **Sem React Router** — roteamento custom via hash (`useHashRoute` hook)
- **Alias `@` → `src/`** configurado no `vite.config.js`
- **Build output** → pasta `public/` com `emptyOutDir: false`

## Estrutura do `src/`

```
src/
├── main.jsx                         # Entry point React
├── App.jsx                          # Router manual (hash) com 13 páginas
├── index.css                        # CSS variables + Tailwind (Framer design system)
├── hooks/
│   ├── useHashRoute.js              # Roteamento custom (sem React Router)
│   └── useDarkMode.js               # Dark mode (persiste em localStorage)
├── lib/
│   ├── api.js                       # Fetch wrapper (GET/POST/PUT/DELETE)
│   ├── constants.js                 # Constantes (pipeline CRM, etc.)
│   ├── formatters.js                # Formatação de moeda, data, etc.
│   ├── utils.js                     # cn() utility (clsx + tailwind-merge)
│   ├── printFormats.js              # Opções de formato de impressão
│   └── whatsappFlows.js             # Helpers de fluxo WhatsApp (pure JS)
├── components/
│   ├── layout/
│   │   ├── Layout.jsx               # Layout principal (Sidebar + TopBar + conteúdo)
│   │   ├── Sidebar.jsx              # Sidebar de navegação
│   │   └── TopBar.jsx               # Top bar com breadcrumb/ações
│   ├── ui/
│   │   ├── badge.jsx                # Badge (shadcn-style, cva + cn)
│   │   ├── button.jsx               # Button (shadcn-style, cva + cn)
│   │   ├── input.jsx                # Input (shadcn-style, cva + cn)
│   │   └── table.jsx                # Table (shadcn-style)
│   ├── PageHeader.jsx               # Cabeçalho de página reutilizável
│   ├── Skeleton.jsx                 # Skeleton genérico
│   ├── SkeletonDetail.jsx           # Skeleton para página de detalhe
│   ├── SkeletonKanban.jsx           # Skeleton para kanban
│   └── SkeletonTable.jsx            # Skeleton para tabela
└── pages/
    ├── DashboardPage.jsx            # #/dashboard
    ├── QuotationsPage.jsx           # #/quotations (default)
    ├── QuotationDetailPage.jsx      # #/quotations/:id
    ├── AutoQuotePage.jsx            # #/auto
    ├── ManualOrcamentoPage.jsx      # #/manual
    ├── SalesOrdersPage.jsx          # #/sales-orders
    ├── SalesOrderDetailPage.jsx     # #/sales-orders/:id
    ├── FreightPage.jsx              # #/freight
    ├── ProductsPage.jsx             # #/products
    ├── ProductDetailPage.jsx        # #/products/:sku
    ├── CrmKanbanPage.jsx            # #/crm
    ├── LeadsPage.jsx                # #/leads
    └── SettingsPage.jsx             # #/settings
```

## Convenções

- Componentes UI seguem padrão **shadcn** (`class-variance-authority` + `cn()`)
- **Sem code splitting** — todas as páginas no bundle principal
- Roteamento **hash-based**: `window.location.hash = '#/quotations'`
- Fallback: rota não encontrada redireciona para `/quotations`
- Cores Framer via CSS variables no `:root` + `.dark` override
- Dark mode controlado por classe `.dark` no `<html>` + localStorage

## Páginas (13)

| Rota                  | Componente             |
|-----------------------|------------------------|
| `/dashboard`          | DashboardPage          |
| `/quotations`         | QuotationsPage (default)|
| `/quotations/:id`     | QuotationDetailPage    |
| `/auto`               | AutoQuotePage          |
| `/manual`             | ManualOrcamentoPage    |
| `/sales-orders`       | SalesOrdersPage        |
| `/sales-orders/:id`   | SalesOrderDetailPage   |
| `/freight`            | FreightPage            |
| `/products`           | ProductsPage           |
| `/products/:sku`      | ProductDetailPage      |
| `/crm`                | CrmKanbanPage          |
| `/leads`              | LeadsPage              |
| `/settings`           | SettingsPage           |
