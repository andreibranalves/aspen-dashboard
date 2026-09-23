# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Um único usuário: o dono da Aspen Estamparia, que opera o app sozinho no dia a dia, em desktop. Não há equipe, multiusuário nem permissões — decisões de UI podem otimizar para um operador único experiente.

## Product Purpose

Criar e gerenciar orçamentos da estamparia de ponta a ponta: extração assistida por IA (mensagens e imagens de clientes viram rascunho de orçamento), revisão/edição, emissão e entrega via WhatsApp ou e-mail — além de acompanhar o ciclo comercial (CRM kanban, clientes/leads, pedidos, produtos).

Sucesso prático: transformar uma conversa de cliente em orçamento enviado com o mínimo de cliques, e acompanhar o que aconteceu com ele depois.

## Positioning

Pipeline de orçamentos nativo em WhatsApp: a Evolution API é o único transporte de WhatsApp e os orçamentos nascem da conversa com o cliente (extração via OpenRouter), são emitidos com template próprio (branded/comparativo/simples) e devolvidos ao cliente pelo mesmo canal, com rastreio de entregas. O PostgreSQL é a fonte de verdade de produtos, clientes, orçamentos, CRM, pedidos e atividades.

## Operating Context

- Uso diário em navegador desktop (não há uso mobile real hoje).
- Fluxo típico: cliente manda mensagem/arte no WhatsApp → extração gera rascunho → revisão na tela Auto → emissão → envio WhatsApp/e-mail → follow-up no CRM/pedidos.
- Deploy na Vercel (Function única `api/[...path].ts`); lanes de release descritas em `docs/release-lanes.md`.
- Valores de ambiente reais ficam em `~/.config/aspen-dashboard/` (fora do repo).

## Capabilities and Constraints

- Rotas por hash (`src/app/routes.tsx`), sem React Router; cobre o fluxo ponta a ponta: Atendimento, Novo orçamento (Auto e manual), Orçamentos, Comercial, Pedidos, Clientes, Catálogo, Envios, Resultados, Configurações e telas de detalhe.
- Evolution API é o único transporte de WhatsApp; sem fallbacks de provedor/transporte/persistência novos.
- Sem biblioteca de estado global; preferência por estado local/contexto.
- Interface do sketch V01: workspace escuro, navegação lateral clara e uma única aparência.
- Prioridade declarada pelo dono: criação de orçamento é o trabalho central; a parte comercial (CRM, pedidos, follow-up) é a frente de evolução.
- Telas pouco usadas podem ser removidas em prol de integrações e contexto comercial (decisão registrada pelo dono).

## Brand Commitments

- Nome: Aspen Orçamento (Aspen Estamparia).
- Logos: `public/logo_marinho.svg` (claro) e `public/logo_branca.svg` (escuro); variantes de e-mail em `docs/` e `public/`.
- Identidade visual do sketch V01: canvas cinza, sidebar branca, workspace quase preto, acentos sage/terracota/taupe e fonte Manrope. Tokens em `src/index.css`, UI em pt-BR.

## Evidence on Hand

- Suíte e2e Playwright cobrindo orçamentos, produtos, settings e entregas WhatsApp.
- Templates de e-mail com as logos da marca; biblioteca de mídia no app.

## Product Principles

1. O orçamento rápido é o trabalho central: qualquer tela compete com isso.
2. WhatsApp é o canal do negócio; integrações valem mais que interfaces novas.
3. Um operador só: simplicidade e densidade valem mais que recursos de equipe.
4. O rótulo basta. Não explicar o óbvio em helpers de campo, subtítulos de página ou descrições de seção.
5. Desktop-first: atalhos, tabelas densas e fluxos de poucos cliques primeiro.
6. O comercial (CRM/pedidos) deve evoluir sem complicar o fluxo principal.

## Accessibility & Inclusion

Sem requisitos específicos estabelecidos; público é o próprio dono em desktop, pt-BR.
