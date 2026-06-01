# Plano de Implementação: Design System shadcn/Aspen

> **For Hermes:** Use `subagent-driven-development` somente após aprovação do Andrei, implementando tarefa por tarefa com revisão de conformidade e qualidade. Este arquivo é apenas plano; não executar alterações de código sem pedido explícito.

**Goal:** Reorganizar a UI do Aspen Orçamento para ficar homogênea, profissional e tecnicamente alinhada ao shadcn/ui, preservando a identidade visual Aspen/Framer e sem reescrever a lógica de negócio.

**Architecture:** A melhor abordagem é uma refatoração incremental em branch dedicada: primeiro configurar corretamente o shadcn no projeto atual, depois criar primitivas de layout próprias do app e só então migrar páginas por grupos. O shadcn será a fundação técnica de componentes; os tokens Aspen/Framer continuarão sendo a identidade visual.

**Tech Stack:** Vite + React + JSX, Tailwind v3, shadcn/ui CLI, Lucide React, Playwright (`npm run test:e2e`).

---

## 1. Decisão recomendada

### Recomendação principal

**Não começar um projeto do zero.**  
A base atual é recuperável e já contém muita regra de negócio crítica: integração com ERPNext, CRM, orçamentos, pedidos, produtos, WhatsApp, frete, follow-up e testes. Recomeçar em outro app criaria risco alto de regressão e retrabalho.

A rota recomendada é:

1. Criar uma branch dedicada, por exemplo `feat/design-system-shadcn`.
2. Configurar o shadcn corretamente **dentro do projeto atual**.
3. Criar uma pequena camada Aspen de componentes compostos sobre shadcn.
4. Migrar 2 páginas piloto.
5. Validar visualmente e com Playwright.
6. Expandir para o restante do app em fases.

### O que evitar

- Não rodar `shadcn init` direto sem controle, porque ele pode sobrescrever `tailwind.config.js`, `index.css` e componentes já customizados.
- Não substituir o tema Aspen por tema padrão shadcn.
- Não migrar todas as páginas de uma vez.
- Não mexer na lógica de API/ERPNext durante a refatoração visual, exceto se algum bug de UI exigir.
- Não instalar dependências novas sem aprovação explícita.

---

## 2. Contexto atual observado

### Evidências já verificadas

- Branch atual: `master`, limpa, sem alterações locais.
- O projeto é Vite + React + Tailwind v3 + JSX.
- Já existe alias `@` em `vite.config.js`, apontando para `src/`.
- Já existe `src/lib/utils.js` com `cn()`, usado por componentes shadcn/custom.
- Existem componentes em `src/components/ui/`, incluindo `button.jsx`, `input.jsx`, `badge.jsx`, `table.jsx`.
- Não existe `components.json`, então o CLI do shadcn não está formalmente inicializado.
- Não existe `jsconfig.json`/`tsconfig.json`, e a versão atual do shadcn CLI exige isso para resolver alias.
- O tema Aspen/Framer está em `src/index.css` e `tailwind.config.js`.
- `PageHeader` já existe, mas seu uso é inconsistente: algumas páginas usam, outras usam `<h1>`/`<h2>` manuais.
- Muitas páginas repetem classes de card, seção, filtro, tabela e empty state manualmente.
- O contrato correto de `PageHeader` é: `title`, `description`, `action`, `className`.

### Hipóteses/inferências

- A inconsistência visual vem menos de “falta de shadcn” e mais de falta de **primitivas próprias do app**: `PageShell`, `SectionCard`, `FilterBar`, `DataToolbar`, `EmptyState`, etc.
- Só adicionar componentes shadcn não resolve a homogeneidade se cada página continuar compondo layout do seu jeito.
- Um novo projeto do zero só faria sentido se a arquitetura atual estivesse inviável, o que não parece ser o caso.

---

## 3. Resultado esperado

Ao final da refatoração:

- O shadcn CLI funciona no projeto sem quebrar os tokens Aspen.
- O app tem uma linguagem visual consistente em páginas, cabeçalhos, cards, filtros, tabelas, dialogs e estados vazios.
- As páginas usam componentes compostos reutilizáveis, em vez de classes Tailwind repetidas.
- A identidade visual continua Aspen/Framer, não “shadcn default”.
- Build e Playwright passam após mudanças de frontend.
- A refatoração não altera comportamento de negócio: chamadas de API, regras de orçamento, ERPNext e WhatsApp continuam iguais.

---

## 4. Princípios de design e implementação

1. **shadcn como base, Aspen como produto**  
   Usar shadcn para acessibilidade, composição e padrões de componentes; usar tokens Aspen para aparência.

2. **Camada composta antes de migrar páginas**  
   Não repetir `Card`, `Button`, `Table`, `Badge` manualmente em cada página. Criar componentes próprios para padrões recorrentes.

3. **Migração incremental**  
   Primeiro 2 páginas piloto, depois replicar o padrão.

4. **Sem reescrita de lógica**  
   Cada PR/commit deve ser majoritariamente visual/estrutural. Se precisar mexer em dados, isolar e justificar.

5. **Testes obrigatórios para frontend**  
   Ao final das alterações de UI: `npm run build` e `npm run test:e2e`.

6. **Português brasileiro na UI**  
   Labels, mensagens, empty states e validações continuam em PT-BR.

7. **Lucide para ícones**  
   Não usar emoji como elemento visual em componentes.

---

## 5. Fases de implementação

## Fase 0 — Preparação e baseline

### Task 0.1: Criar branch dedicada

**Objetivo:** Isolar a refatoração visual da `master`.

**Comando planejado:**

```bash
git checkout -b feat/design-system-shadcn
```

**Acceptance criteria:**

- Branch criada a partir de `master` limpa.
- Nenhum arquivo modificado ainda.

**Verificação:**

```bash
git status
git branch --show-current
```

---

### Task 0.2: Rodar baseline de build e testes antes de mexer

**Objetivo:** Saber se algum teste já falha antes da refatoração.

**Comandos planejados:**

```bash
npm run build
npm run test:e2e
```

**Acceptance criteria:**

- Build passa.
- Playwright passa ou falhas pré-existentes são documentadas antes de mudar UI.

**Notas:**

- Se `test:e2e` falhar por problema pré-existente, registrar o erro no plano/commit antes de continuar.
- Não corrigir bugs fora do escopo sem aprovação, a menos que bloqueiem a própria refatoração.

---

## Fase 1 — Inicialização controlada do shadcn

### Task 1.1: Criar `components.json` manualmente

**Objetivo:** Permitir uso do shadcn CLI sem rodar `shadcn init` destrutivo.

**Arquivo a criar:**

- `components.json`

**Conteúdo proposto:**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

**Acceptance criteria:**

- Arquivo criado sem alterar `tailwind.config.js` ou `src/index.css`.
- `style` usa `new-york`.
- `tsx: false`, porque o projeto usa JSX.

**Verificação:**

```bash
node -e "JSON.parse(require('fs').readFileSync('components.json','utf8')); console.log('components.json OK')"
```

---

### Task 1.2: Criar `jsconfig.json`

**Objetivo:** Dar ao shadcn CLI e ao editor a resolução correta do alias `@/*`.

**Arquivo a criar:**

- `jsconfig.json`

**Conteúdo proposto:**

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

**Acceptance criteria:**

- `@/components`, `@/lib`, `@/hooks` continuam resolvendo.
- O arquivo não força TypeScript nem altera build.

**Verificação:**

```bash
node -e "JSON.parse(require('fs').readFileSync('jsconfig.json','utf8')); console.log('jsconfig.json OK')"
```

---

### Task 1.3: Auditar componentes UI atuais antes do CLI

**Objetivo:** Salvar mentalmente/diffar customizações Aspen antes de qualquer `npx shadcn add`.

**Arquivos a revisar:**

- `src/components/ui/button.jsx`
- `src/components/ui/input.jsx`
- `src/components/ui/badge.jsx`
- `src/components/ui/table.jsx`
- `src/index.css`
- `tailwind.config.js`

**Acceptance criteria:**

- Identificar variantes customizadas importantes, especialmente:
  - `rounded-full`
  - tokens `framer-*`
  - variante `success`, se existir
  - estados `active:scale-[0.97]`
  - estilos de input/card compatíveis com Framer

**Verificação:**

```bash
git diff -- src/components/ui/button.jsx src/components/ui/input.jsx src/index.css tailwind.config.js
```

Esperado: sem alterações nessa task.

---

### Task 1.4: Adicionar componentes shadcn faltantes em pequenos lotes

**Objetivo:** Ter os building blocks necessários para padronizar páginas.

**Componentes candidatos:**

```bash
npx shadcn@latest add card textarea select dialog tabs dropdown-menu separator skeleton alert tooltip sheet --overwrite
```

**Importante:** executar em lotes menores se o diff ficar grande:

```bash
npx shadcn@latest add card textarea separator skeleton --overwrite
npx shadcn@latest add select dialog tabs dropdown-menu alert tooltip sheet --overwrite
```

**Arquivos prováveis:**

- `src/components/ui/card.jsx`
- `src/components/ui/textarea.jsx`
- `src/components/ui/select.jsx`
- `src/components/ui/dialog.jsx`
- `src/components/ui/tabs.jsx`
- `src/components/ui/dropdown-menu.jsx`
- `src/components/ui/separator.jsx`
- `src/components/ui/skeleton.jsx`
- `src/components/ui/alert.jsx`
- `src/components/ui/tooltip.jsx`
- `src/components/ui/sheet.jsx`
- Possíveis alterações em `button.jsx`, `input.jsx`, `index.css`, `tailwind.config.js`

**Acceptance criteria:**

- Componentes adicionados em JSX, não TSX.
- Imports usam `@/lib/utils`.
- Se `button.jsx`/`input.jsx` forem sobrescritos, restaurar customizações Aspen mantendo a estrutura shadcn necessária.
- `index.css` e `tailwind.config.js` preservam tokens Framer/Aspen.

**Verificação:**

```bash
npm run build
```

**Commit sugerido:**

```bash
git add components.json jsconfig.json src/components/ui src/index.css tailwind.config.js
git commit -m "chore: configure shadcn design foundation"
```

---

## Fase 2 — Criar primitivas Aspen sobre shadcn

### Task 2.1: Criar `PageShell`

**Objetivo:** Padronizar espaçamento, largura e estrutura de página.

**Arquivo a criar:**

- `src/components/layout/PageShell.jsx`

**API proposta:**

```jsx
<PageShell>
  <PageShell.Header title="Orçamentos" description="..." action={...} />
  <PageShell.Body>...</PageShell.Body>
</PageShell>
```

ou, se preferir mais simples:

```jsx
<PageShell title="Orçamentos" description="..." action={...}>
  ...conteúdo...
</PageShell>
```

**Acceptance criteria:**

- Usa internamente `PageHeader` ou substitui gradualmente o padrão antigo.
- Define espaçamento consistente entre header, filtros e conteúdo.
- Não altera `Layout.jsx` ainda, apenas páginas que optarem por usar.

**Arquivos relacionados:**

- `src/components/PageHeader.jsx`
- `src/components/layout/PageShell.jsx`

**Verificação:**

```bash
npm run build
```

---

### Task 2.2: Criar `SectionCard`

**Objetivo:** Unificar cards/seções usados em dashboard, listas, detalhes e formulários.

**Arquivo a criar:**

- `src/components/ui/section-card.jsx`

**API proposta:**

```jsx
<SectionCard title="Filtros" description="Refine a listagem" action={<Button>Limpar</Button>}>
  ...
</SectionCard>
```

**Acceptance criteria:**

- Usa `Card`, `CardHeader`, `CardContent` do shadcn.
- Preserva visual Aspen: borda sutil, superfície Framer, radius consistente.
- Suporta casos sem título/header.

---

### Task 2.3: Criar `FilterBar` / `DataToolbar`

**Objetivo:** Padronizar barras de busca, filtros, chips e ações de tabela.

**Arquivo a criar:**

- `src/components/data/FilterBar.jsx`

**API proposta:**

```jsx
<FilterBar
  searchValue={search}
  onSearchChange={setSearch}
  searchPlaceholder="Buscar orçamento..."
  filters={<StatusChips ... />}
  actions={<Button>Novo</Button>}
/>
```

**Acceptance criteria:**

- Responsivo: em mobile quebra em linhas, sem overflow horizontal indesejado.
- Usa `Input`, `Button`, `Badge`/chips padronizados.
- Não acopla a uma página específica.

---

### Task 2.4: Criar `EmptyState`, `LoadingState` e `ErrorState`

**Objetivo:** Padronizar estados vazios/carregando/erro.

**Arquivos a criar:**

- `src/components/feedback/EmptyState.jsx`
- `src/components/feedback/LoadingState.jsx`
- `src/components/feedback/ErrorState.jsx`

**Acceptance criteria:**

- Ícones via Lucide, sem emoji.
- Textos em português.
- Suporta CTA opcional.
- Visual coerente com cards Framer.

---

### Task 2.5: Criar `MetricCard` / `StatCard`

**Objetivo:** Unificar cards de métricas em dashboard, vendas, produtos e frete.

**Arquivo a criar:**

- `src/components/data/MetricCard.jsx`

**Acceptance criteria:**

- Suporta `label`, `value`, `description`, `icon`, `tone`.
- Pode ser usado no dashboard sem reescrever lógica.

---

### Checkpoint Fase 2

**Comandos planejados:**

```bash
npm run build
npm run test:e2e
```

**Acceptance criteria:**

- Build passa.
- Testes passam.
- Ainda não houve migração ampla; apenas criação de componentes base.

**Commit sugerido:**

```bash
git add src/components
git commit -m "feat: add Aspen design primitives"
```

---

## Fase 3 — Página piloto 1: ProductsPage

### Por que começar por ProductsPage

A página de produtos costuma ser um bom piloto porque tem padrões comuns de app administrativo:

- Header
- Busca
- Tabela/lista
- Estado vazio
- Loading/error
- Ações por linha

É menos arriscada do que a página de orçamento automático ou edição de orçamento, que têm fluxos críticos mais complexos.

### Task 3.1: Migrar estrutura da ProductsPage para `PageShell`

**Arquivo a modificar:**

- `src/pages/ProductsPage.jsx`

**Acceptance criteria:**

- Cabeçalho usa padrão único.
- Espaçamentos ficam consistentes com o resto do app.
- Nenhuma chamada API muda.

**Verificação:**

```bash
npm run build
```

---

### Task 3.2: Migrar busca/filtros para `FilterBar`

**Arquivo a modificar:**

- `src/pages/ProductsPage.jsx`

**Acceptance criteria:**

- Busca mantém debounce/comportamento atual.
- Layout responsivo não quebra em mobile.
- Sem regressão na navegação para detalhe do produto.

---

### Task 3.3: Migrar estados vazio/carregando/erro

**Arquivo a modificar:**

- `src/pages/ProductsPage.jsx`

**Acceptance criteria:**

- Loading usa `LoadingState`/`Skeleton`.
- Empty state usa `EmptyState` com texto em PT-BR.
- Error state usa `ErrorState`, sem expor detalhes internos indevidos.

---

### Task 3.4: Adicionar/ajustar teste Playwright para ProductsPage

**Arquivos prováveis:**

- `tests/products.spec.js` ou spec existente equivalente

**Acceptance criteria:**

- Teste cobre renderização da página.
- Mocka `/api/products` via `page.route(/\/api\//, ...)`.
- Verifica título, busca e pelo menos um item renderizado.

**Verificação:**

```bash
npm run test:e2e
```

**Commit sugerido:**

```bash
git add src/pages/ProductsPage.jsx src/components tests
git commit -m "refactor: standardize products page layout"
```

---

## Fase 4 — Página piloto 2: QuotationsPage

### Por que QuotationsPage como segunda piloto

É uma página mais central e com mais impacto comercial. Se o padrão funcionar nela, provavelmente funciona no restante das páginas de listagem.

### Task 4.1: Migrar header e shell da QuotationsPage

**Arquivo a modificar:**

- `src/pages/QuotationsPage.jsx`

**Acceptance criteria:**

- Usa `PageShell`/`PageHeader` corretamente.
- Props corretas: `description`, não `subtitle`; `action`, não `actions`.
- Ações existentes continuam visíveis.

---

### Task 4.2: Migrar filtros e chips para `FilterBar`

**Arquivo a modificar:**

- `src/pages/QuotationsPage.jsx`

**Acceptance criteria:**

- Filtros por status/origem/data continuam funcionando.
- Busca continua com comportamento atual.
- Layout mobile preserva usabilidade.

---

### Task 4.3: Padronizar tabela/lista e estados

**Arquivo a modificar:**

- `src/pages/QuotationsPage.jsx`

**Acceptance criteria:**

- Tabela mantém ações de visualizar/duplicar/excluir se já existirem.
- Não introduzir `<Table>` se houver dropdown absoluto dentro da tabela; usar wrapper `overflow-visible` quando necessário.
- Empty/loading/error seguem componentes padronizados.

---

### Task 4.4: Atualizar/adicionar testes de QuotationsPage

**Arquivos prováveis:**

- `tests/quotations.spec.js` ou spec existente equivalente

**Acceptance criteria:**

- Mocka `/api/quotations` e endpoints necessários.
- Verifica título, filtros e renderização de orçamentos.
- Se houver ação de duplicar/excluir, garantir que botão continua acessível por role.

**Verificação:**

```bash
npm run test:e2e
```

**Commit sugerido:**

```bash
git add src/pages/QuotationsPage.jsx src/components tests
git commit -m "refactor: standardize quotations page layout"
```

---

## Fase 5 — Revisão visual com o Andrei

### Task 5.1: Subir ambiente local e revisar páginas piloto

**Comando planejado:**

```bash
npm run dev
```

ou, se precisar do fluxo full-stack local:

```bash
npm run dev:vercel
```

**Páginas para revisar:**

- `/#/products`
- `/#/quotations`
- `/#/dashboard` apenas para comparar consistência ainda não migrada

**Acceptance criteria:**

- Andrei aprova a direção visual.
- As páginas piloto parecem parte de um sistema único.
- Não há perda de densidade operacional importante.

### Decisão de checkpoint

Após as 2 páginas piloto, decidir:

1. **Aprovado:** migrar o restante por grupos.
2. **Ajustes leves:** ajustar primitivas e reaplicar nas 2 páginas.
3. **Direção errada:** reverter/ajustar antes de contaminar mais páginas.

---

## Fase 6 — Migração por grupos

## Grupo A — Páginas de listagem administrativa

### Páginas candidatas

- `src/pages/SalesOrdersPage.jsx`
- `src/pages/LeadsPage.jsx`
- `src/pages/CrmKanbanPage.jsx`
- `src/pages/EmailTemplatesPage.jsx`
- `src/pages/EmailFollowupPage.jsx`

### Objetivo

Aplicar o padrão validado de `PageShell`, `FilterBar`, `SectionCard`, estados e botões.

### Acceptance criteria

- Headers consistentes.
- Filtros consistentes.
- Empty/loading/error consistentes.
- Kanban mantém todas as colunas, inclusive vazias.
- Drawer e ações contextuais não quebram.

### Verificação por página

```bash
npm run build
npm run test:e2e
```

**Commit sugerido:**

```bash
git commit -m "refactor: standardize administrative list pages"
```

---

## Grupo B — Páginas de detalhe

### Páginas candidatas

- `src/pages/QuotationDetailPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`
- `src/pages/ProductDetailPage.jsx`
- Página single de lead/cliente, se existir separada

### Objetivo

Padronizar detalhes, abas, cards laterais, ações principais e blocos de informação.

### Cuidados específicos

- Em `QuotationDetailPage`, preservar `_key` para itens editáveis.
- Não usar índice de array para editar/reordenar itens.
- Preservar autocomplete de produtos com `onMouseDown`.
- Evitar `<Table>` com `overflow-auto` onde houver dropdown absoluto.
- Preservar lógica de preço manual (`_rateManual`) se estiver presente.

### Acceptance criteria

- Modo visual e modo edição continuam funcionando.
- Ações críticas continuam acessíveis.
- Nenhuma chamada API muda sem motivo.

**Commit sugerido:**

```bash
git commit -m "refactor: standardize detail page layouts"
```

---

## Grupo C — Fluxos operacionais complexos

### Páginas candidatas

- `src/pages/AutoQuotePage.jsx`
- `src/pages/ManualOrcamentoPage.jsx`
- `src/pages/FreightPage.jsx`
- `src/pages/SettingsPage.jsx`

### Objetivo

Padronizar visual sem alterar regras de criação de orçamento, WhatsApp, frete ou configurações.

### Cuidados específicos

- `AutoQuotePage`: não quebrar paste/drop de imagem, sequência de cards, envio WhatsApp.
- `ManualOrcamentoPage`: preservar carrinho, autocomplete SKU, lookup de preço e validações.
- `FreightPage`: preservar fluxo de cotação e agrupamento de transportadoras.
- `SettingsPage`: preservar localStorage keys de fluxos WhatsApp.

### Acceptance criteria

- Fluxos principais continuam cobertos por Playwright ou teste manual documentado.
- UI fica consistente com piloto.
- Não há side effects automáticos, como envio real de WhatsApp ou alteração ERPNext, durante testes mockados.

**Commit sugerido:**

```bash
git commit -m "refactor: standardize operational flow pages"
```

---

## Fase 7 — Consolidação final

### Task 7.1: Remover padrões antigos redundantes

**Objetivo:** Evitar dois design systems paralelos.

**O que procurar:**

- Classes repetidas de card/seção.
- Headers manuais com `<h1>`/`<h2>` onde `PageShell` deveria ser usado.
- Estados vazios manuais.
- Botões estilizados manualmente que deveriam usar `Button`.

**Comandos úteis planejados:**

```bash
# Exemplos de buscas, ajustar conforme necessário
rg "<h1|<h2" src/pages src/components
rg "border.*rounded|rounded.*border" src/pages
rg "Nenhum|Carregando|Erro" src/pages
```

**Acceptance criteria:**

- Não há duplicação óbvia dos padrões migrados.
- O app tem uma forma canônica de criar páginas, seções, filtros e estados.

---

### Task 7.2: Documentar o design system no projeto

**Arquivo a criar/modificar:**

- `docs/design-system.md` ou `plans/design-system-shadcn-aspen.md` se não houver pasta `docs/`

**Conteúdo mínimo:**

- Como adicionar componente shadcn sem quebrar tokens Aspen.
- Quando usar `PageShell`, `SectionCard`, `FilterBar`, `EmptyState`.
- Contrato de `PageHeader`.
- Pitfalls: `Table` com dropdown, `onMouseDown`, `useRef` para debounce, `_key` em listas editáveis.

**Acceptance criteria:**

- Próximas alterações de UI têm referência clara.
- Evita regressão para estilos manuais inconsistentes.

---

### Task 7.3: Rodar validação completa

**Comandos finais:**

```bash
npm run build
npm run test:e2e
git status
```

**Acceptance criteria:**

- Build passa.
- Playwright passa.
- `git status` mostra apenas arquivos intencionais antes do commit final.

**Commit sugerido:**

```bash
git add src components.json jsconfig.json docs tests
 git commit -m "refactor: unify app design system with shadcn"
```

> Nota: remover o espaço acidental antes de `git` ao executar; está aqui apenas como linha de exemplo.

---

## 6. Arquivos provavelmente impactados

### Configuração

- `components.json` — novo
- `jsconfig.json` — novo
- `tailwind.config.js` — revisar/possível merge seguro
- `src/index.css` — revisar/possível merge seguro

### Componentes base

- `src/components/ui/button.jsx`
- `src/components/ui/input.jsx`
- `src/components/ui/badge.jsx`
- `src/components/ui/table.jsx`
- `src/components/ui/card.jsx` — novo
- `src/components/ui/textarea.jsx` — novo
- `src/components/ui/select.jsx` — novo
- `src/components/ui/dialog.jsx` — novo
- `src/components/ui/tabs.jsx` — novo
- `src/components/ui/dropdown-menu.jsx` — novo
- `src/components/ui/separator.jsx` — novo
- `src/components/ui/skeleton.jsx` — novo
- `src/components/ui/alert.jsx` — novo
- `src/components/ui/tooltip.jsx` — novo
- `src/components/ui/sheet.jsx` — novo

### Componentes compostos Aspen

- `src/components/PageHeader.jsx`
- `src/components/layout/PageShell.jsx` — novo
- `src/components/ui/section-card.jsx` — novo
- `src/components/data/FilterBar.jsx` — novo
- `src/components/data/MetricCard.jsx` — novo
- `src/components/feedback/EmptyState.jsx` — novo
- `src/components/feedback/LoadingState.jsx` — novo
- `src/components/feedback/ErrorState.jsx` — novo

### Páginas piloto

- `src/pages/ProductsPage.jsx`
- `src/pages/QuotationsPage.jsx`

### Páginas posteriores

- `src/pages/DashboardPage.jsx`
- `src/pages/SalesOrdersPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`
- `src/pages/QuotationDetailPage.jsx`
- `src/pages/LeadsPage.jsx`
- `src/pages/CrmKanbanPage.jsx`
- `src/pages/ProductDetailPage.jsx`
- `src/pages/AutoQuotePage.jsx`
- `src/pages/ManualOrcamentoPage.jsx`
- `src/pages/FreightPage.jsx`
- `src/pages/SettingsPage.jsx`
- `src/pages/EmailFollowupPage.jsx`
- `src/pages/EmailTemplatesPage.jsx`

### Testes

- `tests/*.spec.js` — atualizar/adicionar conforme cobertura real.

### Documentação

- `docs/design-system.md` — novo, se aprovado.

---

## 7. Testes e validação

### Obrigatórios em toda alteração de frontend

```bash
npm run build
npm run test:e2e
```

### Se algum teste não cobrir a página alterada

- Criar ou atualizar spec Playwright.
- Mockar APIs via `page.route(/\/api\//, handler)`.
- Não depender de ERPNext/OpenRouter reais para teste de UI.

### Checks manuais recomendados

- Mobile: largura 375px.
- Desktop: 1440px.
- Sidebar aberta e recolhida.
- Tema claro/escuro, se aplicável.
- Páginas com dados, sem dados, loading e erro.
- Ações com ícones Lucide têm labels acessíveis.

---

## 8. Riscos e mitigação

| Risco                                                                | Impacto | Mitigação                                                                                                |
| -------------------------------------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------- |
| `npx shadcn add` sobrescrever `button.jsx`/`input.jsx` customizados  |    Alto | Rodar em branch dedicada, revisar diff imediatamente e restaurar estilos Aspen mantendo estrutura shadcn |
| `index.css`/`tailwind.config.js` perder tokens Framer                |    Alto | Não usar `shadcn init`; criar config manual; revisar diff linha por linha                                |
| Refatoração visual quebrar fluxo comercial                           |    Alto | Migrar páginas em grupos; rodar Playwright; não alterar chamadas API                                     |
| Criar outro design system paralelo                                   |   Médio | Centralizar padrões em `PageShell`, `SectionCard`, `FilterBar`, estados e documentação                   |
| Páginas complexas ficarem visualmente bonitas mas menos operacionais |   Médio | Validar com Andrei após páginas piloto antes de expandir                                                 |
| Tabelas com dropdown cortado                                         |   Médio | Evitar shadcn `<Table>` wrapper com `overflow-auto` em células com autocomplete absoluto                 |
| Testes Playwright ficarem frágeis                                    |   Médio | Usar selectors por role/texto real e mocks completos de API                                              |
| Escopo crescer demais                                                |    Alto | Commitar por fase/página; revisar após pilotos; não migrar tudo em uma tacada                            |

---

## 9. Ordem sugerida de commits

1. `chore: configure shadcn design foundation`
2. `feat: add Aspen design primitives`
3. `refactor: standardize products page layout`
4. `refactor: standardize quotations page layout`
5. `refactor: standardize administrative list pages`
6. `refactor: standardize detail page layouts`
7. `refactor: standardize operational flow pages`
8. `docs: document Aspen shadcn design system`

Se a branch ficar grande, abrir PR/revisão após os commits 1–4 antes de continuar.

---

## 10. Critérios de aceite finais

- [ ] `components.json` existe e o shadcn CLI funciona.
- [ ] `jsconfig.json` existe com alias `@/*`.
- [ ] Tokens Aspen/Framer continuam preservados.
- [ ] Páginas piloto aprovadas visualmente.
- [ ] Páginas principais usam cabeçalhos e cards consistentes.
- [ ] Filtros, tabelas, estados vazios e métricas seguem componentes padronizados.
- [ ] Nenhuma regra de orçamento/ERPNext/WhatsApp/frete foi alterada indevidamente.
- [ ] `npm run build` passa.
- [ ] `npm run test:e2e` passa.
- [ ] Documentação do padrão foi criada.

---

## 11. Open questions para o Andrei

1. **Densidade visual:** prefere manter a UI mais compacta/operacional ou mais espaçada/premium?
2. **Primeiras páginas piloto:** confirma `ProductsPage` e `QuotationsPage`, ou prefere começar por outra dupla?
3. **Tema:** quer manter exatamente os tokens Framer atuais ou aproveitar para ajustar contraste/cores durante a migração?
4. **Escopo da primeira branch:** quer só fundação + 2 pilotos, ou já migrar todas as páginas principais antes de merge?
5. **Deploy:** após aprovação e testes, quer merge/push para auto-deploy ou revisar localmente primeiro?

---

## 12. Minha recomendação de escopo inicial

Para reduzir risco, eu faria a primeira branch assim:

1. Configuração shadcn controlada (`components.json`, `jsconfig.json`).
2. Componentes base Aspen (`PageShell`, `SectionCard`, `FilterBar`, estados).
3. Migrar **ProductsPage**.
4. Migrar **QuotationsPage**.
5. Rodar build + Playwright.
6. Parar para revisão visual do Andrei.

Só depois de aprovado eu migraria o restante. Essa abordagem resolve a dúvida principal — “dá para deixar homogêneo sem começar do zero?” — com risco baixo e evidência visual rápida.
