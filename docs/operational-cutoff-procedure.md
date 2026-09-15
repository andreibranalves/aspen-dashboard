# Procedimento operacional PostgreSQL

O dashboard usa PostgreSQL como fonte de verdade para produtos, clientes, orçamentos, CRM, pedidos e atividade de catálogo.

## Pré-condições

A verificação exigida para concluir depende da classificação de risco da mudança, conforme a política atual em [release-lanes.md](./release-lanes.md). Nenhuma sequência ad-hoc de checks individuais substitui essa política.

As etapas posteriores deste runbook são específicas de cutover e exigem autorização explícita; não devem ser executadas para uma feature comum. Backup e restore são operações controladas fora deste repositório.

## Readiness

`GET /api/operational-status` verifica somente conectividade PostgreSQL e configurações locais obrigatórias.

A resposta não contém segredos, credenciais, dados de clientes ou informações de serviços externos.

A aplicação fica pronta quando o banco responde e `app_settings` contém validade, pagamento e template padrão válidos.

## Fluxo local

1. Execute as verificações automatizadas em uma cópia local.
2. Confirme que os adapters Node e Vercel delegam ao pipeline compartilhado e ao registro único `api/_app/routes.ts`.
3. Confirme que produtos, clientes, orçamentos, CRM, pedidos, atividade e telas de comunicação usam contratos locais.
4. Valide o envio WhatsApp somente com mocks da Evolution em testes.
5. Registre resultados e riscos no relatório de auditoria apropriado.

Nenhuma etapa deste documento executa deploy, alteração de ambiente, migração ou acesso a serviço remoto.

## Configuração operacional de corte

Os nomes de configuração necessários são:

```text
EVOLUTION_WEBHOOK_SECRET
CRON_SECRET
EVOLUTION_INSTANCE
```

Configure o webhook `MESSAGES_UPDATE` da Evolution com um cabeçalho `Authorization` personalizado.

Confirme que `/api/evolution-webhook` rejeita requisições sem bearer e com bearer incorreto.

Confirme que o schedule QStash `aspen-whatsapp-delivery-worker` invoca `POST /api/quotation-delivery-worker` a cada dois minutos, com zero retries e `Authorization: Bearer <CRON_SECRET>` encaminhado por `Upstash-Forward-Authorization`.

O schedule fica fora do `vercel.json` porque o plano Hobby da Vercel aceita somente execuções diárias. Configure `Upstash-Redact-Fields: header[Authorization]` e nunca registre o token QStash ou `CRON_SECRET`.

Inspecione **Envios WhatsApp** para localizar linhas ativas e acionáveis.

Execute uma entrega real controlada usando um orçamento aprovado existente e um destinatário designado.

Verifique que cada identificador de mensagem do provedor alcança `DELIVERY_ACK`.

Verifique que logs não exibem segredos nem números de telefone.

Em rollback de código, não faça rollback da migração, porque ela é aditiva e linhas legadas continuam legíveis.

Não registre valores dessas variáveis neste repositório, em comandos ou em relatórios.

## Prontidão do envio WhatsApp (somente leitura)

Antes de investigar um relato de envio parcial, confirme que o webhook e o schedule
apontam para o host ativo e que não há fila executável vencida. O comando não envia
mensagem, não aciona o worker e não imprime credenciais, cabeçalhos ou telefones.

```bash
node scripts/whatsapp-delivery-readiness.mjs \
  --webhook-url https://<host-ativo>/api/evolution-webhook \
  --worker-url  https://<host-ativo>/api/quotation-delivery-worker
```

A URL do banco vem apenas do ambiente protegido (`DATABASE_URL`). `--database-url` é
proibido e encerra com código diferente de zero, sem ecoar o valor, para não expor
credenciais no histórico do shell ou na listagem de processos.

- `dns=FAIL` significa que o destino configurado não resolve — o webhook e o schedule
  não chegam à aplicação ativa, mesmo com o worker saudável.
- A sondagem é obrigatória: ela envia a menor requisição sem credenciais nem
  corpo no método não suportado `HEAD` para exatamente `/api/evolution-webhook` e
  `/api/quotation-delivery-worker` e reporta o status observado e o esperado,
  sempre `405` (método rejeitado pelo handler antes do bearer e de qualquer
  trabalho). Nada é processado: a pipeline libera as rotas de máquina canônicas,
  o roteamento alcança o handler e o handler rejeita `HEAD` antes de qualquer
  ação. Caminho protegido errado responde `401` antes do roteamento e reprova,
  assim como uma rota canônica divergente do caminho esperado; rota quebrada
  (`500`) também reprova. `OPTIONS` não é usado porque o adapter Node o responde
  com `204` antes do roteamento. `probe=OMITIDO` (por exemplo com `--no-probe`,
  que existe só para diagnóstico) também reprova e termina com código diferente
  de zero.
- `fila executável agora` conta etapas `queued`/`retry_scheduled` vencidas e
  reprova a verificação quando há atraso acima de 30 minutos.
- Sem `DATABASE_URL` a fila não é verificada e o resultado é `FALHA`; informe a URL
  descartável/operacional para completar a checagem. Uma falha de conexão/consulta
  imprime apenas a mensagem fixa e uma categoria fixa (`CONNECTION_REFUSED`,
  `TIMEOUT`, `AUTH_FAILED`, `UNKNOWN`, …) mapeada de uma allow-list — nunca o código
  cru do driver, a mensagem crua nem a URL de conexão.
- A ausência de qualquer uma das duas URLs também é `FALHA`.

O comando conclui com `resultado: OK` somente quando os dois destinos respondem com o
status esperado e a fila está verificada e saudável; em qualquer outro caso imprime
`resultado: FALHA` e termina com código de saída diferente de zero.

Compare o `host=` reportado com o host ativo conhecido. O comando não corrige
destinos: alteração de QStash ou do webhook é operação do responsável principal.

## Corte de follow-up de orçamento

O corte do follow-up é separado da aplicação da migration. A migration aditiva deve ser
aplicada posteriormente, durante uma janela controlada; não a aplique como parte deste
procedimento.

Antes do corte, mantenha
`QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0`. Depois de confirmar a migration e a
configuração de `QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT`,
`QUOTATION_FOLLOW_UP_WORKER_URL`, `QSTASH_TOKEN`, `QSTASH_API_URL` e `CRON_SECRET`,
programe no QStash uma chamada a `POST /api/quotation-follow-up-worker` a cada 15
minutos, com zero retries e o bearer encaminhado por
`Upstash-Forward-Authorization`.

Habilite o envio somente com `APP_ENV=production`,
`EXTERNAL_WRITES_ENABLED=1` e `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=1`.
O kill switch é qualquer um desses valores diferente do exigido; para interromper
imediatamente, defina `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0`.

Execute apenas um envio controlado para um destinatário designado e confirme o
recebimento no dispositivo. Em seguida, verifique o estado persistido e os logs sem
segredos, telefones ou texto da mensagem. Se houver qualquer divergência, desligue o
kill switch e não repita o envio.

## Gate controlado do Preview

A execução local termina antes do ensaio controlado do deployment Preview. A
homologação é o Preview da própria branch/PR; não há VPS de staging nem alvo
permanente de branch neste fluxo.

No executor protegido, pré-configure `DATABASE_URL`,
`PRODUCTION_DATABASE_URL`, `E2E_USERNAME`, `E2E_PASSWORD`,
`PREVIEW_E2E_USERNAME`, os dois IDs `KNOWN_POSTGRES_*` e as atestações
`PREVIEW_EGRESS_BLOCKED=1` e `PREVIEW_FIXTURE_RESET=1`. `DATABASE_URL` deve
corresponder ao deployment do PR após verificação do operador; não coloque
URLs de banco ou credenciais inline.

O preflight entra automaticamente no runner protegido antes do Playwright. Ele
não entra no build normal nem no deployment comum.

No gate, execute primeiro:

```bash
node scripts/cutover-env-status.mjs preview-e2e
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview -- --list
```

O operador deve verificar que `DATABASE_URL` é a URL efetiva do deployment do
PR e selecionar o banco isolado correspondente no contrato aprovado. O
preflight local compara identidades; `/api/operational-status` prova
ambiente, writes-off, conectividade e persistência servida, e a fixture prova
que o deployment atende ao alvo atestado. Isso não prova, sozinho, a identidade
única da branch. A URL de produção fica somente no executor protegido e não é
passada ao Playwright.

Depois, use somente o orçamento e a fixture descartável identificados pelo
ambiente do operador. Não crie cotação nem fixture novos para essa validação.

Confirme o estado da página, o banco isolado, o egress atestado pelo executor e
a ausência de mensagem duplicada. O listener de requests do browser é uma
atestação independente; não representa prova de egress da Vercel.

`DELIVERY_ACK` não é gate do Preview: essa validação de envio real ocorre
somente na operação Production aprovada, documentada acima.

## Comandos de verificação e corte

Execute somente o comando da lane em [release-lanes.md](./release-lanes.md):
`verify:fast` ocorre uma vez antes da entrega de código. O Preview acima é a
homologação controlada quando a lane exigir jornada relevante; não repita
corpus, build ou checks de banco por hábito.

Use a suíte controlada de Preview somente com o deployment do PR, banco
isolado, egress bloqueado e fixtures descartáveis:

```bash
PREVIEW_BASE_URL="https://<deployment-do-pr>.vercel.app" npm run test:e2e:preview
```

O canário Production é somente leitura e não envia WhatsApp nem cria leads Typebot.
A cobertura de fluxos mutáveis pertence exclusivamente à suíte controlada do
Preview; Production continua sendo o deployment de `master`.

Execute o canário depois de configurar os identificadores PostgreSQL existentes:

```bash
CANARY_BASE_URL="$PRODUCTION_BASE_URL" \
CANARY_PASSWORD="$PRODUCTION_CANARY_PASSWORD" \
CANARY_QUOTATION_ID="$KNOWN_PRODUCTION_POSTGRES_QUOTATION_ID" \
CANARY_PUBLIC_QUOTATION_URL="$KNOWN_PRODUCTION_PUBLIC_QUOTATION_URL" \
node scripts/postgres-only-canary.mjs
```
