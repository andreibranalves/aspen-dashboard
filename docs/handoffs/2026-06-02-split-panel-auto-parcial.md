# Hand-off — Split Panel Auto Page

**Data:** 2026-06-02
**Branch:** `feature/split-panel-auto`
**Commits:** 5 commits (ainda não enviados ao GitHub — sem chave SSH/token no VPS)

## Estado atual

Split panel 50/50 funcional no dashboard em `https://dashboard.srv1633500.hstgr.cloud/#/auto`.

### Arquivos alterados

| Arquivo | O que mudou |
|---------|-------------|
| `src/pages/AutoQuotePage.jsx` | Reescrito — split panel com input + histórico à esquerda, resultados à direita |
| `src/components/SplitResultCard.jsx` | **Novo** — card enxuto pro painel direito (substitui DraftReviewCard) |
| `src/index.css` | Adicionada animação `.spinner` |
| `tests/orcamento.spec.js` | Atualizado: "Analisar pedido" → "Extrair", "em revisão" → "Resultados (N)" |

### Estrutura do AutoQuotePage

```
Painel Esquerdo (50%)           | Painel Direito (50%)
─────────────────────────────────|─────────────────────────
"Pedido do cliente" (h1)        | Estado vazio ou resultados
textarea (min-h-[130px])         | SplitResultCard (por draft)
[Extrair] [Limpar]               |   - header: nome, email, tel
                                 |   - tabela de itens
─── Recentes ───                 |   - modo edição inline
item.cliente | item.id           |   - botões: Editar, 🗑️, Criar
item.data | item.valor           |
```

### SplitResultCard (novo componente)

Props aceitas: `draft`, `displayIdx`, `totalDrafts`, `isProcessing`, `onUpdateField`, `onUpdateItem`, `onRemoveItem`, `onCreateQuote`, `onDelete`.

Estados:
- **Normal** — header + tabela de itens + total + barra de ações
- **Edição** — revela campos de nome/email/telefone/origem + edição inline de qtd/preço + campo de nota
- **Processando** — opacidade reduzida, botão desabilitado

### Histórico de orçamentos

- Fonte: `GET /api/quotations?limit=3&order_by=creation+desc`
- Campos retornados: `id`, `cliente`, `data`, `valor`
- Ao clicar: `GET /api/quotations?id={id}` → formata como texto:
  ```
  Nome: {cliente}
  E-mail:
  Telefone:
  Pedido: SKU1 30 un, SKU2 30 un
  ```

### Alinhamento com viewport

`useEffect` remove as classes `p-4` e `md:p-6` do `<main>` ao montar e restaura ao sair. Isso permite que os painéis encostem nas bordas sem gap.

### Fluxo da extração

1. Usuário cola texto → clica **Extrair**
2. `POST /api/extract` → `buildDraftsFromOrders()` → `fetchPricing()`
3. Drafts aparecem no painel direito como `SplitResultCard`
4. Usuário revisa/edita → clica **Criar orçamento** no card
5. `POST /api/orcamento` → card vira resultado (WhatsApp + links)

## Próximos passos

### Pendente
- [ ] **Push para GitHub** — precisa de chave SSH ou token. `git push origin feature/split-panel-auto`
- [ ] Testar fluxo completo (extrair → editar → criar) com API real
- [ ] Verificar responsivo mobile (painéis empilham em `w-full`)

### Melhorias futuras
- [ ] Buscar email/telefone do cliente ao clicar no histórico
- [ ] Adicionar busca de produtos no SplitResultCard (autocomplete de SKU)
- [ ] Drag-and-drop de itens no SplitResultCard
- [ ] Suporte a toggle urgente com recálculo de preço
- [ ] Merge na master após aprovação

### Comandos úteis

```bash
# Build + restart VPS
cd /opt/data/aspen-dashboard
npm run build
kill $(pgrep -f "node scripts/app-server" | head -1)
PORT=8888 node scripts/app-server.mjs &

# Testes E2E
npx playwright test --reporter=list

# Screenshot rápido
npx playwright screenshot --browser chromium "http://127.0.0.1:8888/#/auto" /tmp/test.png
```
