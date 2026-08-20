# Design - Fases 6-7: Frontend por feature + rotas centralizadas

Data: 2026-08-18.
Status: deriva das Fases 6-7 (seções 11-12) da spec raiz `aspen-dashboard-plano-refatoracao.md`, já aprovada pelo usuário.

## 1. Objetivo

Implementar as Fases 6 e 7 da spec raiz:

- Fase 6: reorganizar o frontend por feature (`src/features/<dominio>/`).
- Fase 7: centralizar rotas frontend em `src/app/routes.tsx` (única fonte de rotas + navegação), mantendo hash routing sem React Router.

Esta fase é **organização física + centralização de rotas**.
Não altera comportamento, não muda assinaturas de páginas, não introduz dependências.

## 2. Escopo

Mover 57 arquivos TypeScript/TSX do frontend (`src/`), reorganizar `src/lib/` em subpastas, deletar 2 componentes mortos e reescrever o dispatch de rotas.

Ficam intactos: `src/hooks/` (4 arquivos), `src/types/` (3), `src/lib/` raiz mantém `utils.ts`, `constants.ts`, `clientMetadata.ts`, `localProjections.ts`, `src/components/ui/` (button, input, table, badge, back-button) e `src/components/layout/`.

## 3. Layout alvo

```text
src/
  app/
    App.tsx            # dispatch via routes.tsx
    LoginPage.tsx      # fora do Layout shell
    match-route.ts     # matchers puros (sem JSX, testáveis em node:test)
    routes.tsx         # tabela única de rotas (match + render + nav)
    navigation.ts      # NAV_SECTIONS derivada das rotas
  features/
    dashboard/pages/DashboardPage.tsx
    quotations/pages/{AutoQuotePage,ManualOrcamentoPage,QuotationDetailPage,QuotationsPage}.tsx
    quotations/components/{CustomerMetadataForm,DraftItemTable,DraftReviewCard,
      OrderTemplateManager,QuotationSectionsEditor,QuotationTemplateManager,
      SplitResultCard,StatusBadge,WhatsAppSendPanel}.tsx
    products/pages/{ProductsPage,ProductDetailPage}.tsx
    customers/pages/{LeadsPage,LeadDetailPage}.tsx
    customers/components/{ContextActions,DetailDrawer,QualityBadges}.tsx
    crm/pages/CrmKanbanPage.tsx
    crm/components/SkeletonKanban.tsx
    sales-orders/pages/{SalesOrdersPage,SalesOrderDetailPage}.tsx
    whatsapp/pages/WhatsAppInboxPage.tsx
    whatsapp/components/whatsapp-attachment-card.tsx
    communication/pages/ComunicacaoPage.tsx
    communication/components/{ChannelsTab,FlowEditorTab,MediaGridItem,MediaLibrary,
      MediaUploader,SendHistoryTab,SkeletonComunicacao}.tsx
    settings/pages/SettingsPage.tsx
  components/
    ui/                 # primitivos (inalterado)
    shared/             # ConfirmDialog, PageHeader, PageLoader, Skeleton, SkeletonDetail, SkeletonTable
    layout/             # Layout, Sidebar, TopBar (inalterado)
  lib/
    api/                # api, communicationApi, communicationSend, orderTemplatesApi, productCache,
                        # quotationIssueApi, quotationTemplatesApi, settingsApi, whatsappFlows, whatsappInboxApi
    formatting/         # formatters, printFormats
    storage/            # autoQuoteDraftStorage
    utils.ts, constants.ts, clientMetadata.ts, localProjections.ts   # cross-feature, ficam na raiz
  hooks/                # inalterado
  types/                # inalterado
```

## 4. Decisões

1. **`features/settings/` como 9º diretório de feature** - a spec raiz lista 8 features; SettingsPage não pertence a nenhuma delas (usa componentes de quotations via props, mas é página de configuração). Adicionar `settings/` é a resposta consistente com o domínio.
2. **AutoQuotePage e ManualOrcamentoPage em `quotations/`** - são os dois fluxos de criação de orçamento (auto-extração e manual).
3. **LoginPage em `src/app/`** - renderiza fora do Layout shell; não é feature.
4. **StatusBadge em `quotations/components/`** - usado apenas por QuotationDetailPage e QuotationsPage. `components/ui/badge.tsx` define um `StatusBadge` próprio e local (sem import), então não há conflito.
5. **CustomerMetadataForm em `quotations/components/`** - usado apenas por DraftReviewCard (fluxo de auto-orçamento).
6. **EmptyState e ErrorState deletados** - zero usos no repo (grep confirmado).
7. **`lib/` raiz mantém 4 arquivos cross-feature** - `utils` (28 usos), `constants`, `clientMetadata`, `localProjections` (7 usos em 7 páginas de features distintas). A spec só exige `api/`, `formatting/`, `storage/`.
8. **`productCache` em `lib/api/`** - cache do catálogo de produtos, usado por quotations + products + manual (cross-feature).
9. **Rotas com `render` lambdas tipadas** - nenhuma página muda de assinatura; cada entrada da tabela chama a página com as props exatas de hoje (id, sku, tipo, navigate).
10. **Matchers puros em `app/match-route.ts`** - `node --test` não transforma JSX; manter matchers sem JSX permite teste unitário direto.
11. **Sem React Router** - spec raiz: "Não é necessário introduzir React Router. O hash routing pode continuar."

## 5. Design de rotas (Fase 7)

Contrato de `src/app/routes.tsx`:

```ts
export interface RouteContext {
  navigate: (hash: string) => void;
  params: Record<string, string>;
}

export interface AppRoute {
  path: string;                                            // documentação + match exato
  match?: (route: string) => Record<string, string> | null; // default: igualdade com path
  render: (ctx: RouteContext) => ReactNode;
  suspense?: boolean;   // envolve em Suspense/PageLoader
  layout?: boolean;     // default true; false = fora do Layout (login)
  nav?: { label: string; icon: LucideIcon; section: string };
}
```

- Dispatch: primeira rota cujo `match` retorna params não-nulos vence.
- Fallback (rota desconhecida): `AutoQuotePage` sem Suspense (paridade com o `default` do switch atual).
- Ordem da tabela preserva a precedência atual: login, prefixos de detalhe (quotations, sales-orders, products, leads), estáticas, e o resto.
- `navigation.ts` deriva `NAV_SECTIONS` da tabela (mesmos hashes, labels, ícones e seções do Sidebar atual).

Paridade de comportamento (auditar no review):

| Caso | Antes | Depois |
| --- | --- | --- |
| `/quotations/` (id vazio) | QuotationDetailPage id='' | prefix match: igual |
| `/leads/x` (sem id) | cai no switch -> AutoQuotePage | matcher exige tipo && id: igual |
| `/leads/x/y/z` (id com barra) | id='y/z' | `:id*` catch-all: igual |
| `/products/new` | ProductDetailPage sku='new' | prefix: igual |
| rota desconhecida | AutoQuotePage sem Suspense | fallback: igual |
| `/login` | fora do Layout, sem Suspense | layout:false: igual |
| `/auto` | sem Suspense | sem flag suspense: igual |

## 6. Ferramenta de rewrite (extensão)

`scripts/rewrite-imports.mjs` (commitado na sessão anterior) ganha:

1. Candidates `.tsx`/`.jsx` (e `/index.tsx`) no `resolveOld` - handoff anterior já apontava.
2. Suporte a specifiers de alias `@/...` no regex de import (frontend não usa imports relativos): resolve contra `src/`, reescreve como novo alias `@/...`, preserva sufixo `.ts` e query strings.

Sem mudanças no pass de strings de caminho (`api/...`) - backend-only.

## 7. Violações de fronteira registradas (para inventário da Fase 19)

Movidas, não corrigidas:

1. `src/lib/localProjections.ts` (shared) importa tipo de `features/quotations/components/QuotationSectionsEditor` - dependência lib -> feature (type-only).
2. `scripts/test-whatsapp-flows.mjs` e `scripts/test-whatsapp-sequence.mjs` importam `src/lib/api/whatsappFlows.ts` diretamente (harnesses de teste).
3. `features/quotations/` depende de `lib/api/productCache.ts` (cache do domínio products) - cross-feature assumido como compartilhado em `lib/`.

## 8. Verificação

- `npm run check` verde (lint + type-check + tailwind + build).
- `npm run test:unit` verde (689 + 1 novo teste de matcher).
- `npx playwright test` verde (89/89) - cobre navegação real por hash.
- `node scripts/check-no-legacy-provider.mjs` verde.
- `git status --porcelain` vazio ao final.
