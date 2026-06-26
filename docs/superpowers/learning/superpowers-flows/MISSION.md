# Mission: Usar os fluxos Superpowers de forma previsível

## Why

O usuário quer parar de perder tempo quando um agente em nova sessão recomeça o ciclo de `brainstorming` em cima de um spec já aprovado. Ele quer saber qual prompt/skill usar em cada fase — dentro de uma sessão única ou retomando trabalho depois — para que o agente execute o trabalho em vez de redesenhar o trabalho.

## Success looks like

- Dizer "faça" para um spec aprovado e o agente criar um plano de implementação, não refazer o spec.
- Retomar uma sessão antiga passando o caminho do spec/plano e o agente continuar de onde parou.
- Saber quando usar `writing-plans`, `executing-plans`, `subagent-driven-development` e `dispatching-parallel-agents`.
- Ter prompts prontos para copiar e colar em cada transição de fase.

## Constraints

- Foco no fluxo Superpowers já instalado (skills em `/home/andrei/.kimi-code/plugins/managed/superpowers/skills/`).
- Sem exigir mudanças na ferramenta ou novas dependências.
- Material deve servir tanto para revisão rápida (colinha) quanto para estudo de 5 minutos.

## Out of scope

- Criar novas skills ou alterar o comportamento das existentes.
- Ensinar programação em si (TypeScript, React, etc.) — apenas o processo de orquestração de agentes.
