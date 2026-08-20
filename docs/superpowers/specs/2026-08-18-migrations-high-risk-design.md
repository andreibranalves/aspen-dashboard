# Fase 16 - Migrations como HIGH risk

## Status

Design aprovado em brainstorming.

Implementação ainda não aprovada.

Este documento descreve os guardrails e o fluxo operacional, mas não autoriza executar migration, E2E de staging, cutover ou operação de produção.

## Contexto

PostgreSQL é a fonte de verdade do Aspen Dashboard.

Drizzle gera e aplica migrations versionadas em `drizzle/`.

O comando `npm run db:migrate` já existe e deve continuar disponível para desenvolvimento e testes PostgreSQL locais.

Migrations não podem executar implicitamente no startup, no build ou no CI padrão.

A lane HIGH cobre migrations, autenticação, WhatsApp, integrações externas, permissões e mudanças destrutivas.

A Fase 15 já estabeleceu o boundary PostgreSQL + Drizzle e exige que migrations históricas permaneçam intactas.

## Objetivos

- Impedir alteração, remoção ou rename de migrations SQL já rastreadas.
- Exigir classificação explícita em migrations novas.
- Validar o alvo staging antes de qualquer apply operacional.
- Evitar que `DATABASE_URL` herdada aponte a operação para produção.
- Produzir checklist redigido que possa ser salvo fora do checkout.
- Documentar additive, destructive, expand, migrate data e contract.
- Preservar o comando local existente sem criar migration implícita.

## Fora de escopo

- Executar `npm run db:migrate` durante esta fase.
- Executar `npm run test:e2e:staging` durante esta fase.
- Alterar, renomear ou regenerar arquivos históricos em `drizzle/`.
- Criar uma migration de produto para validar o fluxo.
- Executar migration em produção.
- Automatizar backup, deploy, aprovação ou canary.
- Criar rollback automático para SQL arbitrário.
- Inferir segurança semântica completa a partir de regex SQL.
- Adicionar dependências.

## Decisões

### Dois gates independentes

O gate estático `npm run check:db-migrations` roda sem banco e pode ser executado no CI de pull request.

O gate operacional `npm run db:migration:preflight` executa somente validações read-only contra o alvo nomeado de staging.

Nenhum gate aplica migration.

O comando `npm run db:migrate` permanece genérico para uso local e não recebe comportamento implícito novo.

### Contrato de ambiente

O contrato canônico da operação HIGH usa `STAGING_DATABASE_URL` e `STAGING_PG_SERVICE`.

`STAGING_DATABASE_URL` deve ser fornecida pelo shell operacional aprovado.

`STAGING_PG_SERVICE` deve identificar uma seção no `PGSERVICEFILE` protegido.

`PGSERVICEFILE` e `PGPASSFILE` devem ser arquivos regulares com modo `0600`.

O destino efetivo do serviço nomeado deve coincidir com host, porta e database obtidos da URL staging.

O database retornado por `SELECT current_database()` deve coincidir com o database da URL staging.

A identidade host, porta e database do staging deve ser diferente de `PRODUCTION_DATABASE_URL`.

O preflight não imprime URLs, usuários, senhas, hosts, payloads ou linhas de dados.

O contrato `CUTOVER_*` existente continua pertencendo ao fluxo de backup/cutover já implementado.

Não haverá alias silencioso entre `STAGING_*` e `CUTOVER_*`.

### Classificação no cabeçalho

Toda migration SQL nova deve começar, após linhas em branco opcionais, com exatamente um cabeçalho no formato:

```sql
-- migration-risk: additive
```

ou:

```sql
-- migration-risk: destructive
```

O check aceita somente esses dois valores e rejeita ausência, duplicidade ou valor desconhecido.

A classificação cobre o maior risco da migration inteira.

Quando houver dúvida, a migration deve ser classificada como `destructive`.

O cabeçalho não prova que o SQL é seguro.

O review da mudança deve confirmar se o SQL corresponde à categoria declarada.

### Imutabilidade histórica

Um arquivo `drizzle/*.sql` que existia no ref base não pode ser modificado, removido, copiado ou renomeado.

Uma migration nova pode ser adicionada, desde que tenha o cabeçalho obrigatório.

A checagem opera sobre o diff Git da mudança, não exige cabeçalhos retroativos nos arquivos históricos.

O ref base pode ser fornecido por `MIGRATION_BASE_REF`.

O check também deve reconhecer arquivos novos não rastreados no workspace local.

O CI deve fornecer um ref base disponível no checkout para que a regra cubra o pull request inteiro.

### Destructive e expand-contract

`additive` cobre alterações compatíveis como coluna nullable, tabela nova e índice novo.

`destructive` cobre drop, remoção, rename, alteração incompatível de tipo ou constraint e qualquer operação que possa quebrar a versão anterior.

Uma sequência destrutiva deve seguir:

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

`expand` introduz estrutura compatível antes de a aplicação depender exclusivamente dela.

`deploy compatível` mantém a versão antiga e a nova funcionando durante a transição.

`migrate data` transforma ou preenche dados enquanto o contrato compatível está ativo.

`contract` remove a estrutura antiga somente depois de a dependência anterior ter sido removida e validada.

Uma migration destrutiva isolada não satisfaz esse fluxo, mesmo que o header esteja correto.

O spec, plano e review da mudança devem registrar a etapa da sequência e a evidência de compatibilidade.

## Componentes

### `scripts/check-db-migrations.mjs`

O script recebe o ref base por `MIGRATION_BASE_REF` quando fornecido.

Sem ref explícito, o script verifica mudanças staged, unstaged e arquivos novos não rastreados no workspace.

Para cada caminho sob `drizzle/` com extensão `.sql`, o script classifica o status Git.

Status de modificação, remoção, cópia ou rename de arquivo que já existia no base falham.

Status de adição exigem o cabeçalho de risco válido.

Um workspace sem mudança de migration passa sem exigir alterações nos arquivos históricos.

A saída lista somente caminho, status, risco e resultado.

O exit code é zero somente quando todas as regras passam.

### `scripts/migration-preflight.mjs`

O script lê apenas variáveis já fornecidas pelo shell operacional aprovado.

O script não carrega `.env` do checkout e não escolhe automaticamente `DATABASE_URL`.

O script valida presença de `STAGING_DATABASE_URL`, `STAGING_PG_SERVICE`, `PGSERVICEFILE`, `PGPASSFILE` e `PRODUCTION_DATABASE_URL`.

O script valida formato PostgreSQL e extrai host, porta e database sem imprimir esses valores.

O script lê somente a seção de `STAGING_PG_SERVICE` no `PGSERVICEFILE`.

O script rejeita seção ausente, host ausente, database ausente e `hostaddr` divergente.

O script compara a identidade efetiva do serviço com a URL staging.

O script executa `psql` com `--no-psqlrc`, `ON_ERROR_STOP=1` e `SELECT current_database()` contra `service=$STAGING_PG_SERVICE`.

A execução remove `DATABASE_URL`, `TEST_DATABASE_URL`, `PGSERVICE` e outras variáveis de seleção conflitantes do ambiente filho.

O script compara o database retornado com o database da URL staging.

O script compara a identidade de staging com `PRODUCTION_DATABASE_URL` e falha se forem iguais.

Nenhuma operação de escrita é executada pelo preflight.

A saída contém estados `PASS` ou `FAIL`, timestamp e resultado redigido.

Falhas usam mensagens em português e não repassam stderr bruto de ferramentas que possam conter conexão ou dados.

### `scripts/postgres-target.mjs`

O módulo concentra parsing de URL, identidade host/porta/database, leitura de serviço nomeado e validação de permissões protegidas.

`migration-preflight.mjs` e `backup-crm.mjs` devem usar as mesmas funções para evitar divergência na prova de alvo.

A extração preserva os contratos `CUTOVER_*` e os testes existentes de backup.

O módulo não cria conexão de aplicação e não imprime credenciais.

### `package.json`

Adicionar `check:db-migrations` apontando para o gate estático.

Adicionar `db:migration:preflight` apontando para o gate operacional.

Não alterar o comando `db:migrate` para executar preflight ou escolher staging automaticamente.

### CI

O CI de pull request executa o gate estático sem acesso a banco ou segredos.

O job que executa o gate deve fazer checkout de um ref base disponível para o diff.

O CI padrão não executa preflight operacional, migration ou E2E de staging.

### Documentação

`docs/database-migrations.md` será a documentação operacional ativa da Fase 16.

`docs/release-lanes.md` será atualizado para referenciar os dois gates e a injeção explícita de `TEST_DATABASE_URL`.

`.env.example` documentará somente os nomes, sem valores operacionais.

A documentação explicará como salvar stdout fora do checkout sem incluir segredos.

A documentação reforçará que `STAGING_DATABASE_URL` e `STAGING_PG_SERVICE` vêm do shell operacional aprovado.

## Fluxo aprovado

O fluxo HIGH de staging será:

```bash
npm run check:db-migrations
node scripts/cutover-env-status.mjs
npm run db:migration:preflight
TEST_DATABASE_URL="$STAGING_DATABASE_URL" DATABASE_URL= npm run db:migrate
npm run test:e2e:staging
```

O operador deve parar na primeira falha.

A saída dos gates deve ser salva fora do checkout em diretório operacional protegido.

A evidência deve relacionar commit, migration, risco, timestamp e resultado sem incluir segredo ou dado de banco.

Após migration bem-sucedida e E2E verde, a lane HIGH continua exigindo os gates de Preview, backup, aprovação explícita, Production e canary read-only já documentados.

A execução de produção permanece fora desta implementação e exige decisão operacional explícita.

## Falhas e recuperação

Ausência de variável, arquivo protegido ou serviço nomeado bloqueia antes do apply.

URL inválida, serviço divergente, database divergente ou identidade igual à produção bloqueia antes do apply.

Cabeçalho ausente ou inválido bloqueia a mudança no check estático.

Alteração de migration histórica bloqueia a mudança no check estático.

Falha de `psql` bloqueia o preflight e não chama `db:migrate`.

Falha de `db:migrate` encerra o fluxo e não inicia E2E, Preview ou produção.

Não haverá rollback automático.

Restauração de staging ou produção segue os procedimentos de backup e restore existentes, com alvo explicitamente isolado.

## Testes

`tests/unit/check-db-migrations.test.js` deve cobrir adição válida, header ausente, header inválido, header duplicado, edição histórica, remoção histórica, rename histórico, arquivo novo não rastreado e workspace sem mudanças.

`tests/unit/migration-preflight.test.js` deve cobrir variáveis ausentes, arquivo com permissão insegura, serviço ausente, serviço divergente da URL, database efetivo divergente, alvo igual à produção, falha do `psql`, sucesso read-only e ausência de valores sensíveis na saída.

`tests/unit/backup-crm.test.ts` deve continuar verde após a extração dos helpers compartilhados.

Os testes unitários não devem exigir banco PostgreSQL, credenciais, `psql` real ou rede.

A validação da fase deve incluir lint, typecheck, unitários, build, check de boundary, check de legacy provider e `git diff --check`.

A validação não inclui `npm run db:migrate`, `npm run test:e2e:staging` ou `node scripts/cutover-env-status.mjs` com ambiente operacional real.

## Critérios de aceite

- Migration histórica não pode ser alterada pelo check.
- Migration nova sem classificação não pode passar.
- Migration nova com classificação válida pode passar o gate estático.
- Preflight não pode aceitar URL sem serviço nomeado correspondente.
- Preflight não pode aceitar database efetivo diferente da URL.
- Preflight não pode aceitar staging com a mesma identidade da produção.
- Preflight não pode escrever no banco.
- Saída de sucesso e falha não pode expor segredos ou dados.
- `db:migrate` continua explícito e não é chamado por startup, build ou CI padrão.
- Backup existente preserva comportamento e testes.
- Documentação descreve additive, destructive e expand-contract sem autorizar operação real.
- Todos os checks locais previstos passam.

## Decisões adiadas

A definição de janela de retenção de dados após `contract` pertence ao plano específico de cada mudança destrutiva.

A política de lock e timeout para cada SQL pertence ao review da migration concreta.

O formato de aprovação de produção permanece na governança operacional da lane HIGH.
