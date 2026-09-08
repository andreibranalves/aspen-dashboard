# Validação — Novo orçamento

## Referências Figma

Nodes consultados e copiados para esta pasta: `99:85`, `115:89`, `116:92`,
`116:445`, `8:124`, `8:202`, `90:58`, `131:588`, `131:98`, `132:144` e
`79:186`. Os PNGs `figma-*.png` são referências visuais; nomes, valores e
tempos presentes nos frames não são fixtures de produção.

## Matriz visual

| Estado | Tema | Viewport | Evidência |
| --- | --- | --- | --- |
| Conversa inicial | claro/escuro | 1440×900 | `conversation-initial-*.png` |
| Resultado extraído | claro/escuro | 1280×800 | `conversation-result-*.png` |
| Manual preenchido | claro/escuro | 1024×768 | `manual-filled-*.png` |
| Revisão pendente | claro/escuro | 390×844 | `review-pending-*.png` |

As capturas finais ficam nesta pasta; `visual-audit.log` registra os oito casos
com `consoleErrors: []`, `pageErrors: []` e largura de `document`, `body`,
`main` e `PageShell` igual ou menor que o viewport/contêiner. As tabelas que
excedem a largura usam seus próprios contêineres `overflow-auto`.

## Comportamentos exercitados

- `/novo-orcamento`, `/auto` e `/manual` usam a experiência comum.
- Alternância Manual ↔ Da conversa preserva identidade, origem, itens, prazo,
  observações e metadados salvos quando o payload não muda; draft emitido segue
  para o detalhe canônico.
- Extração por imagem envia payload controlado; nova resposta fica isolada para
  aplicação explícita; falha posterior preserva o ativo.
- Múltiplos drafts ficam identificados por cliente e seleção ativa.
- Draft Manual é restaurado do `localStorage` v1 após reload.
- Cliente/endereço usam painel lateral; Escape retorna foco ao gatilho.
- Quantidade/urgência recalculam somente preços automáticos e preservam preço
  manual, inclusive sob resposta atrasada ou falha.
- Salvar → Emitir e duplo clique compartilham uma única persistência e resultam
  em um POST de `/orcamento` e um POST idempotente de emissão.
- Pendências recebem identidade negativa própria; novas extrações entram na
  fila e aplicar/descartar remove somente o resultado escolhido.
- Emissão manual mantém o botão bloqueado durante `processing`, navega ao
  detalhe canônico e não oferece transporte WhatsApp nessa página.
- Recuperação de emissão por GET restaura resultado concluído sem novo POST.
- Atalhos `@modelo` conhecidos são enviados como `orderTemplateSelections`; um
  alias desconhecido bloqueia a extração.
- Drawer confirma somente com “Aplicar”; cancelar/Escape/backdrop descartam a
  cópia temporária e devolvem o foco.

## Testes e checks

Executados com `DOTENV_CONFIG_PATH=/dev/null` e APIs interceptadas quando
aplicável:

- `npm run verify:fast` — passou; nenhuma migration mudou.
- `npm run build:web` — passou.
- Testes unitários focados de storage/contrato — 15 passaram.
- `npm run test:unit` — 1.101 passaram e 80 foram pulados por dependerem de
  `TEST_DATABASE_URL`.
- `tests/new-quotation.spec.js` — 17 passaram.
- Auditoria visual controlada — 8 capturas, dois temas, quatro viewports, sem
  erros de console/página e sem overflow de `main`/`PageShell`.
- Regressões E2E focadas (`orcamento-core` e `orcamento`) — 18 passaram; a
  execução combinada com a jornada nova fechou em 35/35.
- PostgreSQL descartável não foi necessário: não houve alteração de backend,
  repositórios, schema ou migrations; o check de migrations passou.
- `git diff --check` — passou.

## Diferenças justificadas

- A entrada comum substitui a duplicação visual das duas páginas, mas conserva
  os aliases e seus prefills.
- O frame Manual usa a coluna lateral de 320px; em 1024px a navegação global
  fica recolhida conforme o contrato responsivo existente.
- O resultado ativo é exibido individualmente com seletor explícito quando há
  múltiplos drafts; isso evita misturar identidades e mantém o painel utilizável
  em telas estreitas.
- O resultado de uma nova extração é tratado como revisão pendente, sem merge
  automático e sem alterar regras de cálculo ou contratos de backend.
