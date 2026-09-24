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

## Identidade de cliente

- A consulta de identidade é `POST /api/client-matches` (somente leitura) e a regra autoritativa de normalização e classificação fica em `api/_modules/client-matching.ts`. A decisão de vínculo acontece no salvamento, dentro da transação de `/api/orcamento`, depois do lock de escrita e da recuperação por `creation_request_id`; o card apenas antecipa o resultado.
- `POST /api/orcamento` sem `client_id` e sem identificador forte válido (documento, e-mail ou telefone) só cria cliente com `extracted.confirm_new_client: true`; sem isso responde `409 CLIENT_SELECTION_REQUIRED`. Conflitos de identidade usam `409` com `code` opcional (`CLIENT_SELECTION_REQUIRED`, `CLIENT_IDENTITY_CONFLICT`, `CLIENT_ARCHIVED`) e cliente inexistente responde `404` com `code: CLIENT_NOT_FOUND`.

## Fluxo de git

- Mudanças triviais e reversíveis (CSS, copy, navegação, ajuste pequeno de UI) podem ser implementadas localmente sem issue ou worktree.
- Publicação segue branch curta + PR + CI, inclusive para mudanças triviais. Ao solicitar um fluxo de skill, o usuário autoriza as operações Git e de tracker previstas nele, incluindo commit, integração de branches de subagentes na branch de trabalho, push dessa branch e PR draft. Isso não autoriza push direto em `master`, merge do PR em `master`, alteração de env operacional, envio externo nem operações em produção.
- Não há gate por contagem de arquivos. Pergunte somente quando a autorização ou o risco mudar.
- Sincronize `git pull --ff-only origin <base>` após checar o status e antes das mudanças, preservando trabalho alheio.
- Após o merge do PR, use `sh scripts/post-merge-cleanup.sh` para limpar branches com upstream apagado e ancestralidade comprovada em `origin/master`. Worktrees criados pela tarefa podem ser removidos depois de comprovar que estão limpos e que seus commits foram integrados na branch de destino. Preserve trabalho alheio e worktrees sujos; nunca force a remoção para cumprir uma skill.
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

Preserve dados reais e contratos em uso. Não crie compatibilidade para consumidores hipotéticos. Refactors largos podem manter formas antiga e nova temporariamente, conforme a seção Complexidade de `docs/release-lanes.md`.

Antes de adicionar abstração ou infraestrutura para requisito futuro, siga a seção Complexidade de `docs/release-lanes.md`.

## Ritmo de entrega

Siga o procedimento da skill acionada, sem copiá-lo ou reescrevê-lo neste arquivo.
`docs/release-lanes.md` define a classificação de risco, os comandos de validação
e os gates operacionais. A lane não substitui o procedimento da skill.
Antes de editar um diretório, leia os `AGENTS.md` aplicáveis no caminho.
SHIP é o padrão para CRUD recuperável; PostgreSQL não implica CRITICAL.
Não repita testes sem alteração, dúvida concreta ou reprodução.

Preview é a única homologação e Production é o `master`. Deploy manual,
migrations remotas, env operacional e efeitos sobre dados ou comunicação reais
exigem autorização separada. O Preview automático de um push autorizado segue
o isolamento de `docs/release-lanes.md`. Preserve os consumidores técnicos
existentes do pipeline de migrations até decisão explícita.

## Comandos

```bash
npm run dev
npm run verify:fast          # lint + typecheck + checks estruturais baratos
npm run test:unit:focused -- tests/unit/<arquivo>.test.ts   # testes focados
npm run test:unit            # corpus unitário completo
npm run verify:full          # verify:fast + corpus + build + E2E local descartável
```

- Durante a edição, rode o checker barato relevante; antes de entregar código, rode `npm run verify:fast`, conforme a política de risco.
- Quando a skill pedir suíte completa, use `verify:full`, com os pré-requisitos de `docs/release-lanes.md`. A instalação de uma skill não executa nem impõe seu fluxo a toda tarefa.

E2E integrado (HTTP -> PostgreSQL descartável -> UI) usa o ponto de entrada seguro
`npm run test:e2e:safe`; ver `docs/safe-e2e.md`.

## Agent skills

### Issue tracker

Issues são rastreados no GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os cinco labels canônicos de triagem. See `docs/agents/triage-labels.md`.

### Domain docs

Usamos layout single-context. See `docs/agents/domain.md`.

A configuração do kit já existe em `docs/agents/`; não é necessário repetir o setup para instalar skills. `CLAUDE.md` importa este arquivo. Preserve essa fonte única ao alterar a configuração.

## Skills do kit upstream

Use [`mattpocock/skills`](https://github.com/mattpocock/skills) sem modificações locais. As quatro adaptações antigas foram removidas; a instalação é uma etapa separada, feita pelo operador.

- Instale as skills desejadas com `npx skills add mattpocock/skills` e versione os arquivos instalados e `skills-lock.json`. Revise o diff nas atualizações.
- As skills definem os procedimentos; este projeto define arquitetura, segurança, comandos e autorizações operacionais.
- O glossário `CONTEXT.md` e a base `.out-of-scope/` são criados quando houver conteúdo. O tracker ativo é GitHub, conforme `docs/agents/issue-tracker.md`; material histórico fica na tag `archive/historico-2026-09`.
- Use o mecanismo de skills do agente em execução. No OMP, `Call the Skill tool with "x"` corresponde a ler `skill://x`.
- Instalar uma skill não autoriza instalar suas dependências ou alterar hooks, credenciais e recursos externos. Solicite as aprovações específicas quando forem necessárias.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
