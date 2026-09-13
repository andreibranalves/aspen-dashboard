# Lanes de entrega: SHIP, SAFE e CRITICAL

Esta é a fonte normativa única das lanes, da revisão e dos limites de correção.
A prioridade é ship fast: classifique pela consequência concreta do diff,
remova validação sem valor e preserve rigor onde há dano real. `SHIP` é o
padrão. `RELEASE` é um gate periódico, não uma lane de issue.

## SHIP (padrão)

Inclui UI, CSS, copy, navegação, filtros, CRUD comum de cliente/produto,
pequenas APIs, bug simples e refactor local. PostgreSQL continua SHIP quando o
dano é baixo e recuperável.

Fluxo: implementar → teste focado somente quando trouxer confiança real →
`npm run verify:fast` uma vez antes da entrega → CI. Não há reviewer por
padrão. Corpus completo, PostgreSQL completo e browser completo local são
exceções justificadas, não hábito. Docs-only verifica diff, links e coerência
sem compilar o app. SHIP usa somente CI: não exige inspeção manual nem E2E
manual/Preview.

## SAFE

Inclui persistência ou comportamento relevante, mas controlável: migration
aditiva, tabela/coluna nova simples, relação comercial reparável e oportunidade
ou follow-up sem efeito irreversível.

Fluxo: implementar → `verify:fast` uma vez → teste focado da garantia alterada
→ PostgreSQL descartável somente se o banco for necessário → E2E focado somente
se a jornada exigir → um reviewer → CI. Quando houver jornada relevante, usar
o Preview isolado; sem jornada relevante, não fazer inspeção manual nem E2E
manual.

## CRITICAL

Use somente quando o diff puder causar dano concreto: auth/authz, segredos,
valores oficialmente emitidos, pedido/venda real, envio externo, duplicidade,
idempotência ou concorrência danosa, migration destrutiva ou corrupção durável
difícil de recuperar. O ticket/PR deve citar o dano.

Fluxo: invariantes e erros → `verify:fast` uma vez → PostgreSQL/E2E quando
pertinentes → um reviewer aprofundado → CI + Preview + preflight de isolamento
→ E2E focado quando pertinente → aprovação operacional quando exigida →
merge/deploy.

Migrations seguem o [runbook PostgreSQL](./database-migrations.md), inclusive
alvo, preflight, backup e aprovação. Não se aplicam migrations em staging ou
produção sem autorização operacional separada.

## Revisão e correção

Reviewer é consultor. Bloqueia apenas bug reproduzível, acceptance criterion
atual não cumprido, vulnerabilidade concreta, efeito externo incorreto ou perda
e corrupção relevantes. Hardening hipotético, arquitetura futura e cenário
improvável são FOLLOW-UP ou IGNORE.

O limite GLOBAL de ciclos após review é: SHIP 1, SAFE 2, CRITICAL 3. A contagem
não reinicia por agente, reviewer ou CI. Não repita a mesma suíte entre
implementador, Hermes e reviewer sem alteração, dúvida concreta ou reprodução;
entregue logs e testes como evidência sem repetição ritual. Ao atingir o limite,
STOP: registre o blocker e não faça merge inseguro nem peça mais reviewers para
resetar a contagem. Hermes arbitra `BLOCKER`, `FOLLOW-UP` ou `IGNORE`.

Backup ajuda a recuperar CRUD comum, mas não desfaz envio duplicado, orçamento
oficialmente emitido errado, pedido real ou corrupção comercial. Esses efeitos
continuam sendo critérios de `CRITICAL` mesmo quando há backup.

## Ambientes

PR/branch usa CI e Vercel Preview, com URL própria, `APP_ENV=preview`,
`EXTERNAL_WRITES_ENABLED=0` e PostgreSQL isolado por branch. O prune existente
no fechamento do PR é best-effort; não há claim de remoção garantida sem
evidência operacional.

Merge em `master` usa Vercel Production, banco e integrações reais conforme a
configuração operacional. Preview é a única homologação. VPS de staging,
target permanente de migration e branch permanente não são ambientes de
homologação. `npm run preview` do Vite e a prévia de orçamento são recursos
locais/documentais, não homologação.

A URL `DATABASE_URL` usada no E2E deve ser a URL efetiva do deployment do PR,
verificada pelo operador. Preflight local, `/api/operational-status` e fixture
atestada são provas independentes de configuração, writes-off, conectividade e
persistência; não provam sozinhas a identidade única da branch. A aprovação de
deploy, migration, envio ou outro efeito externo é sempre separada.

## RELEASE

Use `npm run verify:full` somente para release importante, milestone, mudança
transversal relevante ou pedido explícito. Ele reúne `verify:fast`, corpus,
build e E2E; não pertence ao inner loop de toda issue.

## Ciclo de vida das branches de Preview

A integração Vercel + Neon e o workflow
`.github/workflows/neon-preview-prune.yml` fazem a tentativa best-effort de
limpar a branch PostgreSQL associada quando o PR fecha. O workflow não prova
que houve deployment, criação da branch ou remoção efetiva, e falha não bloqueia
o PR.

Para uma limpeza manual, o operador lista as branches sem alterar recursos,
compara-as aos PRs abertos, preserva `main` e releases em validação, apresenta
as candidatas e obtém aprovação humana explícita. Remover uma branch é
destrutivo para seu banco; `main` nunca é removida e `backup-*` exige aprovação
específica.

## Complexidade

Adicione abstração, infraestrutura ou compatibilidade apenas para requisito
atual ou falha observada, quando a solução simples for comprovadamente
insuficiente e o custo for proporcional ao dano. Não crie adapters, dual-read,
dual-write, backfills complexos ou fallbacks para consumidores hipotéticos.
