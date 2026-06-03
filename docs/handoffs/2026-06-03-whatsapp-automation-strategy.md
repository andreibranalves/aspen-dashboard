# Handoff: 2026-06-03 — Estratégia de Automação WhatsApp

**Projeto:** aspen-dashboard
**Branch:** N/A (discussão arquitetural, sem código)
**Data:** 2026-06-03
**Origem:** Sessão com Andrei (Hermes Web UI)

## Resumo da Sessão

Andrei quer expandir a automação de WhatsApp além do envio de orçamentos — quer fazer atendimento automático, respostas, follow-ups. Perguntou qual caminho seguir: expandir a dashboard atual, usar Chatwoot, usar só n8n, ou algo híbrido. Fizemos um levantamento completo do estado atual da infra e cheguei a uma recomendação de arquitetura em 3 camadas.

## Decisão Proposta

| Decisão | Motivo | Alternativas consideradas |
|---|---|---|
| **n8n como camada principal de automação** | Já está rodando no VPS. Suporta webhooks sem cold-start, multi-step conversations, nós HTTP/AI/ERPNext, retry e agendamento built-in. Resolve o core: receber mensagens, classificar intenção, responder, agendar follow-ups. | Chatwoot (overkill pra 1 pessoa, ~500MB RAM extra), Typebot/Dify (plataformas externas com latência e custo), só a dashboard (Vercel serverless tem timeout 10s e cold start — WhatsApp webhook exige resposta em ~3s) |
| **Dashboard continua no fluxo comercial** | Extração IA, criação de orçamentos, geração de PDF, UI. O n8n chama a dashboard via API quando precisar criar orçamento ou enviar mensagem. Separação clara: n8n = automação/inteligência, Dashboard = core de negócio. | Fazer tudo no n8n (perde a UI, extração IA, preview HTML) ou tudo na dashboard (serverless inadequado pra chatbots) |
| **Evolution API permanece como transporte** | É o que já está em produção. Só precisa ativar `readMessages: true` e configurar webhook → n8n. | Trocar de provedor WhatsApp (desnecessário, Evolution funciona) |

## Estado Atual da Infra

### Evolution API (VPS — projeto `evolution-api-qeaa`)
- Versão: **v2.3.7**
- Instância: `aspen-estamparia` — **conectada** (`state: "open"`)
- Número: `5521969241265`
- Histórico: **575 chats, 611 contatos, ~13.900 mensagens**
- ⚠️ `readMessages: false`, `alwaysOnline: false` — não está lendo mensagens recebidas
- ⚠️ **Nenhum webhook configurado** — mensagens recebidas são ignoradas
- API Key: `<redacted — verificar em ambiente/secret store>`
- Acessível em: `http://177.7.54.42:32772` / `https://evolution-api-qeaa.srv1633500.hstgr.cloud`

### n8n (VPS — projeto `n8n-vsc9`)
- **Rodando há 7 dias**
- Acessível em: porta `32788` do VPS
- ⚠️ **Nenhum workflow criado ainda** — instância limpa
- ⚠️ **Não conectado à Evolution** — não recebe webhooks

### Dashboard (Vercel — `aspen-dashboard`)
- `send-whatsapp.js`: envia mensagens outbound via Evolution (template, sequência, PDF, imagens)
- Sem endpoint de webhook — não recebe mensagens
- `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE` configurados nas env vars

### VPS (Hostinger — VM #1633500)
- 8 GB RAM, 2 vCPU, 100 GB disco
- Projetos rodando: evolution-api (12d), n8n (7d), hermes-agent, honcho, traefik
- Folga de recursos confortável para mais workloads

## Próximos Passos (Ordem de Execução)

### Passo 1: Configurar webhook Evolution → n8n
1. Ativar `readMessages: true` na instância `aspen-estamparia` via `POST /instance/update/aspen-estamparia`
2. Criar webhook: `POST /webhook/set/aspen-estamparia` com URL do n8n + eventos `MESSAGES_UPSERT`
3. Criar workflow n8n de eco: Webhook trigger → extrai texto/remetente → responde "Olá, recebi sua mensagem!"
4. Testar enviando mensagem real no WhatsApp da Aspen

### Passo 2: Fluxo de saudação + classificação
- Workflow n8n: recebe mensagem → nó AI (OpenRouter) classifica intenção (orçamento / pedido / suporte / fora)
- Saudação personalizada para primeiro contato
- Template de resposta por categoria

### Passo 3: Consulta de pedido
- n8n extrai nome/telefone → HTTP Request → ERPNext (`/api/resource/Quotation`) → retorna status
- Se não achar, oferece "quer fazer um orçamento?"

### Passo 4: Follow-ups agendados
- n8n agendador: 24h/72h/7d após orçamento → envia mensagem de follow-up
- Pode chamar `POST /api/send-whatsapp` da dashboard pra reaproveitar o pipeline de envio

## Contexto Técnico

### Endpoints Evolution API relevantes (v2)
| Ação | Método | Path |
|---|---|---|
| Atualizar instância | POST | `/instance/update/{instance}` |
| Configurar webhook | POST | `/webhook/set/{instance}` |
| Buscar chats | POST | `/chat/findChats/{instance}` |
| Buscar mensagens | POST | `/chat/findMessages/{instance}` |
| Buscar contatos | POST | `/chat/findContacts/{instance}` |
| Enviar texto | POST | `/message/sendText/{instance}` |

### Webhook payload esperado (evento MESSAGES_UPSERT)
```json
{
  "event": "messages.upsert",
  "instance": "aspen-estamparia",
  "data": {
    "key": { "remoteJid": "55219XXXXXXXX@s.whatsapp.net", "fromMe": false },
    "message": { "conversation": "Oi, quero um orçamento" },
    "pushName": "Nome do Cliente"
  }
}
```

### Variáveis de ambiente Evolution (no docker-compose)
- `AUTHENTICATION_API_KEY`: `<redacted — verificar em ambiente/secret store>`
- `SERVER_URL`: `https://evolution-api-qeaa.srv1633500.hstgr.cloud`
- Database: PostgreSQL com `DATABASE_SAVE_DATA_NEW_MESSAGE: true` — mensagens são persistidas

## Notas & Armadilhas

- **@lid JIDs**: Evolution API v2.3.x tem bug conhecido onde alguns remetentes vêm com JID `@lid` ao invés de `@s.whatsapp.net`. O número real pode estar ausente. A skill `evolution-api` tem fallback chain documentado (JID → senderPn → AI extraction → ERPNext lookup → fuzzy name match).
- **Timeout do webhook**: O n8n precisa responder ao webhook em < 3 segundos. Use Response Node com "Respond Immediately" e processe o resto async.
- **Rate limit do WhatsApp**: Máximo ~50-80 mensagens/minuto. Adicione delay de 1-2s entre mensagens em sequências.
- **Horário comercial**: Considere não enviar follow-ups fora de horário comercial (Brasil).
- **API Key do Evolution na Vercel**: As env vars da dashboard podem ter uma key diferente. Verificar se `EVOLUTION_API_KEY` no `.env` da Vercel bate com a do docker-compose/secret store, sem registrar o valor em docs.
