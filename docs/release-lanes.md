# Classificação de risco: SHIP, SAFE e CRITICAL

Este documento é a **fonte normativa única** das lanes, do processo de revisão e dos limites de correção. Outros documentos e runbooks referenciam as lanes e os comandos canônicos definidos aqui em vez de reproduzir definições, testes ou limites divergentes.

O Aspen Orçamento é uma ferramenta interna de operador único, em produção, com dados reais. Dados reais e contratos em uso precisam ser preservados; não implemente compatibilidade com consumidores hipotéticos. O estágio do produto e as prioridades estão em [`AGENTS.md`](../AGENTS.md). O contexto atual e esta política prevalecem sobre skills genéricas e planos históricos no processo, sem apagar acceptance criteria atuais nem relaxar segurança por omissão.

Classifique pela consequência concreta do **diff**, não por palavra-chave, número de arquivos ou domínio. `SHIP` é o padrão; promova apenas com critério objetivo.

## SHIP (padrão)

Mudanças reversíveis sem dano concreto: UI, copy, navegação, filtros, CRUD comum, pequenas APIs, refactor local, bug simples.

- Checks baratos conforme a mudança; teste focado só quando agrega confiança real.
- Docs/copy não exigem teste novo; mudança docs-only verifica diff, links e consistência, sem compilar o app.
- Zero ou uma revisão leve.

## SAFE

Persistência ou comportamento relevante, porém controlável e reversível.

- Checks baratos e testes focados das garantias alteradas.
- PostgreSQL descartável ou integração somente quando a garantia depender deles; E2E focado quando a jornada exigir.
- Um reviewer.
- Migration genuinamente aditiva pode ser SAFE se preservar os dados e a compatibilidade com o app anterior, sem dano concreto. Criar e testar a migration em PostgreSQL local descartável faz parte da implementação autorizada. Aplicar em staging/produção exige autorização operacional explícita e separada; alterar migration histórica, criar migration destrutiva ou mudar a estratégia de migrations exige decisão explícita.

## CRITICAL

Use somente com consequência concreta: perda ou corrupção irreversível de dados, migration destrutiva, autenticação/autorização/isolamento, dinheiro ou valores oficialmente emitidos, envio externo real, exposição de segredos, concorrência/idempotência cuja falha produza dano real. **Cite o dano** no ticket/PR.

- Checks pertinentes + testes das invariantes afetadas e caminhos de erro.
- PostgreSQL descartável e E2E **somente** onde a garantia depender dessa camada; não é pacote automático.
- Um reviewer, com aprofundamento orientado ao risco.

```text
checks + testes das invariantes e caminhos de erro
-> PostgreSQL descartável e/ou E2E focados, quando a garantia depender
-> revisão orientada ao risco
-> Preview
-> aprovação explícita
-> Production
```

Migrations seguem o [runbook Migrations PostgreSQL](./database-migrations.md), inclusive gate estático, apply, alvos, preflight, evidência, cutover e backup. O runbook é o procedimento operacional canônico; não reproduza as etapas aqui.

Mudanças destrutivas seguem `expand -> deploy compatível -> migrate data -> contract`.

## RELEASE (gate periódico)

RELEASE não é um quarto tipo de tarefa: é um gate aplicado ao conjunto integrado antes de deploy importante, milestone, mudança transversal que justifique ou solicitação explícita. `verify:full` fica **fora do inner loop**.

```bash
npm run verify:full          # verify:fast + corpus completo + build + E2E
npm run test:postgres        # PostgreSQL real, quando aplicável
```

Inclui também smoke manual das jornadas principais, revisão de migrations pendentes e regressões conhecidas documentadas.

## Inner loop e validação

Ciclo: editar -> checker barato relevante -> teste focado se necessário. Antes de entregar código, rode `npm run verify:fast` (não a cada edição), em qualquer lane; SAFE e CRITICAL acrescentam os checks e testes focados das garantias alteradas. No fim, verifique a evidência pertinente ao diff.

- Suite completa, todos os E2E/PG, múltiplos browsers e auditorias amplas não são default.
- Teste comportamento e risco, não coverage nem detalhe interno. Preserve os testes baratos de regressão existentes.
- Não repita a mesma suite no worker/Hermes/reviewer sem mudança ou dúvida concreta; Hermes inspeciona log, escopo e resultado e só reexecuta o necessário para comprovar.
- Falha de infraestrutura não prova bug do produto, mas um comando que falhou não pode ser chamado de verde.

## Revisão

Um reviewer é consultor, um por vez, sem eixos paralelos. Hermes verifica e classifica os findings; o worker recebe apenas blockers aceitos. O reviewer não inicia workers, outro reviewer, issues ou implementações.

- **BLOCKER** — acceptance criteria atual não atendido, bug funcional reproduzível, regressão introduzida ou vulnerabilidade/efeito externo/perda de dados concreta que impeça o uso esperado seguro. Exige arquivo/linha, caminho alcançável ou reprodução, impacto e solução mínima. Não exigir incidente em produção para reconhecer risco de segurança comprovável por código; severidade HIGH sozinha não basta.
- **FOLLOW-UP** — hardening, cenário improvável sem dano que bloqueie o uso esperado, melhoria arquitetural, escopo futuro ou problema antigo não agravado. Não bloqueia merge e não gera issue automaticamente. Problema preexistente que torne a feature insegura no uso esperado ainda exige decisão explícita, não anistia geral.
- **IGNORE** — custo/complexidade supera o benefício neste estágio.

Classifique cada finding pelo impacto específico: um detalhe do runner dentro de um PR crítico não herda automaticamente o risco do domínio.

## Limites de correção

Limites são tetos, não metas: SHIP 1, SAFE 2, CRITICAL 3 ciclos de correção após review. Um ciclo é um brief consolidado de correção e a validação correspondente. Não zere o contador trocando agente/modelo, chamando correção de CI ou após aprovação.

- Correção aprovada por Hermes recebe verificação focada no delta e em risco novo real; não reabra toda a feature por hábito.
- No limite com blocker restante: **STOP**. Sem merge inseguro, sem outro reviewer para desempatar, sem nova arquitetura automática.
- Hermes apresenta blocker, evidência, impacto, solução mínima, alternativas e custo aproximado e decide simplificação, rollback, redução de escopo autorizada ou escalonamento humano. Novo orçamento de trabalho exige decisão explícita, não autocontinuação.

## Complexidade

Adicione complexidade apenas para um requisito atual ou falha observada, com a solução simples comprovadamente insuficiente e custo proporcional ao dano. Não sofistique por sunk cost.

Se a correção aumentar muito o diff, criar novas classes de falha, exigir infra/operação especializada ou gerar edge cases sucessivos, interrompa antes do limite e compare rollback/simplificação.

Exemplos de aplicação: um Chromium destacado que ocasionalmente sobrevive a `SIGTERM`, rodando com DB descartável e sem credenciais/egress, é limitação best-effort documentável, não motivo isolado de blocker; um supervisor capaz de matar processo alheio deve ser removido/simplificado, não endurecido indefinidamente. Retry capaz de emitir/cobrar um pedido duas vezes é BLOCKER concreto. A correção do discovery do Playwright não justifica um supervisor Linux.

## Falhas antigas

Não abra issue obrigatória. Registre no PR/relatório curto a evidência suficiente de que a falha é preexistente e não agravada; reproduza apenas o comando relevante na base quando necessário para decidir, sem rodar o corpus inteiro por ritual. Não mascare o status do CI nem contorne check obrigatório.

## Branches e PRs

- PRs pequenos e utilizáveis, não micro-PRs artificiais. Não há gate por contagem de arquivos; na dúvida, branch curta.
- Mecânica de git, sincronização e limpeza pós-merge: [`AGENTS.md`](../AGENTS.md).
- Mudanças triviais podem seguir no fluxo direto já autorizado; `SHIP` não autoriza push/deploy nem pular check existente.
- Demais mudanças vão em branch curta + PR quando a publicação for autorizada. Publicação pode disparar Preview; aprovação de deploy é separada quando o escopo exclui deploy.

## Regras comuns

- CI padrão executa lint, tipos, corpus unitário completo, repositories contra banco descartável, build e smoke E2E como rede de segurança assíncrona. A descrição é factual: o CI ainda não filtra por SHIP/SAFE/CRITICAL.
- E2E completo de staging não executa no CI padrão.
- Writes externos reais, auth, migrations e mudanças destrutivas nunca são SHIP.
- Preview não substitui aprovação de fluxos CRITICAL.
- O documento orienta o processo, mas não automatiza deploy, backup, aprovação, migration ou canary.

## Utilitários operacionais suportados

Estes comandos são invocados manualmente pelo operador e fazem parte do runtime de operações do projeto:

- `node scripts/hash-app-password.mjs` — gera `APP_PASSWORD_HASH` sem imprimir a senha digitada (setup/rotação de acesso).
- `node scripts/whatsapp-identity-audit.mjs` — auditoria somente-leitura de identidades WhatsApp persistidas (diagnóstico de provider; usa credenciais do ambiente aprovado, nunca imprime PII).

Migrations não executam no startup ou implicitamente durante o build. O único apply no CI é a exceção explícita do banco descartável do job `postgres`; alvos operacionais continuam fora do CI padrão. Preservam-se preflight, aprovação explícita, alvos de staging/produção e backup definidos no [runbook Migrations PostgreSQL](./database-migrations.md).

## Ciclo de vida das branches de Preview

A integração Vercel + Neon cria uma branch PostgreSQL `preview/<git-branch>` para cada nova branch implantada em Preview. O projeto Neon Free comporta 10 branches; `main` ocupa uma delas.

A integração só remove a branch Neon quando o deployment Vercel correspondente é deletado (retention de preview default de meses), então o prune garantido é automático: ao fechar um PR — merged ou não — o workflow `.github/workflows/neon-preview-prune.yml` deleta `preview/<head-branch>` via `neondatabase/delete-branch-action` com o secret `NEON_API_KEY`. A remoção é best-effort e não bloqueia o PR.

A limpeza manual permanece para os casos fora do fluxo automático:

1. branches `preview/*` sem PR associado (deploy falhou antes de criar branch, PR convertido em draft abandonado fora do GitHub, etc.);
2. branches usadas por uma validação de release em andamento que precise liberar capacidade;
3. auditoria semanal de segurança.

Antes de remover qualquer branch manualmente:

1. liste as branches Neon sem alterar recursos;
2. compare cada `preview/*` com os PRs abertos no GitHub;
3. preserve `main` e qualquer release em validação;
4. apresente a lista de candidatas e obtenha aprovação humana explícita;
5. remova somente as candidatas aprovadas e confirme a capacidade liberada.

A remoção é destrutiva para o banco daquela Preview. `main` nunca é removida; branches `backup-*` só saem com aprovação humana explícita.
