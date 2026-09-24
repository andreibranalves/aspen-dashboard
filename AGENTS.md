# AGENTS.md - Aspen Orçamento

Ferramenta interna de operador único, em produção, com dados reais. Mapa e boundaries em `ARCHITECTURE.md`, produto em `PRODUCT.md`, vocabulário em `CONTEXT.md` e decisões em `docs/adr/`. Antes de editar um diretório, leia os `AGENTS.md` aplicáveis no caminho.

## Estágio do produto

O objetivo de engenharia é aprender e entregar rápido, preservando rigor somente onde um erro causa dano real (dados, dinheiro, comunicação externa, segurança, inconsistência permanente). Prioridade: velocidade de entrega, baixo custo/tokens, simplicidade, segurança proporcional e qualidade suficiente.

Preserve dados reais e contratos em uso. Não crie compatibilidade para consumidores hipotéticos nem abstração ou infraestrutura para requisito futuro; o critério e a exceção de refactor largo estão na seção Complexidade de `docs/release-lanes.md`.

## Convenções

- Use apenas ESM; imports do backend para arquivos locais incluem a extensão `.js`.
- Handlers recebem eventos no formato Lambda e retornam `{ statusCode, headers?, body }`. Registre cada endpoint uma única vez em `api/_app/routes.ts`.
- Mensagens HTTP destinadas ao usuário são escritas em português brasileiro.
- O frontend é para um operador único experiente. Não acrescente texto de ajuda abaixo de campos, descrições de PageHeader/seção que repetem o título, nem copy tutorial. Deixe texto auxiliar só quando a consequência não aparece no rótulo: efeito colateral, ação bloqueada, ou empty state com o próximo passo.
- As rotas do frontend são por hash, em `src/app/routes.tsx`; não adicione React Router.
- Prefira estado local ou contexto; não adicione biblioteca de estado global sem aprovação.
- PostgreSQL é a única fonte de verdade (ADR 0008) e Evolution API o único transporte de WhatsApp (ADR 0010). Não adicione fallbacks de provedor, transporte ou persistência, nem branches de rollout; fallbacks de leitura ou cache existentes no frontend não autorizam novos caminhos de persistência.
- Não exponha erros de banco, erros brutos de integrações, stack traces, segredos ou dados pessoais em respostas e logs. Autenticação e rate limiting passam pelo pipeline compartilhado, local e implantado.
- Não edite arquivos gerados pelo Vite em `public/`.

## Comandos

```bash
npm run dev
npm run verify:fast          # lint + typecheck + checks estruturais; antes de entregar código
npm run test:unit:focused -- tests/unit/<arquivo>.test.ts
npm run test:unit            # corpus unitário
npm run verify:full          # RELEASE; pré-requisitos em docs/release-lanes.md
npm run test:e2e:safe        # HTTP -> PostgreSQL descartável -> UI; docs/safe-e2e.md
```

`docs/release-lanes.md` define a lane e a validação exigida. SHIP é o padrão para CRUD recuperável; PostgreSQL não implica CRITICAL. Siga o procedimento da skill acionada; a lane não o substitui. Não repita testes sem alteração, dúvida concreta ou reprodução.

## Autorizações

Esta seção é a fonte; os demais documentos apontam para ela.

- Mudança trivial e reversível (CSS, copy, navegação, ajuste pequeno de UI) pode ser feita localmente sem issue ou worktree. Publicação é sempre branch curta + PR + CI.
- Pedir um fluxo de skill autoriza as operações Git e de tracker previstas nele: commit, integração de branches de subagentes na branch de trabalho, push dessa branch e PR draft. Pergunte somente quando a autorização ou o risco mudar.
- Exigem autorização explícita e separada: push direto ou merge em `master`, deploy manual, alteração de env operacional, envio externo, efeitos sobre dados ou comunicação reais e aplicar migration em qualquer alvo que não seja PostgreSQL local descartável.
- Criar e testar migration genuinamente aditiva em PostgreSQL local descartável faz parte da implementação. Alterar migration histórica, criar migration destrutiva ou mudar a estratégia de migrations exige decisão explícita; preserve os consumidores técnicos do pipeline de migrations até essa decisão.
- Não adicione dependências sem aprovação explícita. Instalar uma skill não autoriza instalar suas dependências nem alterar hooks, credenciais e recursos externos.
- Nunca registre ou versione `.env`, credenciais ou dados de produção.
- Preview é a única homologação e Production é o `master` (ADR 0011). O Preview automático de um push autorizado segue `docs/preview-isolation.md` e não autoriza produção.

## Git

- Antes de mudar, cheque o status e sincronize com `git pull --ff-only origin <base>`, preservando trabalho alheio.
- Após o merge do PR, `sh scripts/post-merge-cleanup.sh` limpa branches com upstream apagado e ancestralidade comprovada em `origin/master`. Remova worktrees da tarefa só quando estiverem limpos e integrados; nunca force a remoção.

## Ambiente operacional

- Valores reais ficam fora do checkout em `$HOME/.config/aspen-dashboard/.env.local` ou `.env`, com diretório em modo `0700` e arquivos em `0600`.
- Antes de uma operação com env operacional, rode `node scripts/cutover-env-status.mjs <operação>`. O preflight mostra só nomes e estados `present` ou `missing`, nunca valores.

## Agent skills

### Issue tracker

Issues são rastreados no GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

Usamos os cinco labels canônicos de triagem. See `docs/agents/triage-labels.md`.

### Domain docs

Usamos layout single-context. See `docs/agents/domain.md`.

As skills vêm de [`mattpocock/skills`](https://github.com/mattpocock/skills) sem modificação local e são instaladas pelo operador com `npx skills add mattpocock/skills`; versione os arquivos e `skills-lock.json` e revise o diff nas atualizações. As skills definem procedimentos; este arquivo define arquitetura, segurança, comandos e autorizações. Use o mecanismo de skills do harness em execução (Claude Code, Codex, OMP/pi, Hermes); no OMP, `Call the Skill tool with "x"` corresponde a ler `skill://x`. `CLAUDE.md` só importa este arquivo.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
