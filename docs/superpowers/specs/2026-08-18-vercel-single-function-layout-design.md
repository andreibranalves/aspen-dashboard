# Design - Layout de função única na Vercel

Data: 2026-08-18.
Status: abordagem aprovada pelo usuário em 2026-08-18; spec aguardando revisão.

## 1. Objetivo

Restaurar o deploy do Aspen Dashboard no plano Hobby da Vercel com exatamente uma Vercel Function de origem: `api/[...path].ts`.

A mudança deve preservar o monólito modular, o mapa único de rotas, os contratos HTTP, o comportamento local e todos os guardrails de segurança e banco.

## 2. Problema observado

O Preview do PR `#20` falhou depois de concluir o build.

A Vercel retornou:

```text
exceeded_serverless_functions_per_deployment
No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan.
```

O repositório contém 117 arquivos TypeScript rastreados sob `api/`.
A intenção arquitetural é expor apenas o catch-all `api/[...path].ts`.
Entretanto, a refatoração criou dois diretórios públicos para a convenção file-based da Vercel:

- `api/modules/`, com 80 arquivos TypeScript;
- `api/infrastructure/`, com 24 arquivos TypeScript.

A Vercel trata arquivos sob `api/` como Functions por padrão.
Arquivos e caminhos utilitários iniciados por `_` são privados para essa descoberta.
O `vercel.json#functions` configura Functions encontradas, mas não transforma os demais arquivos de `api/` em helpers privados.

O layout anterior em `origin/master` não excedia o limite porque toda implementação auxiliar estava em `_db/`, `_functions/` e `_lib/`.

## 3. Decisão

Renomear somente os dois diretórios públicos:

```text
api/modules/        -> api/_modules/
api/infrastructure/ -> api/_infrastructure/
```

Os demais diretórios permanecem inalterados:

```text
api/
├── [...path].ts
├── _app/
├── _http/
├── _shared/
├── _modules/
└── _infrastructure/
```

`api/[...path].ts` continua sendo a única entrada implantável.
`api/_app/routes.ts` continua sendo o único mapa de endpoints.
O pipeline compartilhado continua em `api/_app/handle-request.ts`.

O prefixo `_` é uma adaptação na camada de implantação.
Ele não altera as responsabilidades arquiteturais de módulos, repositórios ou integrações.

Esta decisão substitui apenas os nomes físicos `api/modules/` e `api/infrastructure/` definidos no design das Fases 4-5.
As demais decisões daquele design permanecem válidas.

## 4. Alternativas rejeitadas

### 4.1. Mover o backend para fora de `api/`

Mover a implementação para `server/` ou outra raiz eliminaria o acoplamento nominal com a Vercel.
A opção foi rejeitada porque repetiria uma movimentação de aproximadamente 104 arquivos sem melhorar comportamento, isolamento ou interfaces do monólito.

### 4.2. Usar `vercel.json#builds`

Uma configuração `builds` poderia declarar somente o catch-all.
A opção foi rejeitada porque `builds` é configuração legada, exige declarar outputs estáticos explicitamente e não deve ser combinada com `functions`.

### 4.3. Atualizar para Vercel Pro

O plano Pro elevaria o limite, mas manteria arquivos auxiliares sendo classificados como Functions.
A opção foi rejeitada porque pagaria para preservar uma classificação incorreta da aplicação.

### 4.4. Usar `.vercelignore`

Ignorar `modules/` e `infrastructure/` removeria dependências importadas pelo catch-all do contexto de build.
A opção foi rejeitada porque exclusão de upload não representa uma seam válida entre entrada e implementação.

## 5. Escopo da migração

A implementação deve:

1. Remover outputs `.js` e `.js.map` ignorados antes dos movimentos.
2. Mover os 80 arquivos de `api/modules/` para `api/_modules/` preservando nomes e layout flat.
3. Mover os 24 arquivos de `api/infrastructure/` para `api/_infrastructure/` preservando subdiretórios.
4. Atualizar imports estáticos, imports dinâmicos, exports e imports de tipos.
5. Preservar extensões `.js` nos imports ESM do backend.
6. Atualizar strings de caminhos usadas por testes e scripts executáveis.
7. Atualizar `drizzle.config.ts` para o novo caminho do schema.
8. Atualizar `scripts/check-postgres-boundary.mjs` sem enfraquecer nenhuma regra existente.
9. Atualizar documentação ativa, incluindo `AGENTS.md` e `docs/postgresql-drizzle-boundary.md`.
10. Manter specs e planos históricos intactos, exceto quando uma referência for usada como contrato ativo por um guard automatizado.
11. Adicionar um guard pequeno contra novas Functions acidentais.
12. Integrar o guard à validação local e ao CI existente.

Não devem existir re-exports, symlinks ou arquivos de compatibilidade nos caminhos antigos.
Todos os consumidores devem mudar atomicamente.

## 6. Consumidores conhecidos

O inventário atual encontrou:

- 308 referências textuais a `api/modules` em 74 arquivos;
- 174 referências textuais a `api/infrastructure` em 47 arquivos;
- imports em `api/_app/routes.ts` e tipos HTTP;
- imports e leituras de fonte em testes unitários;
- imports em scripts operacionais e de auditoria;
- import de tipo em `src/lib/api/quotationIssueApi.ts`;
- caminho do schema em `drizzle.config.ts`;
- regras de fronteira em `scripts/check-postgres-boundary.mjs`;
- documentação ativa e histórica.

Esses números servem como inventário de impacto.
Eles não autorizam rewrite indiscriminado de documentação histórica.

## 7. Guard de layout Vercel

Criar `scripts/check-vercel-function-layout.mjs` sem dependência nova.

O guard deve examinar arquivos de origem rastreados pelo Git sob `api/` e aplicar a convenção file-based da Vercel.

Estado aceito:

```text
api/[...path].ts
```

Qualquer outro arquivo de função rastreado fora de um caminho privado iniciado por `_` deve falhar com mensagem que liste somente os caminhos inválidos.
Arquivos `.d.ts`, arquivos iniciados por `_` e arquivos dentro de diretórios iniciados por `_` não são entradas implantáveis.

O guard deve cobrir as extensões de função Node suportadas pelo projeto:

```text
.js, .cjs, .mjs, .ts, .cts, .mts
```

Um teste focado deve provar pelo menos:

- o catch-all é aceito;
- arquivos sob `_modules/`, `_infrastructure/`, `_app/`, `_http/` e `_shared/` são aceitos;
- `api/modules/example.ts` falha;
- `api/health.ts` falha;
- a mensagem lista os caminhos inválidos.

Adicionar o comando:

```text
check:vercel-functions
```

`verify:fast` deve executar esse comando.
O job `boundary` do GitHub Actions deve executá-lo sem criar um novo job.

## 8. Comportamento preservado

A mudança não pode alterar:

- rotas, métodos, query strings ou payloads HTTP;
- mensagens de erro destinadas ao usuário;
- autenticação, cookies ou rate limiting;
- transações PostgreSQL ou schema Drizzle;
- migrations;
- clientes Evolution, Meta CAPI, OpenRouter, Blob ou KV;
- regras de bloqueio de escritas externas em preview e staging;
- build e desenvolvimento local;
- alias `@/` do frontend;
- estrutura interna flat de `_modules/`;
- estrutura de `_infrastructure/db/repositories/` e `_infrastructure/integrations/`.

## 9. Validação

A implementação deve verificar em árvore limpa:

```bash
npm run check:vercel-functions
npm run verify:full
```

Também deve verificar:

1. Ausência de código ativo importando `api/modules/` ou `api/infrastructure/`.
2. Ausência dos diretórios antigos após limpeza dos outputs gerados.
3. Mapa de rotas idêntico ao anterior.
4. Build API sem resolução acidental de `.js` obsoleto.
5. Build Vite concluído.
6. Testes unitários e E2E existentes aprovados.
7. Jobs `lint`, `types`, `unit`, `boundary`, `migrations` e `build` aprovados no PR.
8. Vercel Preview em estado `READY`.
9. Deployment contendo somente a Function correspondente a `api/[...path].ts`.
10. Smoke HTTP do Preview para uma rota pública ou protegida sem realizar escrita externa.

Os 29 testes PostgreSQL condicionais podem continuar ignorados quando `TEST_DATABASE_URL` não estiver configurado.
Essa lacuna já existe e não pertence a esta mudança.

## 10. Critérios de aceitação

- `api/modules/` não existe.
- `api/infrastructure/` não existe.
- `api/_modules/` contém os 80 módulos atuais.
- `api/_infrastructure/` contém os 24 arquivos atuais de infraestrutura.
- `api/[...path].ts` é a única entrada de Function detectada pelo guard.
- Nenhum contrato HTTP ou comportamento funcional muda.
- O check PostgreSQL/Drizzle mantém todas as proibições atuais.
- `npm run verify:full` termina com código zero.
- Todos os jobs do GitHub Actions terminam com sucesso.
- O Vercel Preview termina com sucesso no plano Hobby.
- O PR deixa de reportar `exceeded_serverless_functions_per_deployment`.

## 11. Rollout e rollback

A mudança deve permanecer no draft PR atual até o primeiro Preview aprovado.
Nenhuma migration ou variável de ambiente é necessária.
Nenhuma escrita externa deve ser habilitada para validar o Preview.

Se o Preview ainda exceder o limite, a implementação deve parar e inspecionar a lista real de Functions geradas.
Não adicionar `builds`, `.vercelignore` ou upgrade de plano como fallback automático.

Se imports ou guardrails quebrarem, reverter o commit de movimentação mantém o PR no estado anterior sem afetar produção.

## 12. Riscos

### Imports ESM obsoletos

Outputs `.js` ignorados podem mascarar imports antigos.
Mitigação: limpar outputs antes do movimento e antes de cada verificação relevante.

### Rewrites incompletos

Testes e scripts usam imports dinâmicos e strings de caminhos, além de imports estáticos.
Mitigação: busca residual nos caminhos antigos, typecheck e suíte completa.

### Enfraquecimento da fronteira PostgreSQL

O check atual contém regras baseadas em caminhos.
Mitigação: alterar somente os prefixos físicos e manter os mesmos casos permitidos e proibidos.

### Divergência entre check local e Vercel

A convenção da plataforma pode mudar.
Mitigação: manter o guard pequeno, documentar a regra e exigir Preview real como critério final.

### Movimento amplo com comportamento invariável

O diff terá muitos renames e alterações de imports.
Mitigação: não misturar refatorações de domínio, correções funcionais ou mudanças de configuração não necessárias.

## 13. Fora de escopo

- Atualização para Vercel Pro.
- Uso de `vercel.json#builds`.
- Movimento do backend para fora de `api/`.
- Reorganização interna de módulos ou repositórios.
- Correção de violações domain/infrastructure existentes.
- Mudança do output de `build:api` para outro diretório.
- Troca de `npm install` por `npm ci` na Vercel.
- Headers HTTP adicionais.
- Testes PostgreSQL com service container.
- Simplificação de `check-no-legacy-provider.mjs`.
- Alterações de dependências.

## 14. Referências

- Vercel Functions API Reference: <https://vercel.com/docs/functions/functions-api-reference>
- Vercel Advanced Configuration, utility files in `api/`: <https://vercel.com/docs/functions/configuring-functions/advanced-configuration>
- Vercel project configuration, `builds`: <https://vercel.com/docs/project-configuration/vercel-json>
- Erro do Preview: `exceeded_serverless_functions_per_deployment`
