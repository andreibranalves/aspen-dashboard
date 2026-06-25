# AGENTS.md — `src/` (Aspen Frontend)

## OVERVIEW

React 19 + Vite 6 SPA: páginas, componentes shadcn-style, hooks de roteamento/hash e libs puras.

## STRUCTURE

```
src/
├── main.jsx              # entry React (StrictMode)
├── App.jsx               # roteador manual hash-based (15 rotas)
├── index.css             # CSS variables do design system Framer
├── pages/                # 15 páginas (ver WHERE TO LOOK)
├── components/
│   ├── layout/           # Layout, Sidebar, TopBar
│   ├── ui/               # button, input, badge, table, back-button
│   ├── communication/    # subviews da ComunicacaoPage (WhatsApp mídia/fluxos)
│   └── *.jsx             # componentes feature/shared
├── hooks/                # useHashRoute, useDarkMode, useExtractionDrafts, useImageInput
└── lib/                  # helpers puros (api, formatters, whatsappFlows, etc.)
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Adicionar página | `src/pages/*.jsx` + `src/App.jsx` |
| Adicionar rota | `src/App.jsx` (`renderPage`) |
| Componente UI reutilizável | `src/components/ui/*.jsx` |
| Layout / sidebar / topbar | `src/components/layout/*.jsx` |
| Tela de comunicação WhatsApp | `src/pages/ComunicacaoPage.jsx` + `src/components/communication/*.jsx` |
| Chamadas API do frontend | `src/lib/api.ts` |
| API de comunicação (WhatsApp) | `src/lib/communicationApi.ts` |
| Fluxos WhatsApp (KV + fallback) | `src/lib/whatsappFlows.ts` |
| Cache de produtos (TTL 5min) | `src/lib/productCache.ts` |
| Metadados cliente (CNPJ/endereço) | `src/lib/clientMetadata.ts` |
| Formatadores (moeda/data/fone) | `src/lib/formatters.js` |
| Constantes do pipeline CRM | `src/lib/constants.js` |

## CONVENTIONS

- Rotas são **hash-based**: `window.location.hash = '#/comunicacao'`.
- Rota padrão (`#/` ou desconhecida) → `AutoQuotePage`.
- Página de login (`#/login`) é full-screen, sem `Layout`.
- `Layout` injeta ações no `TopBar` via `SetTopBarActionsCtx`.
- Componentes UI usam `class-variance-authority` + `cn()` (`src/lib/utils.js`).
- Cores seguem o design system Framer via CSS variables (`page`, `surface`, `shell`, `fg`, `line`, `on-solid`).
- `dark` class no `<html>` alterna tema claro/escuro; persistido em `aspen_theme`.
- localStorage: `aspen_theme`, `aspen_drafts`, `aspen_active_print_format`, `aspen_wa_flows*`.

## ANTI-PATTERNS / NOTES

- Não use React Router; toda navegação passa por `useHashRoute`.
- Não adicione estado global; prefira `useState` local + contexto só para ações do TopBar.
- Não quebre a convenção de roteamento manual no `App.jsx` (switch + `startsWith` para detalhes).
- `public/index.html` é output do Vite; não edite diretamente.
- `ComunicacaoPage` consome `src/lib/communicationApi.ts` e os subcomponents em `components/communication/`.
