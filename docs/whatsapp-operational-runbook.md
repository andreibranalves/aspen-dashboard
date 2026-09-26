# Runbook operacional do WhatsApp

Readiness da aplicação, configuração do webhook Evolution e do wake do worker
e prontidão de envio. Nenhuma etapa executa deploy ou
migration; alterar webhook, wake ou env é operação do responsável principal,
com autorização própria (ver `AGENTS.md`).

## Readiness

`GET /api/operational-status` verifica somente conectividade PostgreSQL e configurações locais obrigatórias.

A resposta não contém segredos, credenciais, dados de clientes ou informações de serviços externos.

A aplicação fica pronta quando o banco responde e `app_settings` contém validade, pagamento e template padrão válidos.

## Webhook e worker de entregas

Os nomes de configuração necessários na Vercel são:

```text
EVOLUTION_WEBHOOK_SECRET
EVOLUTION_INSTANCE
WORKER_WAKE_URL
WORKER_WAKE_SECRET
```

Configure o webhook da Evolution com os eventos `MESSAGES_UPSERT` (mensagens do Atendimento) e `MESSAGES_UPDATE` (recibos), `webhookBase64: false` e um cabeçalho `Authorization` personalizado.

Confirme que `/api/evolution-webhook` rejeita requisições sem bearer e com bearer incorreto.

Envios, respostas do Atendimento, retornos, recibos e efeitos do webhook saem do container `aspen-worker` no VPS ([ADR 0013](adr/0013-worker-whatsapp-no-vps.md), [runbook](worker-runbook.md)). Depois de gravar trabalho, a Function chama `POST WORKER_WAKE_URL` (`https://aspen-worker.srv1892439.hstgr.cloud/wake`) com `Authorization: Bearer <WORKER_WAKE_SECRET>`, o mesmo valor do `.env` do worker. O wake é só um aviso: o worker relê o banco, trabalha até esvaziar o que venceu e dorme até o próximo vencimento registrado, no máximo uma hora. Se o wake falhar, a tela avisa o operador e o trabalho sai nessa varredura.

Nunca registre `WORKER_WAKE_SECRET`.

Inspecione **Envios** para localizar linhas ativas e acionáveis.

Execute uma entrega real controlada usando um orçamento aprovado existente e um destinatário designado.

Verifique que cada identificador de mensagem do provedor alcança `DELIVERY_ACK`.

Verifique que logs não exibem segredos nem números de telefone.

Não registre valores dessas variáveis neste repositório, em comandos ou em relatórios.

## Prontidão do envio WhatsApp (somente leitura)

Antes de investigar um relato de envio parcial, confirme que o webhook e o wake
apontam para o destino ativo e que não há fila executável vencida. O comando não envia
mensagem, não aciona o worker e não imprime credenciais, cabeçalhos ou telefones.

```bash
node scripts/whatsapp-delivery-readiness.mjs \
  --webhook-url https://<host-ativo>/api/evolution-webhook \
  --worker-url  https://aspen-worker.srv1892439.hstgr.cloud/wake
```

A URL do banco vem apenas do ambiente protegido (`DATABASE_URL`). `--database-url` é
proibido e encerra com código diferente de zero, sem ecoar o valor, para não expor
credenciais no histórico do shell ou na listagem de processos.

- `dns=FAIL` significa que o destino configurado não resolve — o webhook ou o wake
  não chegam ao destino ativo, mesmo com o worker saudável.
- A sondagem é obrigatória: ela envia a menor requisição sem credenciais nem
  corpo no método não suportado `HEAD` para exatamente `/api/evolution-webhook` e
  o `/wake` do worker e reporta o status observado e o esperado,
  sempre `405` (método rejeitado antes do bearer e de qualquer
  trabalho). Nada é processado: na Vercel a pipeline libera a rota de máquina
  canônica e o handler rejeita `HEAD` antes de qualquer ação; no VPS o worker
  rejeita `HEAD` no `/wake`. Caminho protegido errado na Vercel responde `401`
  antes do roteamento e reprova, caminho desconhecido no worker responde `404`
  e reprova, e rota quebrada (`500`) também reprova. `OPTIONS` não é usado porque o adapter Node o responde
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
destinos: alteração do wake ou do webhook é operação do responsável principal.

A aba **Canais** de Configurações mostra, somente leitura, a última execução
registrada do worker de entregas, quantas etapas estão em reconciliação e quantos recibos
aguardam correlação (`GET /api/whatsapp-delivery-diagnostics`). O painel não envia, não
reivindica lease nem expira nada. `nenhuma execução registrada` significa que nenhum
ciclo do worker gravou resultado desde o deploy desta versão: confira
`docker ps --filter name=aspen-worker` e `docker logs --tail 100 aspen-worker` no VPS
antes de concluir que o worker não rodou.

## Retornos de orçamento

O worker envia os retornos aprovados. Com
`QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0` ele não envia. As variáveis
`QUOTATION_FOLLOW_UP_*` ficam na Vercel e no `.env` do worker, com os mesmos
valores.

Habilite o envio somente com `APP_ENV=production`,
`EXTERNAL_WRITES_ENABLED=1` e `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=1`.
O kill switch é qualquer um desses valores diferente do exigido; para interromper
imediatamente, defina `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0`.

Execute apenas um envio controlado para um destinatário designado e confirme o
recebimento no dispositivo. Em seguida, verifique o estado persistido e os logs sem
segredos, telefones ou texto da mensagem. Se houver qualquer divergência, desligue o
kill switch e não repita o envio.
