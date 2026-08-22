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

## Comandos

```bash
npm run dev
npm run verify:fast
npm run verify:full
```

- Use `verify:fast` durante o desenvolvimento.
- Use `verify:full` antes de considerar uma alteração concluída.

## Development workflow

O development lifecycle global se aplica. GitHub Issues é a fonte de verdade, e iniciativas não triviais usam `/wayfinder` com child issues e dependencies nativas. Implemente apenas a frontier desbloqueada, em branch dedicada, e abra PR para todo trabalho não trivial. O implementer não faz merge da própria implementação.

Execute `npm run verify:fast` durante o desenvolvimento e `npm run verify:full` antes do handoff ou review, quando aplicável. O merge exige CI obrigatório verde e review independente aprovado. Use `master` como branch padrão. Após o merge, resolva a issue e avance o Wayfinder.

Mantenha os human gates já definidos para migrations, produção, external writes e dados. Consulte `docs/agents/development-loop.md` ao planejar, implementar, revisar, integrar ou concluir trabalho não trivial.

Ao concluir qualquer tarefa, sempre informe de forma objetiva o próximo passo recomendado, considerando a sequência lógica do projeto. Não encerre apenas dizendo que terminou. Não execute o próximo passo sem solicitação do usuário, salvo modo autônomo explicitamente autorizado.

## Agent skills

### Issue tracker

Issues são rastreados no GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os cinco labels canônicos de triagem. See `docs/agents/triage-labels.md`.

### Domain docs

Usamos layout single-context. See `docs/agents/domain.md`.
