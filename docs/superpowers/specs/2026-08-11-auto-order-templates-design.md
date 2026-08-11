# Templates de pedido no orçamento automático

## Contexto

A rota `/auto` recebe uma mensagem livre do cliente, extrai os dados do pedido e monta um rascunho de orçamento.
A seleção atual de produtos depende dos SKUs informados ou das regras de produto aplicadas pelo extrator.
A equipe precisa reutilizar grupos fixos de SKUs, como "Todos os lenços", sem repetir os produtos no texto de cada cliente.
Os templates de pedido descritos neste documento são diferentes dos templates HTML usados para renderizar orçamentos.

## Objetivo

Permitir que toda a equipe crie grupos compartilhados de SKUs e selecione um desses grupos antes de extrair um pedido em `/auto`.
O texto ou imagem continuará fornecendo os dados do cliente, a urgência e as quantidades.
Quando um template estiver selecionado, seus SKUs substituirão qualquer produto mencionado ou inferido no pedido.

## Fora de escopo

- Guardar quantidades dentro do template.
- Templates privados por usuário.
- Combinar produtos do texto com produtos do template.
- Definir um template padrão ou lembrar o último template usado.
- Alterar a precificação, revisão, visualização ou criação atual do orçamento.
- Alterar os templates HTML de orçamento.

## Decisões de produto

### Compartilhamento

Todos os templates serão compartilhados entre os usuários autenticados do dashboard.
A mesma biblioteca será usada e gerenciada por toda a equipe.

### Conteúdo do template

Cada template terá um nome e uma lista ordenada de SKUs.
O template não armazenará quantidades.
O nome será obrigatório e único entre templates ativos.
Cada template terá pelo menos um SKU ativo do catálogo.
SKUs duplicados dentro do mesmo template não serão permitidos.

### Quantidades

As quantidades serão extraídas do pedido no momento do uso.
Uma quantidade será aplicada a todos os SKUs do template.
Várias quantidades gerarão todas as combinações entre quantidades e SKUs no mesmo rascunho.
Por exemplo, o template `[A, B]` usado com `300 e 500 unidades` produzirá `A x 300`, `B x 300`, `A x 500` e `B x 500`.

### Produtos mencionados no pedido

Quando houver um template selecionado, produtos e SKUs mencionados no texto ou imagem serão ignorados.
Quando não houver template selecionado, a extração continuará usando exatamente o comportamento atual.

### Seleção inicial

A tela sempre abrirá com `Nenhum` selecionado.
A ação `Limpar` também retornará a seleção para `Nenhum`.
Essa escolha evita aplicar um grupo de produtos por engano.

## Interface

A página `/auto` exibirá um seletor compacto chamado `Template de pedido` acima da textarea.
O seletor terá `Nenhum` como primeira opção e listará somente templates ativos.
Ao lado do seletor haverá um botão `Gerenciar`.

O botão `Gerenciar` abrirá um modal sem retirar a pessoa do fluxo de orçamento.
O modal listará os templates existentes e permitirá criar, renomear, editar SKUs e arquivar.
A adição de produtos reutilizará a busca existente do catálogo por SKU ou nome.
Um produto selecionado será exibido em uma lista ordenada com remoção individual.
A interface impedirá a inclusão duplicada do mesmo SKU.

Falhas ao salvar manterão o modal aberto e preservarão os dados digitados.
Falhas ao carregar templates mostrarão um aviso, mas não bloquearão o fluxo atual com `Nenhum` selecionado.
Um template arquivado desaparecerá imediatamente do seletor e da lista padrão do modal.

## Modelo de dados

### `order_templates`

- `id` UUID como chave primária.
- `name` como nome exibido.
- `archived` para exclusão lógica.
- `created_at` e `updated_at` com fuso horário.

O banco garantirá nome preenchido.
Um índice parcial garantirá unicidade por `lower(trim(name))` entre templates ativos, permitindo reutilizar o nome de um template arquivado.
A API converterá violações dessa restrição em conflito sem substituir dados existentes.

### `order_template_items`

- `template_id` com referência a `order_templates`.
- `sku` com referência ao catálogo `products`.
- `position` para preservar a ordem escolhida.

A chave de `template_id + sku` impedirá duplicatas.
A chave de `template_id + position` impedirá posições repetidas.
A remoção de um template removerá logicamente o template, sem remover produtos do catálogo.
Produtos referenciados continuarão protegidos pelas regras de arquivamento do catálogo.

## API

Um novo endpoint autenticado `/api/order-templates` atenderá a biblioteca compartilhada.
O endpoint seguirá o formato dos handlers existentes e retornará mensagens públicas em português.

- `GET /api/order-templates` listará templates ativos e seus SKUs.
- `POST /api/order-templates` criará um template.
- `PUT /api/order-templates?id=...` atualizará nome e lista completa de SKUs em uma transação.
- `DELETE /api/order-templates?id=...` arquivará o template, sem exclusão física.

A rota será registrada no catch-all da Vercel e nos dois servidores locais existentes.
A API validará nome, presença de itens, duplicatas, existência dos SKUs e estado ativo dos produtos.

## Fluxo de extração

A página enviará `orderTemplateId` junto com `text`, imagem e demais campos atuais para `/api/extract`.
O cliente nunca enviará a lista de SKUs como fonte de verdade.
O backend carregará o template pelo identificador e validará que ele e todos os produtos associados continuam ativos.

O prompt de extração informará que existe um template selecionado e orientará a IA a extrair os dados do cliente, a urgência e as quantidades.
As quantidades continuarão seguindo as regras atuais do extrator, incluindo o mínimo de 30 unidades.
Depois da resposta da IA, o backend não confiará nos códigos de produto retornados.
Para cada pedido extraído, o backend coletará as quantidades válidas e gerará deterministicamente o produto cartesiano entre quantidades e SKUs do template.
A ordem será quantidade primeiro e posição do SKU depois.

Se o template contiver `[A, B]` e a extração retornar as quantidades `[300, 500]`, os itens finais serão:

1. `A`, quantidade `300`.
2. `B`, quantidade `300`.
3. `A`, quantidade `500`.
4. `B`, quantidade `500`.

Os itens resultantes seguirão o fluxo existente de criação de rascunho, precificação, revisão, visualização e criação do orçamento.
Sem `orderTemplateId`, o backend não executará nenhuma transformação nova.

## Validação e erros

Nome vazio ou lista vazia retornará `400`.
Nome duplicado entre templates ativos retornará `409`.
SKU inexistente, duplicado ou arquivado retornará `400`.
Template inexistente retornará `404`.
Template arquivado selecionado durante uma extração retornará um erro de conflito em português.
Pedido sem quantidade válida continuará usando o tratamento de erro da extração e não criará linhas com quantidade inventada.

Erros internos serão registrados no servidor.
Respostas HTTP não exporão consultas, stack traces, respostas internas do banco ou conteúdo interno do provedor de IA.

## Concorrência e consistência

Criação e atualização validarão o estado dos produtos no servidor.
A atualização do template e de seus itens ocorrerá em uma única transação.
A extração sempre carregará a versão atual do template no servidor.
Se outra pessoa arquivar o template ou um produto associado após o carregamento da página, a extração falhará claramente em vez de usar uma cópia obsoleta do navegador.

## Testes

### Repositório e API

- Criar e listar um template compartilhado.
- Atualizar nome, ordem e SKUs em uma transação.
- Arquivar sem exclusão física.
- Rejeitar nome vazio, lista vazia, nome duplicado, SKU duplicado, inexistente ou arquivado.
- Não retornar templates arquivados na listagem padrão.

### Extração

- Preservar o comportamento atual sem template.
- Ignorar produtos mencionados no pedido quando houver template.
- Gerar todas as combinações para vários SKUs e várias quantidades.
- Preservar um único pedido com linhas para todas as quantidades.
- Rejeitar template inexistente ou arquivado.
- Não aceitar SKUs enviados pelo navegador como fonte de verdade.

### Interface e E2E

- Abrir `/auto` com `Nenhum` selecionado.
- Criar um template pelo modal usando a busca do catálogo.
- Selecionar o template criado.
- Extrair um pedido com nome, e-mail, telefone e `300 e 500 unidades`.
- Confirmar um único rascunho contendo todos os SKUs nas duas quantidades.
- Confirmar que produtos mencionados no texto não entram no rascunho.
- Confirmar que `Limpar` remove texto, imagem e seleção de template.
- Confirmar que uma falha ao carregar templates não impede a extração sem template.

## Critérios de aceite

- Toda a equipe enxerga a mesma biblioteca de templates.
- Um template pode ser criado, alterado e arquivado sem sair de `/auto`.
- Somente produtos válidos do catálogo podem compor um template.
- A seleção inicial e o estado após `Limpar` são sempre `Nenhum`.
- Um template selecionado define integralmente os SKUs do rascunho.
- Cada quantidade extraída é aplicada a todos os SKUs do template no mesmo orçamento.
- O fluxo sem template não sofre regressão.
