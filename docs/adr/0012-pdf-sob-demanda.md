---
status: accepted
date: 2026-08-25
---

# PDF do orçamento é gerado sob demanda

Em 04/08/2026 o PDF arquivado na emissão foi abandonado. Desde 25/08/2026 (#87) o documento é sempre derivado da revisão emitida e de seu snapshot de template e empresa; o PDF é renderizado quando pedido (`/api/quotation-preview?format=pdf`, envios) e não é guardado. A emissão renderiza o PDF uma vez, apenas para recusar emitir um documento que não gera. Desde #350 esse render acontece antes da transação de escrita, sem lock. A transação refaz as validações e recusa a emissão se o documento mudou durante o render.
