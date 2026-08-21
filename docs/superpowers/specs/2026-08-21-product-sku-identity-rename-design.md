# Spec: Identidade estável e renomeação de SKU

**Data:** 2026-08-21
**Status:** proposta para implementação
**Decisão:** o SKU atual poderá mudar; a identidade do produto, não.

## 1. Contexto

Hoje `products.sku` é a chave primária do catálogo. O valor também é usado como chave estrangeira por preços, templates de pedido, itens de orçamento, itens de pedido de venda e atividades do produto.

As FKs atuais usam `ON UPDATE NO ACTION`. O backend rejeita `sku` no `PATCH /product-update`, e a tela de detalhe desabilita o campo para produtos existentes.

O SKU também aparece em:

- rotas hash e URLs de detalhe;
- busca e cache do catálogo;
- rascunhos locais de orçamento;
- itens de orçamento enviados pela API;
- regras de extração da IA;
- `frappe_import_lineage.local_key` e payloads históricos de importação.

Portanto, a mudança não é uma edição de texto. É uma renomeação da chave comercial de um produto existente.

## 2. Objetivo

Permitir que um usuário autorizado altere o SKU de um produto já criado sem:

- criar um segundo produto;
- perder preços, templates ou atividades;
- invalidar referências internas;
- alterar o SKU impresso em orçamento ou pedido já registrado;
- quebrar rascunhos, busca, URLs ou extração de pedidos;
- permitir reutilização ambígua de um SKU histórico.

## 3. Fora de escopo

- Alterar nome, descrição, unidade ou preços como parte da renomeação.
- Recalcular valores de orçamentos ou pedidos.
- Reescrever snapshots de documentos comerciais já emitidos.
- Exclusão física de produtos.
- Sincronizar automaticamente uma renomeação com ERP ou provedor externo que não ofereça contrato explícito para isso.
- Criar fallback de persistência, transporte ou provedor.
- Alterar migrations históricas ou executar migration durante desenvolvimento, build ou startup.
- Criar um novo sistema de permissões ou uma nova identidade de usuário.

## 4. Vocabulário

Esta spec adota os seguintes termos:

- **Identidade do produto:** vínculo permanente com o mesmo produto.
- **SKU atual:** código comercial vigente no catálogo.
- **SKU histórico/alias:** código anteriormente usado pelo mesmo produto.
- **Snapshot da linha:** valores copiados para preservar o conteúdo de um documento.
- **Rascunho:** documento ainda editável.
- **Documento emitido:** orçamento ou pedido que não deve mudar por alterações posteriores do catálogo.

## 5. Invariantes de domínio

1. Cada produto possui um `product_id` imutável.
2. O SKU atual é único entre produtos ativos e arquivados.
3. Um SKU histórico permanece reservado e não pode ser atribuído a outro produto.
4. Renomear SKU não cria, duplica, arquiva ou substitui o produto.
5. Consultas por SKU atual ou histórico resolvem para o mesmo `product_id`.
6. Novos registros comerciais persistem o SKU atual no momento da criação.
7. Snapshots de documentos emitidos são imutáveis.
8. Uma renomeação bem-sucedida é atômica: nenhuma tabela pode observar somente parte da operação.
9. Uma atualização concorrente ou uma tentativa de colisão retorna conflito, sem alteração parcial.

## 6. Modelo de dados alvo

### 6.1 Produtos

Adicionar uma identidade interna estável:

- `products.id` UUID como chave primária;
- `products.sku` continua exposto como SKU atual e recebe índice único;
- os demais campos do produto permanecem sem alteração semântica.

O contrato público passa a retornar `product_id` junto de `sku`. O SKU continua sendo o identificador comercial, não a identidade relacional.

### 6.2 Histórico de SKU

Criar uma tabela de histórico/alias, por exemplo `product_sku_history`, com:

- `sku` histórico único;
- `product_id` referenciando o produto;
- data da atribuição ou renomeação;
- SKU de destino registrado como snapshot;
- motivo opcional da renomeação;
- metadados de auditoria disponíveis no contexto atual.

O registro deve reservar todos os SKUs antigos. A implementação deve garantir unicidade global entre SKU atual e SKU histórico dentro da mesma transação; uma checagem de aplicação sem lock não é suficiente.

A tabela é fonte oficial de compatibilidade, não fallback temporário.

### 6.3 Referências relacionais

As tabelas que hoje referenciam `products.sku` devem passar a referenciar `product_id`:

- `product_pricing_tiers`;
- `order_template_items`;
- `quote_revision_items`;
- `sales_order_items`;
- `product_activity_events`.

Não haverá FK de negócio baseada no SKU atual. Assim, a troca do SKU não depende de `ON UPDATE CASCADE`.

A nomenclatura física poderá preservar colunas legadas durante o período expand-contract, mas o contrato final deve distinguir claramente:

- `product_id`: vínculo relacional;
- `sku_snapshot`: valor exibido no documento naquela ocasião.

### 6.4 Snapshots

`quote_revision_items.produto_sku` continuará sendo o snapshot do SKU do orçamento.

`sales_order_items` deverá possuir um snapshot explícito do SKU. O campo atualmente usado como `product_sku` não poderá continuar exercendo simultaneamente os papéis de FK e código histórico.

Os snapshots de pedidos e revisões emitidas não serão atualizados durante uma renomeação.

### 6.5 Importação histórica

`frappe_import_lineage.local_key` e `legacy_payload` são históricos e não devem ser reescritos apenas porque o catálogo mudou.

Se algum importador ainda aceitar `local_key`, ele deve resolver SKU atual e alias para `product_id`. O vínculo de origem continua preservado.

## 7. Semântica por fluxo

### 7.1 Catálogo

O produto mantém preços, categoria, marca, status, data de criação e atividades. Apenas o SKU atual muda.

A operação registra uma atividade equivalente a:

```text
SKU alterado de ANTIGO para NOVO
```

A atividade deve usar o `product_id` e uma referência determinística que contenha os dois SKUs.

### 7.2 Templates de pedido

Templates referenciam `product_id`.

Ao listar ou usar um template, a interface mostra o SKU atual. Não é necessário editar manualmente todos os templates quando o SKU mudar.

### 7.3 Orçamentos emitidos e aprovados

A revisão comercial mantém o SKU snapshot original, nome, preço e demais valores gravados.

Abrir ou renderizar um orçamento histórico nunca deve consultar o SKU atual para substituir o snapshot.

### 7.4 Orçamentos em rascunho

Rascunhos continuam ligados ao mesmo `product_id`.

Durante a renomeação, linhas de revisões em `rascunho` terão o snapshot de SKU atualizado para o SKU atual, pois ainda são editáveis. A operação também deve atualizar `quotations.updated_at` dos orçamentos afetados para invalidar telas antigas por concorrência otimista.

O usuário deve receber aviso visual de que o SKU do produto mudou. Uma tela com token antigo deve receber conflito e recarregar, nunca sobrescrever a nova informação.

### 7.5 Pedidos de venda

Pedidos já criados preservam o SKU snapshot da linha, independentemente do status. A alteração do catálogo não muda documento comercial existente.

Pedidos novos usam o SKU atual do produto.

### 7.6 Extração de pedidos

O backend deve canonicalizar `item_code` antes de criar ou atualizar um orçamento:

- SKU atual resolve diretamente;
- SKU histórico resolve pelo alias e vira o SKU atual no novo snapshot;
- SKU inexistente continua retornando produto não encontrado.

As regras atuais da IA podem conter SKUs antigos durante a transição. Isso não pode impedir a criação de novos rascunhos, mas novas regras devem preferir SKUs atuais. A canonicalização deve ocorrer no servidor, nunca depender do texto produzido pelo provedor.

### 7.7 Rascunhos locais

Rascunhos armazenados no navegador podem conter SKU histórico. Eles não devem ser descartados automaticamente.

Na criação ou emissão, o backend resolve o alias e grava o SKU atual. A interface pode informar `ANTIGO` → `NOVO` antes de concluir a operação.

Após uma renomeação, o cache de busca do catálogo deve ser invalidado no navegador atual. Outros navegadores devem receber dados atuais por TTL normal e canonicalização no backend.

### 7.8 URLs

A rota canônica de detalhe deve usar `product_id` ou o SKU atual.

Uma URL com SKU histórico deve localizar o produto e redirecionar para o SKU atual, sem criar uma página duplicada. O redirecionamento deve preservar o hash e os parâmetros não sensíveis necessários ao fluxo.

## 8. API

### 8.1 Atualização

O endpoint existente de atualização será mantido para compatibilidade, mas a nova interface usará a identidade interna:

```http
PATCH /api/product-update?product_id=<UUID>
Content-Type: application/json
```

Payload mínimo de renomeação:

```json
{
  "sku": "NOVO-SKU",
  "concurrency_token": "2026-08-21T12:00:00.000Z"
}
```

`sku` no corpo deixa de ser rejeitado somente quando a operação usa o contrato novo. O endpoint pode aceitar `?sku=` como lookup de transição, inclusive alias, mas deve resolver imediatamente para `product_id`.

O retorno inclui:

```json
{
  "success": true,
  "product_id": "uuid",
  "sku": "NOVO-SKU",
  "previous_sku": "ANTIGO-SKU",
  "sku_changed": true
}
```

A operação pode atualizar metadados no mesmo request, mas produto, aliases, snapshots de rascunho e atividade devem ser escritos em uma única transação.

### 8.2 Validação

- `sku` obrigatório quando houver intenção de renomear;
- trim obrigatório;
- máximo de 120 caracteres;
- valor não vazio;
- manter a semântica atual de maiúsculas/minúsculas, salvo decisão posterior explícita;
- SKU igual ao atual é operação idempotente, sem criar alias novo;
- colisão com SKU atual ou histórico retorna `409`;
- token ausente ou vencido retorna `409`;
- produto inexistente retorna `404`;
- erro de validação retorna `400`;
- erros internos não expõem SQL, stack trace, segredo ou payload bruto.

### 8.3 Consultas por SKU

Os endpoints de detalhe, atividade, preços, busca e criação de orçamento devem aceitar alias durante a transição e retornar o produto canônico.

A resposta deve permitir ao frontend distinguir:

```json
{
  "sku": "NOVO-SKU",
  "requested_sku": "ANTIGO-SKU",
  "sku_was_alias": true
}
```

Campos de compatibilidade são opcionais quando a requisição usa o SKU atual.

## 9. Interface

Na edição de produto existente:

1. o campo SKU fica editável;
2. a interface exibe aviso de que a mudança não cria produto novo;
3. ao alterar, mostra `SKU atual` e `Novo SKU`;
4. exige confirmação explícita;
5. informa que documentos comerciais antigos manterão o código original;
6. trata colisão, conflito e falha sem perder os demais campos digitados;
7. após sucesso, navega para o detalhe canônico do novo SKU;
8. invalida o cache de produtos.

O formulário deve enviar `product_id` e token de concorrência. Não deve usar o valor editado como única identidade da requisição.

## 10. Concorrência, auditoria e segurança

- O repository bloqueará o produto e o namespace de SKU durante a renomeação.
- A verificação de colisão e todas as escritas ocorrerão na mesma transação.
- Uma segunda renomeação baseada em estado antigo retornará `409`.
- A autorização será a mesma autorização existente para editar o produto; não haverá nova role nesta entrega.
- Toda renomeação produzirá atividade com SKU antigo e novo.
- Nenhum log deverá registrar dados pessoais, segredos ou erro bruto do banco.
- A operação não enviará escrita externa automaticamente sem contrato específico e aprovação da integração correspondente.

## 11. Estratégia de migração

A mudança exige migration HIGH e seguirá expand-contract. Migrations existentes não serão alteradas.

### Fase 1 — Inventário e preflight

- contar produtos e referências por SKU;
- identificar órfãos e valores inconsistentes;
- validar que cada linha relacional pode ser ligada a um produto;
- inventariar SKUs presentes em regras, fixtures, rascunhos e lineage;
- salvar apenas evidência redigida fora do checkout.

### Fase 2 — Expand

- adicionar `products.id` e preencher todos os produtos existentes;
- adicionar `product_id` nullable às tabelas dependentes;
- adicionar snapshot explícito de SKU às linhas de pedido;
- criar histórico/alias;
- criar índices e FKs novas sem remover as antigas;
- preencher aliases/códigos atuais sem alterar snapshots históricos.

### Fase 3 — Compatibilidade

- repositories escrevem ID e snapshot novos;
- leituras preferem ID e fazem fallback somente para linhas ainda não migradas;
- endpoints resolvem SKU atual e alias;
- frontend passa `product_id` e mantém suporte a URLs antigas;
- novas renomeações permanecem bloqueadas até a validação da fase seguinte.

### Fase 4 — Backfill e validação

- preencher todos os `product_id`;
- preencher snapshots ausentes a partir do SKU persistido na própria linha;
- validar ausência de nulos, órfãos e divergências;
- testar rollback da transação em staging;
- executar `npm run check:db-migrations` e os preflights aprovados.

### Fase 5 — Cutover

- ativar a renomeação;
- habilitar canonicalização de aliases;
- monitorar conflitos, 404 de URL antiga, falhas de conversão de orçamento e falhas de criação de pedido;
- manter compatibilidade pelo período definido operacionalmente.

### Fase 6 — Contract

Somente depois de todos os consumidores migrarem:

- remover FKs e colunas antigas baseadas em SKU;
- promover `product_id` como única referência relacional;
- tornar snapshots explícitos e obrigatórios onde necessário;
- remover fallback de leitura legado;
- atualizar o gate de boundary e testes estáticos.

Cada migration nova deve declarar `-- migration-risk: additive` ou `-- migration-risk: destructive`, conforme `docs/database-migrations.md`.

## 12. Testes

### Banco e repositories

- criar produto e atribuir identidade estável;
- renomear produto sem dependências comerciais;
- renomear produto com preços, template, atividade, orçamento e pedido;
- preservar preços e referências por `product_id`;
- preservar snapshots de orçamento emitido e pedido existente;
- atualizar snapshot somente de rascunho;
- resolver SKU atual e histórico;
- rejeitar colisão com produto ativo, arquivado ou alias histórico;
- rejeitar concorrência com token antigo;
- confirmar rollback integral quando uma escrita dependente falhar;
- impedir reutilização de SKU histórico.

### Orçamentos e pedidos

- criar orçamento usando SKU atual;
- criar orçamento usando alias e persistir SKU atual;
- editar rascunho depois de uma renomeação;
- retornar conflito para tela de rascunho obsoleta;
- converter orçamento aprovado sem depender do SKU antigo existir como produto;
- renderizar documentos históricos com snapshots originais;
- criar pedido novo usando SKU atual;
- manter pedidos antigos inalterados.

### Extração e frontend

- canonicalizar `item_code` antigo produzido pelas regras da IA;
- manter rascunho local antigo recuperável;
- mostrar aviso de alias antes da emissão quando aplicável;
- redirecionar URL antiga para o detalhe atual;
- atualizar breadcrumbs, cache, busca e navegação;
- exibir erros `400`, `404` e `409` em português;
- impedir submissão de SKU duplicado.

### Verificação

- testes unitários focados;
- testes de repository contra PostgreSQL;
- `npm run verify:fast` durante cada tranche;
- `npm run verify:full` antes do cutover;
- `npm run check:db-boundary`;
- `npm run check:db-migrations`;
- `git diff --check`.

## 13. Critérios de aceite

1. O mesmo `product_id` permanece após qualquer quantidade de renomeações.
2. SKU atual e histórico não podem colidir nem ser reutilizados.
3. A renomeação é atômica e protegida contra concorrência.
4. Preços, templates, atividades e referências continuam vinculados ao produto correto.
5. Orçamentos emitidos e pedidos existentes preservam seus SKUs snapshots.
6. Rascunhos podem continuar sendo editados e passam a usar o SKU atual.
7. Novos orçamentos, pedidos e templates usam o SKU atual.
8. URLs e payloads antigos com alias continuam encontrando o produto correto.
9. Regras de extração e rascunhos locais não quebram por conter SKU histórico.
10. Nenhuma migration histórica é alterada e nenhuma migration é executada implicitamente.
11. Erros públicos não expõem dados internos.
12. Todos os gates e verificações definidos nesta spec passam antes da ativação.

## 14. Riscos residuais

- Sistemas externos que tratem SKU como identidade própria podem exigir operação de renomeação separada.
- Textos livres, prompts e planilhas antigas podem continuar contendo SKUs históricos; aliases reduzem a quebra, mas não corrigem material externo.
- URLs antigas podem permanecer compartilhadas fora do dashboard; o redirecionamento deve ser mantido enquanto esses links forem relevantes.
- O histórico de SKU cresce com cada renomeação; limpeza só poderá ocorrer com política explícita de retenção e sem violar documentos históricos.
