# Implementation Plan: Automação Multicanal (WhatsApp + Email)

## Overview

Conectar o dashboard (Vercel) ao n8n (já deployado no VPS) para automatizar fluxos de WhatsApp e email pós-orçamento. Zero custo mensal adicional — usa infraestrutura existente.

## Architecture Decisions

- **Orquestrador: n8n auto-hosted** (já rodando em `https://n8n-vsc9.srv1633500.hstgr.cloud`, v2.22.4, TLS/Traefik)
- **Trigger: Webhook** — dashboard dispara eventos (`POST` HTTP) para n8n; n8n processa delays, condições, retries
- **Email: Resend** — free tier (100/dia), SDK nativo no n8n, tracking de abertura/clique, entregabilidade superior ao SMTP compartilhado
- **WhatsApp: Evolution API** — já rodando em `https://evolution-api-qeaa.srv1633500.hstgr.cloud`, acessível do container n8n
- **State: n8n interno** — SQLite do próprio n8n, sem dependência externa

## Task List

### Phase 1: n8n Configuration

#### Task 1: Fix n8n config warnings

**Description:** Remover env vars deprecated e adicionar `N8N_REQUEST_TRUST_PROXY` para silenciar warnings do rate-limiter. Update no docker-compose do VPS.

**Acceptance criteria:**
- [ ] Logs não mostram mais `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
- [ ] Logs não mostram mais warning sobre `N8N_RUNNERS_ENABLED`
- [ ] n8n continua acessível após restart

**Verification:**
- [ ] `vercel dev` não afetado (projeto separado)
- [ ] Checar logs do n8n após update: sem warnings

**Dependencies:** None

**Files likely touched:**
- `/docker/n8n-vsc9/docker-compose.yml` (via Hostinger VPS API)

**Estimated scope:** XS (1 arquivo, 2 env vars)

---

#### Task 2: Criar conta Resend + configurar credential no n8n

**Description:** Criar conta gratuita no Resend (resend.com), verificar domínio `aspenestamparia.com` (DKIM/SPF), gerar API key e cadastrar como credential no n8n.

**Acceptance criteria:**
- [ ] Conta Resend criada (free tier: 100 emails/dia)
- [ ] Domínio `aspenestamparia.com` verificado no Resend (DNS records adicionados)
- [ ] API key gerada
- [ ] Credential "Resend" existe no n8n (tipo: Resend API)
- [ ] Test connection passa

**Verification:**
- [ ] Criar workflow de teste com nó "Resend" → enviar email de teste
- [ ] Email chega na caixa de entrada (não no spam)
- [ ] Resend dashboard mostra open/click tracking

**Dependencies:** Acesso ao DNS da Hostinger (para adicionar registros DKIM/SPF do Resend)

**Files likely touched:**
- DNS zone do `aspenestamparia.com` (3 registros: DKIM, SPF, Return-Path)
- n8n UI (credentials)

**Estimated scope:** S

---

#### Task 3: Build workflow "Pós-Orçamento"

**Description:** Criar workflow no n8n que:
1. Recebe webhook com payload `{ quotation_id, nome, email, telefone, ... }`
2. Envia WhatsApp via Evolution API (HTTP Request node)
3. Aguarda 24h (Wait node)
4. Envia email com PDF do orçamento via Resend (com tracking)
5. Aguarda 72h (Wait node)
6. Envia email de follow-up: "Ficou alguma dúvida?"
7. Atualiza CRM deal: status follow-up, marca como "sem resposta"

**Acceptance criteria:**
- [ ] Workflow "Pós-Orçamento" ativo no n8n
- [ ] Webhook URL gerada e testada (curl)
- [ ] WhatsApp enviado corretamente (Evolution API)
- [ ] Email com orçamento enviado 24h depois
- [ ] Follow-up "dúvidas?" enviado 72h depois
- [ ] CRM deal atualizado após follow-up (status + nota)
- [ ] Erro em qualquer step: workflow para com erro visível

**Verification:**
- [ ] `curl -X POST <webhook_url> -d '{"test": true}'` → workflow executa
- [ ] WhatsApp chega no número de teste
- [ ] Email com PDF chega após 24h
- [ ] Follow-up chega após 72h
- [ ] CRM deal atualizado (status visível no ERPNext)

**Dependencies:** Task 2 (Resend credential + domínio verificado)

**Files likely touched:**
- n8n UI (workflow JSON)

**Estimated scope:** M

---

### Checkpoint: n8n standalone funcional
- [ ] Resend configurado e testado (envio + tracking)
- [ ] Workflow: WhatsApp → 24h → email orçamento → 72h → follow-up + CRM update
- [ ] Testado manualmente via curl

---

### Phase 2: Dashboard Integration

#### Task 4: Disparar webhook no `orcamento.js`

**Description:** Após criar quotation com sucesso, `orcamento.js` dispara `POST` para o webhook do n8n. Não bloqueante — fire-and-forget com timeout curto.

**Code change (conceitual):**
```js
// No handler do orcamento.js, após criar quotation com sucesso:
const n8nUrl = process.env.N8N_WEBHOOK_URL;
if (n8nUrl) {
  fetch(n8nUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: 'quotation_created',
      quotation_id: quotation.name,
      nome,
      email,
      telefone,
      pdf_url: pdfUrl,
    }),
    signal: AbortSignal.timeout(5000),
  }).catch(err => console.error('[orcamento] n8n webhook failed:', err.message));
}
```

**Idempotência:** n8n Webhook node configurado com **Deduplication Key = `{{ $json.quotation_id }}`** — payloads repetidos são ignorados automaticamente.

**Acceptance criteria:**
- [ ] Orçamento criado → webhook disparado para n8n
- [ ] Falha no webhook NÃO quebra a criação do orçamento (try/catch, warn apenas)
- [ ] Webhook URL configurável via env var (`N8N_WEBHOOK_URL`)

**Verification:**
- [ ] `vercel dev` → criar orçamento → checar n8n executions (deve aparecer nova execution)
- [ ] Parar n8n → criar orçamento → orçamento criado normalmente (sem erro)

**Dependencies:** Task 3 (webhook URL definida)

**Files likely touched:**
- `api/_functions/orcamento.js`
- `.env` (adicionar `N8N_WEBHOOK_URL`)

**Estimated scope:** S

---

#### Task 5: Disparar webhook no `send-whatsapp.js`

**Description:** Após enviar WhatsApp manualmente, `send-whatsapp.js` dispara webhook para n8n iniciar fluxo de email follow-up. Payload inclui `source: "manual_whatsapp"`.

**Acceptance criteria:**
- [ ] WhatsApp enviado manualmente → webhook "whatsapp-sent" disparado
- [ ] Mesmo padrão fire-and-forget do Task 4
- [ ] Webhook URL configurável via env var separada ou mesmo `N8N_WEBHOOK_URL`

**Verification:**
- [ ] Enviar WhatsApp via UI → checar n8n executions
- [ ] Confirmar que workflow de follow-up inicia

**Dependencies:** Task 3

**Files likely touched:**
- `api/_functions/send-whatsapp.js`
- `.env`

**Estimated scope:** S

---

### Checkpoint: Integração completa
- [ ] Dashboard → n8n → WhatsApp → delay → Email funciona ponta a ponta
- [ ] Falhas no n8n não quebram o dashboard
- [ ] Webhook URL configurável (não hardcoded)

---

### Phase 3: Polish & Monitoring

#### Task 6: End-to-end test + monitoring

**Description:** Teste completo com quotation real e configuração de alerta de erro no n8n.

**Acceptance criteria:**
- [ ] Criar orçamento real → WhatsApp enviado → email chega após delay
- [ ] n8n workflow tem Error Trigger configurado (notificar se algo falhar)
- [ ] Documentação mínima: como acessar n8n, como ver executions, como editar workflow

**Verification:**
- [ ] Teste com orçamento real (não teste, cliente de verdade ou teste interno)
- [ ] Timeout/erro de SMTP → workflow mostra erro, não silencia

**Dependencies:** Tasks 4, 5

**Files likely touched:**
- n8n UI (Error Trigger node)
- `docs/ideas/automacao-multicanal-whatsapp-email.md` (atualizar)

**Estimated scope:** S

---

### Checkpoint: Produção
- [ ] Teste end-to-end passou
- [ ] Monitoramento de erros configurado
- [ ] Documentação atualizada

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| n8n cair e perder webhooks | Médio | Webhook é fire-and-forget no dashboard; workflow pode ser re-executado manualmente no n8n |
| Resend free tier insuficiente (100/dia) | Baixo | Volume atual ~10-20/dia; upgrade para Starter ($20/mês, 5.000/dia) se necessário |
| Verificação de domínio Resend falhar (DNS) | Médio | Fazer Task 2 primeiro; se DNS Hostinger não permitir DKIM customizado, fallback para SMTP |
| Container n8n consumir muito disco | Baixo | n8n já tem prune de insights diário; monitorar volume Docker |
| Webhook URL do VPS exposta | Baixo | n8n webhook paths são randomizados (UUID); adicionar header auth se necessário |

## Open Questions

- [ ] Senha do n8n owner: Andrei tem acesso? (precisa para configurar credentials/workflows)
- [ ] Template de email follow-up: qual o copy? Usar o mesmo tom dos templates WhatsApp?
- [ ] Quer notificação de erro do n8n via Telegram? (n8n tem nó Telegram nativo)
