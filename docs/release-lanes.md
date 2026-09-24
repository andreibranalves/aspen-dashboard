# Lanes de entrega: SHIP, SAFE e CRITICAL

Este documento define risco, validação e gates operacionais do Aspen.
As skills acionadas definem o procedimento de implementação e revisão, sem
forks locais nem limites de ciclos impostos pela lane. `SHIP` é o padrão.
`RELEASE` é um gate de validação, não uma lane de issue. Classifique o diff
inteiro pela maior consequência concreta, não pelo arquivo ou pela skill.

## SHIP (padrão)

Inclui UI, CSS, copy, navegação, filtros, CRUD comum de cliente/produto,
pequenas APIs, bug simples e refactor local. PostgreSQL continua SHIP quando o
dano é baixo e recuperável.

Siga os checks e o review previstos pela skill acionada. A lane não exige
homologação manual adicional ao CI. Para docs-only, verifique diff, links e
coerência sem compilar o app. Quando houver código, execute `verify:fast` e
valide o comportamento alterado; suíte completa segue a seção RELEASE.

## SAFE

Inclui persistência ou comportamento relevante, mas controlável: migration
aditiva, tabela/coluna nova simples, relação comercial reparável e oportunidade
ou follow-up sem efeito irreversível.

Valide a garantia alterada com teste focado. Use PostgreSQL descartável quando
o banco for necessário e E2E quando a jornada exigir. Siga o review da skill
acionada e o CI. Quando houver jornada relevante, use o Preview isolado.

## CRITICAL

Use somente quando o diff puder causar dano concreto: auth/authz, segredos,
valores oficialmente emitidos, pedido/venda real, envio externo, duplicidade,
idempotência ou concorrência danosa, migration destrutiva ou corrupção durável
difícil de recuperar. O ticket/PR deve citar o dano.

Valide invariantes e erros, usando PostgreSQL/E2E quando pertinentes. O review
deve examinar o dano concreto citado no ticket/PR. Exija CI, Preview e preflight
de isolamento, além de E2E focado quando pertinente. Merge/deploy e operações
sensíveis continuam sujeitos às aprovações abaixo.

Migrations seguem o [runbook PostgreSQL](./database-migrations.md), inclusive
alvo, preflight e backup.

## Revisão e correção

Quando solicitado pelo usuário ou pelo fluxo de implementação, siga
`code-review` sem substituir sua composição de agentes ou formato de relatório.
Uma revisão isolada não autoriza correções ou commit; o pedido de implementação
ou de revisão com correção define essas ações.

Corrija bugs demonstrados e requisitos não cumpridos. Achados heurísticos não
justificam expansão silenciosa do escopo. Resolva divergências com o operador
e não faça merge com risco de perda de dados ou efeito externo incorreto.

Não repita a mesma suíte entre implementador e reviewer sem alteração, dúvida
concreta ou reprodução; entregue logs e testes como evidência sem repetição
ritual. O agente principal propõe `BLOCKER`, `FOLLOW-UP` ou `IGNORE`; o operador
arbitra divergências e autoriza operações sensíveis.

O agente principal classifica o risco, implementa e reúne evidências. Se o
harness não oferecer execução independente, registre o review como pendente; uma
segunda leitura própria não o substitui.

Em entrega ou handoff, registre no PR/issue ou documento de passagem: objetivo,
base/HEAD e diff não commitado, branch/worktree, lane e dano, autorizações,
checks executados e código avaliado, correções aplicadas, blockers e próximo
passo. Evidência de outro agente é reutilizável quando corresponde ao código
atual; perda de contexto não autoriza repetir efeitos externos.

Operações Git, de tracker, deploy, migrations remotas, env operacional e efeitos
sobre dados ou comunicação reais seguem a seção Autorizações de `AGENTS.md`.
Preserve trabalho não integrado ao limpar worktrees. Recursos globais de outros
projetos não são pré-requisitos do Aspen.

Backup ajuda a recuperar CRUD comum, mas não desfaz envio duplicado, orçamento
oficialmente emitido errado, pedido real ou corrupção comercial. Esses efeitos
continuam sendo critérios de `CRITICAL` mesmo quando há backup.

## Ambientes

PR/branch usa CI e Vercel Preview isolado; merge em `master` usa Vercel
Production, com banco e integrações reais (ADR 0011). Preflight, E2E controlado
e ciclo de vida das branches Neon estão em [Preview isolado](./preview-isolation.md).

Proteção de branch e vínculo entre CI e promoção precisam de confirmação no
provedor; um workflow configurado não comprova que o merge está tecnicamente bloqueado.

## RELEASE

Quando a skill exigir suíte completa, ou em release importante, milestone,
mudança transversal relevante ou pedido explícito, use `npm run verify:full`.
Ele reúne `verify:fast`, corpus, build e E2E. Docs-only não exige compilar o app.
A instalação de skills não torna RELEASE obrigatório para toda tarefa.

O comando exige `TEST_DATABASE_URL` de PostgreSQL local descartável já
disponível; o preflight inicial falha antes da suíte se o alvo estiver ausente
ou for remoto. O E2E deriva `DATABASE_URL` desse alvo e recusa um valor herdado
diferente. Não carrega `.env` operacional. Veja [E2E seguro](./safe-e2e.md).

## Complexidade

Adicione abstração, infraestrutura ou compatibilidade apenas para requisito
atual ou falha observada, quando a solução simples for comprovadamente
insuficiente e o custo for proporcional ao dano. Não crie adapters, dual-read,
dual-write, backfills complexos ou fallbacks para consumidores hipotéticos.

Exceção única, para refactor largo: quando uma mudança mecânica única tiver
blast radius sobre todo o código e nenhum slice vertical fechar verde, o
`to-tickets` sequencia expand–contract, adicionando a forma nova ao lado da
antiga, migrando por lotes e apagando a forma antiga no ticket `contract`. A
convivência das duas formas vale enquanto esse ticket estiver aberto e termina
com ele; não se transforma em caminho de compatibilidade permanente.
