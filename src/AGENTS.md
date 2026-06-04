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
├── main.jsx                         # Entry point React (StrictMode)
├── App.jsx                          # Router manual (hash) com 15 páginas
├── index.css                        # CSS variables + Tailwind (Framer design system)
├── hooks/
│   ├── useHashRoute.js              # Roteamento custom (sem React Router)
│   ├── useDarkMode.js               # Dark mode (persiste em localStorage)
│   ├── useExtractionDrafts.js       # Gerenciamento de rascunhos de extração
│   └── useImageInput.js             # Input de imagem (paste, drag-drop, FileReader)
├── lib/
│   ├── api.js                       # Fetch wrapper (GET/POST/PUT/DELETE + 401 redirect)
│   ├── constants.js                 # Constantes (pipeline CRM, APP_NAME, APP_VERSION)
│   ├── formatters.js                # Formatação de moeda, data, telefone, saudação
│   ├── utils.js                     # cn() utility (clsx + tailwind-merge)
│   ├── printFormats.js              # Opções de formato de impressão (localStorage)
│   ├── whatsappFlows.js             # Helpers de fluxo WhatsApp (Vercel KV + localStorage fallback)
│   ├── clientMetadata.js            # Validação CNPJ, endereço, lead source
│   ├── erpLinks.js                  # URLs para ERPNext
│   └── productCache.js              # Cache in-memory TTL 5min para busca de produtos
├── components/
│   ├── layout/
│   │   ├── Layout.jsx               # Layout principal (Sidebar + TopBar + conteúdo)
│   │   ├── Sidebar.jsx              # Sidebar de navegação
│   │   └── TopBar.jsx               # Top bar com breadcrumb/ações
│   ├── ui/
│   │   ├── badge.jsx                # Badge (shadcn-style, cva + cn)
│   │   ├── button.jsx               # Button (shadcn-style, 6 variants, rounded-full)
│   │   ├── input.jsx                # Input (shadcn-style, rounded-[10px])
│   │   └── table.jsx                # Table (shadcn-style)
│   ├── PageHeader.jsx               # Cabeçalho de página reutilizável
│   ├── EmptyState.jsx               # Estado vazio padronizado
│   ├── ErrorState.jsx               # Estado de erro com retry
│   ├── ConfirmDialog.jsx            # Modal de confirmação (Lucide + backdrop)
│   ├── WhatsAppSendPanel.jsx        # Seletor de fluxo + botão de envio WhatsApp
│   ├── SplitResultCard.jsx          # Card de resultado no split panel (AutoQuote)
│   ├── DraftReviewCard.jsx          # Card de revisão de rascunho
│   ├── DraftItemTable.jsx           # Tabela de itens do rascunho
│   ├── CustomerMetadataForm.jsx     # Formulário de metadados do cliente
│   ├── DetailDrawer.jsx             # Drawer de detalhes
│   ├── ContextActions.jsx           # Ações contextuais
│   ├── QualityBadges.jsx            # Badges de qualidade
│   ├── StatusBadge.jsx              # Badge de status (por status do orçamento)
│   ├── Skeleton.jsx                 # Skeleton genérico (animate-pulse)
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
    ├── LeadDetailPage.jsx           # #/leads/:tipo/:id
    ├── SettingsPage.jsx             # #/settings
    └── LoginPage.jsx                # #/login (full-screen, sem Layout)
```

## Estado & Persistência

- **90% `useState` local** — cada página gerencia seu próprio estado (data, loading, error)
- **API fetch** via `lib/api.js` — wrapper com redirect 401 automático
- **localStorage**: tema (`aspen_theme`), rascunhos (`aspen_drafts`), formato de impressão (`aspen_active_print_format`)
- **Vercel KV** (primário) + localStorage (fallback): fluxos WhatsApp (`aspen_wa_flows*`)
- **In-memory cache**: `productCache.js` — `Map` com TTL 5min para busca de produtos
- **Sem React Context** (exceto `SetTopBarActionsCtx` no Layout para injeção de ações na TopBar)

## Resumo

| Categoria | Contagem |
|-----------|---------|
| Páginas | 15 |
| Hooks | 4 |
| Libs (pure JS) | 9 |
| Componentes | 20 (4 UI + 4 layout + 4 skeleton + 8 feature) |

## Convenções

- Componentes UI seguem padrão **shadcn** (`class-variance-authority` + `cn()`)
- **Sem code splitting** — todas as páginas no bundle principal
- Roteamento **hash-based**: `window.location.hash = '#/quotations'`
- Fallback: rota não encontrada redireciona para `/quotations`
- Cores Framer via CSS variables no `:root` + `.dark` override
- Dark mode controlado por classe `.dark` no `<html>` + localStorage

## Páginas (15)

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
| `/leads/:tipo/:id`    | LeadDetailPage         |
| `/settings`           | SettingsPage           |
| `/login`              | LoginPage (full-screen, sem Layout) |
