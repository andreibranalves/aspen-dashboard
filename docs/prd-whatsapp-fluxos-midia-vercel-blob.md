# PRD: Fluxos de WhatsApp com mídia por produto usando Vercel Blob

**Data:** 2026-06-16  
**Status:** Proposto  
**Produto:** Aspen Dashboard — Comunicação / WhatsApp  
**Responsável comercial:** Aspen Estamparia  
**Stack-alvo:** Dashboard Aspen + Vercel Blob + n8n + Evolution API + ERPNext/CRM

---

## 1. Resumo executivo

A Aspen hoje consegue enviar WhatsApp a partir da página `/auto`, principalmente para o cenário em que a conversa com o cliente já está aberta: o sistema envia uma mensagem curta e anexa o PDF do orçamento.

O próximo passo é permitir fluxos mais ricos para cenários de **primeiro contato**, especialmente quando o cliente pediu orçamento por e-mail, formulário ou outro canal e ainda não existe uma conversa aberta no WhatsApp.

O MVP proposto cria uma configuração simples no Dashboard para:

1. Cadastrar fluxos de WhatsApp por contexto comercial.
2. Cadastrar fotos/vídeos comerciais por grupo de produto ou produto específico.
3. Armazenar esses arquivos no **Vercel Blob**.
4. Enviar uma sequência de mensagens via Evolution API, orquestrada pelo app ou pelo n8n.
5. Registrar histórico/status para evitar duplicidade e dar visibilidade ao operador.

A decisão de usar **Vercel Blob** é adequada porque o volume esperado é pequeno, os arquivos são comerciais e reutilizáveis, e o custo/limite não deve ser um problema para a fase atual.

---

## 2. Problema

### Situação atual

O envio atual funciona bem para o contexto:

> “Já estou falando com o cliente no WhatsApp e quero apenas mandar o orçamento.”

Exemplo atual:

```txt
Segue o orçamento solicitado, João!
[orçamento.pdf]
```

### Limitação

Quando o pedido vem por e-mail ou formulário, esse texto é insuficiente porque:

- o cliente talvez ainda não reconheça o número da Aspen;
- a atendente precisa se apresentar;
- a mensagem precisa explicar o motivo do contato;
- o orçamento deve ser contextualizado com o produto/quantidade;
- materiais visuais ajudam a aumentar confiança e conversão;
- a Aspen precisa configurar esses materiais sem editar código.

### Exemplo desejado

```txt
Msg 1:
Boa tarde, João! Tudo bem?

Msg 2:
Meu nome é Juliana, da Aspen Estamparia.
Estou entrando em contato com o orçamento de 30 cangas personalizadas.

Msg 3:
[orçamento.pdf]

Msg 4:
Separei também uma referência de cangas personalizadas para você visualizar melhor o acabamento.
[foto ou vídeo]
```

---

## 3. Objetivos

### Objetivos do MVP

1. Permitir configurar fluxos de WhatsApp para pelo menos dois contextos:
   - **Já estou falando com o cliente**
   - **Primeiro contato — pedido veio por e-mail/formulário**

2. Permitir cadastrar biblioteca de mídias comerciais:
   - por grupo de produto;
   - opcionalmente por produto/SKU específico;
   - com arquivo, tipo, descrição/caption e status ativo/inativo.

3. Usar **Vercel Blob** como storage dos arquivos enviados pelo Dashboard.

4. Permitir que o fluxo selecione automaticamente uma mídia relevante com base nos itens do orçamento.

5. Permitir preview antes do envio.

6. Enviar mensagens sequenciais com pequenos intervalos entre elas.

7. Registrar histórico de envio.

### Objetivos de negócio

- Aumentar conversão de orçamentos vindos por e-mail/formulário.
- Reduzir trabalho manual repetitivo da atendente.
- Manter o tom humano e contextualizado.
- Evitar mensagens duplicadas ou fora de contexto.
- Permitir que a própria operação comercial atualize materiais visuais.

---

## 4. Não objetivos nesta fase

O MVP **não** deve tentar construir:

1. Um bot conversacional completo.
2. Um substituto do Typebot.
3. Um substituto do n8n.
4. Uma inbox multiatendente estilo Chatwoot.
5. Edição visual completa da topologia do n8n.
6. IA gerando mensagens automaticamente sem revisão.
7. Upload de grandes bibliotecas de catálogo com centenas de arquivos.
8. Sistema avançado de DAM ou gestão de assets.

Typebot pode ser avaliado em fase futura se a Aspen quiser atendimento interativo com botões, perguntas, qualificação ou autoatendimento.

---

## 5. Usuários

### Operador comercial / atendente

Exemplo: Juliana.

Precisa:

- enviar orçamento por WhatsApp rapidamente;
- escolher ou confirmar o fluxo correto;
- ver preview das mensagens;
- confiar que o PDF e a mídia correta serão enviados;
- evitar enviar mensagem errada para cliente já em conversa.

### Administrador da operação

Exemplo: Andrei.

Precisa:

- configurar fluxos globais;
- cadastrar mídias por grupo/produto;
- testar envios;
- consultar histórico;
- ajustar copy sem mexer em código;
- manter custo baixo.

---

## 6. Premissas

1. A Aspen usará poucos arquivos de mídia inicialmente.
2. O volume não deve estourar os limites práticos do Vercel Blob para o MVP.
3. As mídias são comerciais e não sensíveis; podem ser públicas por URL não listada.
4. O Dashboard continua sendo a interface principal de configuração.
5. A Evolution API continua sendo o transporte de WhatsApp.
6. O n8n pode continuar orquestrando delays, webhooks, logs e integrações.
7. O ERPNext/CRM continua sendo a fonte de verdade para orçamento, cliente e status comercial.
8. Estado/configuração deve ser global/server-side, nunca depender apenas de `localStorage`.

---

## 7. Decisão de storage: Vercel Blob

### Decisão

Usar **Vercel Blob** para armazenar fotos e vídeos comerciais usados nos fluxos de WhatsApp.

### Modo recomendado

Criar um Blob Store **público** para assets comerciais.

Motivo:

- Evolution API precisa baixar a mídia por URL.
- Os arquivos são materiais comerciais, não documentos sensíveis.
- URLs públicas simplificam envio via WhatsApp.
- Evita proxy/download pelo backend.

### Segurança

Mesmo com leitura pública, o upload deve ser protegido:

- somente usuários autenticados do Dashboard podem gerar token/upload;
- validar tipo de arquivo;
- validar tamanho máximo;
- registrar quem enviou;
- permitir desativar/remover mídia;
- nunca expor `BLOB_READ_WRITE_TOKEN` no frontend.

### Upload recomendado

Usar **client upload** do Vercel Blob.

Motivo:

- imagens/vídeos podem passar de 4,5 MB;
- Vercel Functions têm limite de request body para server upload;
- no client upload, o arquivo vai direto do browser para o Blob;
- o backend apenas autentica e gera o token temporário.

### Variável de ambiente

O projeto precisa receber:

```txt
BLOB_READ_WRITE_TOKEN=...
```

No Vercel, essa variável é criada automaticamente ao conectar o Blob Store ao projeto.  
Na VPS/local, deve ser adicionada ao `.env` usado pelo app server.

---

## 8. Modelo de dados proposto

### 8.1 CommunicationMediaAsset

Representa um arquivo comercial reutilizável.

```ts
type CommunicationMediaAsset = {
  id: string;
  title: string;
  description?: string;
  product_group: string;
  product_code?: string;
  kind: 'image' | 'video';
  blob_url: string;
  pathname: string;
  content_type: string;
  size_bytes: number;
  caption?: string;
  active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
};
```

Exemplo:

```json
{
  "id": "media_canga_001",
  "title": "Canga personalizada — praia",
  "description": "Foto de referência para cangas personalizadas",
  "product_group": "canga",
  "product_code": null,
  "kind": "image",
  "blob_url": "https://...public.blob.vercel-storage.com/whatsapp/canga/praia.jpg",
  "pathname": "whatsapp/canga/praia.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 842331,
  "caption": "Exemplo de canga personalizada com estampa total.",
  "active": true,
  "sort_order": 10,
  "created_at": "2026-06-16T00:00:00.000Z",
  "updated_at": "2026-06-16T00:00:00.000Z"
}
```

### 8.2 CommunicationFlow

Evolução do modelo atual de WhatsApp Flows.

```ts
type CommunicationFlow = {
  id: string;
  name: string;
  description?: string;
  context: 'already_talking' | 'email_first_contact' | 'form_first_contact' | 'manual';
  channel: 'whatsapp';
  vendor_name: string;
  enabled: boolean;
  delay_min_seconds: number;
  delay_max_seconds: number;
  max_media_per_product_group: number;
  steps: CommunicationFlowStep[];
  created_at: string;
  updated_at: string;
};
```

### 8.3 CommunicationFlowStep

```ts
type CommunicationFlowStep =
  | {
      id: string;
      type: 'text';
      template: string;
    }
  | {
      id: string;
      type: 'quotation_pdf';
      caption?: string;
    }
  | {
      id: string;
      type: 'product_media';
      selection: 'product_code_first' | 'product_group';
      max_items: number;
      fallback_group?: string;
      caption_template?: string;
    }
  | {
      id: string;
      type: 'fixed_media';
      media_asset_id: string;
      caption_template?: string;
    };
```

### 8.4 CommunicationSendEvent

Histórico de execução.

```ts
type CommunicationSendEvent = {
  id: string;
  quotation_id: string;
  customer_name: string;
  phone: string;
  flow_id: string;
  context: string;
  status: 'pending' | 'sent' | 'failed' | 'skipped';
  steps_planned: number;
  steps_sent: number;
  error_message?: string;
  sent_at?: string;
  created_at: string;
  created_by?: string;
};
```

---

## 9. Variáveis de template

O MVP deve suportar no mínimo:

| Variável | Descrição | Exemplo |
|---|---|---|
| `(Saudacao)` | Saudação por horário | Bom dia / Boa tarde / Boa noite |
| `(nome)` | Nome completo | João Silva |
| `(primeiro_nome)` | Primeiro nome | João |
| `(vendedora)` | Nome da atendente | Juliana |
| `(empresa)` | Nome da empresa | Aspen Estamparia |
| `(produto_resumo)` | Resumo comercial do pedido | 30 cangas personalizadas |
| `(numero_pedido)` | ID do orçamento | SAL-QTN-2026-00001 |
| `(link_orcamento)` | Link público/visualização | https://... |
| `(grupo_produto)` | Grupo detectado | canga |

### Regra de saudação

```txt
05:00–11:59 → Bom dia
12:00–17:59 → Boa tarde
18:00–04:59 → Boa noite
```

---

## 10. Fluxos padrão do MVP

### 10.1 Já estou falando com o cliente

Uso: conversa já aberta no WhatsApp.

```txt
Msg 1:
Segue o orçamento solicitado, (primeiro_nome)!

Msg 2:
[PDF do orçamento]
```

Comportamento:

- envio manual assistido;
- sem mídia extra por padrão;
- delay curto de 1–2 segundos.

### 10.2 Primeiro contato — pedido veio por e-mail

Uso: cliente pediu por e-mail/formulário; a Aspen quer iniciar WhatsApp.

```txt
Msg 1:
(Saudacao), (primeiro_nome)! Tudo bem?

Msg 2:
Meu nome é (vendedora), da Aspen Estamparia.
Estou entrando em contato com o orçamento de (produto_resumo).

Msg 3:
[PDF do orçamento]

Msg 4:
Separei também uma referência de (grupo_produto) para você visualizar melhor o acabamento.
[mídia do grupo/produto]
```

Comportamento:

- envio manual assistido no MVP;
- operador vê preview antes;
- seleciona automaticamente mídia do grupo detectado;
- se não houver mídia cadastrada, pula o passo de mídia e avisa no preview.

---

## 11. Experiência do usuário

### 11.1 Página/Aba: Comunicação

Criar ou evoluir uma área no Dashboard:

```txt
Comunicação
  ├─ Fluxos WhatsApp
  ├─ Biblioteca de mídias
  ├─ Histórico de envios
  └─ Configuração / saúde dos canais
```

### 11.2 Fluxos WhatsApp

Funcionalidades:

- listar fluxos;
- criar/duplicar fluxo;
- editar nome, descrição, contexto e atendente padrão;
- editar passos;
- preview com dados mock e com dados reais de um orçamento;
- botão “Enviar teste”;
- ativar/desativar fluxo.

### 11.3 Biblioteca de mídias

Funcionalidades:

- upload de imagem/vídeo;
- definir grupo de produto;
- opcionalmente vincular SKU/produto específico;
- editar título e caption;
- ordenar prioridade;
- ativar/desativar;
- remover do catálogo operacional;
- visualizar URL/blob metadata;
- indicar se mídia está sendo usada em algum fluxo.

### 11.4 Página `/auto`

Ao gerar orçamento, o botão de WhatsApp deve permitir:

```txt
Enviar WhatsApp
  - Já estou falando com o cliente
  - Primeiro contato — pedido veio por e-mail
```

O sistema deve sugerir o fluxo com base na origem do pedido quando esse dado existir, mas o operador pode trocar antes de enviar.

### 11.5 Preview antes do envio

Antes de enviar, mostrar:

```txt
Cliente: João Silva
Telefone: +55 ...
Fluxo: Primeiro contato — pedido veio por e-mail
Produto: 30 cangas personalizadas
Mídia selecionada: Canga personalizada — praia

Mensagens:
1. Boa tarde, João! Tudo bem?
2. Meu nome é Juliana...
3. PDF: SAL-QTN-2026-00001.pdf
4. [imagem] Exemplo de canga personalizada...
```

Botões:

- `Enviar agora`
- `Trocar fluxo`
- `Editar antes de enviar` — opcional/futuro
- `Cancelar`

---

## 12. APIs propostas

### 12.1 Upload/token Vercel Blob

```txt
POST /api/communication-media/upload-token
```

Responsabilidade:

- autenticar usuário;
- validar intenção de upload;
- gerar token de client upload do Vercel Blob;
- restringir pathname sugerido.

Entrada:

```json
{
  "filename": "canga-praia.jpg",
  "contentType": "image/jpeg",
  "product_group": "canga",
  "product_code": null
}
```

Saída:

```json
{
  "success": true,
  "uploadUrl": "...",
  "pathnamePrefix": "whatsapp/canga/"
}
```

> A implementação exata deve seguir o padrão do `@vercel/blob/client` para client uploads.

### 12.2 Registrar mídia após upload

```txt
POST /api/communication-media
```

Entrada:

```json
{
  "title": "Canga personalizada — praia",
  "description": "Referência comercial para cangas",
  "product_group": "canga",
  "product_code": null,
  "kind": "image",
  "blob_url": "https://...",
  "pathname": "whatsapp/canga/canga-praia.jpg",
  "content_type": "image/jpeg",
  "size_bytes": 842331,
  "caption": "Exemplo de canga personalizada com estampa total."
}
```

### 12.3 Listar mídias

```txt
GET /api/communication-media?product_group=canga&active=1
```

Saída:

```json
{
  "success": true,
  "items": [
    {
      "id": "media_canga_001",
      "title": "Canga personalizada — praia",
      "product_group": "canga",
      "kind": "image",
      "blob_url": "https://...",
      "caption": "Exemplo de canga personalizada...",
      "active": true
    }
  ]
}
```

### 12.4 Atualizar mídia

```txt
PUT /api/communication-media/:id
```

Permite editar:

- título;
- descrição;
- grupo;
- SKU;
- caption;
- ativo/inativo;
- ordem.

### 12.5 Renderizar preview do fluxo

```txt
POST /api/communication-flow-preview
```

Entrada:

```json
{
  "flow_id": "email-first-contact",
  "quotation_id": "SAL-QTN-2026-00001"
}
```

Saída:

```json
{
  "success": true,
  "context": {
    "customer_name": "João Silva",
    "product_summary": "30 cangas personalizadas",
    "product_groups": ["canga"]
  },
  "steps": [
    { "type": "text", "text": "Boa tarde, João! Tudo bem?" },
    { "type": "text", "text": "Meu nome é Juliana..." },
    { "type": "document", "fileName": "SAL-QTN-2026-00001.pdf" },
    {
      "type": "image",
      "url": "https://...",
      "caption": "Exemplo de canga personalizada..."
    }
  ],
  "warnings": []
}
```

### 12.6 Enviar fluxo

```txt
POST /api/send-whatsapp-flow
```

Ou evolução do endpoint atual:

```txt
POST /api/send-whatsapp
```

Entrada:

```json
{
  "quotation_id": "SAL-QTN-2026-00001",
  "phone": "5511999999999",
  "flow_id": "email-first-contact",
  "context": "email_first_contact",
  "dry_run": false
}
```

Saída:

```json
{
  "success": true,
  "send_event_id": "send_abc123",
  "steps_sent": 4
}
```

---

## 13. n8n

### Papel recomendado do n8n no MVP

O n8n deve continuar como orquestrador, mas não como editor principal dos templates.

Responsabilidades recomendadas:

- receber eventos do Dashboard;
- fazer branch por `event`;
- aplicar waits quando necessário;
- atualizar CRM/ERPNext;
- registrar erro/alerta;
- futuramente executar follow-ups atrasados.

### Eventos mínimos

```txt
quotation_created
whatsapp_flow_sent
whatsapp_flow_failed
communication_media_uploaded
```

### Guardrail obrigatório

Logo no início do workflow:

```txt
Webhook
  ├─ event = quotation_created
  ├─ event = whatsapp_flow_sent
  ├─ event = whatsapp_flow_failed
  └─ otherwise → ignore/alert
```

O evento `quotation_created` não deve disparar WhatsApp automaticamente sem regra explícita.

---

## 14. Regras de seleção de mídia

### Prioridade

1. Mídia vinculada ao SKU/produto específico.
2. Mídia vinculada ao grupo de produto detectado.
3. Mídia de fallback do fluxo.
4. Sem mídia — pular passo e avisar no preview.

### Detecção de grupo

Usar os itens do orçamento:

- SKU/prefixo quando disponível;
- categoria/grupo do item quando disponível;
- fallback por regra existente no backend.

### Limites no MVP

- Máximo de 1 mídia por envio no fluxo de primeiro contato.
- Máximo configurável por fluxo, com default `1`.
- Tipos aceitos:
  - `image/jpeg`
  - `image/png`
  - `image/webp`
  - `video/mp4`

### Tamanho sugerido

Para manter envio rápido no WhatsApp:

- imagem: sugerir até 5 MB;
- vídeo: sugerir até 25 MB no MVP;
- bloquear acima de limite configurado.

Mesmo usando client upload no Vercel Blob, arquivos muito grandes não são ideais para envio comercial por WhatsApp.

---

## 15. Persistência

### Configurações globais

Fluxos, seleção padrão e biblioteca de mídia devem ser globais/server-side.

Opções aceitáveis:

1. Vercel KV / Upstash Redis — simples e alinhado ao modelo atual de WhatsApp Flows.
2. ERPNext DocType customizado — melhor para auditoria/CRM, mais trabalho.
3. Arquivo JSON server-side — aceitável só como fallback local/dev.

### Recomendação MVP

Usar Vercel KV/Upstash para metadados:

```txt
aspen:communication:flows
aspen:communication:media-assets
aspen:communication:send-events
```

Usar Vercel Blob apenas para os arquivos binários.

---

## 16. Requisitos funcionais

### RF-01 — Criar fluxo de WhatsApp

O administrador deve conseguir criar um fluxo com nome, contexto, atendente, delays e passos.

### RF-02 — Editar fluxo existente

O administrador deve conseguir editar textos, ordem dos passos e status ativo/inativo.

### RF-03 — Cadastrar mídia

O administrador deve conseguir fazer upload de imagem/vídeo e associar a grupo/produto.

### RF-04 — Armazenar mídia no Vercel Blob

O arquivo deve ser armazenado no Vercel Blob e retornar URL pública utilizável pela Evolution API.

### RF-05 — Selecionar mídia automaticamente

Ao preparar envio, o sistema deve selecionar mídia compatível com os produtos do orçamento.

### RF-06 — Preview antes do envio

O operador deve ver mensagens, PDF e mídia antes de enviar.

### RF-07 — Enviar sequência

O sistema deve enviar textos, PDF e mídia em sequência, respeitando delays configurados.

### RF-08 — Histórico

Todo envio deve gerar registro com orçamento, telefone, fluxo, status e erro se houver.

### RF-09 — Evitar duplicidade

O sistema deve alertar se o mesmo fluxo já foi enviado recentemente para o mesmo orçamento/telefone.

### RF-10 — Fallback sem mídia

Se não houver mídia configurada para o produto, o envio não deve falhar. O passo de mídia deve ser omitido com aviso no preview.

---

## 17. Requisitos não funcionais

1. **Segurança:** token do Vercel Blob nunca exposto ao cliente.
2. **Performance:** preview deve carregar em até 2 segundos em condições normais.
3. **Confiabilidade:** falha no envio de uma mídia deve ser registrada e exibida.
4. **Auditabilidade:** histórico deve permitir entender o que foi enviado.
5. **Baixo custo:** solução deve operar dentro do uso esperado do Vercel Blob para poucos arquivos.
6. **Simplicidade:** evitar instalar Typebot/Chatwoot para este MVP.
7. **Manutenibilidade:** templates e metadados devem estar centralizados, não duplicados em n8n e frontend.

---

## 18. Critérios de aceite

### CA-01 — Upload de mídia

Dado que sou administrador, quando faço upload de uma imagem de canga, então ela aparece na biblioteca com URL, grupo, caption e status ativo.

### CA-02 — Preview com mídia

Dado um orçamento de canga e uma mídia ativa de canga, quando seleciono o fluxo “Primeiro contato — pedido veio por e-mail”, então o preview mostra a imagem/vídeo selecionado.

### CA-03 — Preview sem mídia

Dado um orçamento sem mídia correspondente, quando abro o preview, então o sistema mostra aviso e omite o passo de mídia sem bloquear envio.

### CA-04 — Envio completo

Dado um orçamento com telefone válido, quando confirmo o envio, então o cliente recebe:

1. saudação por horário;
2. apresentação da atendente;
3. PDF do orçamento;
4. mídia contextual com caption.

### CA-05 — Histórico

Após o envio, o histórico mostra orçamento, cliente, telefone, fluxo, status e data/hora.

### CA-06 — Sem duplicidade silenciosa

Se o fluxo já foi enviado para o mesmo orçamento/telefone, o sistema deve alertar antes de reenviar.

### CA-07 — Segurança do upload

Usuário não autenticado não consegue gerar token de upload nem cadastrar mídia.

---

## 19. Plano de implementação sugerido

### Fase 1 — PRD e design funcional

- Validar este PRD.
- Definir onde a aba “Comunicação” ficará na navegação.
- Definir nomes dos grupos de produto iniciais.

### Fase 2 — Storage e metadados

- Criar Blob Store público no Vercel.
- Adicionar `BLOB_READ_WRITE_TOKEN` nos ambientes necessários.
- Criar endpoints de mídia.
- Persistir metadados em KV/Upstash.

### Fase 3 — Biblioteca de mídias

- Criar UI para listar/upload/editar/desativar mídia.
- Validar tipo e tamanho.
- Mostrar preview.

### Fase 4 — Preview de fluxo

- Criar endpoint de renderização de preview.
- Reutilizar lógica de variáveis existente.
- Selecionar mídia por SKU/grupo.

### Fase 5 — Envio

- Evoluir `send-whatsapp` ou criar `send-whatsapp-flow`.
- Enviar texto, PDF e mídia.
- Registrar histórico.
- Enviar evento ao n8n.

### Fase 6 — Operação e histórico

- Mostrar histórico na área Comunicação.
- Adicionar alertas de duplicidade.
- Adicionar teste de envio.

---

## 20. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Arquivos grandes prejudicam envio | Mensagem demora/falha | Limitar tamanho e orientar compressão |
| URL pública de mídia é compartilhável | Baixo, material comercial | Usar só assets não sensíveis |
| Templates duplicados entre app e n8n | Manutenção ruim | Dashboard vira fonte de verdade; n8n executa |
| Envio duplicado para cliente | Experiência ruim | Histórico + alerta antes de reenviar |
| Falha no Blob token/local env | Upload indisponível | Status de configuração na UI |
| Evolution não aceita algum formato | Falha no envio | Restringir MIME types testados |

---

## 21. Perguntas em aberto

1. Quais grupos de produto entram primeiro?
   - Sugestão: canga, lenço, boné, toalha, chapéu, ecobag, cachecol.

2. A mídia deve ser sempre escolhida automaticamente ou o operador pode trocar antes do envio?
   - Recomendação: automático com opção de trocar no preview.

3. O primeiro contato por WhatsApp deve ser sempre manual assistido ou pode ser automático para pedidos por e-mail?
   - Recomendação MVP: manual assistido.

4. Onde o histórico definitivo deve viver?
   - Recomendação MVP: KV/endpoint do dashboard.
   - Recomendação futura: ERPNext/CRM timeline.

5. Vídeo entra no primeiro MVP ou começa apenas com imagem?
   - Recomendação: aceitar vídeo MP4 desde que limitado, mas lançar primeiro com imagem se quiser reduzir risco.

---

## 22. Métricas de sucesso

1. Tempo médio para enviar orçamento contextual por WhatsApp cai para menos de 30 segundos após criação do orçamento.
2. Pelo menos 80% dos envios de primeiro contato usam mídia contextual cadastrada.
3. Zero duplicidades silenciosas no mesmo orçamento/telefone.
4. Operador consegue alterar copy e mídia sem editar código.
5. Falhas de envio ficam visíveis no histórico.

---

## 23. Decisão recomendada

Implementar o MVP usando:

```txt
Dashboard Aspen       → configuração, preview, upload e disparo
Vercel Blob           → armazenamento de imagens/vídeos comerciais
Vercel KV / Upstash   → metadados dos fluxos, mídias e histórico
Evolution API         → envio WhatsApp
n8n                   → orquestração/eventos/follow-ups
ERPNext/CRM           → orçamento, cliente e status comercial
```

Não instalar Typebot nesta fase. O Typebot deve ficar reservado para uma etapa futura de atendimento interativo, caso a Aspen queira transformar o WhatsApp em bot com opções, perguntas e respostas guiadas.
