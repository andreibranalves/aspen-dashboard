# Design - Fases 8-10: Preview staging + external write guard

Data: 2026-08-18.
Status: desenho aprovado pelo usuário nesta sessão.

## 1. Objetivo

Implementar as Fases 8-10 da spec raiz `aspen-dashboard-plano-refatoracao.md`:

- Fase 8: tornar Vercel Preview o staging padrão documentado.
- Fase 9: combinar ausência de credenciais perigosas, guard de aplicação e guard de testes.
- Fase 10: documentar a transição gradual da VPS para Preview sem desligamento automático.

Esta fase altera o contrato de ambiente e protege writes externos críticos.
Não executa deploy, não altera o dashboard Vercel, não migra banco remoto e não remove a VPS.

## 2. Contexto atual

- `vercel.json` já define build Vite, output `public/`, função catch-all e rewrite SPA.
- O checkout não contém configuração remota de ambientes Vercel.
- A suíte staging já exige `STAGING_EXTERNAL_PROVIDERS_DISABLED=1` e `STAGING_EGRESS_BLOCKED=1` em `tests/support/staging-auth.js`.
- Writes Evolution estão em `api/modules/send-whatsapp.ts` e `api/modules/send-whatsapp-flow.ts`.
- Write Meta CAPI está em `api/infrastructure/integrations/meta-capi/meta-capi.ts`.
- OpenRouter, Vercel KV e Vercel Blob são recursos necessários a fluxos do Preview e não devem ser bloqueados pelo guard de writes críticos.
- A sincronização de conversas Evolution é leitura operacional e permanece protegida pela ausência de credenciais e pelo egress bloqueado.

## 3. Decisões aprovadas

1. **Guard na fronteira de integração.**
   Um helper em `api/_shared/external-writes.ts` protege os pontos que efetivamente fazem POST externo.
2. **Fail closed.**
   A permissão exige simultaneamente `APP_ENV=production` e `EXTERNAL_WRITES_ENABLED=1`.
3. **Providers cobertos.**
   O guard cobre `evolution` e `meta-capi`, os dois writes externos críticos existentes no inventário atual.
4. **Sem guard global de `fetch`.**
   Interceptar todo `fetch` bloquearia OpenRouter e recursos de armazenamento necessários ao Preview.
5. **Sem fallback de provider.**
   Preview falha de forma segura quando write externo está desativado.
6. **Sem configuração remota automática.**
   Variáveis Vercel Preview/Production são configuradas pelo operador no painel ou CLI fora deste checkout.
7. **Sem remoção imediata da VPS.**
   Fase 10 registra uma transição observável e mantém VPS opcional até decisão operacional posterior.
8. **Preservação de no-op sem credencial.**
   Meta continua retornando `missing_token` sem tentar rede quando o token está ausente.
   Evolution continua reportando configuração ausente antes de executar rede.
   Quando credenciais existem em ambiente não autorizado, o guard bloqueia antes do `fetch`.

## 4. Contrato de ambiente

Defaults locais seguros:

```text
APP_ENV=development
EXTERNAL_WRITES_ENABLED=0
```

Contrato Preview:

```text
APP_ENV=preview
EXTERNAL_WRITES_ENABLED=0
DATABASE_URL=<staging database>
<staging KV/BLOB resources>
EVOLUTION_API_KEY=<absent>
META_CAPI_ACCESS_TOKEN=<absent>
TYPEBOT_WRITE_TOKEN=<absent>
```

Contrato Production:

```text
APP_ENV=production
EXTERNAL_WRITES_ENABLED=1
DATABASE_URL=<production database>
<production KV/BLOB resources>
<production provider credentials>
```

Valores reais nunca entram no repositório, na spec, no plano ou no relatório.
`.env.example` documenta somente nomes e defaults seguros.
O runbook operacional documenta a matriz sem copiar valores.

## 5. Interface do guard

`api/_shared/external-writes.ts` expõe:

```ts
export type ExternalWriteProvider = 'evolution' | 'meta-capi';

export function isExternalWritesAllowed(env?: NodeJS.ProcessEnv): boolean;

export function assertExternalWritesAllowed(
  provider: ExternalWriteProvider,
  env?: NodeJS.ProcessEnv,
): void;
```

`isExternalWritesAllowed` retorna `true` somente quando:

```ts
String(env.APP_ENV || '').trim().toLowerCase() === 'production'
  && String(env.EXTERNAL_WRITES_ENABLED || '').trim() === '1'
```

`assertExternalWritesAllowed` lança erro HTTP 503 com mensagem pública neutra em PT-BR:

```text
Integrações externas desativadas neste ambiente.
```

O detalhe interno identifica somente o provider lógico.
Nunca inclui tokens, URLs, headers ou dados pessoais.

## 6. Pontos de aplicação

Aplicar o guard imediatamente antes de cada POST externo crítico:

- `api/modules/send-whatsapp.ts:evolutionPost` com provider `evolution`.
- `api/modules/send-whatsapp-flow.ts:evolutionPost` com provider `evolution`.
- `api/infrastructure/integrations/meta-capi/meta-capi.ts:sendMetaLeadEvent` com provider `meta-capi`.

O guard não altera validações anteriores de payload nem o contrato de sucesso.
Não há chamada de saída Typebot no inventário atual que justifique um terceiro provider.

## 7. Testes

Criar `tests/unit/external-writes.test.ts` com matriz determinística:

- production + `EXTERNAL_WRITES_ENABLED=1` permite.
- production + valor ausente bloqueia.
- preview + `EXTERNAL_WRITES_ENABLED=1` bloqueia.
- development + `EXTERNAL_WRITES_ENABLED=1` bloqueia.
- `APP_ENV` ausente bloqueia.
- erro possui status 503 e mensagem pública neutra.

Adicionar cobertura nos testes de Evolution/Meta para provar que:

- chamadas autorizadas continuam usando o fetch mock existente.
- chamadas bloqueadas não executam `fetch`.
- ausência de token Meta mantém o retorno `missing_token` sem rede.

A suíte staging existente continua verificando que o browser não acessa destinos proibidos.
Não executar staging sem configuração operacional válida.

## 8. Fase 8 - Preview como staging

Atualizar `.env.example` com `APP_ENV` e `EXTERNAL_WRITES_ENABLED` seguros.
Atualizar `docs/operational-cutoff-procedure.md` com:

1. Matriz Preview versus Production.
2. Checklist de Preview usando banco, KV e Blob de staging.
3. Checklist de ausência de credenciais Evolution, Meta CAPI e Typebot em Preview.
4. Comandos de verificação local e staging já existentes.
5. Proibição de colocar credenciais ou URLs com credenciais no repositório.

Não alterar `vercel.json` sem necessidade técnica.
A configuração de Preview permanece uma ação operacional fora do checkout.

## 9. Fase 10 - Transição VPS -> Preview

Adicionar ao runbook uma sequência reversível:

1. Deploy de uma branch em Preview.
2. Execução da suíte staging com egress bloqueado e fixtures descartáveis.
3. Registro do resultado e dos riscos.
4. Repetição por releases suficientes para ganhar confiança.
5. Manutenção opcional da VPS durante a observação.
6. Descomissionamento posterior somente após decisão operacional explícita.

Não apagar Docker, Traefik, nftables ou scripts nesta fase.
Essas remoções pertencem a uma decisão posterior após evidência de releases estáveis.

## 10. Fora de escopo

- Configurar secrets ou env vars no Vercel Dashboard.
- Fazer deploy, push, merge ou criar PR.
- Alterar bancos, KV, Blob ou providers remotos.
- Bloquear leituras OpenRouter, KV, Blob ou Evolution com guard global.
- Criar clients de integração completos (Fase 19).
- Reduzir feature flags definitivamente (Fase 18).
- Remover runtime ou infraestrutura VPS.

## 11. Aceitação

- Preview tem contrato documentado com writes externos desativados por default.
- Guard central fail-closed existe e protege Evolution/Meta antes do `fetch`.
- Nenhuma resposta pública expõe segredo, URL privada ou stack.
- Unit tests cobrem matriz permitida/bloqueada e ausência de rede no bloqueio.
- `npm run check` verde.
- `npm run test:unit` verde.
- `npx playwright test` local verde.
- `node scripts/check-no-legacy-provider.mjs` verde.
- Runbook documenta transição reversível sem remover VPS automaticamente.
