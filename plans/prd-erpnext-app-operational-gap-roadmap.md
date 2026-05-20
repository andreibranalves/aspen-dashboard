# PRD — Evolução operacional do Aspen Orçamento vs ERPNext/Frappe CRM

**Produto:** Aspen Orçamento  
**Workspace:** `/opt/data/aspen-orcamento`  
**Status:** PRD aprovado para implementação incremental  
**Tipo:** Pesquisa de produto + roadmap funcional  
**Fonte da pesquisa:** leitura comparativa entre o app Aspen Orçamento, os endpoints/páginas atuais do projeto e as telas equivalentes do ERPNext/Frappe CRM.  
**Objetivo de implementação:** evoluir aos poucos, sem transformar o app em um ERP paralelo.

---

## 1. Resumo executivo

O Aspen Orçamento já funciona bem como uma camada rápida sobre ERPNext/Frappe CRM para:

- gerar orçamentos com IA;
- revisar pedidos antes de criar documentos no ERP;
- consultar preços e produtos;
- acompanhar orçamentos;
- acompanhar pedidos de venda;
- mover deals em Kanban;
- enviar WhatsApp;
- cotar frete;
- visualizar métricas comerciais.

A principal lacuna identificada não é falta de módulos, e sim falta de **drill-down operacional** nas entidades que já aparecem no app.

Hoje várias páginas mostram listas/cards úteis, mas não permitem entender ou editar rapidamente o objeto sem abrir o ERPNext. Exemplos:

- na página de Leads, não dá para expandir um Lead/Cliente e ver origem, histórico, orçamento, deal, endereço ou editar contato;
- no Kanban de CRM, o card permite mover status, mas não abrir um painel de Deal com próximo passo, orçamento, telefone, follow-up e ações rápidas;
- no detalhe do Orçamento, a edição está forte em itens/preço, mas ainda falta metadado comercial de cliente, origem, contato, CNPJ, endereço e vínculo com CRM;
- o Dashboard tem métricas, mas pode virar uma lista de ações pendentes;
- Produtos e Frete já estão bons, mas podem ganhar filtros/integrações pequenas e muito úteis.

A direção recomendada é:

> **Adicionar drawers, painéis de detalhe, filtros acionáveis e links de continuidade para ERPNext — sem copiar formulários completos do ERP.**

---

## 2. Objetivos

### 2.1 Objetivos de negócio

1. Reduzir tempo entre lead recebido e orçamento enviado.
2. Reduzir retrabalho de abrir ERPNext para consultas simples.
3. Melhorar qualidade de dados comerciais: origem, telefone, email, CNPJ, endereço e vínculo CRM.
4. Aumentar previsibilidade de follow-up.
5. Ajudar a identificar gargalos: orçamento parado, deal parado, produto sem preço, pedido atrasado.
6. Manter o app leve e operacional, não administrativo.

### 2.2 Objetivos de produto

1. Cada lista/card importante deve ter um detalhe rápido.
2. Cada detalhe deve ter ações naturais:
   - WhatsApp;
   - email;
   - abrir orçamento;
   - abrir pedido;
   - abrir deal;
   - abrir ERPNext.
3. Cada página deve mostrar pendências relevantes daquele contexto.
4. Cada tela deve ter poucos campos, focados na operação real da Aspen.
5. O ERPNext continua sendo a fonte da verdade.

### 2.3 Objetivos técnicos

1. Reutilizar endpoints existentes quando possível.
2. Expandir APIs de forma incremental, sem endpoints genéricos demais.
3. Usar componentes pequenos e reutilizáveis para drawers, badges e ações contextuais.
4. Preservar padrões atuais do projeto:
   - React/Vite;
   - `apiGet`, `apiPost`, `apiPut`, `apiDelete`;
   - Vercel Functions;
   - ERPNext client central em `api/_functions/lib/erpnext.js`;
   - mensagens em português;
   - Lucide icons;
   - sem dependências novas sem aprovação explícita.

---

## 3. Não objetivos

Este PRD **não** propõe:

1. Clonar o ERPNext dentro do app.
2. Recriar formulários completos de Lead, Deal, Quotation ou Sales Order.
3. Criar módulo financeiro.
4. Criar módulo de estoque.
5. Criar Delivery Note ou Invoice dentro do app.
6. Criar inbox/email completo.
7. Criar sistema completo de tarefas, comentários e anexos.
8. Criar permissões multiusuário complexas.
9. Automatizar follow-up ou disparos recorrentes sem aprovação explícita.
10. Instalar novas dependências para recursos que podem ser feitos com o stack atual.

---

## 4. Usuários e jobs-to-be-done

### 4.1 Usuário principal

**Andrei / equipe Aspen** usando o app como cockpit comercial para orçamento e acompanhamento.

### 4.2 Jobs principais

#### JTBD 1 — Atender lead rapidamente

Quando chega um lead, quero ver/editar dados básicos e criar orçamento sem navegar por múltiplas telas do ERP.

#### JTBD 2 — Acompanhar orçamento enviado

Quando um orçamento está aberto, quero saber se ele já foi enviado, se tem deal, se precisa follow-up e qual contato usar.

#### JTBD 3 — Fechar venda

Quando um cliente aprova, quero converter orçamento em pedido e acompanhar se o pedido está entregue/faturado.

#### JTBD 4 — Corrigir dados sem interromper fluxo

Quando vejo telefone/email/origem/CNPJ faltando, quero corrigir ali mesmo, sem entrar no formulário completo do ERPNext.

#### JTBD 5 — Priorizar o que fazer hoje

Quando abro o Dashboard ou CRM, quero enxergar rapidamente o que está parado, atrasado ou incompleto.

---

## 5. Princípios de produto

1. **ERPNext-first:** dados comerciais e documentos continuam no ERPNext.
2. **Drawer antes de página nova:** sempre que possível, usar painel lateral para detalhe rápido.
3. **Link para ERPNext sempre disponível:** casos avançados devem abrir o ERP, não serem duplicados no app.
4. **Campos mínimos:** adicionar somente dados usados em venda, follow-up, orçamento, pedido ou qualidade de cadastro.
5. **Ações contextuais:** cada página deve responder “o que posso fazer agora?”.
6. **Sem bloat visual:** preferir badges, filtros e ações pequenas a tabelas gigantes.
7. **Edição segura:** editar apenas campos de baixo risco operacional; documentos fiscais/financeiros ficam no ERP.
8. **Implementação incremental:** cada fase deve entregar valor isolado.

---

## 6. Estado atual do app

### 6.1 Páginas principais

- `src/pages/DashboardPage.jsx`
- `src/pages/AutoQuotePage.jsx`
- `src/pages/ManualOrcamentoPage.jsx`
- `src/pages/QuotationsPage.jsx`
- `src/pages/QuotationDetailPage.jsx`
- `src/pages/CrmKanbanPage.jsx`
- `src/pages/LeadsPage.jsx`
- `src/pages/ProductsPage.jsx`
- `src/pages/ProductDetailPage.jsx`
- `src/pages/FreightPage.jsx`
- `src/pages/SalesOrdersPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`
- `src/pages/SettingsPage.jsx`

### 6.2 Endpoints relevantes

- `api/_functions/leads-clients.js`
- `api/_functions/crm-deals.js`
- `api/_functions/crm-update-deal.js`
- `api/_functions/quotations.js`
- `api/_functions/sales-orders.js`
- `api/_functions/sales-order-from-quotation.js`
- `api/_functions/products.js`
- `api/_functions/product-detail.js`
- `api/_functions/product-pricing.js`
- `api/_functions/product-pricing-update.js`
- `api/_functions/sales-dashboard.js`
- `api/_functions/freight.js`
- `api/_functions/send-whatsapp.js`
- `api/_functions/orcamento.js`
- `api/_functions/extract.js`

---

## 7. Roadmap macro

### P0 — Drill-down operacional

Foco: resolver as lacunas mais gritantes sem bloat.

1. Drawer de Lead/Cliente.
2. Drawer de Deal no Kanban.
3. Link “Abrir no ERPNext” no detalhe de Orçamento.
4. Bloco de cliente/contato/origem no detalhe de Orçamento.
5. Alertas operacionais básicos:
   - sem telefone;
   - sem email;
   - sem origem;
   - orçamento parado;
   - deal parado;
   - produto sem preço;
   - pedido atrasado.

### P1 — Filtros e ações de rotina

1. Filtros por origem/data/cliente em Orçamentos e CRM.
2. Produtos com filtro de preço incompleto.
3. Frete pré-preenchido a partir de orçamento/pedido.
4. Botões de copiar resumo em Orçamento, Pedido e Frete.
5. Notas rápidas em Lead/Deal, se houver destino seguro no ERPNext.

### P2 — Governança leve

1. Exportar/importar configurações do WhatsApp Flow Builder.
2. Histórico simples de envio WhatsApp por orçamento/deal.
3. Conversão por origem no Dashboard.
4. Rascunhos de Auto Orçamento persistidos no servidor.
5. Timeline simplificada:
   - Lead → Deal → Orçamento → Pedido.

---

# 8. Requisitos por área

---

## 8.1 Leads / Clientes

### Estado atual

A página de Leads/Clientes mostra lista unificada com:

- nome;
- email;
- telefone;
- tipo: Lead ou Cliente;
- data de criação;
- ações de WhatsApp/email;
- busca e filtro por tipo.

### Referência ERPNext

No ERPNext, Lead/Customer têm muito mais informações:

- nome;
- organização;
- status;
- fonte/origem;
- campanha;
- email;
- telefone;
- mobile;
- website;
- território;
- endereço;
- notas;
- atividades;
- anexos;
- conversões;
- documentos vinculados.

### Problema

O app mostra “quem existe”, mas não mostra “qual é o contexto desse contato”.

Perguntas não respondidas hoje:

- De onde veio esse lead?
- Já tem orçamento?
- Já tem deal?
- Já virou cliente?
- Tem CNPJ?
- Tem endereço?
- Está sem telefone/email?
- Posso corrigir dados básicos sem abrir ERPNext?

### Requisito P0 — Lead/Cliente Drawer

Ao clicar em um Lead/Cliente, abrir um drawer lateral com detalhe enxuto.

#### Campos mínimos

- ID ERPNext.
- Tipo: Lead ou Cliente.
- Nome.
- Email.
- Telefone/mobile.
- CNPJ, quando aplicável.
- Origem/fonte, quando disponível.
- Data de criação.
- Última modificação.
- Último orçamento vinculado, quando encontrado.
- Deal vinculado/status, quando encontrado.
- Indicadores de qualidade:
  - sem telefone;
  - sem email;
  - sem origem;
  - sem CNPJ;
  - endereço incompleto.

#### Ações

- WhatsApp.
- Email.
- Criar orçamento para este contato.
- Abrir orçamento recente.
- Abrir deal vinculado.
- Abrir no ERPNext.

#### Edição permitida

Editar apenas campos de baixo risco:

- nome;
- email;
- telefone;
- origem;
- CNPJ;
- endereço básico.

#### Edição não permitida nesta fase

- Campos financeiros.
- Território.
- Owner/responsável.
- Conversão completa Lead → Customer.
- Configurações avançadas do ERP.

### Possíveis endpoints

#### Opção A — expandir endpoint atual

`GET /api/leads-clients?id=<id>&tipo=lead|cliente`

#### Opção B — novo endpoint dedicado

`GET /api/client-detail?doctype=Lead&name=CRM-LEAD-...`

`PUT /api/client-detail?doctype=Lead&name=CRM-LEAD-...`

Opção recomendada: **novo endpoint dedicado**, para não sobrecarregar listagem.

### Critérios de aceite

1. Clicar em uma linha abre drawer em até poucos segundos.
2. Drawer mostra dados principais sem precisar abrir ERPNext.
3. Usuário consegue corrigir telefone/email/origem.
4. Existe botão “Abrir no ERPNext”.
5. Lista não fica mais lenta por causa do detalhe.
6. Campos avançados continuam fora do app.

### Nice to have

- Histórico dos últimos 5 orçamentos.
- Histórico dos últimos 5 pedidos.
- Valor total orçado/fechado.
- Botão “copiar contato”.
- Badge “cliente recorrente”.

---

## 8.2 CRM / Kanban de Deals

### Estado atual

O Kanban mostra deals agrupados por status:

- Novo Lead;
- Contato Feito;
- Orcamento Enviado;
- Em Negociacao;
- Arte Aprovada;
- Pedido Fechado;
- Perdido.

Cards mostram:

- nome;
- email;
- telefone;
- orçamento vinculado;
- follow-up stage;
- próxima etapa/resumo;
- idade desde modificação;
- drag-and-drop para status.

### Referência Frappe CRM

Deal no Frappe CRM pode conter:

- status;
- organização;
- contato;
- valor;
- próximo passo;
- responsável;
- atividades;
- emails;
- chamadas;
- tarefas;
- notas;
- anexos;
- timeline;
- documentos relacionados.

### Problema

O app permite mover deals, mas não permite entender ou editar o deal com contexto suficiente.

Perguntas não respondidas hoje:

- Qual telefone usar?
- Qual orçamento está vinculado?
- Qual valor?
- Qual próximo passo?
- Há follow-up pendente?
- Está parado há quantos dias?
- Posso corrigir próximo passo/status sem abrir ERP?

### Requisito P0 — Deal Drawer

Ao clicar em um card do Kanban, abrir drawer lateral com detalhe do Deal.

#### Campos mínimos

- ID do Deal.
- Nome do lead.
- Email.
- Telefone.
- Origem/source.
- Status atual.
- Orçamento vinculado.
- Valor do orçamento.
- Follow-up stage.
- Próximo passo (`next_step`).
- Data de criação.
- Última modificação.
- Idade do deal.

#### Ações

- Alterar status.
- Editar próximo passo.
- Editar follow-up stage.
- Abrir orçamento vinculado.
- WhatsApp.
- Email.
- Abrir no ERPNext.

#### Comportamento para status “Perdido”

Se for simples e houver campo seguro:

- pedir motivo curto de perda;
- salvar em campo adequado ou nota;
- caso não exista campo claro, registrar apenas status e deixar motivo fora da primeira fase.

### Melhorias em cards

Adicionar badges compactos:

- sem orçamento;
- sem telefone;
- follow-up pendente;
- parado há 3+ dias;
- pedido fechado;
- origem.

### Filtros P1

- Origem.
- Sem orçamento.
- Sem telefone.
- Parado há 3+ dias.
- Follow-up stage.
- Status.
- Busca por nome/email.

### Possíveis endpoints

- Expandir `GET /api/crm-deals` para incluir `source`, valor de orçamento e telefone confiável.
- Criar `GET /api/crm-deal-detail?id=...`.
- Expandir `PUT /api/crm-update-deal` para editar:
  - status;
  - `next_step`;
  - `custom_follow_up_stage`;
  - motivo de perda, se aplicável.

### Critérios de aceite

1. Clicar em card abre Deal Drawer.
2. Drawer permite editar status e próximo passo.
3. Abrir orçamento vinculado funciona.
4. Abrir ERPNext funciona.
5. Cards indicam pendências sem ficarem visualmente pesados.
6. Drag-and-drop atual continua funcionando.
7. Colunas vazias continuam visíveis.

### Fora de escopo

- Inbox completa.
- Comentários complexos.
- Anexos.
- Tarefas recorrentes.
- Automações de follow-up.

---

## 8.3 Orçamentos

### Estado atual

A área de Orçamentos já é uma das mais maduras do app.

A lista permite:

- buscar;
- filtrar por status;
- ver contagem por status;
- abrir detalhe;
- enviar WhatsApp;
- excluir;
- seleção múltipla;
- converter para Pedido de Venda.

O detalhe permite:

- ver itens;
- editar itens/preços;
- salvar alterações;
- visualizar orçamento;
- criar pedido de venda.

### Referência ERPNext

Quotation no ERPNext inclui:

- cliente/lead;
- validade;
- itens;
- impostos;
- descontos;
- termos;
- endereço;
- contato;
- status/docstatus;
- impressão;
- atividades;
- documentos relacionados;
- conversão para Sales Order.

### Problema

O app está forte em itens e ações, mas ainda fraco em contexto comercial do orçamento.

Faltam no detalhe:

- origem;
- email;
- telefone;
- CNPJ;
- endereço;
- contato;
- deal vinculado;
- status do deal;
- follow-up;
- botão Abrir no ERPNext.

### Requisito P0 — Link Abrir no ERPNext

No detalhe do orçamento, adicionar botão:

`Abrir no ERPNext`

URL esperada:

`{ERPNEXT_BASE}/app/quotation/{quotation_id}`

Se `ERPNEXT_BASE` não estiver exposto ao frontend, backend deve retornar `erp_url` no detalhe ou usar helper seguro existente.

### Requisito P0 — Bloco Cliente e contato

Adicionar seção no `QuotationDetailPage.jsx`:

**Cliente e contato**

Campos:

- Cliente/Lead.
- Tipo de entidade.
- ID da entidade.
- Origem.
- Email.
- Telefone.
- CNPJ.
- Endereço resumido.
- Deal vinculado.
- Status do deal.
- Follow-up stage.

### Requisito P1 — Edição leve de metadados

Permitir editar, se seguro:

- validade;
- prazo de produção;
- contato/email/telefone;
- origem;
- observação interna curta.

A edição deve ser separada de edição de itens, para evitar salvar acidentalmente mudanças comerciais junto com preços.

### Requisito P1 — Filtros avançados na lista

Adicionar filtros:

- origem;
- `date_from`;
- `date_to`;
- cliente;
- vencidos;
- vencendo em breve;
- sem deal;
- sem origem.

Observação: a memória do projeto indica que filtros de API como `origem`, `date_from`, `date_to`, `cliente` já existem ou foram implementados em fase operacional. Validar estado atual antes de implementar UI.

### Requisito P1 — Indicadores de atenção

Na lista e detalhe:

- orçamento vencido;
- vence hoje;
- vence em até 3 dias;
- sem telefone;
- sem origem;
- sem deal;
- sem pedido vinculado após X dias.

### Critérios de aceite

1. Detalhe do orçamento mostra contexto comercial sem abrir ERP.
2. Botão Abrir no ERPNext funciona.
3. Usuário enxerga contato e origem no detalhe.
4. Lista permite filtrar por origem/data/cliente se API suportar.
5. Indicadores de vencimento aparecem corretamente.
6. Edição de itens continua preservando preço manual.

### Fora de escopo

- Impostos.
- Contabilidade.
- Condições de pagamento complexas.
- Termos legais completos.
- Price list avançada.

---

## 8.4 Pedidos de Venda

### Estado atual

A área de Sales Orders já possui:

- lista;
- filtros de período/status/busca;
- receita;
- número de pedidos;
- ticket médio;
- pedidos abertos;
- detalhe de pedido;
- progresso entregue/faturado;
- origem de orçamento;
- link Abrir no ERPNext.

### Referência ERPNext

Sales Order no ERPNext inclui:

- cliente;
- datas;
- itens;
- entrega;
- faturamento;
- porcentagem entregue;
- porcentagem faturada;
- status;
- delivery notes;
- invoices;
- endereço;
- financeiro/logística;
- comentários/atividades.

### Problema

O app já mostra o essencial, mas pode destacar melhor pedidos que precisam de ação.

Perguntas úteis:

- Está atrasado?
- Está parcialmente entregue?
- Está pendente de faturamento?
- Qual contato/endereço do cliente?
- Qual orçamento originou o pedido?
- Posso copiar resumo para WhatsApp?

### Requisito P0/P1 — Destaques de atenção

Na lista e detalhe, destacar:

- entrega atrasada;
- entrega parcial;
- faturamento pendente;
- pedido aberto há muitos dias;
- pedido sem orçamento de origem.

### Requisito P1 — Mais contexto no detalhe

Adicionar ao detalhe:

- telefone;
- email;
- endereço de entrega;
- data prometida;
- dias até entrega ou dias em atraso;
- orçamento de origem;
- cliente/contato com link.

### Requisito P1 — Ações rápidas

- WhatsApp cliente.
- Abrir orçamento original.
- Abrir ERPNext.
- Copiar resumo do pedido.

### Critérios de aceite

1. Pedidos problemáticos ficam visualmente evidentes.
2. Detalhe permite contatar cliente sem abrir ERP.
3. Resumo copiável contém número, cliente, itens principais e status.
4. Não há tentativa de editar faturamento/entrega no app.

### Fora de escopo

- Criar Delivery Note.
- Criar Sales Invoice.
- Editar financeiro.
- Editar estoque.

---

## 8.5 Produtos / Catálogo / Preços

### Estado atual

A área de Produtos está forte:

- lista de produtos;
- busca por SKU/nome;
- categoria;
- unidade;
- detalhe do produto;
- imagem;
- status ativo/inativo;
- tabela de preços por faixa;
- preço urgente +30%;
- origem do preço;
- edição de preços por faixa.

### Referência ERPNext

Item e Pricing Rule podem conter:

- item group;
- UOM;
- status disabled;
- imagem;
- descrição;
- marca;
- item price;
- pricing rules;
- price lists;
- taxes;
- estoque;
- variantes;
- fornecedores;
- códigos de barras.

### Problema

A tela é boa para preço, mas pode ajudar mais na manutenção de tabela.

Faltam:

- filtro por categoria;
- filtro por ativo/inativo;
- filtro por preço completo/incompleto;
- alerta de faixa faltante;
- link para regra/preço no ERPNext;
- auditoria rápida das faixas Aspen.

### Requisito P0/P1 — Filtros úteis

Na lista de Produtos:

- categoria;
- ativo/inativo;
- com preço completo;
- com preço faltando;
- sem imagem, se relevante.

### Requisito P1 — Auditoria de preço por SKU

No detalhe, mostrar status das faixas:

- 30;
- 100;
- 300;
- 500;
- 1000.

Para cada faixa:

- preço normal;
- preço urgente;
- origem: Pricing Rule por faixa, Pricing Rule SKU ou Item Price;
- status: OK/faltando;
- última modificação, se disponível;
- link ERPNext da regra, se possível.

### Requisito P1 — Preencher faixa faltante

Ação opcional:

- preencher faixa faltante copiando preço de outra faixa;
- sempre com confirmação;
- deixar claro que altera Pricing Rule/Item Price no ERPNext.

### Critérios de aceite

1. Usuário consegue encontrar SKUs com preço incompleto.
2. Produto mostra claramente quais faixas estão faltando.
3. Editar preço continua simples.
4. Link ERPNext está disponível para casos avançados.

### Fora de escopo

- Estoque.
- Fornecedores.
- Variantes.
- Contabilidade.
- Impostos.

---

## 8.6 Auto Orçamento

### Estado atual

A página Auto é o diferencial do app:

- recebe texto;
- recebe imagem/print;
- usa IA para extrair pedidos;
- cria rascunhos;
- permite revisão;
- exige origem;
- aceita CNPJ/endereço;
- busca produtos;
- consulta preços;
- permite aprovar antes de criar;
- cria orçamento no ERPNext;
- cria/atualiza CRM;
- envia WhatsApp via fluxo configurável.

### Referência ERPNext

ERPNext não possui equivalente direto. O app é superior para intake comercial.

### Problema

A página já está funcional, mas pode melhorar confiança antes de criar documentos.

Perguntas úteis antes de aprovar:

- Esse cliente já existe?
- Vai criar ou atualizar cadastro?
- Há deal existente?
- Algum SKU está sem preço?
- Algum campo crítico está faltando?
- O preço foi manual?
- O pedido é urgente?

### Requisito P0/P1 — Warnings de revisão

Nos cards de rascunho, mostrar:

- sem telefone;
- sem email;
- sem origem;
- CNPJ inválido;
- endereço incompleto;
- SKU sem preço;
- preço manual;
- urgente;
- quantidade abaixo do mínimo.

### Requisito P1 — Prévia de impacto ERPNext

Antes da aprovação final, mostrar resumo:

- vai criar Lead/Customer;
- vai atualizar Lead/Customer existente;
- vai criar Contact;
- vai criar Deal;
- vai criar Quotation;
- WhatsApp será enviado manualmente após criação ou automaticamente pelo botão.

### Requisito P1 — Detecção de existentes

Durante revisão, identificar possíveis registros existentes por:

- email;
- telefone;
- CNPJ;
- nome similar, se seguro.

Mostrar:

- “Cliente existente”;
- “Lead existente”;
- “Novo cliente provável”.

### Nota técnica importante

Revisar comportamento de precificação urgente em lote no `AutoQuotePage.jsx`.

Durante a leitura, foi observado um trecho em que pedidos urgentes são separados para `fetchPricing(urgent, true)`, mas o merge de volta parecia incompleto. Isso deve ser validado com teste antes de qualquer alteração maior na página.

### Critérios de aceite

1. Usuário entende por que um rascunho não está pronto.
2. App não cria orçamento automaticamente sem revisão humana.
3. Cliente existente fica claro antes da criação.
4. Preço manual/urgente nunca fica invisível.
5. Fluxo continua rápido para pedido simples.

### Fora de escopo

- Criação automática sem aprovação.
- Motor de deduplicação complexo.
- CRM scoring automático.

---

## 8.7 Frete

### Estado atual

A página de Frete já oferece:

- CEP origem/destino;
- validação ViaCEP;
- volumes;
- peso/dimensões;
- seguro;
- comparação de transportadoras;
- ordenação por preço/prazo;
- resumo da carga.

### Referência ERPNext

ERPNext não é a principal referência; frete é uma utilidade operacional externa.

### Problema

A página é boa isoladamente, mas não está suficientemente conectada com orçamento/pedido.

### Requisito P1 — Abrir frete a partir de orçamento/pedido

Adicionar ação em Orçamento/Pedido:

`Cotar frete`

Deve abrir Frete com dados pré-preenchidos quando disponíveis:

- CEP destino;
- valor segurado;
- resumo dos itens;
- sugestão de volumes, se existir preset simples.

### Requisito P1 — Copiar opção escolhida

Em cada opção de frete, adicionar:

`Copiar para WhatsApp`

Texto exemplo:

```text
Frete Jadlog: R$ 48,90, prazo estimado de 4 dias úteis.
```

### Requisito P2 — Salvar frete escolhido

Se houver destino seguro no ERPNext:

- salvar como nota no orçamento/pedido;
- ou preencher campo customizado futuro.

Não bloquear P1 por isso.

### Critérios de aceite

1. Frete pode ser iniciado a partir de orçamento/pedido.
2. Usuário consegue copiar opção de frete sem redigitar.
3. Página isolada continua funcionando.
4. Nenhuma compra de etiqueta/frete é feita nesta fase.

### Fora de escopo

- Compra de etiqueta.
- Rastreamento completo.
- Módulo logístico.

---

## 8.8 Dashboard

### Estado atual

O Dashboard calcula:

- receita;
- pedidos;
- ticket médio;
- pedidos abertos;
- produtos mais vendidos;
- clientes principais;
- vendas por dia;
- orçamentos parados;
- taxa de conversão.

### Problema

O Dashboard pode ser mais acionável. Hoje ele tende a ser analítico, mas deveria responder:

> “O que eu preciso fazer agora?”

### Requisito P0/P1 — Bloco de ações pendentes

Adicionar seção:

**Ações pendentes**

Itens:

- orçamentos sem follow-up;
- deals parados;
- pedidos atrasados;
- produtos sem preço completo;
- leads sem telefone/origem;
- orçamentos vencendo/vencidos.

### Requisito P1 — Cards clicáveis com filtro

Cada card deve abrir a página correspondente já filtrada:

- orçamento parado → Orçamentos filtrados;
- deal parado → CRM filtrado;
- pedido atrasado → Pedidos filtrados;
- produto sem preço → Produtos filtrados;
- lead sem origem → Leads filtrados.

### Requisito P2 — Métricas por origem

Adicionar:

- leads por origem;
- orçamentos por origem;
- pedidos por origem;
- conversão por origem;
- receita por origem.

### Critérios de aceite

1. Dashboard tem pelo menos uma seção de tarefas acionáveis.
2. Clicar em card leva a uma lista filtrada.
3. Não há excesso de gráficos.
4. Métricas continuam carregando com performance aceitável.

### Fora de escopo

- BI completo.
- Gráficos complexos demais.
- Previsão automática de vendas.

---

## 8.9 Configurações

### Estado atual

Configurações hoje incluem:

- modelo ativo de orçamento;
- fluxos de WhatsApp;
- etapas de fluxo;
- imagens;
- mensagens;
- vendedora;
- delays;
- fotos por categoria;
- preview.

Muita coisa é localStorage.

### Problema

A página já é poderosa. A lacuna é mais de clareza, portabilidade e segurança de edição.

### Requisito P1 — Reforçar localStorage

Mostrar aviso claro:

> Estas configurações ficam salvas neste navegador. Se trocar de computador/navegador, exporte antes ou configure novamente.

### Requisito P2 — Exportar/importar JSON

Adicionar:

- exportar fluxos WhatsApp;
- importar fluxos WhatsApp;
- restaurar padrões;
- validar JSON antes de aplicar.

### Requisito P2 — Preview/teste

Nice to have:

- preview com orçamento real selecionado;
- validar URL de imagem;
- teste de envio para número próprio, somente com confirmação explícita.

### Critérios de aceite

1. Usuário entende que configuração é local.
2. É possível exportar/importar fluxos.
3. Import inválido não quebra configuração atual.
4. Nenhum envio real acontece sem confirmação.

### Fora de escopo

- Sistema multiusuário.
- Permissões/roles.
- Configuração global em backend antes de necessidade clara.

---

# 9. Componentes e padrões sugeridos

## 9.1 Drawer padrão

Criar componente reutilizável, se ainda não existir:

`src/components/DetailDrawer.jsx`

Características:

- abre à direita no desktop;
- ocupa tela cheia ou quase cheia no mobile;
- header com título, subtítulo e botão fechar;
- área de conteúdo rolável;
- footer opcional com ações;
- não depende de biblioteca nova.

Props sugeridas:

```jsx
<DetailDrawer
  open={open}
  onClose={onClose}
  title="Cliente"
  description="CRM-LEAD-0001"
  actions={...}
>
  {children}
</DetailDrawer>
```

## 9.2 Badges de qualidade

Criar helper/componente:

`src/components/QualityBadges.jsx`

Uso em:

- Leads;
- CRM;
- Orçamentos;
- Auto Quote;
- Produtos.

Tipos:

- warning;
- danger;
- info;
- success.

Exemplos:

- Sem telefone;
- Sem origem;
- Preço faltando;
- Vencido;
- Parado 5 dias.

## 9.3 Ações contextuais

Criar padrão visual para:

- WhatsApp;
- Email;
- Abrir ERPNext;
- Copiar resumo;
- Abrir orçamento;
- Abrir pedido.

Evitar botões gigantes repetidos; preferir grupo compacto.

---

# 10. Dados ERPNext necessários por entidade

## 10.1 Lead

Campos prováveis:

- `name`
- `lead_name`
- `first_name`
- `email_id`
- `phone`
- `mobile_no`
- `source`
- `utm_source`
- `status`
- `creation`
- `modified`

## 10.2 Customer

Campos prováveis:

- `name`
- `customer_name`
- `tax_id`
- `customer_type`
- `creation`
- `modified`

Contato/endereço podem exigir consultas em `Contact`, `Dynamic Link`, `Address`.

## 10.3 CRM Deal

Campos prováveis:

- `name`
- `lead_name`
- `email`
- `mobile_no`
- `status`
- `source`
- `custom_quotation`
- `custom_quotation_sent_date`
- `custom_follow_up_stage`
- `next_step`
- `creation`
- `modified`

Campos futuros possíveis:

- `custom_sales_order`
- motivo de perda, se criado no ERPNext.

## 10.4 Quotation

Campos prováveis:

- `name`
- `transaction_date`
- `valid_till`
- `quotation_to`
- `party_name`
- `customer_name`
- `grand_total`
- `status`
- `docstatus`
- `utm_source`
- `contact_person`
- `contact_email`
- `contact_mobile`
- `customer_address`
- `shipping_address_name`
- `items`

## 10.5 Sales Order

Campos prováveis:

- `name`
- `transaction_date`
- `delivery_date`
- `customer`
- `customer_name`
- `grand_total`
- `rounded_total`
- `status`
- `docstatus`
- `per_delivered`
- `per_billed`
- `items`

---

# 11. Métricas de sucesso

## 11.1 Métricas operacionais

- Redução de cliques para ver detalhes de Lead/Deal.
- Número de leads com telefone/origem preenchidos.
- Número de orçamentos com deal vinculado.
- Número de produtos com tabela completa.
- Tempo médio para encontrar contato de cliente.
- Tempo médio para abrir orçamento/ERPNext a partir de card.

## 11.2 Métricas comerciais

- Taxa de conversão de orçamento para pedido.
- Conversão por origem.
- Valor em pipeline por status.
- Orçamentos vencidos sem follow-up.
- Deals parados por mais de X dias.

## 11.3 Métricas de qualidade UX

- Página continua rápida.
- Drawer não quebra mobile.
- Nenhum fluxo principal ganha campos obrigatórios desnecessários.
- Usuário consegue concluir orçamento simples sem distrações.

---

# 12. Riscos e mitigação

## Risco 1 — App virar ERP paralelo

**Mitigação:** toda feature deve passar pelo critério: “isso reduz clique/erro no processo comercial da Aspen?”. Se não, fica fora.

## Risco 2 — APIs ficarem pesadas

**Mitigação:** listas continuam leves; detalhes são carregados sob demanda via drawer.

## Risco 3 — Dados inconsistentes entre Lead/Customer/Contact

**Mitigação:** ERPNext continua fonte da verdade; updates devem ser específicos e seguros.

## Risco 4 — Edição acidental de dado sensível

**Mitigação:** limitar edição a contato/origem/endereço/próximo passo. Não editar financeiro/fiscal/logística.

## Risco 5 — Bloat visual

**Mitigação:** usar badges pequenos, drawers e ações compactas.

## Risco 6 — Performance do Dashboard

**Mitigação:** endpoints agregados com limites, dados paginados e filtros; evitar buscar documentos completos em massa.

---

# 13. Plano incremental recomendado

## Fase A — Infra de UX para detalhes

**Objetivo:** preparar base reutilizável.

Entregas:

1. `DetailDrawer` reutilizável.
2. `QualityBadges` reutilizável.
3. Helper de links ERPNext.
4. Padrão de ações contextuais.

Critérios:

- Drawer funciona desktop/mobile.
- Sem dependência nova.
- Build passa.

---

## Fase B — Lead/Cliente Drawer

**Objetivo:** resolver a dor mais clara apontada pelo usuário.

Entregas:

1. Endpoint de detalhe Lead/Customer.
2. Drawer na `LeadsPage.jsx`.
3. Edição básica de contato/origem.
4. Histórico resumido de orçamentos/deal, se viável.
5. Link Abrir no ERPNext.

Critérios:

- Clicar Lead abre detalhe.
- Editar telefone/email funciona.
- Sem impacto na performance da lista.

---

## Fase C — Deal Drawer no CRM

**Objetivo:** transformar Kanban em ferramenta de acompanhamento, não só movimentação.

Entregas:

1. Endpoint de detalhe de Deal.
2. Drawer no `CrmKanbanPage.jsx`.
3. Edição de status/next_step/follow_up_stage.
4. Badges de pendência nos cards.
5. Link orçamento/ERPNext/WhatsApp.

Critérios:

- Clicar card abre detalhe.
- Alteração de status continua refletindo no Kanban.
- Não remove colunas vazias.

---

## Fase D — Orçamento com contexto comercial

**Objetivo:** completar detalhe de Quotation como tela central de venda.

Entregas:

1. Botão Abrir no ERPNext.
2. Bloco Cliente e contato.
3. Deal vinculado e follow-up.
4. Indicadores de validade/pendência.
5. Filtros de lista se API já suportar.

Critérios:

- Usuário entende cliente/contato/origem no detalhe.
- Pode abrir ERPNext direto.
- Não quebra edição de itens.

---

## Fase E — Alertas operacionais e Dashboard acionável

**Objetivo:** transformar métricas em fila de trabalho.

Entregas:

1. Cards de ações pendentes.
2. Links para páginas filtradas.
3. Produtos sem preço completo.
4. Pedidos atrasados/pendentes.
5. Deals parados.

Critérios:

- Dashboard responde “o que fazer hoje?”.
- Cada card abre lista correspondente.

---

## Fase F — Integrações leves

**Objetivo:** reduzir redigitação e alternância de contexto.

Entregas:

1. Frete a partir de orçamento/pedido.
2. Copiar resumo de frete.
3. Copiar resumo de orçamento.
4. Copiar resumo de pedido.
5. Export/import de Settings.

Critérios:

- Usuário consegue mandar informação no WhatsApp com menos redigitação.
- Configurações ficam portáveis.

---

# 14. Backlog priorizado

## P0

| Item | Área | Resultado esperado |
|---|---|---|
| DetailDrawer reutilizável | UX base | Base para detalhe rápido |
| Lead/Cliente Drawer | Leads | Ver/editar contato sem ERP |
| Deal Drawer | CRM | Ver/editar negócio sem ERP |
| Abrir ERPNext em QuotationDetail | Orçamentos | Continuidade com ERP |
| Bloco Cliente/Contato no orçamento | Orçamentos | Contexto comercial no detalhe |
| Badges de pendência | Cross-app | Problemas visíveis rapidamente |

## P1

| Item | Área | Resultado esperado |
|---|---|---|
| Filtros origem/data/cliente | Orçamentos/CRM | Acompanhamento comercial melhor |
| Produto com preço faltante | Produtos | Higiene de tabela |
| Pedido atrasado/pendente | Sales Orders | Atenção operacional |
| Frete via orçamento/pedido | Frete | Menos redigitação |
| Copiar resumos | Cross-app | WhatsApp mais rápido |

## P2

| Item | Área | Resultado esperado |
|---|---|---|
| Export/import Settings | Configurações | Portabilidade |
| Histórico WhatsApp | CRM/Orçamentos | Rastreabilidade leve |
| Conversão por origem | Dashboard | Decisão de canal |
| Rascunhos no servidor | Auto | Continuidade entre sessões |
| Timeline simplificada | Cross-app | Visão ponta-a-ponta |

---

# 15. Critério global de aceite

Uma implementação deste PRD é considerada bem-sucedida quando:

1. O app continua mais simples que o ERPNext.
2. Leads e Deals podem ser abertos em detalhe sem sair da página.
3. Orçamentos mostram contexto comercial suficiente para follow-up.
4. Produtos com preço incompleto são fáceis de identificar.
5. Dashboard indica ações, não só números.
6. Todas as ações avançadas têm link para ERPNext.
7. Nenhum fluxo passa a criar side effects automáticos sem confirmação.
8. Build e testes principais continuam passando.

---

# 16. Checklist antes de implementar qualquer item

Para cada feature derivada deste PRD, responder:

- [ ] Qual dor real isso resolve?
- [ ] Qual página será alterada?
- [ ] Qual endpoint será alterado/criado?
- [ ] O dado já existe no ERPNext?
- [ ] É leitura ou escrita?
- [ ] Se escrita, o campo é seguro para editar no app?
- [ ] Precisa de confirmação do usuário?
- [ ] Existe link “Abrir no ERPNext” para caso avançado?
- [ ] A feature adiciona campos obrigatórios? Se sim, por quê?
- [ ] O fluxo simples continua rápido?
- [ ] Mobile continua usável?
- [ ] Sem dependência nova?

---

# 17. Arquivos prováveis por fase

## Fase A

- `src/components/DetailDrawer.jsx`
- `src/components/QualityBadges.jsx`
- `src/components/ContextActions.jsx`
- `src/lib/erpLinks.js`

## Fase B

- `src/pages/LeadsPage.jsx`
- `api/_functions/leads-clients.js`
- novo possível: `api/_functions/client-detail.js`

## Fase C

- `src/pages/CrmKanbanPage.jsx`
- `api/_functions/crm-deals.js`
- `api/_functions/crm-update-deal.js`
- novo possível: `api/_functions/crm-deal-detail.js`

## Fase D

- `src/pages/QuotationsPage.jsx`
- `src/pages/QuotationDetailPage.jsx`
- `api/_functions/quotations.js`

## Fase E

- `src/pages/DashboardPage.jsx`
- `api/_functions/sales-dashboard.js`
- `src/pages/ProductsPage.jsx`
- `src/pages/SalesOrdersPage.jsx`

## Fase F

- `src/pages/FreightPage.jsx`
- `src/pages/QuotationDetailPage.jsx`
- `src/pages/SalesOrderDetailPage.jsx`
- `src/pages/SettingsPage.jsx`
- `src/lib/whatsappFlows.js`

---

# 18. Observações finais

A melhor primeira implementação é:

1. criar `DetailDrawer`;
2. implementar Lead/Cliente Drawer;
3. implementar Deal Drawer;
4. completar contexto comercial em Orçamento.

Esses quatro passos entregam o maior ganho com menor risco, porque atacam a lacuna central identificada na pesquisa: **o app lista muita coisa, mas ainda abre pouco o contexto de cada entidade**.

O objetivo final não é substituir ERPNext. O objetivo é que o Aspen Orçamento seja a interface diária rápida para vender, acompanhar e corrigir dados essenciais, deixando o ERPNext como backoffice completo e fonte da verdade.
