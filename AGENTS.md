# AGENTS.md - Aspen Orçamento

## Stack

- Frontend: React 19 e Vite 6.
- Backend: Node.js ESM em funções serverless da Vercel.
- Dados: PostgreSQL via Drizzle.
- Integrações principais: Evolution API para WhatsApp e OpenRouter para extração.

## Arquitetura

- `src/app/routes.tsx` é a única tabela de rotas do frontend.
- `src/app/App.tsx` faz o dispatch das rotas por hash via `useHashRoute`.
- Páginas ficam em `src/features/<dominio>/pages/`.
- Primitivos de UI ficam em `src/components/ui/`; componentes compartilhados ficam em `src/components/shared/`.
- `api/[...path].ts` é a única Function implantável; helpers ficam sob diretórios privados iniciados por `_`.
- Handlers e regras de negócio ficam em `api/_modules/`.
- Repositórios PostgreSQL ficam em `api/_infrastructure/db/repositories/` e controlam estado durável e transações.
- Integrações externas ficam em `api/_infrastructure/integrations/`.

## Convenções

- Use apenas ESM; imports do backend para arquivos locais incluem a extensão `.js`.
- Handlers recebem eventos no formato Lambda e retornam `{ statusCode, headers?, body }`.
- Registre cada endpoint uma única vez em `api/_app/routes.ts`.
- Mensagens HTTP destinadas ao usuário são escritas em português brasileiro.
- O frontend usa rotas por hash; não adicione React Router.
- Prefira estado local ou contexto; não adicione biblioteca de estado global sem aprovação.
- PostgreSQL é a fonte de verdade para produtos, clientes, orçamentos, CRM, pedidos e atividades.
- Evolution API é o único transporte de WhatsApp.
- Não edite arquivos gerados pelo Vite em `public/`.

## Segurança e dados

- Não exponha erros de banco, erros brutos de integrações, stack traces, segredos ou dados pessoais em respostas e logs.
- Autenticação e rate limiting passam pelo pipeline compartilhado em ambiente local e implantado.
- Não adicione novos fallbacks de provedor, transporte ou persistência, nem branches de rollout.
- Fallbacks existentes de leitura ou cache no frontend não autorizam novos caminhos de persistência durável.
- Não altere migrations históricas em `drizzle/` nem execute migrations sem autorização explícita.
- Pare e peça uma decisão antes de criar migrations ou alterar a estratégia de migrations.
- Não adicione dependências sem aprovação explícita.
- Nunca registre ou versione `.env`, credenciais ou dados de produção.

## Ambiente operacional

- Valores reais ficam fora do checkout em `$HOME/.config/aspen-dashboard/.env.local` ou `.env`.
- O diretório de configuração usa modo `0700`; os arquivos usam modo `0600`.
- Antes de cutover, execute `node scripts/cutover-env-status.mjs`.
- O preflight deve mostrar apenas nomes e estados `present` ou `missing`, nunca valores.

## Estágio do produto: PRE-BETA

O Aspen Orçamento está em pré-beta, sem usuários. O objetivo de engenharia é aprender e entregar rápido, preservando rigor somente onde um erro causa dano real (dados, dinheiro, comunicação externa, segurança, inconsistência permanente).

Compatibilidade com comportamentos ou dados de versões anteriores não é requisito por padrão. Não criar adapters, dual-read, dual-write, fallbacks legado, backfills complexos ou camadas de compatibilidade sem necessidade explícita na issue (dados reais a preservar, consumidores reais dependentes ou pedido explícito).

Antes de adicionar abstraction layer, adapter, cache, fila, feature flag, event bus, novo pacote ou infraestrutura para requisito futuro, responda: existe necessidade na issue atual? Existe risco real já observado? A solução mais simples falha em algum requisito atual? Se as três respostas não justificarem, não implemente.

## Classificação de risco por issue

Classifique no início do trabalho. `FAST` é o padrão; promova para `CRITICAL` apenas com critério objetivo.

- **FAST** — mudanças reversíveis: UI, copy, navegação, filtros, CRUD comum, refactors locais, cálculos em rascunho experimental. Validação: `verify:fast`, testes focados quando houver comportamento relevante (`npm run test:unit:focused -- tests/unit/<arquivo>.test.ts`), smoke da jornada alterada quando aplicável. Mudança puramente visual ou de copy não exige teste automatizado novo. Revisão única leve; sem E2E completo nem PostgreSQL real.
- **CRITICAL** — perda destrutiva ou irreversível de dados; envio real de WhatsApp/e-mail/documento ao cliente; valores oficialmente emitidos (orçamento emitido, totais, pedidos); autenticação, autorização ou isolamento de tenant; idempotência, locks e invariantes de concorrência. Validação: checks FAST + testes das invariantes e caminhos de erro + PostgreSQL descartável quando persistência for afetada + E2E das jornadas afetadas + revisão independente.

Pertencer a domínio comercial não torna uma issue CRITICAL por si só; o gatilho é o efeito possível. A fonte normativa das lanes e o detalhamento operacional de cada fluxo ficam em `docs/release-lanes.md`.

**RELEASE** é um gate periódico do conjunto integrado (antes de deploy importante, milestone ou beta), não um tipo de issue: `verify:full` (FAST + corpus unitário completo + build de produção + Playwright completo), PostgreSQL/migrations aplicáveis e smoke das jornadas principais.

Falha já existente no baseline só é ignorável após reprodução idêntica na base e registro em issue própria; a mudança atual não pode piorar nem tocar aquele comportamento.

Issues de implementação devem ter 1 objetivo, 1 jornada principal, domínio coeso e normalmente 3–7 acceptance criteria. Ajustes pequenos e relacionados viajam juntos; não crie uma issue por botão.

Relatórios finais de issues FAST são curtos: implementado, validação realizada e checks amplos omitidos intencionalmente.

## Comandos

```bash
npm run dev
npm run verify:fast          # lint + typecheck + checks estruturais baratos
npm run test:unit:focused -- tests/unit/<arquivo>.test.ts   # testes focados
npm run test:unit            # corpus unitário completo (~47s)
npm run verify:full          # RELEASE: FAST + corpus completo + build + E2E
```

- Use `verify:fast` + testes focados durante o desenvolvimento.
- `verify:full` fica para gates RELEASE, mudanças transversais grandes ou solicitação explícita — não é obrigatório em toda issue.

## Agent skills

### Issue tracker

Issues são rastreados no GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os cinco labels canônicos de triagem. See `docs/agents/triage-labels.md`.

### Domain docs

Usamos layout single-context. See `docs/agents/domain.md`.
