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
- O frontend é para um operador único experiente. Não acrescente texto de ajuda abaixo de campos, descrições de PageHeader/seção que repetem o título, nem copy tutorial. Deixe texto auxiliar só quando a consequência não aparece no rótulo: efeito colateral, ação bloqueada, ou empty state com o próximo passo.
- O frontend usa rotas por hash; não adicione React Router.
- Prefira estado local ou contexto; não adicione biblioteca de estado global sem aprovação.
- PostgreSQL é a fonte de verdade para produtos, clientes, orçamentos, CRM, pedidos e atividades.
- Evolution API é o único transporte de WhatsApp.

## Fluxo de git

- Mudanças triviais e reversíveis (CSS, copy, navegação, ajuste pequeno de UI) podem seguir no fluxo direto já autorizado, sem issue, branch ou worktree.
- Não há gate por contagem de arquivos. Na dúvida, use branch curta; pergunte somente quando a autorização ou o risco mudar.
- Demais mudanças vão em branch curta + PR quando a publicação for autorizada. `SHIP` não autoriza push/deploy nem pular check existente.
- Sincronize `git pull --ff-only origin <base>` após checar o status e antes das mudanças, preservando trabalho alheio.
- Após o merge do PR, rode `sh scripts/post-merge-cleanup.sh` para remover worktrees e branches locais cujo remote foi apagado (branches não merged ficam de fora).
- Não edite arquivos gerados pelo Vite em `public/`.

## Segurança e dados

- Não exponha erros de banco, erros brutos de integrações, stack traces, segredos ou dados pessoais em respostas e logs.
- Autenticação e rate limiting passam pelo pipeline compartilhado em ambiente local e implantado.
- Não adicione novos fallbacks de provedor, transporte ou persistência, nem branches de rollout.
- Fallbacks existentes de leitura ou cache no frontend não autorizam novos caminhos de persistência durável.
- Criar e testar uma migration genuinamente aditiva em PostgreSQL local descartável faz parte da implementação autorizada.
- Alterar migration histórica, criar migration destrutiva ou mudar a estratégia de migrations exige decisão explícita.
- Aplicar qualquer migration em staging ou produção exige autorização operacional explícita e separada, conforme o runbook.
- Não adicione dependências sem aprovação explícita.
- Nunca registre ou versione `.env`, credenciais ou dados de produção.

## Ambiente operacional

- Valores reais ficam fora do checkout em `$HOME/.config/aspen-dashboard/.env.local` ou `.env`.
- O diretório de configuração usa modo `0700`; os arquivos usam modo `0600`.
- Antes de cutover, execute `node scripts/cutover-env-status.mjs`.
- O preflight deve mostrar apenas nomes e estados `present` ou `missing`, nunca valores.

## Estágio do produto: produção, estágio inicial

O Aspen Orçamento é uma ferramenta interna de operador único, em produção, com dados reais. O objetivo de engenharia é aprender e entregar rápido, preservando rigor somente onde um erro causa dano real (dados, dinheiro, comunicação externa, segurança, inconsistência permanente). Prioridade: velocidade de entrega, baixo custo/tokens, simplicidade, segurança proporcional e qualidade suficiente.

Dados reais e contratos em uso precisam ser preservados; não implemente compatibilidade com consumidores hipotéticos nem crie adapters, dual-read, dual-write, fallbacks legado, backfills complexos ou camadas de compatibilidade.

Antes de adicionar abstração ou infraestrutura para requisito futuro, siga a seção Complexidade de `docs/release-lanes.md`.

## Ritmo de entrega

`docs/release-lanes.md` é a fonte normativa: leia-a antes de classificar,
revisar ou escolher checks. SHIP é o padrão para CRUD recuperável; PostgreSQL
não implica CRITICAL. Valide conforme o dano concreto do diff.

SHIP não exige reviewer; SAFE usa um reviewer; CRITICAL usa um reviewer
aprofundado e aprovações operacionais separadas quando cabíveis. Não repita
testes sem alteração, dúvida concreta ou reprodução. `verify:full` é periódico,
não o inner loop.

Preview é a única homologação e Production é o `master`. Migration, deploy,
env operacional e efeitos externos têm aprovações separadas. Preserve os
consumidores técnicos existentes do pipeline de migrations até decisão
explícita; não crie aliases ou compatibilidade hipotética.

## Comandos

```bash
npm run dev
npm run verify:fast          # lint + typecheck + checks estruturais baratos
npm run test:unit:focused -- tests/unit/<arquivo>.test.ts   # testes focados
npm run test:unit            # corpus unitário completo
npm run verify:full          # RELEASE: verify:fast + corpus + build + E2E
```

- Durante a edição, rode o checker barato relevante; antes de entregar código, rode `npm run verify:fast`, conforme a política de risco.
- `verify:full` fica para gates RELEASE, mudanças transversais grandes ou solicitação explícita — não é obrigatório em toda issue.

E2E integrado (HTTP -> PostgreSQL descartável -> UI) usa o ponto de entrada seguro
`npm run test:e2e:safe`; ver `docs/safe-e2e.md`.

## Agent skills

### Issue tracker

Issues são rastreados no GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os cinco labels canônicos de triagem. See `docs/agents/triage-labels.md`.

### Domain docs

Usamos layout single-context. See `docs/agents/domain.md`.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
