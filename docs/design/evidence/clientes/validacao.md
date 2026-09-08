# Evidência visual: jornada de Clientes

Registro de validação desta entrega; o contrato normativo continua em
[`DESIGN-aspen.md`](../../DESIGN-aspen.md).

## Recorte e isolamento

- Base controlada: `2012fa7a3539fdaed89255875cf5a29330c51d56` (`origin/master`).
- Figma consultado: arquivo `N8BOVUvLkQImveVtThA5CV`, nós `13:2` (lista),
  `13:119` (visualização rápida), `13:247` (ficha), `13:334` (edição),
  `213:50` (menu de exportação/ações) e `213:171` (estado arquivado).
- Capturas com fixtures locais e APIs de Clientes interceptadas. Nenhuma
  alteração de banco, migration, emissão, mensagem ou exportação real foi
  executada.

## Capturas finais

| Vista                          | Claro                                    | Escuro                                  |
| ------------------------------ | ---------------------------------------- | --------------------------------------- |
| Lista · 1440×900               | [PNG](lista-1440x900-light.png)          | [PNG](lista-1440x900-dark.png)          |
| Visualização rápida · 1280×800 | [PNG](drawer-1280x800-light.png)         | [PNG](drawer-1280x800-dark.png)         |
| Ficha · 1440×900               | [PNG](cadastro-1440x900-light.png)       | [PNG](cadastro-1440x900-dark.png)       |
| Edição · 1024×800              | [PNG](edicao-1024x800-light.png)         | [PNG](edicao-1024x800-dark.png)         |
| Ficha mobile · 390×844         | [PNG](cadastro-mobile-390x844-light.png) | [PNG](cadastro-mobile-390x844-dark.png) |

## Comportamentos exercitados

- Listagem, busca, filtro Ativos/Arquivados/Todos, criação, ficha completa e
  visualização rápida permanecem nos contratos existentes.
- A ficha expõe contato, endereço, orçamento recente, negócio ativo e pedidos
  recentes somente quando esses relacionamentos existem.
- Novo orçamento mantém o contexto do cliente no fluxo `#/auto`.
- Edição usa um único salvar, preserva o endereço completo e protege alterações
  não salvas na navegação, fechamento e troca de rota.
- Arquivar/restaurar usa confirmação e os endpoints existentes; não há exclusão
  irreversível.
- Ações secundárias ficam no menu contextual e todos os controles têm nome
  acessível.
- O orçamento recente tem um único ponto de abertura no painel rápido e na
  ficha, sem repetir a mesma ação no cabeçalho.

## Verificações

- `npm run verify:fast` — passou.
- `npm run test:unit:focused -- tests/unit/client-detail.test.ts tests/unit/new-client-prefill.test.ts tests/unit/local-projections.test.ts` — 10 passaram.
- `npm run test:unit:focused -- tests/unit/commercial-export-client.test.ts` — 4 passaram.
- `tests/client-core.spec.js` — 11 passaram, incluindo exportação controlada, falha de gravação, descarte e retorno de foco.
- `tests/new-quotation.spec.js` — 17 passaram; cobre rascunhos, entrada comum e o segundo consumidor de `DetailDrawer`.
- `tests/client-core.spec.js` + `tests/orcamento.spec.js` — 24 passaram na regressão conjunta após a revisão.
- `tests/clientes-figma.spec.js` — 1 passou; 10 capturas nos dois temas, após `document.fonts.ready` e confirmação do asset de marca nas vistas expandidas.
- `git diff --check` — passou.
- Nenhum backend, repositório, schema ou migration foi alterado.

`verify:full`, PostgreSQL real e E2E completo foram omitidos conforme a lane
FAST e o escopo visual.

## Diferenças intencionais

- A tabela mantém Documento e Status, que são os campos suportados pelo
  endpoint atual; as colunas de métricas de orçamentos/valor do frame não foram
  inventadas sem contrato de dados.
- O identificador UUID não é exibido como identidade da pessoa; a ficha usa o
  nome projetado e o rótulo de entidade `Cliente`.
- O layout preserva as rotas, APIs, menus, ações e labels já consumidos por
  `#215`, adaptando apenas a apresentação ao recorte visual aprovado.

Este registro não representa aprovação do usuário, merge ou deploy.

## Revisão independente

Uma revisão funcional e visual independente encontrou quatro pontos: uma
assertiva antiga do drawer, contagem durante carregamento/erro, largura da busca
fora do contrato e status repetido no subtítulo. Os quatro foram corrigidos; a
regressão focada e as capturas foram refeitas depois das correções.
