---
status: accepted
date: 2026-09-25
---

# Trabalho assíncrono do WhatsApp num worker no VPS

Até setembro de 2026, envios, retornos, respostas do Atendimento, recibos e efeitos do webhook dependiam de dois schedules do QStash chamando rotas da Function da Vercel. Os schedules eram configurados à mão e não tinham alarme. Por volta de 19/09/2026 pararam de chegar à produção (um apontava para um host sem DNS; o de retornos não existia), e ninguém soube. O limite de 60 s da Function (ADR 0009) ainda dividia cada envio entre "na hora", com 45 s de orçamento, e "worker", o que deixava envios pela metade. Decidimos tirar da Vercel todo o transporte e o trabalho assíncrono do WhatsApp: um container `aspen-worker` no VPS, ao lado do Evolution, faz o trabalho, e a Vercel só grava e avisa. O PostgreSQL continua a única fonte de verdade (ADR 0008) e o Evolution o único transporte (ADR 0010).

## Decisão

- **Nenhuma mensagem sai de dentro de uma requisição HTTP**, inclusive respostas do Atendimento. A Vercel grava o envio e seus passos, a resposta ou a aprovação do retorno, e avisa o worker com `POST /wake` por HTTPS no Traefik, com bearer `WORKER_WAKE_SECRET`, corpo vazio e timeout de 2 s. O aviso é só uma dica: o worker sempre relê o banco, então aviso duplicado ou perdido não muda o resultado.
- **O worker acorda por evento**: aviso da Vercel, webhook do Evolution, timer para o menor horário devido entre as fontes, e uma varredura de segurança de hora em hora. Não há polling curto.
- **Envio com pausas reais.** Saem o orçamento de tempo do envio na hora (`PROCESS_DUE_TIME_BUDGET_MS`) e o módulo de prazos de banco (`api/_infrastructure/db/deadline.ts`).
- **Trava de idade.** Um passo de envio ou uma resposta do Atendimento só sai até 30 min depois do pedido do operador. Passado esse prazo, o envio fica interrompido e vai para revisão; nada é retomado sozinho. Retornos seguem suas próprias regras, porque o teto diário de aprovações os adia de propósito.
- **Webhook direto no worker**, pela rede Docker interna, sem passar pelo Traefik, e com bearer. O worker grava mensagem, recibo e efeito como hoje, responde 200 e aplica os efeitos depois. O Evolution 2.3 reenvia com backoff o webhook que falha.
- **Tabela de tarefas só para trabalho sem dono no domínio**: efeitos do webhook, recibos por correlacionar, heartbeat, varreduras e limpeza, num executor próprio sobre `FOR UPDATE SKIP LOCKED`. Envio e passos, retorno e resposta do Atendimento continuam agendados na própria linha, porque é o lease e o `transport_started_at` dessa linha que impedem envio duplicado.
- **Mesmo código.** O worker usa o mesmo repositório, o mesmo schema Drizzle e o mesmo build TypeScript, e renderiza PDF e imagens com o mesmo `@sparticuz/chromium` da Vercel, para o documento enviado ser igual à prévia. Roda uma instância só.
- **Topologia e segredos.** Projeto compose próprio em `/docker/aspen-worker/`, ligado à rede `evolution-api-zscx_default` como externa; nunca edita nem reinicia o projeto do Evolution, que pertence à Hostinger. Os segredos ficam em `/docker/aspen-worker/.env` (root, 0600), escritos pelo operador por SSH. O GitHub não guarda credencial de banco nem do Evolution.
- **Deploy e rollback.** Um push em `master` que toque o worker dispara o GitHub Actions, que entra na tailnet com chave efêmera (`tailscale/github-action`) e manda `git archive` por SSH a uma chave restrita por `command=` a `deploy-worker.sh <sha>`. O script builda `aspen-worker:<sha>` no VPS, sobe o container e espera `/health`; se falhar, volta à tag anterior. Ficam as 5 últimas imagens, e o rollback manual é um `workflow_dispatch` com o sha, sem rebuild. O redeploy do worker faz parte da autorização de merge; operações no Evolution continuam exigindo autorização própria.
- **Logs.** Driver `json-file` com rotação de 10 MB × 5, nas mesmas regras de `safeErrorSummary`; erros vão ao Sentry. No banco ficam só o heartbeat e as tarefas: a tarefa concluída perde o payload na hora e é apagada após 14 dias.
- **Alarme em Envios e em Configurações › Canais** quando houver trabalho vencido há mais de 10 min sem ser pego, quando o heartbeat da varredura passar de 2 h, ou, na hora do envio, quando o aviso for recusado.

## Transição

Seis fases, cada uma um PR que deixa o sistema funcionando. Nenhuma flag escolhe entre o caminho antigo e o novo. Quando a troca depende de uma operação externa, como na fase 3, o código antigo convive com o novo só até o PR seguinte.

1. Trava de 30 min e alarme, ainda na Vercel.
2. O worker roda o que o QStash chamava, e a Vercel chama `/wake` quando o envio na hora deixa passos pendentes. O mesmo PR apaga o código do QStash e as rotas de worker da Vercel, que não têm chamador em produção. O schedule do QStash é apagado depois que o worker estiver saudável.
3. O worker recebe o webhook, a URL no Evolution é trocada (operação autorizada) e o PR seguinte apaga `/api/evolution-webhook`.
4. Envios e respostas do Atendimento só pelo worker; sai o orçamento de 45 s.
5. Tabela de tarefas, em expand–contract com migration.
6. Limpeza: `/api/send-whatsapp`, o repositório antigo de envios (`quotation-delivery-repository.ts`) e helpers compartilhados.

## Opções descartadas

- **Consertar o QStash.** Continua sendo um schedule configurado à mão, sem alarme, preso aos 60 s da Function.
- **Polling curto no worker.** O Neon Free dá 100 CU-h por mês, 400 h a 0,25 CU, e suspende o compute até o ciclo seguinte quando estoura. Polling a cada 2 min o mantém ativo 720 h/mês, e uma varredura a cada 15 min já passaria do limite. Em 25/09/2026 o projeto, com as branches de Preview, projetava cerca de 190 h no mês.
- **pg-boss.** Dependência nova com polling e manutenção próprios, com o mesmo efeito sobre o scale-to-zero.
- **`LISTEN/NOTIFY`.** Exige conexão direta permanente, que o pooler do Neon não repassa e que impede o scale-to-zero.
- **Mesmo compose do Evolution.** O arquivo pertence ao projeto da Hostinger, que pode reescrevê-lo, e o deploy do worker passaria a tocar no Evolution.
- **Imagem no GHCR.** A cota gratuita privada (500 MB e 1 GB/mês de transferência) não comporta imagens com Chromium.
- **Evento bruto do webhook numa tabela.** Seria mais uma cópia de textos e telefones, e falha de parse já é pega pelo bloqueio `unparsed_upsert`.

## Consequências

- O ADR 0009 continua valendo para a Vercel, que segue com uma Function só, mas o trabalho assíncrono do WhatsApp deixa de rodar nela.
- O worker não tem Preview (emenda ao ADR 0011): há um VPS, uma instância do Evolution e uma branch Neon por PR. O CI builda a imagem e roda o worker contra PostgreSQL descartável com um stub do Evolution; no Preview o envio fica na fila. A primeira execução real acontece em produção, depois do merge.
- A varredura horária custa até 5 min de Neon ativo por hora ociosa, no máximo cerca de 60 h/mês. O worker não mantém conexão ociosa aberta: pool pequeno e `idle_timeout` curto.
- Vercel e worker publicam o mesmo commit de `master` em momentos diferentes. As tabelas e o `/wake` precisam aceitar um deploy de diferença entre os dois.
- Com o worker parado, nada é enviado. O alarme aparece em Envios e em Canais, e a tela de envio avisa na hora.
