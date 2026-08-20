# Plano de Refatoração — Aspen Dashboard

## 1. Objetivo

Refatorar o `aspen-dashboard` de forma **incremental**, sem reescrita e sem trocar as tecnologias principais.

O objetivo é reduzir o tempo necessário para desenvolver, validar e publicar features, removendo duplicações arquiteturais e tornando o processo de release proporcional ao risco de cada mudança.

### Princípios

- Manter React + Vite.
- Manter Node.js.
- Manter PostgreSQL + Drizzle.
- Manter o projeto como monólito modular.
- Manter Vercel como runtime principal de produção.
- Usar Vercel Preview como staging principal.
- Preservar testes e garantias importantes.
- Remover duplicações antes de reorganizar diretórios.
- Não fazer uma reescrita.
- Não introduzir microservices, Kubernetes, Nx ou Turborepo.

---

## 2. Situação atual

A arquitetura atual pode ser resumida como:

```text
React SPA + Vite
        |
        v
/api/[...path] -> Node/Vercel
        |
        +-> PostgreSQL / Drizzle
        +-> OpenRouter
        +-> Evolution API
        +-> Vercel Blob
        +-> Vercel KV
```

O problema principal não está nessa stack.

A maior fonte de complexidade está em torno do runtime e do processo de entrega.

Hoje existem três caminhos HTTP que precisam permanecer sincronizados:

```text
api/[...path].ts
        |
        +-- ROUTES #1

scripts/app-server.mjs
        |
        +-- ROUTES #2

scripts/dev-api-server.mjs
        |
        +-- ROUTES #3
```

Além disso, staging possui uma infraestrutura diferente da produção:

```text
Produção
  Vercel

Staging
  Hostinger VPS
    -> Docker
    -> Traefik
    -> Node
    -> nftables
    -> PostgreSQL staging
```

Isso aumenta o custo cognitivo e operacional de cada feature.

---

# 3. Arquitetura alvo

A arquitetura desejada é:

```text
                    GitHub
                      |
                      v
                CI automático
                      |
            +---------+---------+
            |                   |
         Preview            Production
         Vercel               Vercel
            |                   |
      Postgres staging      Postgres prod


               ASPEN APPLICATION
                      |
               shared router
                      |
           shared request pipeline
                      |
        +-------------+-------------+
        |             |             |
   quotations        CRM         WhatsApp
        |             |             |
        +-------- repositories ------+
                      |
                  PostgreSQL
```

Regra principal:

> Uma regra de negócio, uma definição de rota e um fluxo HTTP.

---

# 4. Fase 0 — Baseline

Antes de alterar a arquitetura, registrar o estado atual conhecido como saudável.

## Tarefas

- [ ] Garantir `npm run check` verde.
- [ ] Garantir unit tests verdes.
- [ ] Garantir Playwright verde.
- [ ] Inventariar endpoints existentes.
- [ ] Inventariar integrações externas.
- [ ] Inventariar variáveis de ambiente.
- [ ] Identificar migrations aplicadas em produção.
- [ ] Identificar testes que realmente dependem de providers externos.
- [ ] Registrar tempos dos comandos principais.

Medir:

```bash
npm run lint
npm run type-check
npm run build:api
npm run build
npm run test:unit
npm run test:e2e
```

## Não fazer nesta fase

- Não trocar router.
- Não trocar ORM.
- Não trocar banco.
- Não reorganizar centenas de arquivos.
- Não introduzir framework de monorepo.

---

# 5. Fase 1 — Uma única definição de rotas da API

Esta é a prioridade arquitetural número 1.

Criar:

```text
api/
  _app/
    routes.ts
```

Exemplo:

```ts
export const routes = {
  'crm-deals': crmDeals,
  'crm-update-deal': crmUpdateDeal,

  products,
  'product-detail': productDetail,

  quotations,
  'quotation-preview': quotationPreview,

  'whatsapp-conversations': whatsappConversations,
};
```

Os runtimes passam a importar a mesma definição:

```text
api/[...path].ts
        |
        +----------+
                   |
             _app/routes.ts
                   |
        +----------+
        |
app-server.mjs
```

## Resultado esperado

Antes:

```text
novo endpoint
  -> handler
  -> registrar Vercel
  -> registrar dev
  -> registrar staging
```

Depois:

```text
novo endpoint
  -> handler
  -> registrar uma vez em routes.ts
```

## Critério de conclusão

Não pode existir mais de uma definição da relação:

```text
"product-detail" -> productDetail
```

no projeto.

---

# 6. Fase 2 — Request pipeline compartilhado

Centralizar o fluxo HTTP.

Criar aproximadamente:

```text
api/
  _app/
    routes.ts
    handle-request.ts

  _http/
    request.ts
    response.ts
    node-adapter.ts
    vercel-adapter.ts
```

Fluxo:

```text
request
   |
   v
resolve route
   |
   v
auth
   |
   v
rate limit
   |
   v
handler
   |
   v
normalize error
   |
   v
response
```

Esse pipeline deve existir apenas uma vez.

Os runtimes ficam responsáveis apenas pela adaptação de transporte.

## Vercel

```ts
export default createVercelHandler(handleApiRequest);
```

## Node

```ts
createServer(createNodeHandler(handleApiRequest));
```

Arquitetura:

```text
                      handleApiRequest()
                           |
          +----------------+----------------+
          |                                 |
     Vercel adapter                    Node adapter
```

---

# 7. Fase 3 — Remover `dev-api-server.mjs`

Depois que o pipeline e os adapters estiverem compartilhados, remover o servidor local redundante.

Objetivo:

```text
npm run dev

Vite :5173
   |
   +-- /api proxy
            |
            v
       Node adapter :8888
            |
            v
      shared API core
```

Deve existir um único servidor de API para desenvolvimento local.

---

# 8. Fase 4 — Organizar backend por domínio

Somente depois de eliminar as duplicações estruturais.

Estrutura desejada:

```text
api/
  _app/
    routes.ts
    handle-request.ts

  _http/
    vercel-adapter.ts
    node-adapter.ts

  _shared/
    auth/
    errors/
    validation/
    rate-limit/

  modules/
    quotations/
    products/
    crm/
    customers/
    sales-orders/
    whatsapp/
    communication/

  infrastructure/
    db/
    integrations/
```

Exemplo:

```text
modules/
  quotations/
    handlers/
      list-quotations.ts
      quotation-detail.ts
      issue-quotation.ts
      preview-quotation.ts

    quotation-service.ts
    quotation-types.ts
```

Infraestrutura:

```text
infrastructure/
  db/
    schema/
    repositories/

  integrations/
    openrouter/
    evolution/
    vercel-blob/
    vercel-kv/
```

---

# 9. Separação Domain x Infrastructure

O projeto deve distinguir claramente regras da empresa de detalhes de infraestrutura.

## Domain

Exemplos:

```text
Criar orçamento
Calcular preço
Converter orçamento em pedido
Atualizar negócio CRM
```

## Infrastructure

Exemplos:

```text
PostgreSQL
Evolution API
OpenRouter
Vercel Blob
Vercel KV
```

Fluxo desejado:

```text
quotation service
       |
       +-- quotation repository
       |
       +-- pdf generator
```

Evitar handlers que conheçam diretamente muitos detalhes de providers e storage.

---

# 10. Fase 5 — Permanecer como monólito modular

Não transformar o projeto em microservices.

Não fazer:

```text
crm-service
quotation-service
whatsapp-service
product-service
customer-service
```

Fazer:

```text
              ASPEN
                |
     +----------+----------+
     |          |          |
 quotations    CRM      WhatsApp
```

Mesmo deploy.

Mesmo banco.

Mesma aplicação.

Separação apenas interna.

---

# 11. Fase 6 — Reorganizar frontend por feature

Estrutura alvo:

```text
src/
  app/
    App.tsx
    routes.ts
    navigation.ts

  features/
    dashboard/
    quotations/
    products/
    customers/
    crm/
    sales-orders/
    whatsapp/
    communication/

  components/
    ui/
    shared/

  lib/
    api/
    formatting/
    storage/

  hooks/
```

Exemplo:

```text
features/
  quotations/
    pages/
      QuotationsPage.tsx
      QuotationDetailPage.tsx

    components/
      QuotationForm.tsx
      QuotationItems.tsx

    api.ts
    types.ts
    utils.ts
```

Essa migração deve acontecer progressivamente, começando pelos domínios mais modificados.

---

# 12. Fase 7 — Centralizar rotas frontend

Não é necessário introduzir React Router nesta refatoração.

O hash routing pode continuar.

Criar:

```text
src/app/routes.ts
```

Exemplo conceitual:

```ts
export const routes = {
  '/dashboard': DashboardPage,
  '/quotations': QuotationsPage,
  '/sales-orders': SalesOrdersPage,
  '/whatsapp-inbox': WhatsappInboxPage,
};
```

Objetivo:

> uma única fonte para definição de rotas e navegação.

---

# 13. Fase 8 — Vercel Preview como staging principal

Após reduzir o acoplamento à VPS, usar Preview como staging padrão.

```text
feature branch
      |
      v
Vercel Preview
      |
      +-- DATABASE_URL staging
      +-- staging KV
      +-- OpenRouter controlado
      +-- external writes disabled
```

Produção:

```text
master
   |
   v
Vercel Production
   |
   +-- DATABASE_URL production
   +-- production KV
   +-- Evolution production
   +-- production providers
```

---

# 14. Fase 9 — Segurança do Preview

Substituir gradualmente a dependência de firewall de staging por múltiplas camadas de segurança.

## Camada 1 — Não fornecer credenciais perigosas

Preview não deve receber segredos capazes de executar operações críticas.

Exemplo:

```text
EVOLUTION_API_KEY = ausente
META_CAPI_TOKEN = ausente
TYPEBOT_WRITE_TOKEN = ausente
```

## Camada 2 — External write guard

Criar um guard central.

Exemplo conceitual:

```ts
assertExternalWritesAllowed('evolution');
```

Operações destrutivas ou externas só são permitidas se:

```text
APP_ENV=production
EXTERNAL_WRITES_ENABLED=1
```

## Camada 3 — Testes

Playwright continua verificando que o browser não acessa destinos proibidos.

Segurança passa a ser:

```text
sem credenciais
      +
application guard
      +
test guard
```

---

# 15. Fase 10 — Transição VPS -> Preview

Não desligar staging VPS imediatamente.

Durante a transição:

```text
             PR
              |
              v
        Vercel Preview
              |
             E2E
              |
              v
       staging aprovado
              |
              +-- VPS staging opcional
              |
              v
         Production
```

Executar alguns releases dessa forma.

Quando houver confiança suficiente:

```text
VPS staging
   |
   v
decommission
```

Remover posteriormente:

- Docker de staging.
- Traefik de staging.
- nftables específico do staging.
- Scripts exclusivamente de staging.
- Documentação operacional obsoleta.
- Runtime Node duplicado quando não for mais necessário.

---

# 16. Fase 11 — GitHub Actions CI

Criar:

```text
.github/
  workflows/
    ci.yml
```

Fluxo básico para PR:

```text
                  PR
                   |
        +----------+----------+
        |          |          |
       lint      types       unit
        |          |          |
        +----------+----------+
                   |
                  build
                   |
                   v
                  OK
```

Executar em paralelo sempre que possível.

---

# 17. Fase 12 — Checks rápidos e completos

Reorganizar scripts do `package.json`.

Estrutura conceitual:

```json
{
  "lint": "...",
  "typecheck": "...",

  "test:unit": "...",
  "test:e2e": "...",
  "test:e2e:smoke": "...",

  "build:api": "...",
  "build:web": "...",
  "build": "...",

  "verify:fast": "...",
  "verify:full": "..."
}
```

## `verify:fast`

Usado durante desenvolvimento:

```text
lint
+
typecheck
+
unit
```

## `verify:full`

Usado em mudanças críticas:

```text
lint
typecheck
unit
build
Playwright
```

Evitar executar builds redundantes entre os comandos.

---

# 18. Fase 13 — Classificar Playwright por domínio

Os E2E não devem ser tratados como um bloco indivisível.

Adicionar tags como:

```text
@smoke
@quotations
@crm
@products
@whatsapp
@database
@external
@critical
```

Exemplo:

## Alteração de produto

```bash
playwright test --grep "@products|@smoke"
```

## Alteração de orçamento

```bash
playwright test --grep "@quotations|@smoke"
```

## Alteração crítica

```bash
npm run test:e2e
```

---

# 19. Fase 14 — Release lanes por risco

Nem toda mudança precisa passar pelo mesmo processo.

## LOW

Exemplos:

- CSS.
- Copy.
- Ícones.
- Componentes puramente visuais.
- Formatação.

Fluxo:

```text
CI
-> Preview
-> merge
-> Production
```

---

## MEDIUM

Exemplos:

- Novo endpoint.
- Regra de negócio.
- Filtros.
- CRM.
- Alterações comuns em orçamento.

Fluxo:

```text
CI
-> unit
-> E2E do domínio
-> Preview
-> Production
```

---

## HIGH

Exemplos:

- Migration.
- Auth.
- WhatsApp send.
- Integrações externas.
- Mudanças destrutivas.
- Permissões.

Fluxo:

```text
CI
-> todos unit
-> build
-> staging DB
-> full E2E
-> backup
-> Preview
-> aprovação
-> Production
-> read-only canary
```

O processo atual mais rigoroso continua existindo, mas apenas quando necessário.

---

# 20. Fase 15 — Manter PostgreSQL + Drizzle

Não trocar a camada de dados.

Estrutura lógica:

```text
handler
   |
   v
service
   |
   v
repository
   |
   v
Drizzle
   |
   v
PostgreSQL
```

A refatoração deve melhorar organização e isolamento, não substituir tecnologias que já estão funcionando.

---

# 21. Fase 16 — Migrations como HIGH risk

Migrations não devem acontecer implicitamente no startup.

Continuar usando uma etapa controlada:

```bash
npm run db:migrate
```

Classificar mudanças.

## Additive

```text
ADD COLUMN nullable
CREATE TABLE
CREATE INDEX
```

## Destructive

```text
DROP COLUMN
DROP TABLE
ALTER incompatible
```

Para mudanças destrutivas usar:

```text
expand
  |
  v
deploy compatível
  |
  v
migrate data
  |
  v
contract
```

---

# 22. Fase 17 — Limpeza PostgreSQL-only

Após estabilizar o cutover para PostgreSQL, iniciar uma fase dedicada à remoção de legado.

Pesquisar e classificar:

```text
Frappe
ERPNext
legacy providers
quote_leads antigos
old env vars
old compatibility adapters
old Typebot paths
old docs
```

Remover quando comprovadamente mortos:

- runtime code;
- providers;
- flags antigas;
- repositories antigos;
- UI morta;
- compatibility code;
- documentação obsoleta.

## Não apagar migrations históricas aplicadas

Migrations versionadas fazem parte do histórico do banco.

---

# 23. Fase 18 — Reduzir feature flags e env vars

Toda flag deveria ter:

- owner;
- propósito;
- condição de remoção.

Flags atuais como:

```text
STAGING_E2E
STAGING_EXTERNAL_PROVIDERS_DISABLED
STAGING_EGRESS_BLOCKED
STAGING_FIXTURE_RESET
```

podem potencialmente ser condensadas no futuro para algo mais simples:

```text
APP_ENV=preview
EXTERNAL_WRITES_ENABLED=0
```

Quanto menos combinações possíveis de configuração, menor o custo cognitivo.

---

# 24. Fase 19 — Padronizar integrações externas

Criar fronteiras claras:

```text
api/
  infrastructure/
    integrations/
      evolution/
        client.ts
        config.ts

      openrouter/
        client.ts
        config.ts

      blob/
        client.ts

      kv/
        client.ts
```

Evitar leitura espalhada de variáveis como:

```ts
process.env.EVOLUTION_BASE_URL
process.env.EVOLUTION_API_KEY
process.env.EVOLUTION_INSTANCE
```

Preferir:

```ts
const evolution = getEvolutionClient();
```

Benefícios:

- configuração central;
- mocks mais simples;
- Preview mais seguro;
- testes mais fáceis;
- menor acoplamento.

---

# 25. Fase 20 — Documentar boundaries para agentes

Criar um `ARCHITECTURE.md` curto e objetivo.

Exemplo:

```text
Frontend
  src/features

HTTP routing
  api/_app

Business logic
  api/modules

Database
  api/infrastructure/db

External APIs
  api/infrastructure/integrations
```

Regras:

```text
Do not:
- access DB from frontend
- instantiate Evolution outside integration layer
- add routes outside routes.ts
- duplicate HTTP adapters
- put infrastructure details inside domain services
```

Esse arquivo deve ser útil tanto para desenvolvedores quanto para coding agents.

---

# 26. Estrutura final sugerida

```text
aspen-dashboard/
|
+-- src/
|   +-- app/
|   |   +-- App.tsx
|   |   +-- routes.ts
|   |   +-- navigation.ts
|   |
|   +-- features/
|   |   +-- dashboard/
|   |   +-- quotations/
|   |   +-- products/
|   |   +-- customers/
|   |   +-- crm/
|   |   +-- sales-orders/
|   |   +-- whatsapp/
|   |   +-- communication/
|   |
|   +-- components/
|   |   +-- ui/
|   |   +-- shared/
|   |
|   +-- lib/
|       +-- api/
|       +-- formatting/
|       +-- storage/
|
+-- api/
|   +-- [...path].ts
|   |
|   +-- _app/
|   |   +-- routes.ts
|   |   +-- handle-request.ts
|   |
|   +-- _http/
|   |   +-- vercel-adapter.ts
|   |   +-- node-adapter.ts
|   |
|   +-- _shared/
|   |   +-- auth/
|   |   +-- errors/
|   |   +-- validation/
|   |   +-- rate-limit/
|   |
|   +-- modules/
|   |   +-- quotations/
|   |   +-- products/
|   |   +-- customers/
|   |   +-- crm/
|   |   +-- sales-orders/
|   |   +-- whatsapp/
|   |   +-- communication/
|   |
|   +-- infrastructure/
|       +-- db/
|       |   +-- schema/
|       |   +-- repositories/
|       |
|       +-- integrations/
|           +-- evolution/
|           +-- openrouter/
|           +-- blob/
|           +-- kv/
|
+-- drizzle/
|   +-- migrations/
|
+-- tests/
|   +-- unit/
|   +-- integration/
|   +-- e2e/
|
+-- scripts/
|   +-- dev/
|   +-- database/
|   +-- operations/
|   +-- release/
|
+-- .github/
|   +-- workflows/
|       +-- ci.yml
|
+-- ARCHITECTURE.md
+-- package.json
+-- vercel.json
```

---

# 27. Ordem recomendada de implementação

Executar nesta ordem:

1. [ ] Registrar baseline.
2. [ ] Criar `api/_app/routes.ts`.
3. [ ] Remover mapas de rotas duplicados.
4. [ ] Criar `handle-request.ts`.
5. [ ] Unificar request pipeline.
6. [ ] Criar adapters Vercel/Node.
7. [ ] Remover `dev-api-server.mjs`.
8. [ ] Simplificar `vite-dev.mjs`.
9. [ ] Criar GitHub Actions CI.
10. [ ] Criar `verify:fast` e `verify:full`.
11. [ ] Classificar E2E por domínio.
12. [ ] Introduzir release lanes LOW/MEDIUM/HIGH.
13. [ ] Configurar Preview com PostgreSQL staging.
14. [ ] Implementar external-write guards.
15. [ ] Retirar credenciais perigosas do Preview.
16. [ ] Rodar Preview e VPS staging paralelamente por alguns releases.
17. [ ] Remover VPS do fluxo normal.
18. [ ] Decommissionar staging VPS.
19. [ ] Migrar backend progressivamente para `modules/`.
20. [ ] Migrar frontend progressivamente para `features/`.
21. [ ] Centralizar integrações externas.
22. [ ] Concluir PostgreSQL-only cleanup.
23. [ ] Remover flags e env vars mortos.
24. [ ] Criar `ARCHITECTURE.md`.
25. [ ] Atualizar documentação operacional final.

---

# 28. O que não faz parte desta refatoração

Não incluir:

- [ ] Migração Vite -> Next.js.
- [ ] Troca do Drizzle.
- [ ] Troca do PostgreSQL.
- [ ] Separação frontend/backend em dois repositórios.
- [ ] Turborepo.
- [ ] Nx.
- [ ] Microservices.
- [ ] Kubernetes.
- [ ] Reescrita geral.
- [ ] React Router apenas por estética.
- [ ] Refatoração de todos os handlers ao mesmo tempo.
- [ ] Mudança simultânea de arquitetura e regra de negócio.

---

# 29. Critérios de sucesso

A refatoração será considerada bem-sucedida quando uma feature comum puder seguir aproximadamente este fluxo:

```text
Nova feature
    |
    +-- frontend feature
    +-- handler/service
    +-- repository, se necessário
    +-- uma entrada em routes.ts
           |
           v
      unit/domain tests
           |
           v
          PR
           |
      +----+----+
     lint types unit
      +----+----+
           |
           v
     Vercel Preview
           |
      E2E relevante
           |
           v
         merge
           |
           v
      Production
```

E quando estes elementos não forem mais necessários para uma feature comum:

```text
VPS staging
full E2E
backup manual
full cutover
network egress ceremony
validações operacionais pesadas
```

Essas garantias devem permanecer disponíveis apenas para mudanças classificadas como HIGH risk.

---

# 30. Resultado esperado

A refatoração não busca reduzir segurança.

Busca substituir:

```text
muitas etapas
+
muita duplicação
+
muitos ambientes diferentes
```

por:

```text
menos caminhos
+
mais automação
+
checks proporcionais ao risco
+
uma arquitetura mais previsível
```

O resultado esperado é:

- menor tempo para desenvolver features;
- menor tempo para validar mudanças;
- menor custo cognitivo para coding agents;
- menos risco de inconsistência entre ambientes;
- menor quantidade de código operacional;
- maior confiança no CI;
- releases mais frequentes;
- manutenção mais simples;
- arquitetura mais fácil de entender.
