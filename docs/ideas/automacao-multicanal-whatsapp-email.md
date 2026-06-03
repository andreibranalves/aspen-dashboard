# Automação Multicanal (WhatsApp + Email)

## Problem Statement

> **HMW** permitir configurar fluxos automatizados de WhatsApp e email pós-orçamento, com delays, condições e follow-up sequences, sem custo mensal adicional?

## Recommended Direction

**n8n auto-hosted no VPS da Hostinger** como orquestrador central de automação.

O dashboard (Vercel) dispara webhooks para o n8n em eventos-chave (orçamento criado, WhatsApp enviado). O n8n gerencia todo o fluxo: delays de horas/dias, envio de email via SMTP Hostinger, envio de WhatsApp via Evolution API, condições (abriu/não abriu email, respondeu/não respondeu), e atualiza o CRM deal via API do ERPNext.

Escolhido sobre n8n porque:
- **$0/mês** (n8n community auto-hosted, Evolution já rodando, Resend free tier 100/dia cobre o volume)
- Entrega retry, delays, condições, logs e UI de debug sem escrever código de orquestração
- Resend substitui SMTP Hostinger: tracking de abertura/clique, DKIM/SPF dedicado, entregabilidade superior
- Com tracking do Resend, workflows podem decidir "abriu email? → para; não abriu? → reenvia"

## Key Assumptions to Validate

- [ ] Evolution API é acessível do container n8n (mesma rede Docker ou IP liberado) — testar com `curl` do n8n
- [ ] Domínio `aspenestamparia.com` pode ser verificado no Resend (DNS Hostinger permite DKIM customizado)
- [ ] Webhooks do Vercel → n8n têm latência aceitável (< 2s)
- [ ] n8n community edition não tem limitação que bloqueie o caso de uso (testar: delays longos, Webhook Wait, Resend node)

## MVP Scope

**Fase 1 — Setup (30min)**
- Deploy n8n via Docker no VPS Hostinger
- Expor na porta 5678 com autenticação básica

**Fase 2 — Workflow Base (1h)**
- Workflow "Pós-orçamento": webhook trigger → enviar WhatsApp (Evolution API) → delay 24h → enviar email follow-up (Resend)
- Configurar Resend credential no n8n
- Template de email com tracking de abertura

**Fase 3 — Drip Condicional (30min)**
- Workflow com condição: Resend webhook "abriu email?" → se sim, para; se não, reenvia em 72h

## Not Doing (and Why)

- **n8n cloud** — custo desnecessário, community edition é suficiente
- **UI de fluxos no dashboard** — aceito usar n8n UI separada; duplicar seria retrabalho
- **Resend** — $20-50/mês vs SMTP gratuito que já funciona
- **Vercel Cron / KV para fila** — serverless não é confiável para delays longos e retry
- **ERPNext Server Scripts** — API do ERPNext é frágil, debug horrível
- **Fase 1 Manual-only (botão "Enviar Email")** — Andrei rejeitou; quer automação de verdade

## Open Questions

- Senha do owner do n8n: Andrei tem acesso?
- DNS Hostinger permite registros DKIM customizados (necessário para Resend)?
- Template de email: React Email (via @react-email) ou HTML inline simples?
