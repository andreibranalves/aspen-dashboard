---
status: accepted
date: 2026-07-01
---

# Evolution API é o único transporte de WhatsApp

O WhatsApp passa só pela Evolution API da VPS: envio, webhook de mensagens e status de entrega. Não há segundo provedor nem fallback de transporte, e a troca pela WhatsApp Cloud API ficou fora de escopo (spec de identidade de 01/07/2026). A consequência é que a maioria das conversas chega endereçada por LID, sem telefone; o app nunca converte LID em telefone e trata a identidade como incompleta até haver vínculo confirmado.
