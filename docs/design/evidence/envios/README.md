# Evidência — Envios

Implementação do BLOCO C usando a referência Figma `N8BOVUvLkQImveVtThA5CV`:

- [Pendências implementada](./implemented-pending.png)
- [Histórico implementado](./implemented-history.png)
- [Drawer de etapas e recibos](./implemented-history-drawer.png)
- Referências Figma: `15:2`, `15:113`, `15:245`, `126:5`, `126:532`, `127:13` e `128:14`.

Validação manual com mocks isolados: abas, filtros, IDs distintos por linha, abertura do drawer, preservação do estado de origem do histórico e ausência de overflow horizontal em 1440px. O histórico respeita o limite atual de 200 registros do endpoint; paginação histórica fica fora deste bloco porque o contrato atual não fornece cursor/offset. Detector Impeccable final: `[]`. Nenhum endpoint, regra de negócio, migration ou integração foi alterado.
