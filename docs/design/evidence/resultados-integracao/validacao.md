# Evidência — Resultados e navegação integrada

Implementação do BLOCO E e da navegação final sobre o HEAD validado de Configurações.

## Referências visuais

Figma `N8BOVUvLkQImveVtThA5CV`: Resultados `17:2`, Produtos `17:87`, Clientes `72:8`,
Financeiro `74:5`, vazio `138:6`, indisponível `139:7` e edição do gasto Meta `178:9`.

## Matriz visual controlada

As capturas usam respostas mockadas isoladas, identificadas como evidência de UI; não
representam dados de produção.

| Superfície  | Claro 1440                               | Claro 390                               | Escuro 1440                             | Escuro 390                             |
| ----------- | ---------------------------------------- | --------------------------------------- | --------------------------------------- | -------------------------------------- |
| Visão geral | [captura](./overview-light-1440x900.png) | [captura](./overview-light-390x844.png) | [captura](./overview-dark-1440x900.png) | [captura](./overview-dark-390x844.png) |
| Financeiro  | [captura](./finance-light-1440x900.png)  | [captura](./finance-light-390x844.png)  | [captura](./finance-dark-1440x900.png)  | [captura](./finance-dark-390x844.png)  |

Produtos e Clientes foram exercitados na mesma sessão mockada, com troca de aba,
tabela, nomes longos e ausência de overflow do documento. Estados vazio, erro/retry,
Google Ads indisponível e gasto Meta editável foram verificados sem gravação externa.

## Decisões verificadas

- `/dashboard` permanece a rota canônica de Resultados; `period` e `tab` ficam na query
  do hash e aliases existentes continuam resolvendo para as mesmas superfícies.
- A visão geral mostra Pedidos, Conversão, Receita, Ticket médio, receita diária real,
  aquisição e atalho para Comercial → Retornos → Sem resposta.
- Produtos e Clientes renderizam somente listas presentes na resposta do backend.
  Linhas inválidas continuam omitidas e registradas sem preencher valores fictícios.
- Financeiro mantém a composição existente; gasto Meta só é editável em meses de
  calendário. Google Ads indisponível permanece explícito e não é tratado como gasto
  confirmado.
- A sidebar deriva a ação global Novo orçamento, os sete destinos centrais na ordem
  Orçamentos, Comercial, Pedidos, Clientes, Catálogo, Envios e Resultados, e Configurações
  no rodapé, todos da tabela central de rotas. `/auto`, `/manual`, `/products`, `/follow-ups` e
  `/comunicacao` continuam acessíveis como aliases/superfícies legadas.

## Impeccable e validação

- Contexto Aspen Operate e contrato visual `docs/design/DESIGN-aspen.md` consultados.
- Revisão manual da superfície implementada, com foco em hierarquia, estados, teclado,
  contraste, tema, overflow e responsividade; corrigidos nome acessível da ação global
  e estados de listas sem dados confirmados.
- Detector final: `/opt/data/home/.agents/skills/impeccable/scripts/impeccable detect --json`
  nos cinco alvos alterados (`routes`, `navigation`, `Layout`, `Sidebar` e `DashboardPage`)
  → `[]`.
- `npm run verify:fast` → PASS.
- `npm run test:unit:focused -- tests/unit/dashboard-view-model.test.ts` → 2/2 PASS.
- Playwright focado (`tests/dashboard.spec.js`, `tests/ui-shell.spec.js` e
  `tests/ui-v2-settings-login-notfound.spec.js`) → 12/12 PASS, com
  `DOTENV_CONFIG_PATH=/dev/null PLAYWRIGHT_BROWSERS_PATH=/opt/data/.playwright` e
  `NO_PROXY=localhost,127.0.0.1` para manter o alvo local fora do proxy do ambiente.

Limitação conhecida: o servidor Vite local usa `publicDir: static`, que não serve o
logo expandido existente no checkout; a imagem quebrada nas capturas é preexistente e
não foi alterada por este bloco.
