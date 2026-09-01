# [SPEC] Fila de follow-up materializada com motivo visível

**Data:** 2026-08-31
**Status:** proposta para implementação
**Risco:** CRITICAL (envio real de WhatsApp, estado comercial durável, migration)
**Lane:** CRITICAL

## Problem Statement

O operador manda orçamento no WhatsApp e abre Follow-ups esperando ver quem recebeu e não respondeu. A tela abre em Prontos e aparece vazia.

O envio em si pode ter funcionado: o monitor de Envios WhatsApp marca entregue depois do recibo. Mesmo assim o orçamento de teste não entra em Prontos nem em Aguardando 24h. Não há motivo na tela. O operador não distingue silêncio, bug ou filtro.

A causa de produto é o modelo: a fila só existe como um JOIN na leitura. Identidade comercial e conversa do WhatsApp foram tratadas como a mesma coisa. Recibo de entrega não cria candidato. Identidade só nasce se o contato falar (`MESSAGES_UPSERT`). Quem recebeu e ficou em silêncio — exatamente o alvo da fila — some como `identity_unresolved`.

Isso já foi observado em produção: depois de corrigir o webhook, o orçamento de teste ficou `delivered` com recibo, CRM em Orçamento Enviado, cliente ativo, e zero linha na fila. Dezenas de entregas com recibo desde o corte de rastreio também não geraram candidato.

## Solution

Remodelar a seção de Follow-ups para uma fila operacional durável, não um cálculo invisível.

Três fatos separados:

1. **Enviamos para este número** — gravado no envio, com o telefone que o outbox já usou.
2. **O WhatsApp confirmou** — recibo `DELIVERY_ACK` ou `READ`. Sem recibo o item fica visível, não some.
3. **Houve conversa depois** — inbound ou outbound extra. Silêncio deixa o item na fila; resposta tira de Prontos/Aguardando.

A tela lê a tabela. Cada linha tem estado e motivo em português. Prontos continua sendo só depois de 24h de silêncio com recibo. Aprovação humana, kill switch, Evolution como único transporte e a regra de nunca tratar `@lid` como telefone permanecem.

Inbox de WhatsApp continua atendimento. Esta fila é só orçamento emitido + silêncio. Chatwoot não entra.

## User Stories

1. Como operador, quero abrir Follow-ups e ver o orçamento que acabei de entregar com recibo em Aguardando 24h, para confirmar que a fila enxerga o envio.
2. Como operador, quero que Prontos só mostre item depois de 24h do primeiro recibo sem resposta do cliente, para não cobrar cedo demais.
3. Como operador, quero ver o motivo de cada linha (aguardando 24h, sem recibo, cliente respondeu, CRM mudou, contato sem telefone), para não achar que a tela quebrou.
4. Como operador, quero empty state diferente em cada aba, com o próximo lugar onde olhar, para saber se estou na aba errada.
5. Como operador, quero que envio pela API, sem o cliente ter falado no WhatsApp, ainda gere candidato, para recuperar quem recebeu e ficou em silêncio.
6. Como operador, quero que o telefone do envio seja o destino comercial do follow-up, para a fila existir sem o contato ter falado — sem isso virar “identidade resolvida” quando a conversa for `@lid`.
7. Como operador, quero que um `@lid` sem telefone apareça em Atenção com motivo, não desapareça, para eu dispensar ou esperar identidade.
7a. Como operador, quero que telefone no outbox não libere follow-up se a conversa real for `@lid` sem recibo/inbound nesse JID, para eu não cobrar o número errado.
7b. Como operador, quero que resposta no `@lid` depois do envio tire o item de Prontos/Aguardando com “Cliente respondeu”, mesmo quando o outbox tem telefone.
8. Como operador, quero que recibo `entregue` ou `lido` avance o item de “aguardando recibo” para “aguardando 24h”, para o relógio começar no fato do WhatsApp.
9. Como operador, quero que recibos antigos não sejam inventados nem reenviados, para envio preso antes do conserto do webhook não virar “entregue” mentiroso.
10. Como operador, quero que resposta do cliente depois do envio tire o item de Prontos e Aguardando, com motivo “Cliente respondeu”, para eu não cobrar quem já falou.
11. Como operador, quero que o próprio envio do orçamento não conte como “houve outro envio”, para o outbound da entrega não cancelar a fila.
12. Como operador, quero que um envio novo do mesmo orçamento vire o candidato vigente, para a fila acompanhar a última tentativa.
13. Como operador, quero que CRM fora de Orçamento Enviado cancele ou segure o item com motivo visível, para não follow-upar deal em negociação, pedido ou perdido.
14. Como operador, quero que orçamento que deixe de estar emitido saia de Prontos/Aguardando com motivo, para rascunho ou ciclo seguinte não receber cobrança.
15. Como operador, quero que cliente arquivado saia da fila operacional com motivo, para não falar com cadastro encerrado.
16. Como operador, quero dispensar item em Aguardando, Atenção ou sem recibo, para um teste ou contato errado não ficar 24h no caminho.
17. Como operador, quero aprovar só o que está Pronto, para o WhatsApp não sair sem revisão.
18. Como operador, quero editar a mensagem padrão na revisão antes de aprovar, para o texto caber no caso.
19. Como operador, quero que “Não contatar” bloqueie o número nas próximas filas, para o pedido ser durável.
20. Como operador, quero que o kill switch impeça envio e mostre motivo, sem esconder a fila, para eu continuar vendo o trabalho mesmo com disparo desligado.
21. Como operador, quero teto diário e lease iguais aos de hoje no disparo aprovado, para não saturar WhatsApp.
22. Como operador, quero Atenção com itens sem recibo, identidade incompleta, ingestão bloqueada, falha de transporte, needs_review e cliente que já respondeu, para operar a exceção no mesmo lugar.
23. Como operador, quero Enviados e Dispensados como histórico, para auditar o que já saiu ou foi recusado.
24. Como operador, quero prazo visível (vence em …) em Aguardando 24h, para saber quando vai para Prontos.
25. Como operador, quero abrir o orçamento a partir da linha, para continuar a venda sem caçar o número.
26. Como operador, quero que a inbox de WhatsApp não vire esta fila, para atendimento e cobrança de orçamento não se misturarem.
27. Como operador, quero que follow-up não abra conversa genérica nem dispare cadência de Chatwoot, para o produto ficar no que o Aspen já opera.
28. Como operador, quero HTTP da fila em português, para erro 409/400/503 continuar no contrato do app.
29. Como operador, quero que duas abas não aprovem o mesmo orçamento duas vezes, para não mandar mensagem duplicada.
30. Como operador, quero que versionamento de elegibilidade continue invalidando aprovação velha, para a fila que mudou pedir reload.
31. Como operador, quero que grupo, broadcast e status do WhatsApp não gerem candidato, para a fila ser só conversa 1:1.
32. Como desenvolvedor, quero uma máquina de estados pura (candidato + evento + agora → próximo estado), para testar a fila sem SQL.
33. Como desenvolvedor, quero que GET da lista leia linhas persistidas, não um JOIN de entregas+atividade+CRM, para silêncio deixar de ser ausência.
34. Como desenvolvedor, quero projetar o candidato nos eventos (envio aceito, recibo, upsert, CRM, orçamento, arquivo de cliente, relógio), para o estado não existir só na leitura.
35. Como desenvolvedor, quero gravar atividade outbound no envio/recibo com o telefone de destino quando o JID for numérico, para o silêncio ter âncora sem exigir inbound.
36. Como desenvolvedor, quero materializar uma vez a última entrega por orçamento desde o corte de rastreio — com recibo **e** `provider_accepted` sem recibo —, para os ~66 da pane aparecerem em Atenção e não sumirem.
37. Como desenvolvedor, quero migration classificada destructive (cutover JOIN→tabela) com expand-contract e apply só com autorização, para não tratar troca de fonte de verdade como additive.
38. Como operador, quero que ingestão UPSERT ilegível segure a instância em Atenção, não aprove follow-up no escuro.
39. Como operador, quero que LID com atividade depois do envio segure a fila visível até recibo ou inbound no mesmo `provider_conversation_id` (ou telefone derivado **desse** JID), para automação não chutar número.
40. Como operador, quero que `readStatus` da Evolution continue irrelevante para esta fila, para tick de entrega não depender de stories.
41. Como operador, quero atualizar a lista e ver o estado atual, para o relógio de 24h não esperar o cron de 15 minutos: o GET calcula `ready` na resposta sem persistir.
42. Como operador, quero copy só no empty state, ação bloqueada ou motivo da linha, sem tutorial sob o título.
43. Como operador, quero um único follow-up por orçamento, para reenvio substituir o candidato e não criar fila paralela.
44. Como operador, quero que falha permanente do transporte vá para Atenção, e rejeição/rate limit feche com motivo, para eu não reenviar no escuro.
45. Como mantenedor, quero esta spec CRITICAL, com invariantes em PostgreSQL descartável e E2E da tela, porque a mudança manda WhatsApp e grava estado comercial.
46. Como desenvolvedor, quero que o recibo faça upsert do candidato se a linha ainda não existir, para ACK que chega antes do INSERT do aceite não sumir para sempre.
47. Como operador, quero ver “Cliente respondeu” (`cancelled`) em Atenção, para o motivo não desaparecer sem aba.

## Implementation Decisions

- **Objetivo de produto.** Fila de orçamento emitido + silêncio após recibo, com motivo visível. Não é inbox, não é cadência genérica, não é Chatwoot.
- **Três fatos.** Destino do envio, recibo do WhatsApp, conversa posterior. O terceiro não é pré-requisito do segundo. Silêncio é ausência de conversa posterior, não ausência de identidade.
- **Uma linha por orçamento.** A fila operacional é a mesma entidade do attempt. Estados novos no ciclo: `awaiting_receipt`, `waiting`, `ready`, `held`, e os já persistidos `approved`, `processing`, `sent`, `cancelled`, `dismissed`, `needs_review`, `failed`. Unique por orçamento. Reenvio atualiza a linha para a entrega mais nova. `quotation_follow_ups.provider_message_id` é só o id da **mensagem de follow-up enviada** (`completeSent`). A âncora da PDF é `delivery_id` (FK). Não reutilizar o `provider_message_id` do step da entrega nessa coluna.
- **Criação.** Dois writers idempotentes, nunca o GET:
  1. Aceite da Evolution (`provider_accepted` / primeiro `provider_message_id` **do step** em `quotation_delivery_steps`): upsert do candidato. Destino comercial = dígitos do telefone da entrega. Conversa inicial = `{dígitos}@s.whatsapp.net` quando o JID for numérico.
  2. Recibo `DELIVERY_ACK`/`READ` `fromMe` desta entrega: se a linha do candidato **não existir**, upsert com o telefone da delivery e o `delivery_id` do step achado. Se existir, só avança recibo/`due_at`.
  Aceite depois do recibo não duplica (ON CONFLICT `quotation_id`). Recibo cujo step ainda não tem `provider_message_id` (ACK antes de `markAccepted`) continua sendo problema do outbox: não inventar ACK; o candidato só nasce quando o step for correlacionável.
- **Identidade comercial.** Telefone de 10–15 dígitos no outbox é o destino do envio. Não exigir activity prévia `verified`/`derived` para **existir** na fila. `@lid` nunca vira telefone. Telefone no outbox **não** derruba a barreira LID.
- **Barreira LID.** Hold `unresolved_identity_barrier` enquanto houver activity `unresolved` com `provider_conversation_id` LIKE `%@lid` depois do âncora **e** essa conversa ainda não for a `provider_conversation_id` do candidato (nem tiver telefone derivado **desse** JID). Recibo ou UPSERT 1:1 com esse `remoteJid` associa a conversa ao candidato. Story 39 cobre LID **com** telefone de delivery, não só LID sem telefone.
- **Recibo.** Só `DELIVERY_ACK` ou `READ` em mensagem `fromMe` desta entrega inicia o relógio. `due_at = first_provider_receipt_at + 24h`. Sem recibo o item permanece em Atenção, estado `awaiting_receipt`, motivo `awaiting_receipt`. `missing_provider_receipt` fica só para entrega já falha/completa sem recibo, se ainda for um caso. Relógio no primeiro ACK **depois** de todos os steps obrigatórios da entrega estarem `delivered`/`read` (igual ao outbox hoje).
- **Silêncio.** Inbound depois do âncora → `cancelled` / `inbound_after_anchor` se a activity for o `provider_conversation_id` do candidato **ou** um `@lid` associado a este envio (recibo desta entrega com esse `remoteJid`, ou telefone derivado desse JID). Resposta `@lid` cancela mesmo com phone no outbox. Outbound extra que não seja mensagem desta entrega → `outbound_after_anchor`. O outbound do próprio orçamento é ignorado nesse teste **somente** quando `last_outbound_provider_message_id` está em `quotation_delivery_steps` desta delivery.
- **Atividade.** Continua watermark de conversa, sem corpo. UPSERT inbound/outbound segue gravando. Envio aceito e recibo 1:1 também gravam outbound, **somente depois** de existir o `provider_message_id` real do step. Recibo passa a gravar activity (hoje `remoteJid` é parseado e descartado). Id sintético/vazio no outbound do aceite é proibido: o próprio PDF viraria `outbound_after_anchor`.
- **Elegibilidade comercial.** Orçamento `emitido`, CRM `Orcamento Enviado`, cliente não arquivado. Mudança nesses fatos transiciona a linha com motivo visível. Não esconder.
- **Hold vs cancel.** Hold (`held`): ingestão bloqueada, barreira LID, identidade sem telefone. Kill switch **não** é hold: a linha permanece `ready`/`waiting`/`awaiting_receipt` listável; POST e worker recusam com motivo `external_writes_disabled` (story 20). Cancel: resposta (inclusive `@lid` associado), outro envio, CRM/orçamento/arquivo, bloqueio de contato, already_attempted. Hold volta quando o fato some; cancel não reabre sozinho salvo reenvio. Terminais `sent`/`dismissed`/`failed`/`needs_review` não reabrem. `cancelled` por entrega incompleta/recibo pode reabrir se uma entrega nova chegar.
- **Relógio.** Worker periódico **persiste** `waiting` → `ready` quando `now >= due_at` e silêncio/elegibilidade ainda valem. GET **não persiste** promoção. GET pode **calcular** `ready` na resposta quando a linha está `waiting` e `now >= due_at`, para Prontos não depender do cron de 15 min. POST approve aceita persistido `ready` **ou** `waiting` com avaliação `ready` no momento do POST; CAS continua em `eligibility_version`.
- **GET não monta candidato.** List/get leem a tabela filtrando a aba. Sem INSERT. Sem JOIN gigante para decidir se a linha existe. Recibo e aceite é que upsertam.
- **Projeção por evento.** Transições a partir de: aceite de envio, recibo (upsert se faltar linha), UPSERT, mudança de CRM, status de orçamento, arquivo de cliente, tick do worker. GET só lê (cálculo de relógio na resposta). Função pura: candidato + fatos + agora → próximo estado e motivo.
- **Aprovação.** Só quando a avaliação no POST é `ready`. Snapshot de mensagem e `eligibility_version` (hash) nascem **no approve**, não no aceite. Lease, teto diário, QStash/worker e kill switch iguais (`APP_ENV=production`, `EXTERNAL_WRITES_ENABLED=1`, `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=1`).
- **Dispensa.** Permitida em `ready`, `waiting`, `held`, `awaiting_receipt`. Motivos humanos iguais aos de hoje. `do_not_contact` bloqueia o número.
- **Abas.** Prontos (`ready`, inclusive o `ready` calculado no GET), Aguardando 24h (`waiting`), Enviados (`sent`), Dispensados (`dismissed`), Atenção (`awaiting_receipt`, `held`, `needs_review`, `failed`, **`cancelled`**). `approved`/`processing` seguem o mapeamento atual de em voo. Sem aba nova: “Cliente respondeu” aparece em Atenção com o motivo.
- **Contrato da lista.** Cada item inclui estado, motivo estável, rótulo em português, `due_at` quando houver, recibo quando houver, telefone de destino, orçamento, cliente, valor. Motivos de UI:

  | motivo | rótulo |
  |---|---|
  | awaiting_receipt | Aguardando recibo do WhatsApp |
  | waiting | Aguardando 24h |
  | ready | Silêncio após o recibo |
  | inbound_after_anchor | Cliente respondeu |
  | outbound_after_anchor | Houve outro envio |
  | newer_delivery_in_flight | Novo envio em andamento |
  | missing_provider_receipt | Sem recibo de entrega |
  | quotation_not_issued | Orçamento não emitido |
  | crm_not_eligible | CRM fora de Orçamento Enviado |
  | client_archived | Cliente arquivado |
  | identity_unresolved | Contato sem telefone confiável |
  | contact_blocked | Contato bloqueado |
  | ingestion_blocked | Ingestão do WhatsApp bloqueada |
  | unresolved_identity_barrier | Identidade LID não associada |
  | external_writes_disabled | Envio automático desativado |
  | already_attempted | Já houve tentativa |
  | before_tracking_start | Anterior ao início do rastreio |
  | delivery_incomplete | Entrega incompleta |
  | provider_rejected | WhatsApp recusou |
  | rate_limited | Limite do WhatsApp |
  | transport_ambiguous | Falha de transporte |
  | lease_expired_after_transport | Envio sem confirmação |
  | already_handled | Já tratado |
  | do_not_contact | Não contatar |
  | no_continuity | Sem continuidade |
  | wrong_contact | Contato incorreto |
  | other | Outro |

- **Empty states (único texto extra da tela).** Prontos: “Nenhum follow-up pronto. Envios recentes ficam em Aguardando 24h.” Aguardando: “Nenhum envio no prazo de 24h.” Atenção: “Nada exige atenção. Cliente que já respondeu também aparece aqui.” Enviados/Dispensados: “Nenhum item nesta lista.”
- **Schema.** Cutover JOIN→tabela é transição de fonte de verdade: `-- migration-risk: destructive` e expand-contract (`docs/database-migrations.md`). O header additive é proibido.
  - Expand (DDL compatível com o INSERT atual de approve/dismiss): tornar nulos `eligibility_version`, `message_snapshot`, `first_provider_receipt_at`, `due_at` até o approve; `eligibility_version` CHECK vira `IS NULL OR sha256`; `message_snapshot` CHECK vira `IS NULL OR not blank`; `canonical_phone` pode permanecer NOT NULL quando a delivery tem dígitos; incluir `awaiting_receipt|waiting|ready|held` no `state_check`; `closed_consistency` passa a ter ramo aberto para estados de fila/hold (`closed_*` nulos); `closed_reason` não lista estados (`awaiting_receipt` é estado, não motivo de fechamento).
  - `provider_message_id` permanece unique parcial = id do follow-up enviado. Não gravar o id da PDF aí. Âncora da entrega = `delivery_id`.
  - Contract: readers passam a ler só a tabela depois da materialização; o JOIN deixa de ser fonte da fila. Sem dual-read eterno, sem feature flag extra.
  - Apply só com autorização explícita; nunca no startup.
- **Estoque atual.** Uma materialização única, no apply da migration ou job one-shot imediatamente depois: última entrega por orçamento desde `QUOTATION_FOLLOW_UP_TRACKING_STARTED_AT`. Com recibo → `waiting`/`ready` conforme o relógio. Sem recibo, se a entrega está `provider_accepted`/in-flight desde o corte → `awaiting_receipt` (os ~66 da pane). Destino = telefone da entrega. Sem dual-read depois. Sem inventar ACK.
- **Webhook.** Continua `MESSAGES_UPDATE` + `MESSAGES_UPSERT`. Recibo atualiza entrega **e** faz upsert/avanço do candidato; grava activity outbound com o `remoteJid` 1:1 quando houver. UPSERT atualiza atividade e silêncio (cancela se inbound associado). Não assinar eventos novos só para esta spec.
- **Inbox e identidade da conversa.** Resolver de identidade da inbox permanece para atendimento. Follow-up não usa a inbox como fonte da fila.
- **Config operacional.** Kill switch e tracking start iguais. Worker de follow-up precisa da URL viva do app (não o host DNS morto). Fora desta spec corrigir env de teste que ainda cita o host antigo, mas produção não pode publicar worker no domínio morto.
- **Sem dependência nova, sem feature flag extra, sem event bus, sem dual-write com a projeção antiga.**

### Máquina de estados (decisão)

```text
(envio aceito) → awaiting_receipt          // upsert idempotente
(recibo desta entrega, linha ausente) → upsert awaiting_receipt|waiting conforme o ACK
awaiting_receipt + recibo + identidade ok + sem barreira LID → waiting
awaiting_receipt|waiting|ready + LID @lid não associado → held (unresolved_identity_barrier)
waiting + now >= due_at + silêncio + elegível → ready
ready visível com kill switch off; POST recusa (external_writes_disabled)
ready + aprovar → approved → processing → sent | failed | needs_review
waiting|ready|held|awaiting_receipt + dispensar → dismissed
qualquer não-terminal + cliente respondeu (telefone ou @lid associado) → cancelled (inbound_after_anchor)  // visível em Atenção
qualquer não-terminal + outbound extra (id ≠ step desta delivery) → cancelled (outbound_after_anchor)
qualquer não-terminal + CRM/orçamento/arquivo → cancelled (motivo correspondente)
held some o fato temporário → volta waiting/ready/awaiting_receipt conforme recibo/relógio
sent/dismissed/failed/needs_review/cancelled → terminal (cancelled só reabre com entrega nova)
```

## Testing Decisions

- Testar comportamento externo: estado visível, motivo, aba, aprovação, dispensa, e o efeito de eventos (envio aceito, recibo, inbound, CRM). Não testar SQL interno, nomes de mapper nem árvore React.
- **Costura principal (uma):** função pura da máquina de estados do candidato. Entrada: linha + fatos do evento + agora. Saída: estado, motivo, `due_at`. Prior art: testes atuais de avaliação de follow-up (24h, cancelamentos, hold). Esses testes passam a esperar visibilidade com motivo no lugar de `absent` para recibo sem atividade. Caso novo: delivery phone **e** activity `@lid` no mesmo orçamento → hold, não `ready`. Caso novo: inbound `@lid` associado → `cancelled` / `inbound_after_anchor`, não hold eterno.
- **Costura HTTP:** handler da fila (GET/POST/PATCH) com repositório injetado. GET devolve linhas persistidas com `reason` e rótulo; GET não INSERT; GET não persiste `waiting`→`ready` (só calcula na resposta). POST só quando a avaliação é `ready`; kill switch → 409 sem esconder a linha; PATCH dispensa waiting/held/awaiting_receipt; 409 de versão velha.
- **Costura de ingestão:** webhook já testado. Acrescentar: recibo com `remoteJid` numérico grava outbound de activity **com o id do step** e move/upsert candidato; recibo `@lid` associa conversa e não vira telefone; UPSERT inbound no JID associado cancela; grupo/broadcast fora; **recibo com candidato ainda inexistente ainda cria a linha** (ordem invertida ACK vs aceite); ACK cujo step ainda não existe continua ignorado pelo outbox (não inventar).
- **PostgreSQL descartável:** persistir candidato no aceite; upsert no recibo antes do aceite; unique por orçamento; INSERT de `awaiting_receipt` sem snapshot/hash/recibo passa nos CHECKs novos e falha nos atuais; `completeSent` grava `provider_message_id` do follow-up sem colidir com o id da PDF; materialização one-shot inclui `provider_accepted` sem recibo. Prior art: testes Postgres da fila atual.
- **UI:** Playwright da tela. Casos: aba Aguardando mostra orçamento entregue com motivo e vencimento; Prontos vazio antes de 24h; Atenção mostra sem recibo, LID e **Cliente respondeu**; empty state de Prontos aponta Aguardando 24h; motivo visível na linha. Sem corpus Playwright completo além desta jornada.
- **Invariantes CRITICAL:** não enviar sem avaliação `ready` + kill switch on; `ready` permanece listável com kill switch off; não tratar `@lid` como telefone; não derrubar barreira LID só porque a delivery tem dígitos; não completar entrega sem recibo; lease/teto inalterados; mensagens de erro em português; `quotation_follow_ups.provider_message_id` ≠ `quotation_delivery_steps.provider_message_id` da PDF.
- Não exigir Evolution real nem WhatsApp real. Recibo e UPSERT entram como payloads já usados nos testes de webhook.

## Out of Scope

- Chatwoot, inbox como fonte da fila, cadência multi-toque, scoring, RBAC, multi-tenant.
- Envio automático sem aprovação humana, encurtar 24h, reenviar ACK antigo, inventar entregue.
- Mudar o outbox de orçamento (estados de entrega, worker de delivery, parser de recibo) além de notificar a fila no aceite/recibo.
- Assinar eventos Evolution além de `MESSAGES_UPDATE` e `MESSAGES_UPSERT`.
- Corpos de mensagem na atividade; persistir mídia.
- Religar o domínio DNS morto; healthcheck genérico da Evolution.
- Feature flag extra, dual-read da projeção antiga depois do cutover, event bus, pacote novo.
- Classificar a migration como additive; o cutover JOIN→tabela é destructive.
- Aplicar a migration nesta spec; o apply continua gate CRITICAL com autorização.
- Backfill contínuo ou dual-write com KV/inbox.
- CRM Kanban, ficha do cliente, histórico de envios, pedidos.

## Further Notes

- Achado em 2026-08-31: webhook apontava para host sem DNS; recibos pararam em 24/08; 66 envios em `provider_accepted`. URL corrigida para o app vivo. Recibo voltou no teste ORC-20262030. Fila continuou vazia porque identidade exigia UPSERT. Uma linha de atividade existia em outro número, inbound, depois do conserto.
- Review adversarial da spec (mesmo dia): três blockers confirmados no código vivo — (1) tabela de attempt não nasce no aceite (NOT NULL snapshot/hash/recibo/`due_at`, `state_check` sem fila, `provider_message_id` = id do follow-up enviado); (2) `MESSAGES_UPDATE` só atualiza delivery e GET não cria linha, então ACK antes do INSERT some; (3) silêncio/identidade batem em `canonical_phone` da delivery, activity `@lid` é outra linha, recibo descarta `remoteJid`. Patches desta revisão estão nas decisões acima.
- `QUOTATION_FOLLOW_UP_EXTERNAL_WRITES_ENABLED=0` no ambiente local: lista pode existir; disparo continua morto até o corte operacional. Kill switch não move `ready` para `held`.
- Testes de publicação ainda citam worker no host antigo; ajustar quando o worker desta spec for tocado.
- PRE-BETA: sem adapter da projeção antiga. A leitura nova é a tabela. O JOIN atual deixa de ser fonte da fila depois da materialização.
- Próximo `/to-tickets` sugerido: (1) máquina de estados + schema destructive/expand, (2) upsert no aceite e no recibo + activity com id do step e `remoteJid`, (3) GET/UI com motivo, `cancelled` em Atenção, empty states, (4) hooks CRM/orçamento/cliente + materialização one-shot (inclui `provider_accepted` sem recibo) + worker de relógio. Tudo CRITICAL.
- Antes do apply da migration: parar e pedir autorização explícita.
