# AGENTS.md — `src/` (Aspen Frontend)

## OVERVIEW

React 19 + Vite 6 SPA: páginas por feature, componentes shadcn-style, hooks de roteamento/hash e libs puras.

## STRUCTURE

```
src/
├── main.tsx              # entry React (StrictMode)
├── index.css             # CSS variables do design system Framer
├── app/                  # shell: App.tsx (dispatch), routes.tsx (tabela única de rotas),
│                         #   navigation.ts (sidebar derivado), match-route.ts (matchers),
│                         #   LoginPage.tsx (full-screen, sem Layout)
├── features/             # páginas e componentes por domínio: <dominio>/{pages,components}/*.tsx
│                         #   (dashboard, quotations, products, customers, crm, sales-orders,
│                         #    whatsapp, communication, settings)
├── components/
│   ├── layout/           # Layout, Sidebar, TopBar (tsx)
│   ├── ui/               # button, input, badge, table, back-button (tsx) — primitivos
│   └── shared/           # PageHeader, PageLoader, Skeleton*, ConfirmDialog (tsx) — entre features
├── hooks/                # useHashRoute, useDarkMode, useExtractionDrafts, useImageInput (tsx)
├── lib/                  # helpers puros (ts)
│   ├── api/              # api, communicationApi, whatsappFlows, productCache, settingsApi, etc.
│   ├── formatting/       # formatters, printFormats
│   ├── storage/          # autoQuoteDraftStorage
│   └── *.ts              # utils, constants, clientMetadata, localProjections (cross-feature)
└── types/                # api, domain, index (ts)
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Adicionar página | `src/features/<dominio>/pages/*.tsx` + registro em `src/app/routes.tsx` |
| Adicionar rota | `src/app/routes.tsx` (entrada em `routes[]`: match + render) |
| Componente UI reutilizável | `src/components/ui/*.tsx` (primitivos) + `src/components/shared/*.tsx` (entre features) |
| Layout / sidebar / topbar | `src/components/layout/*.tsx` (sidebar derivado de `src/app/navigation.ts`) |
| Tela de comunicação WhatsApp | `src/features/communication/pages/ComunicacaoPage.tsx` + `src/features/communication/components/*.tsx` |
| Chamadas API do frontend | `src/lib/api/api.ts` |
| API de comunicação (WhatsApp) | `src/lib/api/communicationApi.ts` |
| Fluxos WhatsApp (KV + fallback) | `src/lib/api/whatsappFlows.ts` |
| Cache de produtos (TTL 5min) | `src/lib/api/productCache.ts` |
| Metadados cliente (CNPJ/endereço) | `src/lib/clientMetadata.ts` |
| Formatadores (moeda/data/fone) | `src/lib/formatting/formatters.ts` |
| Constantes do pipeline CRM | `src/lib/constants.ts` |

## CONVENTIONS

- Rotas são **hash-based**: `window.location.hash = '#/comunicacao'`.
- Rota padrão (`#/` ou desconhecida) → `AutoQuotePage` (fallback em `src/app/App.tsx`).
- Página de login (`#/login`) é full-screen, sem `Layout` (`layout: false` na rota).
- Roteamento: tabela única em `src/app/routes.tsx` (match/render/suspense/layout/nav); dispatch em `src/app/App.tsx` via `useHashRoute`; sem React Router.
- `Layout` injeta ações no `TopBar` via `SetTopBarActionsCtx`.
- Componentes UI usam `class-variance-authority` + `cn()` (`src/lib/utils.ts`).
- Cores seguem o design system Framer via CSS variables (`page`, `surface`, `shell`, `fg`, `line`, `on-solid`).
- `dark` class no `<html>` alterna tema claro/escuro; persistido em `aspen_theme`.
- localStorage: `aspen_theme`, `aspen_drafts`, `aspen_active_print_format`, `aspen_wa_flows*`.

## ANTI-PATTERNS / NOTES

- Não use React Router; toda navegação passa por `useHashRoute`.
- Não adicione estado global; prefira `useState` local + contexto só para ações do TopBar.
- Não duplique rotas fora de `src/app/routes.tsx`; páginas novas entram em `features/<dominio>/pages/`.
- `public/index.html` é output do Vite; não edite diretamente.
- `ComunicacaoPage` consome `src/lib/api/communicationApi.ts` e os subcomponents em `features/communication/components/`.
