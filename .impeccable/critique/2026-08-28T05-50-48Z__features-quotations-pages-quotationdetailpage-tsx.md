---
target: Página de detalhe do orçamento (rascunho + emitido)
total_score: 21
p0_count: 1
p1_count: 2
timestamp: 2026-08-28T05-50-48Z
slug: features-quotations-pages-quotationdetailpage-tsx
---
# Critique — QuotationDetailPage (rascunho + emitido)

Method: dual-agent (A: DesignReview · B: DetectorEvidence)

## Veredito de anti-padrões (comece aqui)

**Não parece "feito por IA" — a falha é estrutural, não decorativa.** Nenhum slop clássico: sem gradiente em texto, sem glassmorphism, sem grid de cards idênticos, tudo em tokens Alpine. A revisão LLM e o detector estático concordam: CLI limpo (0 achados em 12 arquivos `.tsx`; resultado verificado como scan genuíno com controles positivos — sample plantado retorna `gradient-text`, `ai-color-palette`, `bounce-easing`).

O que quebra a página é a própria gramática estrutural/semântica — e o epicentro é a faixa **"Entrega e resultado"**, exatamente o componente apontado pelo dono.

**Scan determinístico (navegador, dark mode forçado):** 9 achados únicos no rascunho (ORC-20261983), 11 no emitido (ORC-20261987). A maioria pertence ao shell do app (labels `text-[10px]` da sidebar, `transition-[width/margin]` do layout) — fora do escopo desta página. Os que são da página:

- **Contraste baixo (somente dark)**: link "Ver histórico completo", `#2f6fdb` sobre `#0f1420` = **3.9:1** (mínimo 4.5:1) — `QuotationDetailPage.tsx:1787`. Achado do detector que a revisão visual não havia isolado.
- **Line-length**: banner read-only com ~151 chars/linha — `QuotationDetailPage.tsx:1250-1252`.
- **Cramped-padding**: a própria `<section>` "Entrega e resultado" (`:1267`) com conteúdo colado nas bordas — evidência mecânica do P1 abaixo.

Falsos positivos descartados: `overused-font` Inter (fonte única é permitida e correta em product UI), `cramped-padding` do wrapper de scroll da tabela (`table.tsx:17`, container de scroll intencional), `marquee` (shimmer de skeleton durante load, presente só no scan descartado de estado de carregamento).

Overlay: injeção mutável confirmada nas duas URLs (aba própria `b-detect`, modo dark via CDP); achados registrados via console da aba — não há overlay persistente visível para o usuário.

## Nota de Saúde de Design: 21/40 — Aceitável

| # | Heurística | Nota | Problema-chave |
|---|-----------|------|----------------|
| 1 | Visibilidade do status | 3 | `role=status` bons; motivo de desabilitado só em `title` (:1294), mouse-only |
| 2 | Match sistema/mundo real | 2 | "Primeiro contato" (`email-first-contact`) pré-selecionado na linha do WhatsApp — leak do modelo de canais |
| 3 | Controle e liberdade | 2 | Envio WhatsApp 1-clique sem confirm/undo; reenvio travado no WhatsApp, assimétrico com e-mail |
| 4 | Consistência e padrões | 2 | Dois UIs de envio WhatsApp no produto (hand-rolled aqui vs `WhatsAppSendPanel`); `<select>` cru vs `Select` na mesma página |
| 5 | Prevenção de erros | 2 | Emitir/apagar têm confirm; a ação mais irreversível (WhatsApp real) tem zero cerimônia — stakes invertidos |
| 6 | Reconhecimento vs recall | 2 | Fluxos sem consequência visível; default vivo contradiz preferência do código (`already_talking`, :346-350) |
| 7 | Flexibilidade e eficiência | 2 | Sem atalho teclado select→envio; select reseta a cada visita |
| 8 | Design estético e minimalista | 2 | Faixa quebra o ritmo: h2 `text-sm` e label `text-xs` no mesmo nível y; base das colunas desalinhada 12px; divisor de 96px parece traço solto |
| 9 | Reconhecer/diagnosticar/recuperar | 3 | Banner de conflito 409 com Recarregar; erros com whitelist segura |
| 10 | Ajuda e documentação | 1 | Zero ajuda inline sobre fluxos; `communicationFlowSummary` existe mas não é usado aqui |
| **Total** | | **21/40** | **Aceitável — melhorias significativas necessárias** |

## Impressão geral

A página é um produto sério com um remendo no meio. Antes e depois da faixa "Entrega e resultado" o ritmo é limpo (seções `border-t`, documento de seções, `tabular-nums`). A faixa em si é o ponto exato da queixa "tá bem errado": um h2 governando dois trabalhos não relacionados (enviar × veredito comercial), cinco controles de 32px com peso visual idêntico onde o único que importa é "Enviar WhatsApp", e uma coluna direita cujo divisor começa no nível errado. A maior oportunidade: transformar o envio — o momento de maior risco do negócio — na ação mais bem desenhada da página.

## O que funciona

1. ** Conjuntos de ação honestos por ciclo de vida.** Rascunho mostra Editar/Emitir; emitido mostra Visualizar PDF; a faixa de entrega não existe em rascunho (gate :1264, verificado ao vivo). A maioria dos apps apodrece exatamente aqui.
2. **Operações irreversíveis guardadas** — emitir com ConfirmDialog (:1897-1906), apagar com confirm (:1907-1916), "perdido" exige motivo em dialog com focus trap (:1966-2038), conflito 409 com banner e reload (:1255-1262).
3. **Disciplina de tokens tipográficos ponta a ponta** — `QuotationSectionsDocument` renderiza pagamento/prazos como documento, dinheiro alinhado à direita com `tabular-nums`, dark palette coerente.

## Problemas prioritários

### P0 — Envio WhatsApp: ação de maior risco, menor cerimônia, default errado
- **O quê:** "Enviar WhatsApp" (:1292-1299) dispara `enqueue` imediatamente (:1022-1039) — sem confirmação, sem preview, sem eco do destinatário. No dado real o select vem com **"Primeiro contato" (`email-first-contact`)** — um fluxo de e-mail — dentro da linha do WhatsApp; o default pretendido pelo código (`already_talking`, :346-350) não vence.
- **Por que importa:** um misclick manda mensagem real e irreversível a um cliente real (reenvio fica travado, :1090-1100). O default desalinhado treina o operador a ignorar o select.
- **Correção:** sheet de confirmação antes do enqueue: nome do cliente + telefone formatado, fluxo escolhido com resumo de 1 linha do que envia (reusar `communicationFlowSummary` do `WhatsAppSendPanel`) e preview da primeira mensagem; fazer `already_talking` vencer de fato. Cerimônia ≈ a do Emitir, não mais.

### P1 — Faixa "Entrega e resultado": um título, dois trabalhos, alinhamento quebrado
- **O quê:** h2 `text-sm` único (:1271-1273) governa envio (esquerda) e "Resultado comercial" (direita, :1339). Medido: label `text-xs` da direita topo em y=272 — no nível do h2; colunas terminam com 12px de desalinhamento; o divisor `lg:border-l` (:1338) corre 272→368 parecendo traço solto; no dark, `bg-surface-subtle/60` dissolve a faixa no banner read-only logo acima — dois cinzas empilhados.
- **Por que importa:** é a sensação exata de "está bem errado" — o olho não resolve de quem é cada título.
- **Correção:** dividir em dois grupos titulados ("Enviar" com select + WhatsApp + e-mail; "Resultado" abaixo, em ordem cronológica envio → desfecho), cada um com rótulo no nível dos seus controles; divisor ou span completo ou nenhum; unificar banner read-only e faixa num único tratamento de superfície.
- **Evidência mecânica (B):** `cramped-padding` na section (:1267) + `line-length` no banner (:1250) — detector e revisão convergem no mesmo trecho.

### P1 — Padrão de envio WhatsApp duplicado e divergente
- **O quê:** a página de detalhe rolha select+button na mão (:1275-1299) enquanto `WhatsAppSendPanel` (usado em `SplitResultCard.tsx:583`) faz o mesmo trabalho com resumo de fluxos. Ainda: `<select>` cru (:1277) vs primitivo `Select` (:1991) na mesma página.
- **Por que importa:** o mesmo modelo mental parece e se comporta diferente conforme a superfície — músculomemória e confiança vazam.
- **Correção:** um componente de envio para as duas superfícies, parametrizado por contexto; aproveitar e consertar o mismatch label-in-name "Fluxo do/do" (:1276 vs :1278, WCAG 2.5.3).

### P2 — Botões de veredito: cromo híbrido indefinido, primazia errada
- **O quê:** "Marcar como aprovado" = outline + `text-success` (:1342-1355); "Marcar como perdido" = outline + `text-destructive` (:1356-1364); computado: mesmas bordas cinza 1px, só a cor do texto difere. Fixos no topo da página, antes do conteúdo que julgam; o vermelho fica como alarme ambiente permanente em todo orçamento enviado sem resposta.
- **Por que importa:** aprovar/perder são estados terminais de lifecycle renderizados como dois chips quase idênticos; após resolver, viram badge sem momento de fechamento.
- **Correção:** usar as variantes `success`/`destructive` definidas no sistema (`button.tsx:14-21`) ou um controle único ("Registrar resultado" → segmentado → confirm); após resolução, colapsar a coluna numa linha de status; considerar mover o veredito **abaixo** do grupo de envio.

### P3 — Bloco Cliente gasta o melhor espaço com saídas
- **O quê:** primeira seção de conteúdo = Cliente (:1377-1459) com três links empilhados "Ver cliente / Abrir no CRM / Ver orçamentos anteriores" (:1432-1454), um dos quais navega pra fora do orçamento no meio da tarefa.
- **Por que importa:** acima da dobra, três saídas azuis competem com "Emitir orçamento"/"Enviar WhatsApp"; o trabalho de verificação (itens, total) desce.
- **Correção:** um link inline ("Ver cliente") + o resto no menu ⋯; Cliente como linha compacta de metadados.

## Red flags de personas

**Alex (power user, 20 envios/dia, desktop)**
- Default do select em desacordo com a intenção do código: Alex reverifica o select em **todo envio** — e o treino que sobra é pular a verificação. É assim que mensagem com template errado sai.
- Assimetria de reenvio: e-mail tem "Reenviar" (:1317); WhatsApp desabilita para sempre após o primeiro envio (:1090-1100), e o caminho "Nova revisão" só aparece quando expirado (:1300-1308) — para envio entregue-mas-perdido não há recuperação visível.
- Sem velocidade de teclado: sem atalho select→envio, sem Enter-para-enviar.

**Sam (acessibilidade: leitor de tela / teclado)**
- Label-in-Name: rótulo visível "Fluxo do WhatsApp" (:1276) vs `aria-label="Fluxo de WhatsApp"` (:1278) — voice control não bate (WCAG 2.5.3).
- Motivo de desabilitado em `title` (:1294) não é anunciado; o parágrafo `role=status` (:1320-1324) é anunciado mas visual e estruturalmente descolado do botão que explica.
- Aprovado/perdido diferem só pela cor do texto sobre cromo cinza idêntico — nada no cromo carrega semântica.
- Positivo: dialog de motivo de perda com focus trap e restore real (:971-1016); focus rings globais ✓.

## Observações menores

- `min-w-52` fixo (208px) no select (:1275): nomes longos de fluxo vão truncar.
- Expired injeta terceira ação ("Nova revisão") no cluster esquerdo já cheio.
- `QuotationDeliveryStatus` usa `text-xs` para tudo (:119) — "Cliente confirmou recebimento"/"Confirmado que não recebeu, reenviar" (:149, :157) são escolhas consequentes em escala de rodapé; `statusTone` colore só o `<strong>` (:62-67) — emparelhar com ícone.
- Banner read-only duplica info do badge; manter (explica o porquê), mas considerar movê-lo para a linha de meta sob o título (:1110-1125) e matar um cinza.
- Fora do escopo desta página, mas real (detector): labels `text-[10px]` "Operacional/Cadastros/Outros" na sidebar abaixo do piso de 11px; `transition-[width/margin]` no shell.

## Perguntas para pensar

1. Se o envio por WhatsApp é o negócio, por que é a única ação crítica da página com menos cerimônia que apagar um rascunho? O que custaria um "cockpit de envio" (destinatário + consequência do fluxo + preview + confirm)?
2. "Entrega e resultado" existe para o operador ou para o modelo de dados? Se dividir em "Enviar" e "Resultado" em ordem cronológica não quebra nada, por que é uma faixa só?
3. Depois de "Marcar como aprovado", o que o operador vê que recompensa a vitória? Hoje: um toast e um badge. A página deveria mudar de estado — como muda quando o orçamento é entregue.

## Run Notes

- Target slug: `features-quotations-pages-quotationdetailpage-tsx`; ignore.md ausente (nada descartado por lista).
- Independência: A e B rodaram como sub-agentes isolados e paralelos; sem cross-contaminação.
- Detector CLI: exit 0, 0 achados em 12 arquivos; verificado genuíno com controles positivos; caveat regex-mode documentado (HTML parser modules ausentes no skill; alvos TSX usam modo regex por design; regras de DOM/computed style exercidas na passada de navegador).
- Navegador: aba dedicada `b-detect`, dark mode forçado via CDP (`prefers-color-scheme: dark` + chave `aspen_theme` removida), injeção mutável confirmada nas 2 URLs; 1º scan do emitido descartado (race com loading, 0 h1/h2 + skeletons) e refeito após poll de render completo.
- Live-server: iniciado (:8400) e parado (verificado, connection refused); temp files removidos; aba fechada.
- Dev server do app (`aspen-dev`, `npm run dev` + `APP_AUTH_BYPASS=true`, :5173) permanece no ar para iteração — parar com `hub stop aspen-dev` se indesejado.
- Conformidade read-only: nenhum clique em botão, nenhum input, nenhuma mutação de rede; nenhuma caixa de diálogo encontrada.
