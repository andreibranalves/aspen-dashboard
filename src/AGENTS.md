# AGENTS.md — `src/` (Aspen Frontend)

## OVERVIEW

React 19 + Vite 6 SPA: páginas, componentes shadcn-style, hooks de roteamento/hash e libs puras.

## STRUCTURE

```
src/
├── main.tsx              # entry React (StrictMode)
├── App.tsx               # roteador manual hash-based (15 rotas)
├── index.css             # CSS variables do design system Framer
├── pages/                # 15 páginas TypeScript (ver WHERE TO LOOK)
├── components/
│   ├── layout/           # Layout, Sidebar, TopBar (tsx)
│   ├── ui/               # button, input, badge, table, back-button (tsx)
│   ├── communication/    # subviews da ComunicacaoPage (WhatsApp mídia/fluxos) — tsx
│   └── *.tsx             # componentes feature/shared
├── hooks/                # useHashRoute, useDarkMode, useExtractionDrafts, useImageInput (tsx)
└── lib/                  # helpers puros (api, formatters, whatsappFlows, etc.) (ts)
```

## WHERE TO LOOK

| Task | Location |
|---|---|
| Adicionar página | `src/pages/*.tsx` + `src/App.tsx` |
| Adicionar rota | `src/App.tsx` (`renderPage`) |
| Componente UI reutilizável | `src/components/ui/*.tsx` |
| Layout / sidebar / topbar | `src/components/layout/*.tsx` |
| Tela de comunicação WhatsApp | `src/pages/ComunicacaoPage.tsx` + `src/components/communication/*.tsx` |
| Chamadas API do frontend | `src/lib/api.ts` |
| API de comunicação (WhatsApp) | `src/lib/communicationApi.ts` |
| Fluxos WhatsApp (KV + fallback) | `src/lib/whatsappFlows.ts` |
| Cache de produtos (TTL 5min) | `src/lib/productCache.ts` |
| Metadados cliente (CNPJ/endereço) | `src/lib/clientMetadata.ts` |
| Formatadores (moeda/data/fone) | `src/lib/formatters.ts` |
| Constantes do pipeline CRM | `src/lib/constants.ts` |

## CONVENTIONS

- Rotas são **hash-based**: `window.location.hash = '#/comunicacao'`.
- Rota padrão (`#/` ou desconhecida) → `AutoQuotePage`.
- Página de login (`#/login`) é full-screen, sem `Layout`.
- `Layout` injeta ações no `TopBar` via `SetTopBarActionsCtx`.
- Componentes UI usam `class-variance-authority` + `cn()` (`src/lib/utils.ts`).
- Cores seguem o design system Framer via CSS variables (`page`, `surface`, `shell`, `fg`, `line`, `on-solid`).
- `dark` class no `<html>` alterna tema claro/escuro; persistido em `aspen_theme`.
- localStorage: `aspen_theme`, `aspen_drafts`, `aspen_active_print_format`, `aspen_wa_flows*`.

## ANTI-PATTERNS / NOTES

- Não use React Router; toda navegação passa por `useHashRoute`.
- Não adicione estado global; prefira `useState` local + contexto só para ações do TopBar.
- Não quebre a convenção de roteamento manual no `App.tsx` (switch + `startsWith` para detalhes).
- `public/index.html` é output do Vite; não edite diretamente.
- `ComunicacaoPage` consome `src/lib/communicationApi.ts` e os subcomponents em `components/communication/`.
