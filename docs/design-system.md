# Design System Aspen (v3)

Diretrizes para construir telas coesas com a biblioteca de componentes do repositório.
Tokens e primitivos são a única fonte de verdade visual; telas nunca definem
cores/sombras/raios próprios.

## Fundamentos

Todos os tokens vivem em `src/index.css` (variáveis CSS) e `tailwind.config.js`
(escala tipográfica, sombras e status). Dual-theme é obrigatório: todo token tem
valor claro e escuto, então componentes nunca usam cor literal (`bg-white`,
`text-zinc-500`) — sempre o token semântico.

| Papel | Tokens |
| --- | --- |
| Fundo | `bg-page` → `bg-surface` → `bg-surface-subtle` (elevação crescente) |
| Bordas | `border-line` (sutil: `border-border-subtle`, forte: `border-border-strong`, controles: `border-border-control`) |
| Texto | `text-fg` → `text-fg-muted` → `text-tertiary` |
| Ação | `bg-primary text-on-solid`; links `text-link` |
| Status negócio | `status-won` (ganho), `status-lost` (perdido), `status-progress` (em progresso) |
| Alertas | `success`, `warning`, `destructive`, `info` |

- **Espaçamento**: grid de 8pt — use múltiplos de 2 unidades Tailwind (`gap-2`,
  `p-4`, `space-y-3` para densidade compacta).
- **Tipografia**: use as classes `text-xs`…`text-4xl` redefinidas com line-height
  e tracking; não ajuste `leading-*` ad-hoc.
- **Sombras**: `shadow-level-1`…`shadow-level-5` (elevação 1 = repouso,
  4/5 = popover/drawer).
- **Raios**: `rounded-xs` (controles densos), `rounded-sm` (controles padrão),
  `rounded-md` (cards), `rounded-lg` (superfícies/dialogs), `rounded-full`
  (apenas pills de status/tags/avatares).

## Biblioteca de componentes

Atômicos em `src/components/ui/`, compostos em `src/components/shared/`.

| Componente | Uso | Contrato essencial |
| --- | --- | --- |
| `Button` | toda ação | `variant` (`default`/`outline`/`secondary`/`ghost`/`link`/`destructive`/`success`), `size`, `loading` (spinner + aria-busy), `asChild` |
| `StatusBadge` | status exibido | `status` + `label`; ganho/perdido/progresso mapeados para `tone-*-soft` |
| `Tag` | marcador removível | `tone` + `onRemove` |
| `Avatar` | iniciais de nome | `name`, `size` |
| `Input`/`Textarea`/`Select` | controles 36px | nunca use elemento cru |
| `Field` | rótulo + controle + erro inline | conecta `id`, `aria-describedby`, `aria-invalid` automaticamente |
| `SearchableSelect` | lista média/grande | navegação ↑/↓/Enter/Escape |
| `Table` + `TableRow` | dados tabulados | `interactive` ativa ativação por teclado |
| `Pagination` | paginação padrão | `page`, `totalPages`, `onPageChange` |
| `Drawer` | drill-down de registro | foco preso, Escape, foco restaurado |
| `Timeline` | trilha de interações | eventos com `tone` semântico |
| `EmptyState` | zero resultados válido | com `actions` para o próximo passo |
| `ConfirmDialog` | confirmação destrutiva | `variant="destructive"` + foco gerenciado |
| `toast` (`useToast`) | feedback de mutação | `success`/`error`/`info`; nunca success silencioso |

Estados obrigatórios em componentes novos: hover, focus-visible, active,
disabled, loading (quando disparar mutação) e empty state (quando listar dados).
Acessibilidade: contraste AA (4.5:1), foco visível (ring/outline do token
primary), navegação por teclado e rótulos aria.

## Padrões de UX

- **Tabela vs. cartões**: tabela para comparar/escanear muitos registros;
  cartões quando há poucos itens com prévia rica (ex.: quadro Kanban) ou em
  telas estreitas. Toda tabela responsiva tem variante cartão abaixo de `md`.
- **Edição inline vs. formulário completo**: inline (drawer) para retoques de
  poucos campos; página/formulário completo para criação e edições densas.
  Mudanças não salvas pedem confirmação de descarte (`ConfirmDialog`).
- **Feedback**: mutações sempre respondem com `toast`; ações destrutivas sempre
  confirmam; carregamento usa `loading` no botão ou skeletons (`Skeleton*`),
  nunca spinheres soltos.
- **Carga cognitiva**: sem copy tutorial, sem texto que repete o rótulo; erro
  inline no campo (via `Field`), erro de servidor no escopo do bloco com ação
  "Tentar novamente".
- **Filtros em massa**: seleção via checkbox + `BulkActionBar` fixo; ações em
  massa confirmam antes de executar.

## Como adicionar uma tela nova

1. Monte com `PageShell` + `PageHeader` + `PageToolbar` e os componentes da
   tabela acima — não crie variantes locais.
2. Use apenas tokens; se um estado visual não existe na biblioteca, estenda a
   biblioteca, não a tela.
3. Estados de carregamento/erro/vazio são obrigatórios e usam
   `Skeleton*`, bloco de erro com retry e `EmptyState`.
4. Valide com `npm run verify:fast` antes de entregar.
