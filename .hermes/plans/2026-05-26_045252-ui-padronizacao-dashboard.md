# Padronização de UI/UX do Dashboard Aspen Orçamento — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task, with visual review after each phase.

**Goal:** Padronizar a interface do dashboard Aspen Orçamento, corrigindo inconsistências de títulos, navegação, cards, cores, estados vazios e fluxo operacional entre Orçamentos, Pedidos, CRM, Produtos, Leads e Configurações.

**Architecture:** A abordagem preserva a identidade visual atual e consolida padrões já existentes no projeto (`PageShell`, `PageHeader`, `SectionCard`, tokens `framer-*`) em vez de redesenhar o app do zero. Primeiro corrigimos estrutura global e nomenclatura, depois extraímos componentes reutilizáveis e, por fim, melhoramos fluxos operacionais de alto impacto.

**Tech Stack:** React 19, Vite, Tailwind CSS, lucide-react, Playwright, Vercel Functions.

---

## 1. Contexto atual

A auditoria combinou inspeção de código e navegação visual no dashboard publicado em:

- `https://dashboard.srv1633500.hstgr.cloud/`

Arquivos/componentes relevantes:

- `src/App.jsx`
- `src/components/layout/Sidebar.jsx`
- `src/components/layout/TopBar.jsx`
- `src/components/layout/PageShell.jsx`
- `src/components/PageHeader.jsx`
- `src/components/ui/section-card.jsx`
- `src/components/data/MetricCard.jsx`
- `src/index.css`
- `docs/design-system.md`
- `src/pages/*.jsx`

Scripts disponíveis confirmados em `package.json`:

- `npm run build`
- `npm run test:e2e`
- `npm run dev`
- `npm run dev:vercel`

---

## 2. Evidências observadas

### 2.1 Títulos e hierarquia

Observado:

- Algumas páginas têm título no conteúdo; outras dependem somente da `TopBar`.
- `AutoQuotePage.jsx` e `ManualOrcamentoPage.jsx` usam `PageShell` sem props de título.
- `TopBar.jsx` possui `PAGE_TITLES` incompleto.
- Rotas `/dashboard` e `/sales-orders` caem no fallback `Aspen Orçamento`.
- Algumas páginas de detalhe têm bom título local, mas sem breadcrumb textual.

### 2.2 Cards e superfícies

Observado:

- Existe `SectionCard`, mas a maioria das páginas usa classes manuais como:
  - `bg-card rounded-xl border border-border shadow-sm p-5`
  - `rounded-xl border border-border bg-muted/20`
  - `bg-framer-surface-1`
- Isso cria pequenas diferenças de padding, borda, sombra, raio e estado visual.

### 2.3 Cores e estados

Observado:

- Azul aparece como cor universal de destaque.
- Cores semânticas (`red`, `amber`, `green`, `blue`) são aplicadas diretamente em várias páginas.
- Não há um vocabulário central claro para `success`, `warning`, `danger`, `info`, `muted`, `primary`.

### 2.4 Navegação e nomenclatura

Observado:

- Sidebar atual mistura módulos operacionais, comerciais, catálogo e sistema no mesmo nível.
- Termos inconsistentes:
  - `Auto` vs. `Orçamento Automático`
  - `Manual` vs. `Novo Orçamento`
  - `CRM — Kanban` vs. `Pipeline CRM`
  - `Products` em inglês em uma página PT-BR
  - `Pedidos` vs. `Pedidos de Venda`
  - `Leads / Clientes` com entidades misturadas

### 2.5 Fluxo operacional

Observado:

- A relação natural `Lead/Cliente → Orçamento → Pedido de Venda → CRM/Follow-up` não fica explícita.
- Página de Pedidos de Venda tem estado vazio sem ação clara.
- CRM mistura conceitos de lead, deal e orçamento.
- Produtos funciona mais como consulta do que como gestão operacional.
- Configurações é densa e com aninhamento visual excessivo.

---

## 3. Assumptions e decisões de produto

### Assumptions

- O app deve permanecer em português brasileiro.
- O objetivo é aumentar consistência e fluidez operacional, não trocar identidade visual.
- Não adicionar novas dependências sem aprovação explícita.
- Mudanças que afetem frontend devem ser validadas com Playwright: `npm run test:e2e`.
- Não fazer deploy automático como parte deste plano sem aprovação.

### Decisões propostas

1. `PageHeader` será o padrão de cabeçalho de conteúdo para todas as páginas principais.
2. `TopBar` não deve ser a única fonte de título da página.
3. `SectionCard` deve substituir gradualmente cards manuais.
4. Sidebar deve ser organizada por grupos visuais, sem submenus inicialmente.
5. CRM deve ser tratado como `Pipeline Comercial`, não como lista genérica de leads.
6. Leads/Clientes deve ser tratado como cadastro/base de contatos.
7. Pedidos de Venda deve mostrar claramente que nasce de orçamentos aprovados.

---

## 4. Resultado esperado

Ao final da implementação:

- Todas as páginas principais terão título, descrição e ações padronizadas.
- `TopBar` não exibirá fallback incorreto em rotas conhecidas.
- Sidebar terá agrupamento mais claro por área.
- Cards e seções terão aparência consistente.
- Estados vazios terão CTA útil.
- Listagens terão filtros com padrão comum.
- CRM, Leads, Orçamentos e Pedidos terão papéis mais claros.
- O dashboard parecerá um produto coeso, não uma coleção de páginas evoluídas separadamente.

---

## 5. Fases de implementação

## Phase 1: Correções rápidas de estrutura e nomenclatura

### Task 1: Completar e robustecer títulos da TopBar

**Objective:** Evitar fallback incorreto `Aspen Orçamento` em rotas conhecidas e melhorar suporte a rotas de detalhe.

**Files:**

- Modify: `src/components/layout/TopBar.jsx`

**Acceptance criteria:**

- [ ] `/dashboard` mostra `Dashboard`.
- [ ] `/sales-orders` mostra `Pedidos de Venda`.
- [ ] Rotas de detalhe não caem em título genérico quando possível:
  - `/products/:sku` → `Produto`
  - `/quotations/:id` → `Orçamento`
  - `/sales-orders/:id` → `Pedido de Venda`
  - `/leads/:id` → `Lead / Cliente`
- [ ] Não quebra títulos existentes.

**Implementation notes:**

- Substituir acesso direto ao objeto por função semelhante a:

```js
function getPageTitle(pathname) {
  if (pathname.startsWith('/products/')) return 'Produto';
  if (pathname.startsWith('/quotations/')) return 'Orçamento';
  if (pathname.startsWith('/sales-orders/')) return 'Pedido de Venda';
  if (pathname.startsWith('/leads/')) return 'Lead / Cliente';
  return PAGE_TITLES[pathname] || 'Aspen Orçamento';
}
```

**Verification:**

- [ ] Rodar `npm run build`.
- [ ] Navegar visualmente para `/dashboard`, `/sales-orders`, `/products/LNC-SED-70`.

---

### Task 2: Padronizar nomenclatura da sidebar

**Objective:** Tornar nomes do menu mais descritivos e coerentes com as páginas.

**Files:**

- Modify: `src/components/layout/Sidebar.jsx`

**Acceptance criteria:**

- [ ] `Auto` vira `Automático` ou `Orçamento automático` conforme espaço disponível.
- [ ] `Manual` vira `Manual` somente se estiver agrupado sob Orçamentos; caso contrário, `Orçamento manual`.
- [ ] `Pedidos` vira `Pedidos de Venda` ou `Pedidos` com tooltip/contexto claro.
- [ ] `Config` vira `Configurações` se houver espaço; se permanecer abreviado, usar `aria-label` completo.
- [ ] Não reduzir legibilidade em telas estreitas.

**Suggested grouping:**

Preferir agrupamento visual sem submenu:

```text
VISÃO GERAL
Dashboard

OPERAÇÃO
Automático
Manual
Orçamentos
Pedidos

COMERCIAL
CRM
Leads

CATÁLOGO
Produtos
Frete

SISTEMA
Configurações
```

**Verification:**

- [ ] Rodar `npm run build`.
- [ ] Verificar sidebar em viewport desktop e mobile.
- [ ] Garantir que rota ativa continua destacada.

---

### Task 3: Definir cabeçalhos padrão das páginas principais

**Objective:** Garantir que todas as páginas principais tenham título local, descrição e ação primária quando aplicável.

**Files:**

- Modify: `src/pages/DashboardPage.jsx`
- Modify: `src/pages/AutoQuotePage.jsx`
- Modify: `src/pages/ManualOrcamentoPage.jsx`
- Modify: `src/pages/QuotationsPage.jsx`
- Modify: `src/pages/SalesOrdersPage.jsx`
- Modify: `src/pages/FreightPage.jsx`
- Modify: `src/pages/CrmKanbanPage.jsx`
- Modify: `src/pages/ProductsPage.jsx`
- Modify: `src/pages/LeadsPage.jsx`
- Modify: `src/pages/SettingsPage.jsx`

**Acceptance criteria:**

- [ ] Cada página tem um `PageHeader` ou uso equivalente padronizado do `PageShell`.
- [ ] Cada página tem exatamente um `h1` semântico visível ou equivalente acessível.
- [ ] Páginas com ação principal exibem CTA no header:
  - Orçamentos → `Novo orçamento`
  - Auto → `Criar orçamento automático` ou fluxo de entrada claro
  - Manual → `Criar orçamento` no resumo/rodapé do fluxo
  - Produtos → opcional `Atualizar preços`/`Novo produto` se existir ação real
  - Pedidos → `Ver orçamentos` quando vazio
- [ ] Títulos e descrições usam português consistente.

**Suggested page titles:**

| Route           | Title                        | Description                                                                    |
| --------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| `/dashboard`    | `Dashboard comercial`        | `Resumo de orçamentos, pedidos e follow-ups.`                                  |
| `/auto`         | `Criar orçamento automático` | `Cole uma mensagem ou imagem do cliente para extrair itens e gerar orçamento.` |
| `/manual`       | `Criar orçamento manual`     | `Monte o orçamento escolhendo cliente, itens e condições.`                     |
| `/quotations`   | `Orçamentos`                 | `Acompanhe orçamentos criados e continue o fluxo comercial.`                   |
| `/sales-orders` | `Pedidos de Venda`           | `Vendas confirmadas no ERPNext a partir de orçamentos aprovados.`              |
| `/freight`      | `Cotação de frete`           | `Consulte opções de entrega para um orçamento ou pedido.`                      |
| `/crm`          | `Pipeline comercial`         | `Acompanhe orçamentos enviados, follow-ups e oportunidades.`                   |
| `/products`     | `Produtos`                   | `Catálogo de SKUs e preços usados nos orçamentos.`                             |
| `/leads`        | `Leads e Clientes`           | `Base de contatos comerciais e clientes cadastrados.`                          |
| `/settings`     | `Configurações`              | `Ajuste regras, mensagens e preferências do sistema.`                          |

**Verification:**

- [ ] Rodar `npm run build`.
- [ ] Rodar `npm run test:e2e`.
- [ ] Revisar visualmente todas as rotas principais.

---

## Checkpoint 1: Estrutura básica consistente

Antes de seguir para componentes compartilhados:

- [ ] `npm run build` passa.
- [ ] `npm run test:e2e` passa.
- [ ] Todas as páginas principais têm título local.
- [ ] TopBar não mostra fallback errado para `/dashboard` e `/sales-orders`.
- [ ] Sidebar usa nomenclatura consistente.
- [ ] Andrei revisou visualmente no dashboard local/VPS antes de avançar.

---

## Phase 2: Componentes compartilhados de UI

### Task 4: Consolidar `SectionCard` como padrão de seção

**Objective:** Reduzir inconsistências de cards, bordas, padding e sombras.

**Files:**

- Modify: `src/components/ui/section-card.jsx`
- Modify gradually:
  - `src/pages/ManualOrcamentoPage.jsx`
  - `src/pages/AutoQuotePage.jsx`
  - `src/pages/FreightPage.jsx`
  - `src/pages/SettingsPage.jsx`
  - `src/pages/ProductDetailPage.jsx`

**Acceptance criteria:**

- [ ] `SectionCard` suporta `title`, `description`, `icon`, `action`, `children`.
- [ ] `SectionCard` suporta variações mínimas:
  - `default`
  - `muted`
  - `highlight`
- [ ] Páginas migradas não perdem layout ou responsividade.
- [ ] Redução de cards manuais duplicados em pelo menos Manual, Auto e Configurações.

**Implementation notes:**

- Evitar criar variações demais.
- Não alterar regras de negócio durante essa migração.
- Fazer migração por página, validando visualmente a cada passo.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Comparação visual antes/depois nas páginas migradas.

---

### Task 5: Criar componente `EmptyState`

**Objective:** Padronizar telas sem dados e sempre oferecer próxima ação útil.

**Files:**

- Create: `src/components/ui/empty-state.jsx`
- Modify:
  - `src/pages/SalesOrdersPage.jsx`
  - `src/pages/QuotationsPage.jsx`
  - `src/pages/ProductsPage.jsx`
  - `src/pages/LeadsPage.jsx`
  - `src/pages/CrmKanbanPage.jsx`

**Acceptance criteria:**

- [ ] `EmptyState` aceita `icon`, `title`, `description`, `actionLabel`, `onAction` ou `href`.
- [ ] Pedidos vazios mostram explicação e CTA para orçamentos.
- [ ] Produtos sem resultado sugerem limpar filtros ou revisar catálogo.
- [ ] Leads sem resultado sugerem criar/importar ou limpar filtros, conforme ações existentes.
- [ ] CRM coluna vazia não parece erro; mostra estado discreto.

**Suggested copy for sales orders:**

```text
Nenhum pedido de venda encontrado
Pedidos são criados a partir de orçamentos aprovados.
[Ver orçamentos]
```

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Forçar/visualizar estados vazios por filtros.

---

### Task 6: Criar padrão de filtros/listagens

**Objective:** Unificar busca, selects, períodos e ações em páginas de listagem.

**Files:**

- Create: `src/components/ui/filter-bar.jsx` or `src/components/data/FilterBar.jsx`
- Modify:
  - `src/pages/QuotationsPage.jsx`
  - `src/pages/SalesOrdersPage.jsx`
  - `src/pages/ProductsPage.jsx`
  - `src/pages/LeadsPage.jsx`
  - `src/pages/CrmKanbanPage.jsx`

**Acceptance criteria:**

- [ ] Busca tem posição e altura consistentes.
- [ ] Selects têm labels claros ou `aria-label` claro.
- [ ] Filtros genéricos como `Todos` são contextualizados:
  - `Status: Todos`
  - `Período: últimos 30 dias`
  - `Tipo: Todos`
- [ ] Botão de limpar filtros aparece quando houver filtro ativo.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Verificar listagens em desktop e mobile.

---

### Task 7: Centralizar badges/chips semânticos

**Objective:** Reduzir uso direto de `bg-red-*`, `bg-amber-*`, `bg-blue-*` e criar vocabulário visual consistente.

**Files:**

- Create or modify: `src/components/ui/badge.jsx` if existing pattern does not exist.
- Modify:
  - `src/pages/ProductDetailPage.jsx`
  - `src/pages/ManualOrcamentoPage.jsx`
  - `src/pages/ProductsPage.jsx`
  - `src/pages/CrmKanbanPage.jsx`
  - `src/pages/LeadsPage.jsx`

**Acceptance criteria:**

- [ ] Badges usam tones semânticos:
  - `success`
  - `warning`
  - `danger`
  - `info`
  - `muted`
  - `primary`
- [ ] Azul fica reservado para ação/primário/informação ativa.
- [ ] Status de preço manual, sem preço, ativo, origem e urgência seguem padrão comum.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Revisão visual em Produtos, detalhe de Produto e Manual.

---

## Checkpoint 2: Design system aplicado

- [ ] `SectionCard`, `EmptyState`, `FilterBar` e `Badge` estão em uso nos fluxos prioritários.
- [ ] Não há regressão visual evidente.
- [ ] `npm run build` passa.
- [ ] `npm run test:e2e` passa.
- [ ] Andrei valida visualmente antes das mudanças de fluxo mais profundas.

---

## Phase 3: Fluxo operacional e arquitetura de informação

### Task 8: Melhorar Orçamentos como hub operacional

**Objective:** Transformar a listagem de orçamentos no centro do fluxo comercial.

**Files:**

- Modify: `src/pages/QuotationsPage.jsx`
- Potentially modify detail page if exists:
  - `src/pages/QuotationDetailPage.jsx`

**Acceptance criteria:**

- [ ] Header tem ação principal clara para novo orçamento.
- [ ] Linhas/cards de orçamento mostram próximas ações visíveis quando aplicável:
  - Ver
  - Enviar WhatsApp
  - Criar pedido
  - Abrir CRM/deal
- [ ] Filtros contemplam status, período, cliente e origem se dados estiverem disponíveis.
- [ ] A página comunica a transição para pedido de venda.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Teste manual do fluxo: abrir orçamento → identificar ação de próximo passo.

---

### Task 9: Melhorar Pedidos de Venda

**Objective:** Deixar claro que pedidos são vendas confirmadas e normalmente nascem de orçamentos aprovados.

**Files:**

- Modify: `src/pages/SalesOrdersPage.jsx`
- Potentially modify: `src/pages/SalesOrderDetailPage.jsx`

**Acceptance criteria:**

- [ ] Título local e TopBar corretos.
- [ ] Empty state com explicação e CTA para Orçamentos.
- [ ] Filtros usam labels claros.
- [ ] Detalhe de pedido, se acessível, tem breadcrumb ou botão voltar contextual.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Visualizar página com e sem resultados.

---

### Task 10: Reposicionar CRM como Pipeline Comercial

**Objective:** Resolver conflito conceitual entre lead, deal, orçamento e follow-up.

**Files:**

- Modify: `src/pages/CrmKanbanPage.jsx`
- Possibly modify supporting API labels only if needed; avoid backend behavior changes unless required.

**Acceptance criteria:**

- [ ] Título único: `Pipeline comercial`.
- [ ] Placeholder de busca não fala apenas em lead se o card representa orçamento/deal.
- [ ] Cards mostram campos operacionais claros:
  - cliente
  - orçamento
  - valor, se disponível
  - data de envio/follow-up
  - próxima ação
- [ ] Colunas vazias têm estado discreto.
- [ ] Colunas/estágios usam nomenclatura consistente.

**Suggested stages:**

```text
Novo lead
Orçamento solicitado
Orçamento enviado
Follow-up pendente
Quente
Convertido
Perdido
```

Se os dados atuais não suportarem todos esses estágios, manter os estágios existentes mas ajustar copy e cards.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Revisão visual com dados reais no dashboard publicado/local.

---

### Task 11: Separar papel de Leads/Clientes

**Objective:** Fazer `Leads e Clientes` funcionar como base de contatos, não como pipeline duplicado.

**Files:**

- Modify: `src/pages/LeadsPage.jsx`
- Modify if needed: `src/pages/LeadDetailPage.jsx`

**Acceptance criteria:**

- [ ] Página comunica que é base de contatos.
- [ ] Tabela/lista mostra tipo, contato, origem, último orçamento e status comercial se disponíveis.
- [ ] Ações levam a próximos passos:
  - abrir contato
  - criar orçamento
  - abrir CRM/oportunidade se existir
- [ ] Abas `Todos / Leads / Clientes` usam contagens ou estados claros.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Visualizar abas e busca com dados reais.

---

### Task 12: Melhorar Produtos como catálogo operacional

**Objective:** Corrigir idioma e tornar Produtos útil para gestão/consulta de SKUs e preços.

**Files:**

- Modify: `src/pages/ProductsPage.jsx`
- Modify: `src/pages/ProductDetailPage.jsx`

**Acceptance criteria:**

- [ ] Remover qualquer `Products` visível em inglês.
- [ ] Listagem tem filtros por categoria/status/preço quando dados permitirem.
- [ ] Linhas têm ação visual clara (`Ver`, `Editar preços` se aplicável).
- [ ] Detalhe de produto tem breadcrumb textual: `Produtos > SKU`.
- [ ] Tabela de preços não corta coluna importante em viewport comum.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Revisar `/products` e `/products/LNC-SED-70` visualmente.

---

## Checkpoint 3: Fluxo comercial coerente

- [ ] Orçamentos, Pedidos, CRM, Leads e Produtos têm papéis distintos.
- [ ] Usuário consegue entender próximo passo sem conhecer a implementação.
- [ ] Estados vazios apontam para ação útil.
- [ ] `npm run build` passa.
- [ ] `npm run test:e2e` passa.
- [ ] Andrei valida no dashboard visualmente antes de qualquer deploy.

---

## Phase 4: Refinamento de páginas complexas

### Task 13: Reorganizar Configurações

**Objective:** Reduzir densidade e aninhamento visual da tela de configurações.

**Files:**

- Modify: `src/pages/SettingsPage.jsx`

**Acceptance criteria:**

- [ ] Configurações são agrupadas em abas ou navegação interna:
  - Extração
  - WhatsApp
  - PDF / Impressão
  - Integrações
  - Aparência
  - Sistema
- [ ] Cada configuração segue estrutura:
  - título
  - descrição curta
  - campo
  - ajuda/exemplo
- [ ] Evitar card dentro de card quando não necessário.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Testar persistência de configurações no `localStorage`.

---

### Task 14: Adicionar breadcrumbs em páginas de detalhe

**Objective:** Melhorar contexto em páginas internas e reduzir dependência de botão voltar.

**Files:**

- Create if useful: `src/components/ui/breadcrumb.jsx`
- Modify:
  - `src/pages/ProductDetailPage.jsx`
  - `src/pages/QuotationDetailPage.jsx`
  - `src/pages/SalesOrderDetailPage.jsx`
  - `src/pages/LeadDetailPage.jsx`

**Acceptance criteria:**

- [ ] Detalhes exibem breadcrumb textual no topo.
- [ ] Botão `Voltar` continua disponível quando útil.
- [ ] Breadcrumb não duplica informação de forma pesada.

**Examples:**

```text
Produtos > LNC-SED-70
Orçamentos > ORC-2026XXXX
Pedidos de Venda > SO-XXXX
Leads e Clientes > Nome do cliente
```

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Navegar para cada detalhe e voltar.

---

### Task 15: Revisão responsiva e acessibilidade básica

**Objective:** Garantir que a padronização não prejudique mobile, teclado e leitores de tela.

**Files:**

- Modify as needed across `src/pages/*.jsx` and `src/components/**/*.jsx`.

**Acceptance criteria:**

- [ ] Toda ação por ícone tem `aria-label`.
- [ ] Inputs/selects têm label visível ou `aria-label` claro.
- [ ] Sidebar mobile abre/fecha corretamente.
- [ ] Tabelas críticas têm tratamento responsivo aceitável.
- [ ] Contraste de badges e botões permanece legível em modo claro e escuro.

**Verification:**

- [ ] `npm run build`.
- [ ] `npm run test:e2e`.
- [ ] Revisão manual em viewport desktop, tablet e mobile.
- [ ] Testar tema claro/escuro.

---

## 6. Testes e validação final

### Validação técnica obrigatória

Executar:

```bash
npm run build
npm run test:e2e
```

Se a mudança tocar funções serverless ou integração com ERPNext, executar também:

```bash
node test_local.mjs
```

### Validação visual obrigatória

Rodar localmente:

```bash
npm run dev
```

Ou, quando necessário para endpoints Vercel:

```bash
npm run dev:vercel
```

Revisar visualmente:

- `/dashboard`
- `/auto`
- `/manual`
- `/quotations`
- `/sales-orders`
- `/freight`
- `/crm`
- `/products`
- `/products/LNC-SED-70`
- `/leads`
- `/settings`

### Critérios de aceite globais

- [ ] Nenhuma página principal sem título local.
- [ ] Nenhuma rota principal com TopBar genérica incorreta.
- [ ] Sidebar com nomes coerentes.
- [ ] Cards principais padronizados.
- [ ] Estados vazios com próxima ação.
- [ ] Filtros com labels claros.
- [ ] Fluxo Orçamento → Pedido → CRM mais claro.
- [ ] Build e Playwright passam.
- [ ] Andrei aprova visualmente antes de merge/deploy.

---

## 7. Riscos e mitigação

| Risk                                                  | Impact | Mitigation                                                                     |
| ----------------------------------------------------- | -----: | ------------------------------------------------------------------------------ |
| Migrar muitos cards de uma vez gerar regressão visual |   Alto | Migrar por página e validar visualmente após cada grupo                        |
| `PageHeader` duplicar informação com TopBar           |  Médio | Definir papel: TopBar global, PageHeader conteúdo                              |
| Sidebar agrupada ocupar espaço demais                 |  Médio | Usar labels de grupo discretas e manter sem submenus inicialmente              |
| CRM depender de campos que a API não retorna          |   Alto | Primeiro ajustar copy e layout com dados existentes; só depois avaliar backend |
| Playwright quebrar por mudanças de texto              |  Médio | Atualizar specs intencionalmente quando textos mudarem                         |
| Configurações perder persistência localStorage        |   Alto | Testar manualmente salvar/recarregar configurações                             |

---

## 8. Open questions para Andrei

1. Preferência de nome para o CRM: `Pipeline comercial`, `CRM comercial` ou `Follow-up de orçamentos`?
2. Sidebar deve mostrar grupos textuais ou manter lista plana com nomes melhores?
3. Em Produtos, deve existir ação de gestão (`Editar produto`) ou apenas gestão de preços?
4. Leads e Clientes devem continuar na mesma tela ou futuramente separar em duas rotas?
5. Pedidos de Venda deve permitir criação manual, ou sempre nascer de orçamento aprovado?

---

## 9. Ordem recomendada de execução

1. Phase 1 completa: títulos, sidebar e headers.
2. Validar visualmente com Andrei.
3. Phase 2: componentes compartilhados (`SectionCard`, `EmptyState`, `FilterBar`, `Badge`).
4. Validar visualmente com Andrei.
5. Phase 3: fluxo comercial, começando por Orçamentos/Pedidos e depois CRM.
6. Phase 4: Configurações, breadcrumbs e acessibilidade.
7. Build + Playwright final.
8. Revisão visual no dashboard da VPS.
9. Só depois: merge/push/deploy conforme aprovação.

---

## 10. Fora de escopo neste plano

- Redesenho completo da identidade visual.
- Alterações profundas no backend ERPNext/Frappe CRM.
- Novas dependências de UI.
- Deploy automático.
- Mudanças na geração de PDF.
- Reestruturação completa de dados do CRM sem validar campos disponíveis.
