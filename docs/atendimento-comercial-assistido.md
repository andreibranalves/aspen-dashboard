# Aspen Dashboard — Atendimento comercial assistido

**Spec de produto e engenharia · versão 1.1 · 23 de setembro de 2026**

| Metadado | Valor |
|---|---|
| Status | Decisões D1–D4 tomadas; pronta para E0 e quebra em tickets. Não representa feature implementada ou homologada. |
| Repositório | `andreibranalves/aspen-dashboard` |
| Base examinada | branch `codex/design-ui-ux-refactor` em `58967de` (29 commits sobre `master` em `846520a`), a ser integrada antes da implementação |
| Usuário | Operador único, experiente, em navegador desktop |
| Canal | WhatsApp, exclusivamente pelo transporte Evolution já adotado |
| Entregas | M1a: histórico confiável (leitura); M1b: resposta de texto; M2: contexto, mídia e orçamento; M3: assistência de IA |

**Mudanças em relação à v1.0:** decisões registradas em §2.3; M1 dividido em M1a e M1b; envio despachado na própria requisição, com varredura no agendamento existente (§10); sem importação do KV (§16); "Preparar orçamento" entrega ao Novo orçamento (§12); referências refeitas sobre a branch de design (Órbita, Comunicação aposentada, identidade de cliente por dois sinais).

## 1. Problema e resultado esperado

O operador precisa atender clientes pelo Aspen e transformar a conversa em trabalho comercial: consultar cadastro e histórico, preparar um orçamento e responder sem reconstruir o contexto em várias telas.

A feature não é um help desk genérico nem uma réplica do Chatwoot. É uma **tela nativa de atendimento conectada às regras e aos registros comerciais do Aspen**.

**História principal:** como operador da Aspen, quero abrir uma conversa, identificar o cliente, entender a demanda, preparar um orçamento e responder no mesmo fluxo, mantendo controle sobre o que é registrado e enviado.

O sucesso funcional exige três resultados: histórico consultável e confiável; acesso ao contexto comercial correto; redução de trabalho manual sem automatizar decisões de identidade, preço, emissão ou envio.

O produto já declara operador único, desktop, Evolution como único transporte e PostgreSQL como fonte de verdade comercial. Esta spec preserva essas escolhas. [S01–S03]

## 2. Decisões de escopo

### 2.1 Incluído

**M1a — Histórico confiável, somente leitura.** Tela de Atendimento com listagem, histórico paginado, leitura local e situações; recebimento persistente por webhook; backfill a partir da Evolution; correção de identidade e preservação de formatação; retirada do KV de conversas. Não envia nada ao WhatsApp. Enquanto só o M1a estiver ativo, o operador responde pelo WhatsApp Web ou pelo celular, e essas respostas aparecem na conversa como saída observada.

**M1b — Resposta de texto.** Compositor, envio com registro prévio e despacho na própria requisição, varredura de recuperação, reconciliação e ações sobre envios incertos.

**M2 — Atendimento comercial integrado.** Painel de cliente e histórico, confirmação de vínculo, recebimento de imagens/PDFs/áudios suportados, envio manual de imagens/PDFs validados, seleção de mensagens para preparar orçamento no Novo orçamento e apresentação dos envios de orçamento na conversa sem criar outro envio.

**M3 — Assistência contextual.** Sugerir resposta, identificar informações faltantes e resumir a negociação. A IA produz resultados internos revisáveis; não envia mensagens nem emite orçamentos.

M1a e M1b são entregas de texto com escopo declarado. **A feature completa só está concluída com M1a, M1b, M2 e M3 aceitos.** A operação pode usar as entregas intermediárias sem apresentá-las como suporte completo a envio, mídia ou IA.

### 2.2 Fora do escopo

Não implementar multicanal, multiusuário, distribuição de atendimentos, equipes, SLA, campanhas, chatbot autônomo, widget de suporte, integração ou fork do Chatwoot, aplicativo móvel, chamadas, grupos, status/broadcast, gravação de áudio, transcrição automática ou busca semântica de todo o histórico.

Também não criar novo CRM, novo motor de preços, novo editor de orçamentos, segunda tela de revisão de extração, framework genérico de agentes, biblioteca de estado global, servidor WebSocket, nova Function, novo agendamento QStash ou troca de provedor. Não alterar nem aposentar a extensão `extensions/whatsapp-context/`. Confirmação de leitura **local** não dispara recibo de leitura ao WhatsApp nesta versão.

### 2.3 Decisões registradas

**D1 — A tela de conversa volta ao Aspen.** Em 21/08/2026 (`1116b8b`) a Inbox foi retirada e o WhatsApp Web com a extensão passou a ser a superfície de conversa. [S17] Em 23/09/2026 o operador decidiu reverter: o Atendimento passa a ser a superfície de conversa do Aspen. A extensão continua funcionando sem mudança neste escopo, com o mesmo serviço de contexto e a mesma tabela de vínculos; aposentá-la é decisão posterior. O PR do M1a atualiza o primeiro parágrafo de `docs/whatsapp-context-extension.md`, marca `docs/whatsapp-inbox-backend-inventory.md` como superado por esta spec e corrige a lista de rotas do `PRODUCT.md`.

**D2 — Envio despachado na própria requisição.** O POST de envio grava a intenção, faz commit e chama o transporte antes de responder. O agendamento QStash existente, a cada 2 minutos, ganha uma varredura de recuperação limitada depois do lote de orçamentos. Sem nova rota de worker, agendamento, segredo ou env. Detalhes em §10.

**D3 — Sem importação do histórico do KV.** O histórico novo nasce no PostgreSQL a partir do webhook e de um backfill pela Evolution. O KV recebe só um snapshot protegido e sai do código. Detalhes em §16.

**D4 — "Preparar orçamento" entrega ao Novo orçamento.** O Atendimento registra a seleção e a demanda e abre `#/novo-orcamento` em modo conversa, que já faz extração, revisão de itens e identidade do cliente no Split Card. Não há segunda revisão dentro do Atendimento. Detalhes em §12.

## 3. Base existente e decisão de reaproveitamento

As observações abaixo vêm da leitura do código na base examinada, não de uma homologação da instância operacional. Esta elaboração não executou a suíte nem realizou envios de teste.

| Componente | Situação observada | Decisão |
|---|---|---|
| `whatsapp-conversations-store.ts` | KV com teto de 200 conversas e 100 mensagens por conversa (`:130`). `cleanText` troca toda sequência de espaços e quebras de linha por um espaço (`:412`). Sem leitor na interface desde 21/08. [S04] | Não importar (D3). Mover `normalizeWhatsappPhone` e `normalizeWhatsappPhoneFromRemoteJid`, usados por módulos de entrega e identidade, para um helper neutro em `api/_shared/`. Remover o restante no M1a. |
| `whatsapp-conversations.ts` | Ações `sync`, `sync-messages`, `send-message`, `extract-quote`, `create-quote-lead` e PATCH. `send-message` envia antes de gravar, passa o texto por `cleanText` e inventa `out-${Date.now()}` quando falta ID (`:495`). `extract-quote` fixa confiança 0.8 (`:407`). Rota sem consumidor no frontend ou na extensão. [S05] | Substituir o handler pelos contratos do §14. Preservar a regra de admissão por `demandId` (`findAdmittedWhatsappLead`). |
| `whatsapp-conversations-sync.ts` | `findChats`/`findMessages` com timeout de 15 s, resposta até 4 MB e até 1.000 itens; anexos não ingeridos. [S06] | Reutilizar acesso ao provedor e normalização revisada no backfill (§9.2). Paginação além da primeira página precisa ser comprovada no E0. |
| `whatsapp-identity-resolver.ts` | `shouldKeepStored` mantém o telefone guardado de confiança alta quando a evidência nova tem confiança menor, inclusive quando ela é um conflito (`:166`). [S07] | Corrigir a precedência (§7) e ler o estado anterior do PostgreSQL. |
| `whatsapp-context.ts` e `whatsapp-client-links.ts` | Serviço de contexto da extensão, com CORS próprio; vínculo versionado com chave `(accountId, conversationId)` vinda do modelo do WhatsApp Web. [S08] | Reutilizar o serviço; o painel ganha adapter próprio, sem CORS. Contrato da extensão inalterado. |
| `whatsapp-crm-match.ts` | Candidatos e correspondência automática por telefone confiável (`e9ce1cb`). [S09] | Reutilizar para exibir contexto. Não é a regra de identidade do orçamento (§7). |
| `client-matching.ts` e `POST /api/client-matches` | Regra oficial de identidade: mesmo cliente só com documento válido ou dois de {nome ou empresa, e-mail, telefone} (`1915c59`). Decisão no salvamento de `/api/orcamento`. [S16] | Usar sem alteração. O Atendimento não decide identidade de cliente. |
| `evolution-webhook.ts` | Autenticação de máquina, corpo até 64 KB, instância validada; `messages.upsert` alimenta atividades e follow-ups; `messages.update` alimenta recibos de orçamento. Não grava corpo de mensagem. [S10] | Acrescentar persistência de mensagens sem retirar efeitos existentes. |
| `quotation-delivery-outbox.ts`, `evolution-transport.ts`, `quotation-delivery-worker.ts` | Outbox de orçamento com reconciliação; transporte com validação de texto (4.000 caracteres e controles proibidos, `evolution-transport.ts:70`) e timeout de 15 s. Worker acionado só pelo QStash, lote de 3 × 15 s dentro dos 60 s da Function. [S11, S18] | Reutilizar transporte, validação e padrões de lease. Varredura de mensagens no mesmo tick (D2), sem revisões fictícias de orçamento. |
| `send-whatsapp.ts` | Depois de enviar o PDF de orçamento, projeta a mensagem no KV quando a conversa existe lá (`:963`). [S11] | Remover a projeção no M1a. Em M2, o card de orçamento vem da entrega real (RF-12). |
| `whatsapp-leads.ts` e `whatsapp-identity-audit.ts` | Leem conversas do KV. `whatsapp-leads` não tem consumidor no frontend; há mock em `tests/orcamento.spec.js:250`. | Confirmar no E0; remover ou migrar para PostgreSQL junto com o KV. |
| `extract.ts` | Extrator com templates e validações; texto até 12.000 caracteres (`:155`). [S12] | Continua chamado pelo Novo orçamento (D4). |
| Novo orçamento (`#/novo-orcamento`, modo conversa) | Extração, Split Card com itens e identidade, rascunho Auto em `sessionStorage` versionado, prefill de origem por `quoteLeadId`/`crmDealId`. [S13] | Destino de "Preparar orçamento"; passa a aceitar `demandId` para carregar a seleção registrada. |
| UI Órbita | Tokens e temas em `src/index.css`; contrato em `DESIGN.md` e `docs/design/DESIGN-aspen.md`; `tests/unit/ui-contract.test.ts` trava o contrato. Comunicação aposentada; `#/comunicacao` só redireciona. [S13] | Compor a página com os componentes compartilhados (§4.1). |
| Upload de mídia | `communication-media-upload.ts` e `MediaUploader.tsx` gravam no Vercel Blob com `access: 'public'`, em caminho por grupo de produto. [S19] | Não reaproveitar para anexos de cliente (§11). |
| Extensão `extensions/whatsapp-context/` (0.2.3) | Contexto somente leitura no WhatsApp Web; não lê corpo de mensagens. [S17] | Continua como está (D1). |

**Regra de implementação:** reaproveitar não significa manter o contrato antigo. Antes de mudar um endpoint ou remover uma função, confirmar seus consumidores reais. Não manter compatibilidade para consumidores hipotéticos. [S03]

## 4. Experiência e jornadas

### 4.1 Tela

Criar `#/atendimento`, com a conversa selecionada em `#/atendimento?conversationId=<id-local>`. Registrar a rota só em `src/app/routes.tsx`, com `nav: { label: 'Atendimento', placement: 'destination' }` como primeiro destino, antes de Orçamentos, e ícone do `lucide-react` já instalado (por exemplo, `MessagesSquare`).

Composição desktop: lista de conversas à esquerda; histórico e compositor no centro; contexto comercial à direita, como painel lateral de 280–336px a partir de `xl`, recolhível, e como `DetailDrawer` abaixo disso. Em janela estreita, mostrar lista ou conversa, com retorno claro, sem exigir aplicativo móvel.

Seguir o contrato Órbita nos temas claro e escuro: `PageShell` e `PageHeader` sem descrição que repita o título; `SearchField` dentro de `PageToolbar`; `EmptyState` distinguindo base vazia de filtro sem resultado; `ErrorState` com retry; `InlineAlert` para as situações da §4.5; `StatusBadge` para situação e estado de envio; `EntityIdentity` para o contato; `Textarea` e `Button` no compositor. O token `chat-background` já existe e serve ao fundo da timeline. Um componente novo só vira compartilhado quando tiver segundo uso. A página passa em `tests/unit/ui-contract.test.ts`.

"Atendimento" é distinto de "Envios" (`#/whatsapp-deliveries`) e das abas Fluxos e Canais de Configurações. Não duplicar biblioteca de mídia, fluxos ou cadastro dentro da nova página.

### 4.2 Abrir e atender

O operador busca por nome exibido ou telefone, filtra por situação e seleciona uma conversa. A tela carrega o histórico recente e permite consultar mensagens anteriores. O painel comercial mostra um cliente confirmado, candidatos ou ausência de vínculo, nunca um cadastro adivinhado pelo nome.

A partir do M1b, o operador escreve, revisa e envia. A mensagem passa a existir localmente antes do transporte e recebe atualizações posteriores. Falhas não apagam o texto nem induzem reenvio sem verificar o resultado anterior.

### 4.3 Preparar orçamento

O operador seleciona as mensagens que representam a demanda e escolhe "Preparar orçamento". O servidor registra a seleção e a demanda (§12) e o app abre o Novo orçamento em modo conversa com esse texto. Extração, itens, pendências, identidade do cliente, cálculo, salvamento, emissão e envio seguem os fluxos atuais.

Ao voltar à conversa, o rascunho de resposta e a seleção continuam acessíveis durante a sessão.

### 4.4 Usar a IA

O operador solicita uma ação interna. O resultado mostra a sugestão ou o resumo e referências verificáveis ao contexto utilizado. "Usar sugestão" insere o texto no compositor; **não equivale a "Enviar"**. O operador pode editar ou descartar.

### 4.5 Situação incerta

Quando identidade, cadastro, entrega ou contexto estiverem em conflito, mostrar a consequência e a ação pertinente: revisar vínculo, atualizar contexto, aguardar reconciliação ou revisar envio. Não usar "tente novamente" indistintamente quando repetir pode causar duplicidade.

## 5. Requisitos funcionais

| ID | Requisito verificável | Entrega |
|---|---|---|
| RF-01 | Listar conversas individuais com busca, filtros, indicador de não lidas e paginação. | M1a |
| RF-02 | Consultar histórico sem truncar registros persistidos; atualizar novas mensagens e mudanças de estado. | M1a |
| RF-03 | Receber e registrar mensagens por webhook, com deduplicação e recuperação de falhas; preencher o histórico anterior por backfill. | M1a |
| RF-04 | Enviar texto com intenção persistida, chave de idempotência, despacho na própria requisição e resultado rastreável. | M1b |
| RF-05 | Preservar quebras de linha no recebimento, backfill e apresentação (M1a) e no envio; manter texto em edição e destino correto ao alternar conversas (M1b). | M1a/M1b |
| RF-06 | Distinguir identidade de transporte, vínculo comercial e nome exibido (M1a); bloquear envio quando houver conflito de destino (M1b). | M1a/M1b |
| RF-07 | Manter leitura local e situações `open`, `waiting_customer`, `closed`, `ignored`, sem sincronizar esses estados com o provedor. | M1a |
| RF-08 | Exibir cliente, oportunidades, orçamentos e entregas a partir dos registros existentes. | M2 |
| RF-09 | Confirmar/remover vínculo comercial com controle de versão, sem criar identidade paralela à extensão. | M2 |
| RF-10 | Abrir mídia recebida suportada e enviar imagem/PDF validado por ação manual. | M2 |
| RF-11 | Selecionar mensagens, registrar seleção e demanda e abrir o Novo orçamento com elas, sem segunda revisão no Atendimento. | M2 |
| RF-12 | Exibir orçamento emitido/enviado e suas entregas na conversa sem repetir o transporte. | M2 |
| RF-13 | Sugerir resposta, apontar pendências e resumir contexto, sempre internamente e sob solicitação. | M3 |
| RF-14 | Identificar sugestões desatualizadas e impedir sua aplicação silenciosa a outra conversa ou outro cliente. | M3 |

### 5.1 Histórico, leitura e navegação

Persistir o corpo fiel da mensagem. A limpeza de nomes e identificadores não se aplica ao corpo. O envio usa a validação de texto de `evolution-transport.ts` (4.000 caracteres e controles proibidos), preservando a formatação permitida; o frontend aplica o mesmo teto para feedback imediato e o servidor é a validação que vale. A requisição precisa conter texto não vazio ou ao menos um anexo válido. [S11]

Ao abrir uma conversa, carregar inicialmente 50 mensagens; aceitar no máximo 100 por página. Consultar anteriores por cursor estável, nunca apagando mensagens antigas para melhorar desempenho. Se o operador estiver lendo acima do fim, não deslocar a rolagem; mostrar "Novas mensagens".

Registrar leitura até uma posição explícita já exibida. Uma mensagem recebida durante a atualização não pode ser marcada como lida sem ter sido apresentada. Backfill não cria enxurrada de não lidas nem reabre atendimentos. O cursor de leitura só avança.

Na primeira versão, atualizar a conversa ativa a cada 5 segundos e a listagem a cada 10 segundos enquanto a aba estiver visível. Suspender polling com aba oculta; retomar com reconciliação incremental e backoff em falha. São decisões iniciais de implementação, não garantias de latência do provedor.

Cancelar ou ignorar respostas antigas de rede quando o operador trocar de conversa. Manter rascunho separado por conversa durante a sessão, limpando-o no logout. Em recarga com envio pendente, recuperar a mesma chave de requisição antes de permitir repetição. Não persistir o histórico inteiro no navegador.

`Enter` insere nova linha; `Ctrl+Enter` ou `Cmd+Enter` envia quando a ação estiver válida. Oferecer botão de envio acessível. Não apagar um texto novo digitado enquanto um envio anterior termina.

### 5.2 Situação do atendimento

Nova mensagem **recebida ao vivo**, inédita, muda `waiting_customer` ou `closed` para `open`. Conversa `ignored` permanece ignorada até ação do operador. Reprocessar o mesmo evento não altera a situação de novo. Envio de resposta não muda automaticamente o estágio do CRM.

"Não lida" é independente de "aberta". A situação comercial de uma demanda pertence ao CRM/orçamento, não ao enum de atendimento.

## 6. Invariantes obrigatórias

**INV-01 — Persistência antes do efeito externo.** Toda resposta enviada pelo módulo tem registro durável da intenção antes do transporte.

**INV-02 — Idempotência local.** A mesma chave com o mesmo conteúdo recupera a mesma operação. A mesma chave com destinatário ou conteúdo diferente retorna conflito.

**INV-03 — Incerteza não é falha confirmada.** Timeout, perda de resposta ou expiração depois do início do transporte não autorizam repetição automática.

**INV-04 — Destino estável.** A intenção fixa conversa, canal, destinatário e versão de identidade. Alteração relevante exige revisão antes de iniciar o transporte.

**INV-05 — Conflito prevalece.** Evidência contraditória não pode ser mascarada por uma identidade anteriormente classificada como confiável.

**INV-06 — Histórico não é janela de cache.** Paginação, sincronização e deduplicação não removem registros antigos por limite de quantidade.

**INV-07 — Uma mensagem, uma identidade local.** Resposta local, eco do provedor e recibos convergem para o mesmo registro quando há correlação comprovada.

**INV-08 — Um orçamento, o mesmo motor comercial.** Extração, cálculo, identidade do cliente no salvamento, emissão e envio seguem os serviços atuais.

**INV-09 — IA não executa comunicação.** Saída do modelo, sugestão aceita ou resumo não criam envio, emissão, alteração de cliente ou desconto sem o fluxo explícito correspondente.

**INV-10 — Vínculo não é telefone de transporte.** Confirmar um cadastro não substitui evidência sobre o destinatário do WhatsApp.

**INV-11 — Nenhuma regressão dos consumidores existentes.** Extensão, follow-ups, entregas de orçamento e o lote do worker de entregas continuam com seus eventos, contratos e orçamento de tempo.

**INV-12 — O KV não volta.** Depois do M1a, nenhum código lê ou escreve histórico de conversa no KV. Sem dual-read, dual-write ou fallback.

Não prometer entrega externa "exatamente uma vez". O objetivo é impedir duplicatas locais e reenvios cegos, mantendo reconciliação quando a fronteira com o provedor deixa o resultado incerto.

## 7. Identidade e contexto comercial

Usar três conceitos separados: **identificador técnico** da conversa no provedor; **telefone canônico** derivado de evidência válida; **cliente confirmado** no Aspen. Nome exibido é apresentação, não prova de identidade.

O backend resolve o canal e a conta; o frontend do Atendimento envia apenas IDs locais. A conta real do WhatsApp deve ter identidade estável, independente do nome temporário da instância. Reconectar a mesma conta preserva o escopo; conectar outra conta não reutiliza suas associações automaticamente.

O vínculo existente usa `accountId` e `conversationId` obtidos pela extensão no modelo do WhatsApp Web. Antes de o painel usar esses vínculos (M2), demonstrar a correspondência entre esse escopo e os identificadores da Evolution. Não considerar iguais o UUID local, o nome da instância, um JID e um identificador da extensão só porque todos são strings. [S08]

Se a equivalência de contas/conversas não estiver comprovada, permitir associação explícita com evidência e não importar vínculos presumidos. Aliases PN/LID só se unem com evidência de que são a mesma conversa; telefone ou nome semelhante, isoladamente, não autorizam fusão de históricos.

Corrigir a precedência no resolvedor: preservar dados anteriores quando não existe evidência nova suficiente; produzir conflito quando há contradição. Normalizar `fromMe` tanto no envelope quanto em `key` antes de usar evidências de remetente, como o webhook já faz. Nunca tratar o texto da mensagem como prova de identidade de transporte.

Três camadas, três regras:

- **Destino do envio:** identidade de transporte da conversa, conforme acima. Identidade válida permite responder mesmo sem cadastro comercial.
- **Contexto exibido no painel:** o serviço de contexto da extensão, com as regras de `whatsapp-crm-match.ts`, inclusive a correspondência automática por telefone confiável. Serve para mostrar histórico comercial; não confirma cliente para orçamento. Mudança do cadastro, do telefone observado ou da versão do vínculo invalida a confirmação conforme as regras existentes, e o backend revalida; esconder um botão no frontend não é a proteção.
- **Cliente do orçamento:** `client-matching.ts`, no salvamento de `/api/orcamento`. Com vínculo confirmado em `whatsapp_client_links`, o Novo orçamento recebe `client_id`. Sem vínculo, recebe telefone e nome exibido como dados informados; telefone sozinho é um sinal, não identidade, e cai na revisão do Split Card (`identifier_in_use` ou sugestões). Nenhum cliente é criado sem `confirm_new_client`. [S16]

Não migrar o matcher antigo que seleciona por nome como confirmação automática de cadastro.

## 8. Modelo de dados proposto

Os nomes abaixo orientam a implementação; a migration deve aproveitar estruturas equivalentes existentes quando seus contratos realmente permitirem. Não criar um modelo genérico multicanal.

| Registro | Conteúdo mínimo e garantia |
|---|---|
| `whatsapp_conversations` | ID local estável, escopo de conta/canal, identidade técnica e canônica, versão da identidade, nome exibido, situação, resumo da última mensagem, cursor de leitura e revisão de atualização. Unicidade da conversa técnica dentro do escopo. |
| `whatsapp_messages` | ID local, conversa, direção, tipo, corpo, origem (`live`, `backfill`, `operator`, `quotation`), ID real do provedor quando disponível, data do provedor, data de ingestão, posição de leitura, revisão de alteração e estado de transporte. Saída de orçamento referencia a entrega/revisão real existente. |
| `whatsapp_message_outbox` | Mensagem, chave de requisição, impressão digital do conteúdo, destinatário/versão fixados, estado, tentativas, próxima execução, lease, início de transporte, erro público classificado e correlação. |
| `whatsapp_message_events` | Recebimento durável de eventos e recibos, escopo, chave de deduplicação, versão normalizada, processamento e pendências. Pode aproveitar a estrutura de ingestão existente apenas se não exigir revisão de orçamento. |
| `whatsapp_message_attachments` (M2) | Mensagem, tipo, MIME validado, nome seguro, tamanho, checksum, referência privada do conteúdo ou referência controlada ao provedor, estado de obtenção e origem. |
| Progresso do backfill | Posição por conversa/página, estado e lacunas declaradas, para retomar sem repetir efeitos. |
| Seleção de demanda (M2) | Conversa, `demandId`, mensagens selecionadas, texto exato entregue ao Novo orçamento e referências a quote lead, oportunidade e orçamento quando existirem. Reutiliza a identidade de demanda atual. |

O cliente confirmado continua na estrutura de vínculo existente. Não manter dois campos independentes que possam afirmar clientes diferentes para a mesma conversa.

A unicidade de mensagem usa o escopo do provedor validado no contrato; no mínimo, conta/canal, conversa canônica resultante do mapeamento técnico e ID da mensagem. Se a instalação comprovar IDs únicos por conta, o índice poderá ser mais restritivo. Texto e horário não são chave de deduplicação confiável.

Usar índices para listagem por atividade, mensagens por conversa/ordenação, mudanças incrementais e fila por estado/próxima tentativa. Registrar a atualização da mensagem e da revisão da conversa de forma transacional. Não introduzir event sourcing genérico.

**Ordenação e atualização são diferentes:** a timeline usa data do evento e desempate por ID local; o cursor incremental usa revisão monotônica de alterações confirmadas. Um recibo ou uma mensagem de backfill pode modificar dados sem avançar a data da última mensagem. Uma revisão não pode ser publicada antes de seu commit, nem avançar além de alterações omitidas em uma página.

## 9. Recebimento e backfill

### 9.1 Caminho do webhook

Preservar autenticação de máquina, validação de instância e o limite de corpo de 64 KB. Aceitar somente eventos suportados da conta configurada; grupos, broadcasts e eventos fora do escopo são ignorados de forma explícita, sem falha silenciosa de eventos válidos.

Normalizar o evento, persistir mensagem/evento e atualizar a conversa com deduplicação. Confirmar recebimento ao provedor somente depois da gravação durável ou da confirmação de duplicata já salva. Falha anterior à persistência retorna erro recuperável.

Atividades, follow-ups, recibos e projeção de orçamento permanecem no processamento. Se não puderem ser concluídos na mesma transação, registrar pendência durável e permitir retentativa independente. Não confirmar evento cuja consequência necessária só existe em uma Promise não aguardada.

Evento desconhecido não apaga mensagens. Payload inesperado de um tipo suportado gera diagnóstico saneado e pendência recuperável. Não registrar payloads completos, credenciais ou mensagens de clientes em logs.

O procedimento operacional documenta só o evento `MESSAGES_UPDATE`, embora o código já trate `messages.upsert`. [S18] O E0 confirma quais eventos estão ativos na instância; ativar `MESSAGES_UPSERT`, se necessário, é mudança operacional com autorização própria. O contrato real também determina se o webhook traz mídia embutida. A configuração pretendida usa metadados/referências, não blobs em base64. Não aumentar o limite de corpo sem evidência e limite explícito.

### 9.2 Backfill e reconciliação

O backfill é a única fonte do histórico anterior à ativação (D3). Usa o acesso à Evolution de `whatsapp-conversations-sync.ts` (`findChats`, `findMessages`) e a mesma normalização e as mesmas chaves do webhook. Busca páginas delimitadas, registra progresso e pode ser retomado; cada chamada cabe nos 60 s da Function e é acionada com autenticação de máquina.

Mensagens do backfill têm origem `backfill`: não geram não lidas, não reabrem conversa, não marcam leitura externa e não acionam atividade ou follow-up como se tivessem ocorrido agora. Uma execução repetida preserva IDs locais e vínculos.

Quando a Evolution não devolver parte do histórico, a conversa declara a lacuna. Não fabricar mensagens nem afirmar importação completa a partir de uma amostra recente.

Depois do backfill inicial, a mesma rotina serve de reconciliação sob demanda. Ela não substitui o recebimento ao vivo e não faz varredura completa a cada atualização da tela. Executar em produção exige autorização operacional.

## 10. Envio confiável

### 10.1 Aceitação e despacho na requisição

O cliente gera `clientRequestId` antes do primeiro POST e conserva a chave até conhecer o resultado. A requisição de envio, em ordem:

1. Verifica autenticação, conteúdo (validação de `evolution-transport.ts`), anexos e identidade (`expectedIdentityVersion`).
2. Numa transação, resolve a idempotência por `clientRequestId` e grava mensagem e outbox em `queued`. Mesma impressão digital devolve a operação existente; impressão diferente responde `409 IDEMPOTENCY_CONFLICT`.
3. Depois do commit, reserva a operação atomicamente (`queued` → `dispatching`, com lease) e grava `transport_started_at` antes de chamar o transporte.
4. Chama o transporte existente, com o timeout atual de 15 s e a proteção `EXTERNAL_WRITES_ENABLED`.
5. Grava o resultado: `provider_accepted` com ID real; `retry_scheduled` ou `failed` para falha comprovadamente anterior ao transporte; `needs_review` para resultado incerto.
6. Responde `202` com o estado persistido. A resposta nunca é comprovante de entrega.

Tudo acontece dentro da requisição, aguardado; nada roda depois da resposta. Se a reserva não for obtida (operação cancelada ou tomada pela varredura), a resposta traz o estado atual. Se a Function for encerrada depois de `transport_started_at`, a varredura leva a operação a `needs_review`, nunca a novo envio. Repetir a requisição com a mesma chave devolve a mesma operação sem novo transporte; `GET` por `clientRequestId` recupera uma resposta perdida. Uma segunda intenção deliberada recebe nova chave.

### 10.2 Varredura de recuperação

O agendamento QStash existente (`aspen-whatsapp-delivery-worker`, a cada 2 minutos, `POST /api/quotation-delivery-worker`) é o único acionador periódico. [S18] O handler roda o lote de orçamentos como hoje e, com o tempo que sobrar, a varredura de mensagens:

- Primeiro, transições só de banco: lease vencido sem `transport_started_at` volta a `queued`; lease vencido com `transport_started_at` vai para `needs_review`.
- Depois, transporte de `queued` e `retry_scheduled` vencidos, um por vez, só enquanto o tempo restante couber um timeout de transporte com margem. O restante fica para o próximo tick.
- Ignora `queued` criados há pouco, para não disputar com o despacho na requisição; a reserva atômica garante a correção de qualquer forma.
- Nunca reduz nem atrasa o lote de orçamentos.

Sem nova rota, agendamento, segredo ou env; o endpoint mantém o nome. Um segundo agendamento de 2 minutos somaria ~720 mensagens QStash por dia às ~720 atuais, acima do limite gratuito de 1.000 por dia. [S18] A pior latência de uma retentativa é um tick; o caminho feliz não depende da varredura. A varredura registra seu resultado separado do lote de orçamentos, para o diagnóstico (RNF-04).

Registrar a aceitação real do provedor, ID de mensagem e recibos. Um identificador sentinela como `accepted` não é ID de mensagem e não pode entrar na chave de deduplicação. Aceitação sem correlação permanece pendente de reconciliação, sem criar identidade fictícia.

### 10.3 Estados e repetição

| Estado interno | Apresentação | Ação permitida |
|---|---|---|
| `queued` | Aguardando envio | Cancelar enquanto não reservada |
| `dispatching` | Enviando | Não reenviar nem editar a intenção em trânsito |
| `provider_accepted` | Aceita pelo WhatsApp | Aguardar recibos; não apresentar como entregue |
| `delivered` | Entregue | Consultar histórico |
| `read` | Lida no WhatsApp | Consultar histórico, somente com recibo real |
| `retry_scheduled` | Nova tentativa agendada | Apenas para falha comprovadamente anterior ao transporte |
| `failed` | Não enviada | Corrigir/repetir conforme falha classificada |
| `needs_review` | Envio não confirmado | Reconciliar ou revisar; nunca reenviar automaticamente |
| `cancelled` | Cancelada | Criar nova intenção somente por ação explícita |

Retry automático tem orçamento limitado e backoff, reaproveitando a política atual (`retryDelayMs`) quando adequada. Não classificar todo `5xx` do provedor como certeza de não envio.

Um recibo antecipado fica persistido até a correlação. Um recibo atrasado não regride `read` para `delivered`, nem uma aceitação para `queued`. Evidência contraditória permanece auditável.

Eco de mensagem enviada pelo próprio Aspen completa o registro local por ID de provedor; não acrescenta outro balão. Mensagem enviada por outro dispositivo, inclusive pelo WhatsApp Web, aparece como saída observada, sem inventar autoria local.

Na revisão de resultado ambíguo, o operador pode registrar a constatação ou criar uma nova tentativa explícita com alerta de possível duplicidade. Essa ação não altera retrospectivamente o fato observado no provedor.

## 11. Mídia e documentos

M2 inclui visualização de imagens, download de PDF e reprodução de áudio recebido nos formatos comprovados pela instalação. Envio manual cobre imagem e PDF; envio/gravação de áudio e vídeo ficam fora desta versão. Tipos não suportados aparecem como "Tipo de mensagem não suportado", sem desaparecimento do item.

O recebimento obtém o conteúdo por referência legítima, valida tamanho/MIME/conteúdo e o disponibiliza por acesso autenticado ou URL temporária controlada. Não confiar em URL arbitrária recebida do navegador ou do webhook.

O upload atual grava no Vercel Blob com `access: 'public'`, em caminho por grupo de produto, e não atende essa proteção. [S19] Anexos de cliente não usam esse contrato. A modalidade privada (Blob privado ou proxy autenticado sobre o armazenamento) é decisão do início do M2 e consta na evidência da entrega. Uma dependência nova continua sujeita à aprovação do projeto.

Usar IDs de anexos e os limites centrais de mídia do Aspen (`allowedMediaMimeTypes`, `MAX_DOCUMENT_BYTES`, `downloadApprovedMedia`). Formatos e limites adicionais para áudio recebido precisam ser definidos e testados antes de liberar esse recurso. Uma mídia acima do limite conserva a mensagem e explica a indisponibilidade; não falha a conversa inteira.

Preservar limites de download, timeouts, checagem de redirecionamentos, proteção contra acesso a redes privadas, nomes seguros e disposição de conteúdo. Não renderizar HTML/SVG ativo como mídia de cliente. Quando a origem permitir obtenção sob demanda, marcar claramente conteúdo ainda não armazenado e risco de indisponibilidade da origem.

Orçamentos oficiais mantêm suas URLs e revisões atuais. O chat não gera um novo link público ou PDF divergente para representar uma entrega existente.

## 12. Preparação de orçamento e vínculo com a demanda

**RF-11 não autoriza extração, emissão ou envio no Atendimento.** "Preparar orçamento" registra a demanda e entrega ao Novo orçamento; não cria documento oficial nem dispara WhatsApp.

O operador seleciona mensagens da conversa. `POST /api/atendimento-quote-draft`:

1. Verifica que as mensagens pertencem à conversa e respeita o limite inicial de até 50 mensagens e 12.000 caracteres, o mesmo do extrator. Excesso retorna pedido de seleção menor; não truncar silenciosamente. [S12]
2. Registra o texto exato que o Novo orçamento vai receber e as mensagens de origem.
3. Cria ou recupera a admissão pela regra atual: quote lead com `source: 'whatsapp'`, `externalId` igual ao ID local da conversa e `demandId` estável. A mesma tentativa não cria dois quote leads/oportunidades; nova demanda na mesma conversa recebe nova identidade, sem sobrescrever a anterior. [S05]
4. Retorna `demandId`, `quoteLeadId`, `crmDealId` quando existir e o destino de navegação.

O app abre `#/novo-orcamento?demandId=...&quoteLeadId=...&crmDealId=...` em modo conversa. A página carrega o texto registrado pelo `demandId` (`GET /api/atendimento-quote-draft`), e o prefill em `sessionStorage` (`quotationOriginPrefill.ts`) só acelera a apresentação. Se houver rascunho Auto com trabalho, vale a regra atual de isolar o conteúdo novo para revisão explícita. Extração, itens interpretados, pendências, identidade do cliente (§7), cálculo e salvamento são os do Novo orçamento e de `/api/orcamento`. Essa é a única mudança no fluxo de orçamento: aceitar `demandId` e levar a origem até o salvamento. [S13]

A confiança fixa de 0.8 desaparece com a ação `extract-quote`. Na primeira entrega, a seleção usa texto. Imagem segue o fluxo de imagem do extrator por ação explícita (M2). Áudio sem transcrição não é interpretado como texto pelo orçamento ou pela IA.

`quotationId` só existe depois do salvamento pelo fluxo de orçamento. Não chamar uma extração em memória de orçamento salvo.

A timeline pode mostrar um card de orçamento e seu estado. Para enviar, acionar a entrega atual da revisão correta; a projeção na conversa não gera outro trabalho na outbox de mensagens livres.

## 13. Assistência de IA

### 13.1 Ações

**Sugerir resposta:** produzir um texto editável, baseado na demanda atual, nas mensagens pertinentes e em dados comerciais consultados.

**Identificar pendências:** informar o que precisa ser perguntado ou confirmado, distinguindo ausência no contexto de uma obrigação comercial efetiva.

**Resumir negociação:** resumir o trecho/contexto escolhido, indicando limitações como histórico parcial ou mídia não interpretada.

Não gerar automaticamente a cada mensagem. Não introduzir chatbot separado como requisito. Falha ou indisponibilidade da IA não impede atendimento manual.

### 13.2 Contexto e saída

O backend monta contexto mínimo: IDs da conversa e da demanda, mensagens efetivamente usadas, cliente confirmado, orçamento/revisão pertinente e dados comerciais necessários. Evitar envio indiscriminado do cadastro inteiro ou de todas as conversas ao provedor.

A sugestão carrega uma versão de contexto que combina revisão da conversa, vínculo comercial e revisões consultadas. Resposta de requisição antiga nunca aparece em outra conversa. Mudança relevante sinaliza "Contexto atualizado; revisar sugestão" e exige regeneração ou revisão explícita, sem substituir rascunho já digitado.

Contrato conceitual da saída:

```json
{
  "action": "suggest_reply",
  "conversationId": "<id-local>",
  "contextVersion": "<versao-opaca>",
  "draftText": "<texto revisavel>",
  "missingFields": [],
  "sources": [
    { "kind": "message", "id": "<id-autorizado>" },
    { "kind": "quotation_revision", "id": "<revisao-consultada>" }
  ],
  "warnings": []
}
```

Validar formato, tamanho, referências e ações permitidas no servidor. IDs de fontes são limitados aos registros de fato consultados; referências inventadas pelo modelo são rejeitadas. Toda afirmação sobre preço, prazo ou condição deve estar ancorada em dado aplicável. Ausência de fonte resulta em pendência, não em invenção.

Não duplicar regras de cálculo no prompt. Mensagens de clientes e anexos são dados não confiáveis, não instruções para o sistema. O modelo não recebe credenciais, acesso direto ao banco ou ferramenta de envio. Não executar URLs, comandos ou ações arbitrárias sugeridas pelo texto.

Reutilizar a integração OpenRouter existente (`api/_infrastructure/integrations/openrouter/`). Esta spec não exige AI SDK, CopilotKit, assistant-ui ou outro pacote; qualquer dependência nova continua sujeita à aprovação do projeto. Seleção de modelo, limites de tokens/custo e timeout são configuração verificada, não IDs presumidos.

## 14. Contratos HTTP propostos

Todos os endpoints seguem o pipeline autenticado atual e o registro único em `api/_app/routes.ts`. IDs técnicos e tokens do provedor não são expostos ao frontend do Atendimento. A tabela descreve contratos **propostos**, não todos já existentes.

| Método e endpoint | Contrato | Entrega |
|---|---|---|
| `GET /api/whatsapp-conversations` | Lista por situação/busca, `limit` e `cursor`; retorna `items`, `nextCursor`, `hasMore`. Substitui o handler atual, que não tem consumidor. | M1a |
| `GET /api/whatsapp-conversations?id=...` | Detalhe e versão de identidade da conversa local. | M1a |
| `PATCH /api/whatsapp-conversations` | Atualiza situação ou cursor de leitura, com ID e versão esperada. | M1a |
| `GET /api/whatsapp-messages` | `conversationId` e, alternativamente, `before` para histórico ou `afterRevision` para alterações; responde cursores e versão consistente. | M1a |
| `POST /api/whatsapp-messages` | Grava a intenção, despacha na mesma requisição e responde `202` com o estado persistido (§10.1). | M1b |
| `GET /api/whatsapp-messages?conversationId=...&clientRequestId=...` | Recupera uma operação cujo resultado HTTP se perdeu. | M1b |
| `POST /api/whatsapp-message-actions` | Cancelamento elegível, retentativa segura ou resolução manual explícita; exige versão e ação permitida. | M1b |
| `POST /api/quotation-delivery-worker` | Endpoint existente; ganha a varredura de mensagens depois do lote de orçamentos (§10.2). | M1b |
| `POST /api/evolution-webhook` | Endpoint existente ampliado, preservando autenticação, conta e consumidores atuais. | M1a |
| `GET /api/whatsapp-message-media?id=...` | Acesso controlado ao conteúdo de anexo validado. | M2 |
| `GET /api/atendimento-context?conversationId=...` | Contexto comercial resolvido pelo backend a partir da conversa local, com o serviço da extensão e adapter sem CORS. | M2 |
| `POST /api/atendimento-client-link` | Confirma/remove vínculo pela mesma regra e versão do vínculo existente. | M2 |
| `POST /api/atendimento-quote-draft` | Registra seleção e demanda de forma idempotente; retorna `demandId`, `quoteLeadId`, `crmDealId` quando houver e destino (§12). | M2 |
| `GET /api/atendimento-quote-draft?demandId=...` | Devolve o texto registrado da seleção ao Novo orçamento. | M2 |
| `POST /api/atendimento-ai` | Ação interna permitida, conversa/seleção e contexto; retorna resultado estruturado revisável. | M3 |
| `GET /api/whatsapp-context` | Endpoint da extensão; contrato e CORS inalterados. | — |

Upload de anexos de cliente não usa o contrato de mídia do catálogo (§11) e não aceita URL arbitrária no envio.

Exemplo de intenção de envio:

```json
{
  "clientRequestId": "<uuid-estavel-da-tentativa>",
  "conversationId": "<id-local>",
  "expectedIdentityVersion": "<versao>",
  "body": "Ola!\n\nVou confirmar a medida com voce.",
  "attachmentIds": []
}
```

O servidor deriva destinatário e conta. A impressão digital idempotente abrange conversa, destino, versão e conteúdo normalizado de forma não destrutiva. Anexo inexistente, de outra conversa ou não autorizado não pode ser enviado.

Erros têm `code` estável e mensagem pública em pt-BR: `IDENTITY_CONFLICT`, `CLIENT_LINK_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CONTEXT_STALE`, `MESSAGE_TOO_LARGE`, `MEDIA_UNAVAILABLE`, `PROVIDER_UNAVAILABLE` e `SEND_REQUIRES_REVIEW`, conforme aplicável. Não devolver erro bruto de banco ou integração.

**Caminhos que saem no M1a, sem compatibilidade:** as ações antigas de `whatsapp-conversations` (`sync`, `sync-messages`, `send-message`, `extract-quote`, `create-quote-lead`), a rota `whatsapp-leads`, a leitura de KV em `whatsapp-identity-audit.ts` e a projeção de `send-whatsapp.ts` no KV. Antes de remover, confirmar que continuam sem consumidor em `src`, `extensions`, `tests` e `scripts`, e atualizar os testes afetados, inclusive o mock de `tests/orcamento.spec.js:250`. Nenhum caminho pode continuar enviando sem outbox ou escrevendo no KV.

## 15. Organização do código

Frontend em `src/features/attendance/`, com página em `pages/` e componentes separados para lista, timeline, compositor, contexto e resultado da assistência. Cliente HTTP em `src/lib/api/`, no padrão dos clientes existentes. Não adicionar React Router nem estado global. No Novo orçamento, a mudança se limita a aceitar `demandId` e levar a origem ao salvamento.

No backend, módulos de aplicação em `api/_modules`, repositórios e transações em `api/_infrastructure/db/repositories`, e fornecedores em `api/_infrastructure/integrations`.

Mover as funções neutras de telefone do store legado para `api/_shared/`, ao lado de `contact-phone.ts`, para remover o store sem quebrar os módulos de entrega; `api/_shared/AGENTS.md` admite helpers neutros de domínio e proíbe regra de negócio e escrita no banco ali. Compartilhar o serviço de contexto entre tela e extensão sem copiar o adapter CORS.

Não criar outra Function implantável: novos endpoints e a varredura ficam atrás de `api/[...path].ts`. O despacho na requisição e a varredura respeitam o limite de 60 s de `vercel.json`. [S02, S03, S11]

## 16. Retirada do KV e ativação

A troca de fonte de verdade é uma operação controlada, e esta spec não autoriza migration remota, deploy, alteração de webhook, backfill, envio real ou mudança de ambiente. [S03, S15]

**Por que não importar (D3).** O KV é derivado da mesma Evolution, está truncado em 200/100, perdeu quebras de linha e contém IDs de saída inventados que não correlacionam com o eco do provedor. Importá-lo exigiria fundir registros por aparência, o que INV-07 proíbe, sem trazer nada que o backfill não traga. Se o Passo 1 encontrar dado que só existe no KV, como histórico que a Evolution não devolve mais, ele fica no snapshot e esta decisão é revista antes do Passo 4.

**Passo 1 — Inventário.** Localmente, confirmar os leitores e escritores do KV de conversas listados no §3 e no §14. Com autorização operacional, contar em produção conversas, mensagens e conversas com `linkedLeadId`, `linkedDealId` ou `linkedQuotationId`, sem exibir conteúdo.

**Passo 2 — Snapshot protegido.** Com autorização operacional, exportar as chaves de conversas e mensagens do KV, inclusive mensagens de conversas que saíram da coleção limitada, para armazenamento protegido fora do checkout, com modo `0600`. Exportação sensível não é log nem artefato de CI. Vínculos antigos com lead, oportunidade ou orçamento não viram vínculo novo; ficam no snapshot como referência.

**Passo 3 — Migration aditiva.** Criada e testada em PostgreSQL descartável. Aplicação em produção com autorização separada, conforme `docs/database-migrations.md`.

**Passo 4 — Ativação do M1a.** Deploy do código que grava mensagens do webhook no PostgreSQL e retira o KV de conversas do código. A partir daí, mensagens ao vivo são persistidas. Se `MESSAGES_UPSERT` não estiver ativo na instância, ativá-lo tem autorização própria.

**Passo 5 — Backfill.** Com autorização operacional, executar o backfill (§9.2). Ele cobre também a janela entre o deploy e sua execução, porque deduplica por ID do provedor.

**Passo 6 — Limpeza separada.** Apagar as chaves do KV é operação posterior, explicitamente autorizada, depois da validação operacional. Não entra na migration.

**Falha depois da ativação.** Corrigir adiante, preservando o PostgreSQL; com o M1b ativo, suspender despacho pelo mecanismo operacional antes. Rollback de código só para versão compatível com os registros já criados; a versão anterior ao M1a ignora as tabelas novas. Não reativar o KV como fonte (INV-12). Backup não desfaz envio externo.

## 17. Segurança, operação e qualidade

| ID | Requisito |
|---|---|
| RNF-01 | Auth, proteção contra requisições indevidas, rate limiting e erros saneados pelo pipeline atual. Nenhum acesso público a histórico/mídia por ID adivinhado. |
| RNF-02 | Preview com `APP_ENV=preview`, `EXTERNAL_WRITES_ENABLED=0`, dados isolados e transporte simulado. Testes não usam credenciais nem mensagens de produção. |
| RNF-03 | Logs contêm IDs internos opacos, estado, código e duração; não contêm telefone, nome, corpo, prompt completo, token ou payload bruto. |
| RNF-04 | Diagnóstico mostra última ingestão bem-sucedida, progresso do backfill, idade da fila, falhas, resultados ambíguos e última varredura de mensagens. Estado visual não inventa sucesso. |
| RNF-05 | Histórico textual não tem expurgo automático por contagem. Retenção/exclusão futura deve ser explícita, documentada e preservar obrigações operacionais aplicáveis. |
| RNF-06 | Toda obtenção de mídia e chamada de IA/transporte tem limite de tamanho, duração e concorrência. Falha de IA não bloqueia a conversa. |
| RNF-07 | Navegação por teclado, foco previsível, rótulos acessíveis e estados comunicados sem depender só de cor. |
| RNF-08 | Registro idempotente de preparação de orçamento e referência às mensagens efetivamente usadas. Sem duplicar documento/cliente na recuperação de uma tentativa. |

Metas iniciais de validação, não medições de produção: testar paginação em fixture com mais de 200 conversas e mais de 100 mensagens em uma conversa; abrir a página inicial do histórico sem carregar o restante; refletir mensagem confirmada no banco no próximo ciclo normal de polling; impedir concorrência de despacho entre requisição e varredura.

Antes de atribuir meta de segundos ao envio externo, medir o despacho na requisição e os limites reais do provedor. Antes de falar em economia de tempo, registrar o fluxo manual de referência e comparar o tempo da mensagem selecionada até o rascunho e até a resposta aprovada.

Para IA, registrar ação, duração, versão de prompt/modelo e uso/custo quando informado pelo fornecedor, sem conteúdo sensível. Sucesso de geração é diferente de sugestão aceita e diferente de mensagem enviada.

## 18. Critérios de aceite e testes

Cada cenário deve ter evidência na entrega correspondente. A presença de um teste no repositório não comprova que passou na versão implementada.

| Teste | Cenário e resultado exigido | Cobertura | Entrega |
|---|---|---|---|
| AC-01 | 250 conversas e 150 mensagens em uma conversa permanecem acessíveis por paginação, sem perda após novas gravações. | RF-01/02, INV-06 | M1a |
| AC-02 | Mesmo evento recebido duas vezes produz um registro e não duplica não lidas, atividade ou efeito comercial. | RF-03, INV-07/11 | M1a |
| AC-03 | Banco falha antes da gravação do webhook: não há confirmação falsa; retry recupera o processamento. | RF-03 | M1a |
| AC-04 | Mensagem é salva e projeção de follow-up falha: pendência durável é retomada sem duplicar a mensagem. | INV-11 | M1a |
| AC-05 | Dois POSTs com mesma chave/conteúdo recuperam a mesma mensagem; alteração de destino/corpo com a mesma chave retorna conflito. | RF-04, INV-02 | M1b |
| AC-06 | Resposta HTTP do POST se perde: repetição da chave ou `GET` por `clientRequestId` recupera a operação sem novo transporte. | INV-01/02 | M1b |
| AC-07 | Despacho na requisição e varredura, ou duas varreduras, disputam o mesmo envio: apenas um inicia transporte. | INV-01/03 | M1b |
| AC-08 | Provedor pode ter aceitado, mas ocorre timeout, Function encerrada ou lease vencido depois de `transport_started_at`: a varredura leva a `needs_review`, sem reenvio. | INV-03 | M1b |
| AC-09 | Falha comprovadamente pré-transporte permite retry limitado; falha ambígua não usa esse caminho. | RF-04 | M1b |
| AC-10 | Recibo chega antes da gravação do ID de provedor: permanece salvo e converge depois. | INV-07 | M1b |
| AC-11 | Recibos fora de ordem não regridem entrega/leitura. | RF-02/04 | M1b |
| AC-12 | Aceitação sem ID real não grava sentinela compartilhada como chave nem funde mensagens distintas. | INV-07 | M1b |
| AC-13 | Saída de outro dispositivo aparece sem autoria local inventada (M1a); eco de saída local não cria outro balão (M1b). | INV-07 | M1a/M1b |
| AC-14 | Identidade anterior confiável e duas novas fontes contraditórias resultam em conflito (M1a) e bloqueio de envio (M1b). | RF-06, INV-05 | M1a/M1b |
| AC-15 | Mudança de destinatário entre a gravação da intenção e o despacho impede o transporte até revisão. | INV-04 | M1b |
| AC-16 | PN/LID ou contas sem equivalência comprovada não compartilham histórico/vínculo automaticamente. | RF-06/09 | M1a |
| AC-17 | Cadastro/vínculo muda após abertura do painel: confirmação antiga é recusada e contexto atualizado. | RF-08/09 | M2 |
| AC-18 | Troca rápida de conversa não exibe dados (M1a) ou resultado de IA (M3) da conversa anterior. | RF-05/14 | M1a/M3 |
| AC-19 | Mensagem multilinha é preservada no recebimento, backfill e apresentação (M1a) e no envio e retorno (M1b). | RF-05 | M1a/M1b |
| AC-20 | Cursor de leitura não marca mensagem que chegou após a posição visualizada; não lidas não regridem por race. | RF-07 | M1a |
| AC-21 | Backfill não cria alertas, reabre conversa ou dispara follow-up; nova entrada ao vivo reabre `closed`/`waiting_customer`. | RF-03/07 | M1a |
| AC-22 | Mensagem de backfill ou recibo alterado aparece pelo cursor incremental sem depender da data da última mensagem. | RF-02 | M1a |
| AC-23 | Mídia válida abre com acesso controlado; mídia expirada/inválida/grande preserva a mensagem com estado adequado. | RF-10 | M2 |
| AC-24 | URL maliciosa, objeto público indevido, MIME adulterado ou anexo de outro escopo não contorna a validação. | RNF-01/06 | M2 |
| AC-25 | O Novo orçamento recebe exatamente o texto registrado da seleção; acima de 50 mensagens ou 12.000 caracteres, o Atendimento pede recorte sem truncar. | RF-11 | M2 |
| AC-26 | Repetir "Preparar orçamento" com o mesmo `demandId` recupera a mesma demanda e quote lead; nova demanda na mesma conversa não sobrescreve a anterior. | RF-11, INV-08 | M2 |
| AC-27 | "Preparar orçamento" não extrai, emite nem envia; extração, identidade, cálculo e salvamento acontecem no Novo orçamento e em `/api/orcamento`. | INV-08/09 | M2 |
| AC-28 | Entrega existente de orçamento aparece na conversa sem criar outro envio ou PDF divergente. | RF-12, INV-11 | M2 |
| AC-29 | IA sem preço/prazo confirmado registra pendência; fontes fora do contexto são rejeitadas. | RF-13 | M3 |
| AC-30 | Texto de cliente tentando instruir o assistente não executa ferramenta, altera cadastro ou envia mensagem. | INV-09 | M3 |
| AC-31 | Nova mensagem/vínculo/revisão deixa sugestão obsoleta visível como tal; inserir não envia nem sobrescreve rascunho sem consentimento. | RF-14 | M3 |
| AC-32 | Modelo indisponível, formato inválido ou timeout mantêm atendimento manual utilizável. | RF-13, RNF-06 | M3 |
| AC-33 | Backfill repetido conserva IDs e contagens e não cria não lidas, reabertura, atividade, follow-up ou demanda. | INV-11/12 | M1a |
| AC-34 | Depois do M1a, nenhum código lê ou escreve conversa/mensagem no KV; mensagens gravadas sobrevivem à suspensão de envio. | INV-12 | M1a |
| AC-35 | Teste integrado cobre receber → abrir conversa → responder → refletir recibo (M1b) e abrir contexto (M2), com transporte simulado e PostgreSQL descartável. | M1b/M2 | M1b/M2 |
| AC-36 | Teste integrado cobre seleção → demanda → Novo orçamento com o texto registrado → rascunho revisável (M2) → sugestão inserida manualmente, sem envio autônomo (M3). | M2/M3 | M2/M3 |
| AC-37 | Cancelamento e reserva concorrentes têm um único vencedor: ou cancela sem transporte, ou informa que o envio já foi reservado; nunca mostra cancelamento falso. | RF-04, INV-01 | M1b |
| AC-38 | Envio e varredura em Preview com writes-off não chamam transporte real, mesmo quando acionados diretamente. | RNF-02 | M1b |
| AC-39 | Com o lote de orçamentos ocupando o tick, a varredura não inicia transporte sem tempo para um timeout completo; o lote de orçamentos não muda de tamanho nem de ordem. | RF-04, INV-11 | M1b |
| AC-40 | Com vínculo confirmado, o Novo orçamento recebe `client_id`; sem vínculo, telefone sozinho resulta em revisão no Split Card, nunca em cliente escolhido ou criado automaticamente. | RF-11, INV-08 | M2 |
| AC-41 | `/api/whatsapp-context` mantém contrato, CORS e correspondência; os testes atuais da extensão continuam passando depois da retirada do KV. | INV-11 | M1a |
| AC-42 | Rascunho Auto com trabalho não é sobrescrito quando chega uma seleção do Atendimento; o conteúdo novo fica isolado para revisão. | RF-11 | M2 |

Testes unitários cobrem parsers, identidade, preservação de corpo, estados e validação. Testes PostgreSQL cobrem transações, idempotência, concorrência, cursores e backfill. E2E cobre as jornadas na interface. Testes de contrato usam fixtures saneadas correspondentes à versão instalada da Evolution, não payloads adivinhados.

## 19. Sequência de implementação e risco

| Etapa | Entrega fechada | Validação e risco |
|---|---|---|
| E0 — Contratos e baseline | Fixtures saneadas da Evolution instalada (upsert, update, eco, mídia); eventos ativos no webhook; paginação de `findMessages`; consumidores do KV confirmados; testes de regressão para `cleanText` no corpo, `shouldKeepStored` com conflito e ID de saída inventado. | Leitura e testes isolados. Contagem do KV em produção só com autorização. |
| E1a — M1a | Migration aditiva, persistência pelo webhook, backfill, correção de identidade, página de leitura, retirada do KV de conversas e documentos de D1. AC-01–04, 13, 14, 16, 18–22, 33, 34, 41. | SAFE para tabelas, leitura e backfill. CRITICAL nas alterações do caminho do webhook que afetam follow-ups e recibos de orçamento, pelo risco de comunicação indevida. |
| E1b — M1b | Compositor, POST com despacho na requisição, ações de envio e varredura no tick. AC-05–15, 19, 35 (parte), 37–39. | CRITICAL: envio externo, idempotência e concorrência. |
| E2 — M2 | Contexto e vínculo (com o mapeamento de escopo comprovado), mídia com armazenamento privado, seleção e entrega ao Novo orçamento, card de entrega de orçamento. AC-17, 23–28, 35, 36 (parte), 40, 42. | Classificar cada diff; CRITICAL quando afeta destino, documento oficial ou comunicação. |
| E3 — M3 | Três ações assistidas, fontes, obsolescência e revisão explícita. AC-18 (IA), 29–32, 36. | Validação de saídas e isolamento; CRITICAL se o diff tocar proteção de dados/comunicação, não simplesmente por conter IA. |
| Ativação | Por entrega: migration remota, deploy, eventos do webhook e backfill, cada um com autorização operacional; limpeza do KV em trabalho separado. | CRITICAL na primeira ativação do M1a e do M1b. |

Cada etapa preserva o uso comercial atual; não fazer um grande refactor sem resultado verificável. Não substituir o transporte inteiro nem adicionar abstrações futuras para cumprir o M1.

Para código, executar `npm run verify:fast` e testes focados correspondentes ao risco; E2E integrado usa o caminho seguro do projeto e banco descartável. `verify:full` segue o gate RELEASE. PR, CI e Preview isolado seguem o procedimento vigente. [S03, S15]

## 20. Condições para liberar e definição de pronto

Antes de ativar o M1a, demonstrar a versão/modalidade efetiva da Evolution, os eventos ativos, o formato de ID e a paginação disponível para o backfill. Antes do M1b, demonstrar a correlação entre aceite, eco e recibo e o tempo real do despacho na requisição. Antes do M2, demonstrar a equivalência de escopo entre extensão e backend e a estratégia de acesso privado à mídia. Antes do M3, fixar modelo, limites de custo e timeout. A consulta à documentação pública durante a elaboração não foi conclusiva; nenhum detalhe específico da instalação é considerado validado por esse caminho.

Essas são verificações técnicas de entrega, não motivos para adiar toda a implementação isolada.

A feature está pronta quando RF-01 a RF-14 e as invariantes aplicáveis têm evidência; os cenários críticos passam no código entregue; o backfill foi ensaiado; os contratos atuais não regrediram; não há caminho de envio sem registro durável; e as limitações remanescentes estão visíveis e fora do escopo aceito.

O handoff registra base/HEAD, diff, lane e dano concreto, testes executados, pendências, autorizações obtidas e operações ainda não realizadas. Não chamar revisão própria de revisão independente. Não declarar homologado um ambiente que apenas compila.

**Decisão final desta spec:** construir a tela nativa sobre serviços comerciais reaproveitados, trocar a persistência limitada, tornar recebimento e envio confiáveis e só então adicionar assistência contextual. O resultado é atendimento integrado ao Aspen, não uma plataforma de suporte paralela.

## 21. Referências da base examinada

Caminhos de `andreibranalves/aspen-dashboard` na branch `codex/design-ui-ux-refactor` em `58967de`. Referências descrevem o estado observado; tabelas de contratos e modelos são propostas normativas desta spec.

| Fonte | Arquivos e pontos relevantes |
|---|---|
| S01 | `PRODUCT.md`: Users, Positioning, Operating Context e Product Principles. |
| S02 | `AGENTS.md` e `ARCHITECTURE.md`: arquitetura, identidade no salvamento, transporte e autorizações; `vercel.json` (limite de 60 s). |
| S03 | `docs/release-lanes.md`: lanes, isolamento, Complexidade, evidência e RELEASE. |
| S04 | `api/_modules/whatsapp-conversations-store.ts`: `MAX_STORED_CONVERSATIONS`, `MAX_STORED_MESSAGES_PER_CONVERSATION`, operações CAS, `cleanText`, `normalizeWhatsappPhone`. |
| S05 | `api/_modules/whatsapp-conversations.ts`: `send-message`, `extract-quote`, `create-quote-lead`, `buildConversationText`, `findAdmittedWhatsappLead`. |
| S06 | `api/_modules/whatsapp-conversations-sync.ts`: normalização, `findChats`/`findMessages`, limites. |
| S07 | `api/_modules/whatsapp-identity-resolver.ts`: `bestSource`, `shouldKeepStored` e fontes de remetente. |
| S08 | `api/_modules/whatsapp-context.ts`; `api/_infrastructure/db/repositories/whatsapp-client-links.ts`; `api/_shared/whatsapp-context-cors.ts`: contexto, escopo e confirmação versionada. |
| S09 | `api/_modules/whatsapp-crm-match.ts`: consultas, candidatos e correspondência automática (`e9ce1cb`). |
| S10 | `api/_modules/evolution-webhook.ts`: limite de corpo, `messages.upsert`, `messages.update`, atividades, follow-ups e recibos. |
| S11 | `api/_modules/quotation-delivery-outbox.ts`; `api/_modules/evolution-transport.ts`; `api/_modules/quotation-delivery-worker.ts`; `api/_modules/send-whatsapp.ts`; `api/_infrastructure/integrations/evolution/evolution-delivery.ts`: transporte, validação de texto, reconciliação, lote do worker e projeção no KV. |
| S12 | `api/_modules/extract.ts`: prompt, templates, validação e limites de extração. |
| S13 | `src/app/routes.tsx`; `src/features/quotations/pages/NewQuotationPage.tsx`; `src/features/crm/quotationOriginPrefill.ts`; `src/features/quotations/automaticClientResolution.ts`; `src/features/quotations/components/SplitResultCard.tsx`; `DESIGN.md`; `docs/design/DESIGN-aspen.md`; `src/index.css`; `tests/unit/ui-contract.test.ts`. |
| S14 | `tests/unit/whatsapp-conversations.test.ts`; `tests/unit/whatsapp-identity-resolver.test.ts`; testes da extensão e do vínculo: `whatsapp-context-extension.test.js`, `whatsapp-context-provider.test.js`, `whatsapp-context-history-query.test.ts`, `whatsapp-client-links.test.ts`, `whatsapp-client-links-postgres.test.ts` (todos em `tests/unit/`). |
| S15 | `docs/database-migrations.md`: aplicação operacional, ensaio isolado, backup e cutover. |
| S16 | `api/_modules/client-matching.ts`; `api/_modules/client-matches.ts`; commit `1915c59`: identidade por dois sinais e revisão no Split Card. |
| S17 | `docs/whatsapp-context-extension.md`; `docs/whatsapp-inbox-backend-inventory.md`; `extensions/whatsapp-context/README.md`; commit `1116b8b`: retirada da Inbox e extensão como superfície de conversa. |
| S18 | `docs/operational-cutoff-procedure.md` (webhook `MESSAGES_UPDATE`, agendamento QStash a cada 2 minutos); `docs/research/free-whatsapp-outbox-schedulers.md` (limites do QStash gratuito). |
| S19 | `api/_modules/communication-media-upload.ts`; `src/features/communication/components/MediaUploader.tsx`: upload público no Vercel Blob. |
