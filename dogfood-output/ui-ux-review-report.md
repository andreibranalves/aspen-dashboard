# Revisão UI/UX — Aspen Orçamento

Data: 2026-05-09  
Escopo: app React em `http://localhost:8888`, rotas principais, fluxos seguros e leitura de código.  
Modo: auditoria, sem alterar código do app.

## Evidência coletada

### Testes automatizados

- `node scripts/playwright-test-react.mjs`
  - Resultado: **59/60 passaram**
  - Falha: teste antigo espera radios de transportadora na tela de frete. A UI atual não expõe mais seleção manual de transportadora, pois consulta todas as transportadoras automaticamente. Classificação: **teste desatualizado, não bug de UX**.
- `node scripts/playwright-test-responsive.mjs`
  - Resultado: **22/22 passaram**
- Auditoria exploratória customizada com Playwright
  - Rotas testadas: Orçamentos, Detalhe de orçamento, Auto, Frete, CRM, Produtos, Detalhe de produto, Leads, Configurações.
  - Interações seguras: abrir detalhe, entrar/cancelar edição, abrir produto, editar/cancelar preços, digitar na extração automática, validar controles de frete, validar 7 colunas do CRM.
  - Resultado: **7/7 checks passaram**
  - Console/network: **0 erros relevantes** durante as interações.

### Artefatos

- Raw audit: `dogfood-output/ux-audit-raw.json`
- Screenshots: `dogfood-output/screenshots/`
- Script usado na auditoria: `dogfood-output/aspen-ux-audit.mjs`

## Sumário executivo

O app está funcional e relativamente estável. Os fluxos principais carregam, os testes de responsividade passam, e não apareceram erros de console nos fluxos testados. O ponto fraco não é bug crítico, é **maturidade de produto**: a interface ainda parece uma coleção de páginas administrativas independentes. Falta uma camada de direção visual, priorização por tarefas reais e affordances mais explícitas.

A maior oportunidade é transformar o dashboard em uma ferramenta operacional orientada a fluxo:

1. **Entrada do pedido** → extração e revisão.
2. **Criação/envio do orçamento** → acompanhamento do orçamento.
3. **Negociação** → CRM e follow-up.
4. **Catálogo/preços/frete** → ferramentas auxiliares, mas integradas ao orçamento.

Hoje essas áreas existem, mas a navegação e as telas ainda não contam essa história.

## Diagnóstico por área

### 1. Shell, navegação e linguagem visual

**O que funciona**
- Sidebar simples, consistente e responsiva.
- TopBar mostra o contexto atual.
- Layout não quebra em desktop/tablet/mobile nos testes.

**Problemas / oportunidades**
- A navegação está por módulo técnico (`Auto`, `Frete`, `CRM`, `Produtos`), mas não por jornada comercial.
- `Auto` é um nome pouco explícito para usuário novo. Algo como **Novo orçamento com IA** ou **Criar orçamento** comunica melhor o valor.
- TopBar é subutilizada. Poderia trazer ações primárias contextuais, estado da operação ou atalhos.
- Falta identidade Aspen: o app usa shadcn/azul genérico, com pouco vínculo visual com estamparia/produtos personalizados.

**Melhorias propostas**
- Renomear itens de navegação por tarefa:
  - `Orçamentos`
  - `Criar com IA` ou `Novo orçamento`
  - `CRM / Follow-up`
  - `Frete`
  - `Produtos e preços`
  - `Leads e clientes`
  - `Configurações`
- Transformar o TopBar em barra de contexto:
  - título + descrição curta da página;
  - ação primária da página;
  - status de conexão/salvamento quando relevante.
- Criar `DESIGN.md`/tokens de marca: paleta Aspen, estados, espaçamento, densidade, padrões de tabela/card.

### 2. Orçamentos

**O que funciona**
- Lista com busca, chips de status, paginação e ações rápidas.
- Linha abre detalhe e ações não propagam clique.
- Detalhe permite editar itens e recalcula total.

**Problemas / oportunidades**
- Página começa com um botão `Automático`, depois filtros. Falta uma ação primária mais clara, tipo **Novo orçamento**.
- Muitas ações icônicas na tabela dependem de `title`, sem `aria-label`; isso prejudica acessibilidade e clareza em mobile.
- Tabela em mobile gera overflow horizontal. É aceitável tecnicamente, mas ruim para uso real no celular.
- Totais atuais parecem somar apenas a página carregada, não deixam claro se é total global ou da página.
- WhatsApp da lista usa texto simples e não parece usar o template configurado nem telefone real da linha, quando disponível.

**Melhorias propostas**
- No desktop, manter tabela. No mobile, usar cards compactos por orçamento:
  - Nº, cliente, status, valor, data;
  - ações grandes: WhatsApp, PDF, Editar.
- Trocar `Automático` por CTA primário: **Criar orçamento com IA**.
- Ações da tabela com `aria-label` e tooltip textual em hover/focus.
- Totais: deixar explícito **Nesta página** vs **Total filtrado**.
- Melhorar WhatsApp para usar template real e telefone do cliente quando disponível.

### 3. Detalhe do orçamento

**O que funciona**
- Estrutura clara: meta do orçamento, tabela de itens, total, ações.
- Modo edição explícito, com salvar/cancelar.
- Reordenação por drag existe.

**Problemas / oportunidades**
- Edição é poderosa, mas pouco guiada: não há aviso de impacto antes de salvar nem resumo das alterações.
- Drag handle pequeno e sem alternativa para teclado/mobile.
- `alert/confirm` nativo para excluir é funcional, mas visualmente fora do sistema.
- Auto-pricing é silencioso. Quando SKU/Qtd muda, o usuário não sabe se preço foi recalculado, se falhou ou se manteve manual.

**Melhorias propostas**
- Barra fixa inferior no modo edição: `3 itens alterados`, `Cancelar`, `Salvar alterações`.
- Marcar células alteradas com destaque sutil.
- Mostrar badge `Preço manual` vs `Preço da tabela`.
- Substituir `confirm()` por confirmação inline ou dialog do design system.
- Alternativa a drag: botões subir/descer em mobile.

### 4. Criar orçamento com IA / Auto extração

**O que funciona**
- Fluxo em fases é bom e comunica pipeline.
- Entrada texto + imagem cobre o caso de uso real.
- Config local de regras/WhatsApp existe.

**Problemas / oportunidades**
- Tela tem muita responsabilidade: entrada, upload, prazo, configurações, revisão, criação e WhatsApp.
- O botão `⚙️ Config` é pequeno demais e visualmente secundário para algo que afeta a extração.
- Faltam exemplos prontos de pedido. Isso é importante porque a qualidade da entrada influencia o resultado da IA.
- Configurações duplicam parte da página Configurações.

**Melhorias propostas**
- Transformar em wizard operacional com foco por etapa:
  1. Pedido recebido
  2. Conferir extração
  3. Ajustar preços/itens
  4. Criar e enviar
- Adicionar exemplos clicáveis:
  - `50 lenços 70x70 para João, urgente...`
  - `300 bonés, cliente Maria...`
- Mostrar preview da mensagem WhatsApp antes da criação final.
- Levar configurações avançadas para painel lateral ou página Config, deixando apenas “regras ativas” resumidas na tela.

### 5. Frete

**O que funciona**
- Fluxo básico de CEP, volumes, seguro e cotação está presente.
- Resultados ordenáveis por preço/prazo.
- Consulta todas as transportadoras, o que é melhor que radios manuais.

**Problemas / oportunidades**
- Inputs de volumes na tabela estão sem labels programáticos. Auditoria achou 5 inputs sem label.
- Tabela de volumes em mobile tende a ser ruim. Campos numéricos pequenos e repetidos são difíceis no celular.
- Validação usa `alert()`, fora do design system.
- Falta clareza sobre o que é obrigatório antes de cotar.

**Melhorias propostas**
- Mobile: substituir tabela por cards de volume, cada card com Peso, CxLxA, Qtd, Conteúdo.
- Desktop: manter tabela, mas com `aria-label` por campo, exemplo `Peso do pacote 1`.
- Validação inline: CEP inválido, peso zerado, dimensões faltantes.
- CTA fixo ou destacado: `Cotar frete`, com resumo `1 volume, 1 kg, seguro R$ X`.
- Atualizar teste Playwright removendo expectativa de radios de transportadora.

### 6. CRM Kanban

**O que funciona**
- Mostra as 7 etapas, inclusive vazias.
- Drag-and-drop funciona e persiste via API.
- Cards têm dados úteis: nome, email, orçamento, follow-up e idade.

**Problemas / oportunidades**
- Drag-and-drop não é descobrível. Não há instrução, handle ou estado visual forte por coluna.
- Cards não têm ação rápida. O usuário provavelmente quer abrir orçamento, WhatsApp, registrar próximo passo.
- Mobile: Kanban horizontal é esperado, mas para uso real no telefone pode ser cansativo.
- Busca refaz request a cada tecla sem debounce.

**Melhorias propostas**
- Adicionar microcopy: “Arraste cards entre etapas para atualizar o CRM”.
- Card com ações rápidas: abrir orçamento, WhatsApp/email, ver contato.
- Destacar drop target ao arrastar.
- Mobile: visão alternativa em lista por estágio, com seletor de status no card.
- Debounce na busca do CRM.

### 7. Produtos e detalhe de produto

**O que funciona**
- Lista rápida, busca e paginação.
- Linha abre detalhe do produto.
- Detalhe mostra ficha + preços por faixa e permite edição explícita.

**Problemas / oportunidades**
- Lista de produtos ainda parece “catálogo técnico”, não ferramenta comercial.
- Faltam filtros por categoria, ativo/inativo, com/sem imagem, com preço incompleto.
- Não há indicação na lista de que a linha é clicável além do cursor/hover.
- Tabela de preços no detalhe poderia mostrar mais contexto: menor preço, economia por volume, preço ausente.
- Inputs de preço aceitam número com ponto, mas usuário brasileiro tende a digitar vírgula.

**Melhorias propostas**
- Adicionar colunas/resumos: `Menor preço`, `Faixas preenchidas`, `Ativo`, `Imagem`.
- Filtros rápidos: Categorias, Ativos, Preço incompleto.
- Botão/ícone `Ver detalhes` na linha para reforçar affordance.
- No detalhe: destacar faixas faltantes e sugerir copiar preço da faixa anterior.
- Aceitar vírgula nos inputs de preço e normalizar para número.

### 8. Leads / Clientes

**O que funciona**
- Lista simples, filtros por tipo e busca.
- Dados básicos carregam.

**Problemas / oportunidades**
- Página é muito passiva. Não há ação ao clicar no lead/cliente.
- Tabela estoura horizontal em mobile.
- Falta contexto comercial: último orçamento, status CRM, origem, data, próxima ação.

**Melhorias propostas**
- Criar detalhe ou drawer de cliente com histórico: orçamentos, deals, contatos, WhatsApp.
- Mobile em cards.
- Ações rápidas: criar orçamento para este cliente, abrir WhatsApp, copiar email/telefone.
- Filtros por origem e status.

### 9. Configurações

**O que funciona**
- Simples e direto.
- Salva localStorage e mostra toast.

**Problemas / oportunidades**
- `Configurações` aparece como h1 dentro da página, duplicando o título do TopBar.
- Um textarea está sem label programático na auditoria.
- Configurações são locais ao navegador, mas isso não está claro. Pode gerar confusão se outro usuário/computador não vê as regras.
- Variáveis de WhatsApp são texto puro, difíceis de usar sem erro.

**Melhorias propostas**
- Remover h1 duplicado ou padronizar PageHeader em todas as páginas.
- Labels explícitos e `id/htmlFor` nos campos.
- Aviso: “Estas configurações ficam salvas neste navegador”.
- Chips clicáveis para inserir variáveis no template.
- Preview da mensagem com dados fictícios.

## Problemas transversais

### A. Sistema visual ainda genérico

A UI está funcional, mas ainda se parece com um admin padrão. Recomendo criar um design system leve:

- PageHeader comum: título, descrição, ação principal.
- EmptyState comum.
- ErrorState comum.
- DataToolbar comum: busca, filtros, contagem, ações.
- TableActionButton com `aria-label`, tooltip e tamanho mínimo.
- MobileCardList para tabelas importantes.

### B. Acessibilidade e toque

A auditoria encontrou muitos botões de 32px e inputs sem label em Frete/Config. Recomendações:

- Alvo mínimo 40x40px para ações em tabela/mobile.
- `aria-label` para botões só com ícone.
- Labels programáticos em todos os inputs.
- Estados de foco visíveis.

### C. Mobile passa tecnicamente, mas não está otimizado

Responsividade passou, mas várias telas ainda dependem de tabela com scroll horizontal. Isso é aceitável em backoffice desktop, mas se Andrei usa no celular, precisa de alternativa em cards para:

- Orçamentos.
- Leads/clientes.
- Produtos.
- Volumes de frete.

### D. Feedback de ações sensíveis

Salvar preço, editar orçamento, mover deal, excluir orçamento, cotar frete são ações sensíveis. Hoje o feedback é misto: toast, alert, confirm, silencioso. Recomendações:

- Unificar feedback com toasts/inline states.
- Mostrar estado `salvando`, `salvo`, `falhou` consistentemente.
- Para mudanças sensíveis, mostrar resumo antes/depois.

## Roadmap recomendado

### Sprint 1 — Correções rápidas de UX e a11y

1. Atualizar teste de frete para o novo fluxo sem radios.
2. Adicionar `aria-label` em todos os botões icônicos.
3. Corrigir labels de inputs de Frete e Configurações.
4. Aumentar hit area de ações para 40px.
5. Padronizar PageHeader e remover títulos duplicados.
6. Debounce na busca do CRM.

Impacto: baixo risco, melhora imediata de qualidade.

### Sprint 2 — Mobile e tabelas

1. Cards mobile para Orçamentos.
2. Cards mobile para Leads/Clientes.
3. Cards mobile para Produtos.
4. Cards de volume no Frete para mobile.
5. Barras de ação fixas nos modos de edição.

Impacto: grande melhora para uso real fora do desktop.

### Sprint 3 — Fluxo comercial integrado

1. Renomear/organizar navegação por jornada.
2. Auto extração como wizard mais guiado.
3. Detalhe de cliente com histórico e ações rápidas.
4. CRM cards com ações rápidas e alternativa mobile.
5. Melhor preview de WhatsApp e templates.

Impacto: transforma o app de “painel administrativo” em ferramenta comercial.

### Sprint 4 — Design polish / identidade Aspen

1. Criar `PRODUCT.md` e `DESIGN.md` para o app.
2. Definir tokens de cor/typography/spacing.
3. Revisar densidade visual e hierarquia de todas as telas.
4. Estados vazios mais úteis e com próximos passos.
5. Microcopy operacional em pontos críticos.

Impacto: deixa o produto mais profissional, memorável e fácil de operar.

## Prioridade sugerida

Se for implementar só um pacote agora, recomendo:

**Pacote A — “Qualidade operacional”**
- Atualizar teste de frete.
- A11y dos botões/inputs.
- PageHeader comum.
- Mobile cards para Orçamentos e Leads.
- Debounce no CRM.

Motivo: melhora usabilidade diária, reduz fricção e tem baixo risco técnico.

**Pacote B — “Criar orçamento melhor”**
- Redesenhar Auto extração como wizard.
- Exemplos de entrada.
- Preview WhatsApp.
- Melhor revisão de itens/preços antes de criar.

Motivo: melhora o fluxo mais importante do negócio, mas exige mais design e teste.

**Minha recomendação:** começar pelo **Pacote A**, depois atacar o wizard do Auto como projeto separado.
